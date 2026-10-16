import assert from "node:assert/strict";
import { test } from "node:test";

import { addEntry, compare, latestVersion, lint, parseChangelog, releaseNotes, releaseVersion } from "./src/index.js";

const sample = `# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
- A new thing
- Another thing

## [0.2.0] - 2026-10-16

### Added
- \`--fast\` mode
  with a second line

### Fixed
- A bug

## [0.1.0] - 2026-10-15

### Added
- First release

[Unreleased]: https://github.com/x/y/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/x/y/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/x/y/releases/tag/v0.1.0
`;

test("parses unreleased, releases, sections, items and links", () => {
  const c = parseChangelog(sample);
  assert.match(c.preamble, /^# Changelog/);
  assert.deepEqual(c.unreleased.sections, { Added: ["A new thing", "Another thing"] });
  assert.deepEqual(c.releases.map((r) => [r.version, r.date]), [["0.2.0", "2026-10-16"], ["0.1.0", "2026-10-15"]]);
  assert.deepEqual(c.releases[0].sections, { Added: ["`--fast` mode\nwith a second line"], Fixed: ["A bug"] });
  assert.equal(c.links["0.2.0"], "https://github.com/x/y/compare/v0.1.0...v0.2.0");
});

test("release notes are the exact markdown of a version", () => {
  assert.equal(releaseNotes(sample, "0.2.0"), "### Added\n- `--fast` mode\n  with a second line\n\n### Fixed\n- A bug");
  assert.equal(releaseNotes(sample, "v0.1.0"), "### Added\n- First release");
  assert.equal(releaseNotes(sample, "latest"), releaseNotes(sample, "0.2.0"));
  assert.equal(releaseNotes(sample, "Unreleased"), "### Added\n- A new thing\n- Another thing");
  assert.equal(releaseNotes(sample, "9.9.9"), null);
  assert.equal(latestVersion(sample), "0.2.0");
  assert.equal(latestVersion("# nothing"), null);
});

test("addEntry appends to an existing section", () => {
  const out = addEntry(sample, "Added", "Third thing");
  assert.match(out, /- Another thing\n- Third thing\n\n## \[0\.2\.0\]/);
  assert.equal(parseChangelog(out).unreleased.sections.Added.length, 3);
});

test("addEntry creates sections in the standard order, and the Unreleased heading when missing", () => {
  let out = addEntry(sample, "Fixed", "Squashed");
  out = addEntry(out, "Changed", "Altered");
  const headings = [...parseChangelog(out).unreleased.body.matchAll(/^### (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(headings, ["Added", "Changed", "Fixed"]);
  const fresh = addEntry("# Changelog\n\n## [1.0.0] - 2026-01-01\n\n### Added\n- x\n", "Added", "New");
  assert.match(fresh, /## \[Unreleased\]\n\n### Added\n- New\n\n## \[1\.0\.0\]/);
  assert.match(addEntry("# Changelog\n", "Security", "Patched"), /## \[Unreleased\]\n\n### Security\n- Patched\n$/);
});

test("addEntry refuses bad input", () => {
  assert.throws(() => addEntry(sample, "Improved", "x"), RangeError);
  assert.throws(() => addEntry(sample, "Added", ""), TypeError);
  assert.throws(() => addEntry(sample, "Added", "two\nlines"), TypeError);
});

test("releaseVersion turns Unreleased into a release and keeps a new empty Unreleased on top", () => {
  const out = releaseVersion(sample, "0.3.0", "2026-10-17");
  assert.match(out, /## \[Unreleased\]\n\n## \[0\.3\.0\] - 2026-10-17\n\n### Added\n- A new thing/);
  const c = parseChangelog(out);
  assert.equal(c.releases[0].version, "0.3.0");
  assert.equal(c.unreleased.body, "");
  assert.deepEqual(lint(out), []);
});

test("releaseVersion updates the link references when it knows the repository", () => {
  const out = releaseVersion(sample, "0.3.0", "2026-10-17", { repoUrl: "https://github.com/x/y/" });
  assert.match(out, /\[Unreleased\]: https:\/\/github\.com\/x\/y\/compare\/v0\.3\.0\.\.\.HEAD\n\[0\.3\.0\]: https:\/\/github\.com\/x\/y\/compare\/v0\.2\.0\.\.\.v0\.3\.0\n\[0\.2\.0\]:/);
  assert.equal((out.match(/^\[Unreleased\]:/gm) ?? []).length, 1);
});

test("releaseVersion refuses mistakes", () => {
  assert.throws(() => releaseVersion(sample, "0.2.0", "2026-10-17"), /already in the changelog/);
  assert.throws(() => releaseVersion(sample, "0.1.5", "2026-10-17"), /not higher/);
  assert.throws(() => releaseVersion(sample, "1.0", "2026-10-17"), RangeError);
  assert.throws(() => releaseVersion(sample, "0.3.0", "17-10-2026"), RangeError);
  assert.throws(() => releaseVersion("# C\n\n## [Unreleased]\n\n## [0.1.0] - 2026-01-01\n\n### Added\n- x\n", "0.2.0", "2026-10-17"), /nothing under Unreleased/);
  assert.throws(() => releaseVersion("# C\n", "0.2.0", "2026-10-17"), /nothing under Unreleased/);
});

test("compare follows semantic versioning", () => {
  const order = ["0.1.0", "0.2.0", "0.10.0", "1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta", "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1", "1.0.0", "1.0.1"];
  for (let i = 0; i < order.length - 1; i++) assert.ok(compare(order[i], order[i + 1]) < 0, `${order[i]} < ${order[i + 1]}`);
  assert.equal(compare("1.2.3", "1.2.3"), 0);
  assert.equal(compare("1.2.3+build", "1.2.3"), 0);
  assert.throws(() => compare("x", "1.0.0"), RangeError);
});

test("lint finds the mistakes people make", () => {
  const bad = `# C\n\n## [1.0.0] - 2026-01-01\n\n### Added\n- a\n\n## [1.1.0] - 2026-02-01\n\n### Added\n- b\n\n## [1.1.0] - 2026-02-02\n\n## [0.9.0]\n\n### Added\n- c\n\n## [0.8.0] - 2026-13-45\n\n### Added\n- d\n`;
  const problems = lint(bad);
  assert.ok(problems.some((p) => /1\.1\.0 appears twice/.test(p)));
  assert.ok(problems.some((p) => /1\.0\.0 should be higher than the one below it \(1\.1\.0\)/.test(p)));
  assert.ok(problems.some((p) => /0\.9\.0 has no date/.test(p)));
  assert.ok(problems.some((p) => /0\.8\.0 has an invalid date/.test(p)));
  assert.ok(problems.some((p) => /1\.1\.0 has no entries/.test(p)));
  assert.deepEqual(lint(sample), []);
});

test("Windows line endings and yanked releases", () => {
  const c = parseChangelog("## [Unreleased]\r\n\r\n### Fixed\r\n- x\r\n\r\n## [1.0.0] - 2026-01-01 [YANKED]\r\n\r\n### Added\r\n- y\r\n");
  assert.deepEqual(c.unreleased.sections, { Fixed: ["x"] });
  assert.equal(c.releases[0].yanked, true);
  assert.throws(() => parseChangelog(5), TypeError);
});
