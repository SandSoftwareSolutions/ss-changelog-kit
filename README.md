# @sandsoftwaresolutions/changelog-kit

[![CI](https://github.com/SandSoftwareSolutions/ss-changelog-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/SandSoftwareSolutions/ss-changelog-kit/actions/workflows/ci.yml)

Work with a `CHANGELOG.md` in the [Keep a Changelog](https://keepachangelog.com/) format: add an entry, cut a release, get the text for the GitHub release page, and check the file for mistakes. It does by script what you now do by hand at every release. No dependencies.

## Install

```bash
npm install @sandsoftwaresolutions/changelog-kit
```

## Usage

```js
import { readFileSync, writeFileSync } from "node:fs";
import { addEntry, releaseVersion, releaseNotes, latestVersion, lint } from "@sandsoftwaresolutions/changelog-kit";

let text = readFileSync("CHANGELOG.md", "utf8");

text = addEntry(text, "Fixed", "Project names that Windows cannot create are refused");   // under ## [Unreleased]
text = releaseVersion(text, "0.5.1", "2026-10-17", { repoUrl: "https://github.com/me/app" });
writeFileSync("CHANGELOG.md", text);

releaseNotes(text, "0.5.1");   // the markdown of that release, ready for `gh release create --notes`
releaseNotes(text, "latest");
latestVersion(text);           // "0.5.1"
lint(text);                    // [] or a list of problems, for CI
```

Tested against the changelogs of Foundry and Assay.

## What each function does

| Function | Does |
| --- | --- |
| `parseChangelog(text)` | `{ preamble, unreleased, releases, links }`; each release has `version`, `date`, `yanked`, `sections` (`Added: [items]`) and `body` (the raw markdown, kept exactly) |
| `addEntry(text, type, message)` | adds `- message` under `### type` in Unreleased; creates the section in the standard order (Added, Changed, Deprecated, Removed, Fixed, Security) or the whole Unreleased heading when needed |
| `releaseVersion(text, version, date)` | turns Unreleased into `## [version] - date` and leaves a fresh empty `## [Unreleased]`; with `repoUrl` the compare links at the bottom are updated |
| `releaseNotes(text, version)` | the body of one version (`"latest"` and `"Unreleased"` work, a leading `v` is fine), or `null` |
| `lint(text)` | duplicate versions, versions not descending, missing or invalid dates, empty releases, dates in the wrong order |
| `compare(a, b)` | semantic version order, with pre-releases below the release |

`releaseVersion` refuses what would make the file wrong: nothing under Unreleased, a version that is not semver, one that already exists, or one that is not higher than the newest. Windows line endings are accepted; text it does not recognise is kept, never dropped.
