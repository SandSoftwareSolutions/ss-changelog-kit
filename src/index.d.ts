export interface Release {
  version: string;
  date: string | null;
  yanked: boolean;
  /** Section heading (Added, Fixed, ...) to its items. */
  sections: Record<string, string[]>;
  /** The raw markdown below the heading. */
  body: string;
}

export interface Changelog {
  preamble: string;
  unreleased: Release | null;
  releases: Release[];
  links: Record<string, string>;
  /** Level-2 headings that are not a release (and not inside a code block). Their text is part of the release above them. */
  unrecognised: { line: number; text: string }[];
}

export type EntryType = "Added" | "Changed" | "Deprecated" | "Removed" | "Fixed" | "Security";

export function parseChangelog(text: string): Changelog;
export function releaseNotes(text: string, version: string): string | null;
export function latestVersion(text: string): string | null;
export function addEntry(text: string, type: EntryType, message: string): string;
export function releaseVersion(text: string, version: string, date: string, options?: { repoUrl?: string }): string;
export function compare(a: string, b: string): number;
export function lint(text: string): string[];
