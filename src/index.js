const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
// `## [1.2.0] - 2026-10-17`; also accepted: `## 1.2.0`, `## v1.2.0`, an en or em dash, and `## 1.2.0 (2026-10-17)`.
const HEADING = /^##\s+\[?v?([^\]\s]+)\]?(?:\s+[-\u2013\u2014]\s+(\S+)|\s+\((\S+)\))?\s*(\[YANKED\])?\s*$/i;
const FENCE = /^\s*(?:```|~~~)/;

// Lines inside a code block are text, not headings. Returns for each line whether it is inside one.
function fenced(lines) {
  let open = false;
  return lines.map((line) => {
    if (FENCE.test(line)) {
      open = !open;
      return true;
    }
    return open;
  });
}

const isRealDate = (date) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date; // 2026-02-30 would roll over to March
};
const lineBreak = (text) => ((text.match(/\r\n/g) ?? []).length > (text.match(/(?<!\r)\n/g) ?? []).length ? "\r\n" : "\n");
const withBreaks = (text, eol) => (eol === "\r\n" ? text.replace(/\n/g, "\r\n") : text);
const SECTIONS = ["Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"];

/**
 * Reads a changelog in the Keep a Changelog format: `## [Unreleased]` and `## [1.2.0] - 2026-10-17`, with `### Added` style
 * sections of `- ` items. Returns `{ preamble, unreleased, releases, links }`. Each release is `{ version, date, yanked, sections, body }`
 * where `sections` maps a heading to its items and `body` is the raw markdown below the heading (kept exactly, for release notes).
 * Text it does not understand stays in `body`, so nothing is lost.
 */
export function parseChangelog(text) {
  if (typeof text !== "string") throw new TypeError("changelog-kit: text must be a string");
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const inFence = fenced(lines);
  const releases = [];
  const links = {};
  const preamble = [];
  const unrecognised = [];
  let current = null;
  for (const [index, line] of lines.entries()) {
    const link = inFence[index] ? null : /^\[([^\]]+)\]:\s*(\S+)\s*$/.exec(line);
    if (link) {
      links[link[1]] = link[2];
      continue;
    }
    const heading = inFence[index] ? null : HEADING.exec(line);
    if (heading && (heading[1].toLowerCase() === "unreleased" || VERSION.test(heading[1]))) {
      current = { version: heading[1].toLowerCase() === "unreleased" ? "Unreleased" : heading[1], date: heading[2] ?? heading[3] ?? null, yanked: Boolean(heading[4]), lines: [] };
      releases.push(current);
    } else {
      if (!inFence[index] && /^##\s/.test(line)) unrecognised.push({ line: index + 1, text: line.trim() });
      if (current) current.lines.push(line);
      else preamble.push(line);
    }
  }
  const done = releases.map((r) => {
    const body = r.lines.join("\n").replace(/^\n+|\n+$/g, "");
    return { version: r.version, date: r.date, yanked: r.yanked, sections: sectionsOf(body), body };
  });
  const unreleased = done.find((r) => r.version === "Unreleased") ?? null;
  return { preamble: preamble.join("\n").replace(/\n+$/, ""), unreleased, releases: done.filter((r) => r.version !== "Unreleased"), links, unrecognised };
}

function sectionsOf(body) {
  const sections = {};
  let name = null;
  const lines = body.split("\n");
  const inFence = fenced(lines);
  for (const [index, line] of lines.entries()) {
    const h = inFence[index] ? null : /^###\s+(.+?)\s*$/.exec(line);
    if (h) {
      name = h[1];
      sections[name] ??= [];
    } else if (name && /^\s*[-*]\s+/.test(line)) sections[name].push(line.replace(/^\s*[-*]\s+/, ""));
    else if (name && /^\s{2,}\S/.test(line) && sections[name].length) sections[name][sections[name].length - 1] += `\n${line.trim()}`;
  }
  return sections;
}

/**
 * The markdown for one version, for a GitHub release: `releaseNotes(text, "1.2.0")` or `"latest"` for the newest release. Returns
 * `null` if the version is not in the file. `"Unreleased"` gives the unreleased part.
 */
export function releaseNotes(text, version) {
  const parsed = parseChangelog(text);
  const entry = version === "Unreleased" ? parsed.unreleased : version === "latest" ? parsed.releases.find((r) => !r.yanked) : parsed.releases.find((r) => r.version === String(version).replace(/^v/, ""));
  return entry ? entry.body : null;
}

/** The newest released version that is not yanked, or `null`. */
export function latestVersion(text) {
  return parseChangelog(text).releases.find((r) => !r.yanked)?.version ?? null;
}

/** Adds an item under `## [Unreleased]` (creating the heading and the `### Added` style section when needed) and returns the new text. `type` is one of Added, Changed, Deprecated, Removed, Fixed, Security. */
export function addEntry(text, type, message) {
  if (!SECTIONS.includes(type)) throw new RangeError(`changelog-kit: type must be one of ${SECTIONS.join(", ")}`);
  if (typeof message !== "string" || message.trim() === "" || /[\r\n]/.test(message)) throw new TypeError("changelog-kit: message must be one line of text");
  const eol = lineBreak(text);
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let inFence = fenced(lines);
  const findHeading = (test, from = 0, to = lines.length) => {
    for (let i = from; i < to; i++) if (!inFence[i] && test(lines[i])) return i;
    return -1;
  };
  let start = findHeading((l) => /^##\s+\[?unreleased\]?\s*$/i.test(l));
  if (start === -1) {
    const firstRelease = findHeading((l) => HEADING.test(l) && VERSION.test(HEADING.exec(l)[1]));
    const at = firstRelease === -1 ? lines.length : firstRelease;
    lines.splice(at, 0, "## [Unreleased]", "", ...(firstRelease === -1 ? [] : [""]));
    start = at;
    inFence = fenced(lines);
  }
  let end = findHeading((l) => /^##\s/.test(l), start + 1);
  if (end === -1) end = lines.length;
  const heading = `### ${type}`;
  const at = findHeading((l) => l.trim() === heading, start + 1, end);
  if (at !== -1) {
    // After the last item of the list (and its continuation lines), also when the list has blank lines in it.
    let sectionEnd = findHeading((l) => /^#{2,3}\s/.test(l), at + 1, end);
    if (sectionEnd === -1) sectionEnd = end;
    let last = at;
    for (let i = at + 1; i < sectionEnd; i++) {
      if (/^\s*[-*]\s+/.test(lines[i]) || (last > at && /^\s{2,}\S/.test(lines[i]) && last === i - 1)) last = i;
    }
    lines.splice(last + 1, 0, `- ${message}`);
  } else {
    // Sections keep the standard order.
    let place = end;
    const wanted = SECTIONS.indexOf(type);
    for (let i = start + 1; i < end; i++) {
      const m = inFence[i] ? null : /^###\s+(.+?)\s*$/.exec(lines[i]);
      if (m && SECTIONS.indexOf(m[1]) > wanted) {
        place = i;
        break;
      }
    }
    const block = [heading, `- ${message}`, ""];
    if (place === end) {
      while (place > start + 1 && lines[place - 1].trim() === "") place--;
      block.unshift("");
      block.pop();
      lines.splice(place, 0, ...block, "");
    } else lines.splice(place, 0, ...block);
  }
  return withBreaks(tidy(lines), eol);
}

const tidy = (lines) => `${lines.join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "").replace(/\n*$/, "")}\n`;

/**
 * Turns the Unreleased part into a release: `releaseVersion(text, "1.2.0", "2026-10-17")`. A new empty `## [Unreleased]` stays on top.
 * Throws if there is nothing under Unreleased, the version is not semver, the date is not a real date, it already exists, or it is
 * not higher than the newest. Link references at the bottom (`[1.2.0]: https://...`) are updated when `repoUrl` is given.
 * The line endings of the file (\n or \r\n) are kept.
 */
export function releaseVersion(text, version, date, { repoUrl } = {}) {
  if (!VERSION.test(version)) throw new RangeError(`changelog-kit: "${version}" is not a semantic version`);
  if (!isRealDate(date)) throw new RangeError("changelog-kit: date must be a real date that looks like 2026-10-17");
  const parsed = parseChangelog(text);
  if (!parsed.unreleased || parsed.unreleased.body.trim() === "") throw new Error("changelog-kit: there is nothing under Unreleased to release");
  if (parsed.releases.some((r) => r.version === version)) throw new Error(`changelog-kit: version ${version} is already in the changelog`);
  const newest = parsed.releases[0]?.version;
  if (newest && compare(version, newest) <= 0) throw new Error(`changelog-kit: ${version} is not higher than the newest release (${newest})`);
  const eol = lineBreak(text);
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const inFence = fenced(lines);
  const at = lines.findIndex((l, i) => !inFence[i] && /^##\s+\[?unreleased\]?\s*$/i.test(l));
  lines.splice(at, 1, "## [Unreleased]", "", `## [${version}] - ${date}`);
  let result = tidy(lines);
  if (repoUrl) {
    const base = repoUrl.replace(/\/$/, "");
    const refs = [`[Unreleased]: ${base}/compare/v${version}...HEAD`, `[${version}]: ${newest ? `${base}/compare/v${newest}...v${version}` : `${base}/releases/tag/v${version}`}`];
    result = result.replace(/^\[(?:Unreleased)\]:.*\n?/gim, "");
    const body = result.replace(/\n+$/, "");
    const firstRef = /^\[[^\]]+\]:\s/m.exec(body);
    result = firstRef ? `${body.slice(0, firstRef.index)}${refs.join("\n")}\n${body.slice(firstRef.index)}\n` : `${body}\n\n${refs.join("\n")}\n`;
  }
  return withBreaks(result, eol);
}

/** Compares two semantic versions: negative, 0 or positive. Pre-releases are lower than the release. */
export function compare(a, b) {
  const parse = (v) => {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(v);
    if (!m) throw new RangeError(`changelog-kit: "${v}" is not a semantic version`);
    return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split(".") : null };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] - y.core[i];
  if (!x.pre && !y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn && Number(p) !== Number(q)) return Number(p) - Number(q);
    if (pn !== qn) return pn ? -1 : 1;
    if (!pn && p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

/** Checks the file for problems: versions that are not descending, missing dates, duplicate versions, empty releases. Returns a list of messages (empty = fine). */
export function lint(text) {
  const { releases, unrecognised } = parseChangelog(text);
  const problems = [];
  for (const { line, text: heading } of unrecognised) problems.push(`line ${line}: "${heading}" is not a release heading (expected "## [1.2.0] - 2026-10-17"); its text counts as part of the release above it`);
  const seen = new Set();
  releases.forEach((r, i) => {
    if (seen.has(r.version)) problems.push(`${r.version} appears twice`);
    seen.add(r.version);
    if (!r.date) problems.push(`${r.version} has no date`);
    else if (!isRealDate(r.date)) problems.push(`${r.version} has an invalid date (${r.date})`);
    if (r.body.trim() === "") problems.push(`${r.version} has no entries`);
    const next = releases[i + 1];
    if (next && compare(r.version, next.version) <= 0) problems.push(`${r.version} should be higher than the one below it (${next.version})`);
    if (next && r.date && next.date && r.date < next.date) problems.push(`${r.version} is dated before ${next.version}`);
  });
  return problems;
}
