const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const HEADING = /^##\s+\[?([^\]\s]+)\]?(?:\s+-\s+(\S+))?\s*(\[YANKED\])?\s*$/i;
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
  const releases = [];
  const links = {};
  const preamble = [];
  let current = null;
  for (const line of lines) {
    const link = /^\[([^\]]+)\]:\s*(\S+)\s*$/.exec(line);
    if (link) {
      links[link[1]] = link[2];
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading && (heading[1].toLowerCase() === "unreleased" || VERSION.test(heading[1]))) {
      current = { version: heading[1].toLowerCase() === "unreleased" ? "Unreleased" : heading[1], date: heading[2] ?? null, yanked: Boolean(heading[3]), lines: [] };
      releases.push(current);
    } else if (current) current.lines.push(line);
    else preamble.push(line);
  }
  const done = releases.map((r) => {
    const body = r.lines.join("\n").replace(/^\n+|\n+$/g, "");
    return { version: r.version, date: r.date, yanked: r.yanked, sections: sectionsOf(body), body };
  });
  const unreleased = done.find((r) => r.version === "Unreleased") ?? null;
  return { preamble: preamble.join("\n").replace(/\n+$/, ""), unreleased, releases: done.filter((r) => r.version !== "Unreleased"), links };
}

function sectionsOf(body) {
  const sections = {};
  let name = null;
  for (const line of body.split("\n")) {
    const h = /^###\s+(.+?)\s*$/.exec(line);
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
  const entry = version === "Unreleased" ? parsed.unreleased : version === "latest" ? parsed.releases[0] : parsed.releases.find((r) => r.version === String(version).replace(/^v/, ""));
  return entry ? entry.body : null;
}

/** The newest released version, or `null`. */
export function latestVersion(text) {
  return parseChangelog(text).releases[0]?.version ?? null;
}

/** Adds an item under `## [Unreleased]` (creating the heading and the `### Added` style section when needed) and returns the new text. `type` is one of Added, Changed, Deprecated, Removed, Fixed, Security. */
export function addEntry(text, type, message) {
  if (!SECTIONS.includes(type)) throw new RangeError(`changelog-kit: type must be one of ${SECTIONS.join(", ")}`);
  if (typeof message !== "string" || message.trim() === "" || message.includes("\n")) throw new TypeError("changelog-kit: message must be one line of text");
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let start = lines.findIndex((l) => /^##\s+\[?unreleased\]?\s*$/i.test(l));
  if (start === -1) {
    const firstRelease = lines.findIndex((l) => HEADING.test(l) && VERSION.test(HEADING.exec(l)[1]));
    const at = firstRelease === -1 ? lines.length : firstRelease;
    lines.splice(at, 0, "## [Unreleased]", "", ...(firstRelease === -1 ? [] : [""]));
    start = at;
  }
  let end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  if (end === -1) end = lines.length;
  const heading = `### ${type}`;
  const at = lines.findIndex((l, i) => i > start && i < end && l.trim() === heading);
  if (at !== -1) {
    let insert = at + 1;
    while (insert < end && lines[insert].trim() !== "" && !lines[insert].startsWith("###")) insert++;
    lines.splice(insert, 0, `- ${message}`);
  } else {
    // Sections keep the standard order.
    let place = end;
    const wanted = SECTIONS.indexOf(type);
    for (let i = start + 1; i < end; i++) {
      const m = /^###\s+(.+?)\s*$/.exec(lines[i]);
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
  return tidy(lines);
}

const tidy = (lines) => `${lines.join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "").replace(/\n*$/, "")}\n`;

/**
 * Turns the Unreleased part into a release: `releaseVersion(text, "1.2.0", "2026-10-17")`. A new empty `## [Unreleased]` stays on top.
 * Throws if there is nothing under Unreleased, the version is not semver, it already exists, or it is not higher than the newest.
 * Link references at the bottom (`[1.2.0]: https://...`) are updated when `repoUrl` is given.
 */
export function releaseVersion(text, version, date, { repoUrl } = {}) {
  if (!VERSION.test(version)) throw new RangeError(`changelog-kit: "${version}" is not a semantic version`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new RangeError("changelog-kit: date must look like 2026-10-17");
  const parsed = parseChangelog(text);
  if (!parsed.unreleased || parsed.unreleased.body.trim() === "") throw new Error("changelog-kit: there is nothing under Unreleased to release");
  if (parsed.releases.some((r) => r.version === version)) throw new Error(`changelog-kit: version ${version} is already in the changelog`);
  const newest = parsed.releases[0]?.version;
  if (newest && compare(version, newest) <= 0) throw new Error(`changelog-kit: ${version} is not higher than the newest release (${newest})`);
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const at = lines.findIndex((l) => /^##\s+\[?unreleased\]?\s*$/i.test(l));
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
  return result;
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
  const { releases } = parseChangelog(text);
  const problems = [];
  const seen = new Set();
  releases.forEach((r, i) => {
    if (seen.has(r.version)) problems.push(`${r.version} appears twice`);
    seen.add(r.version);
    if (!r.date) problems.push(`${r.version} has no date`);
    else if (Number.isNaN(Date.parse(r.date))) problems.push(`${r.version} has an invalid date (${r.date})`);
    if (r.body.trim() === "") problems.push(`${r.version} has no entries`);
    const next = releases[i + 1];
    if (next && compare(r.version, next.version) <= 0) problems.push(`${r.version} should be higher than the one below it (${next.version})`);
    if (next && r.date && next.date && r.date < next.date) problems.push(`${r.version} is dated before ${next.version}`);
  });
  return problems;
}
