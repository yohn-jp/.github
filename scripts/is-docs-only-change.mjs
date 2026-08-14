#!/usr/bin/env node
// Decides whether a set of changed file paths is "docs-only" against a list
// of glob patterns, for the `release-docs-fast-path` capability of the
// reusable TypeScript CLI CI workflow. Reads changed paths from stdin (one
// per line, e.g. `git diff --name-only base...head`) and glob patterns from
// argv. Exits 0 (docs-only) if every changed path matches at least one
// pattern, exits 1 otherwise. Exits 1 (not docs-only) if there are no
// changed paths at all, since an empty diff is not a meaningful fast-path
// signal and the caller should fall back to the full pipeline.

import { readFileSync } from "node:fs";

/**
 * Converts a simple glob (supporting `*`, `**`, `?`) into a RegExp.
 * `**` matches across path separators; `*` does not; `?` matches one
 * non-separator character.
 */
export function globToRegExp(pattern) {
  let out = "^";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        out += ".*";
        i++;
        if (pattern[i + 1] === "/") i++;
      } else {
        out += "[^/]*";
      }
    } else if (c === "?") {
      out += "[^/]";
    } else if (".+^${}()|[]\\".includes(c)) {
      out += `\\${c}`;
    } else {
      out += c;
    }
  }
  out += "$";
  return new RegExp(out);
}

/**
 * @param {string[]} paths changed file paths
 * @param {string[]} patterns glob patterns
 * @returns {boolean} true if every path matches at least one pattern
 */
export function isDocsOnlyChange(paths, patterns) {
  if (paths.length === 0) return false;
  const regexes = patterns.map(globToRegExp);
  return paths.every((p) => regexes.some((re) => re.test(p)));
}

function isMain() {
  return process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
}

function main() {
  const patterns = process.argv.slice(2);
  if (patterns.length === 0) {
    console.error("usage: is-docs-only-change.mjs <glob-pattern>... < changed-paths.txt");
    process.exit(2);
  }

  const input = readFileSync(0, "utf8");
  const paths = input
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const result = isDocsOnlyChange(paths, patterns);
  console.log(result ? "docs-only" : "not-docs-only");
  process.exit(result ? 0 : 1);
}

if (isMain()) {
  main();
}
