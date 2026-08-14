#!/usr/bin/env node
// Generic branch-naming validator for the reusable PR governance workflow
// (.github/workflows/pr-governance.yml). Pattern and exempt list are
// configurable so consumer repositories can express real naming
// differences without forking this script. The default pattern matches
// yohn-jp/gh-inari's own <type>/<issue-number>-<slug> convention, since
// that's the existing org-wide practice this generalizes.
//
// Branch naming is not part of gh-inari's semantic authority (it governs
// Issue/PR *content* contracts, not branch names), so owning this check
// here does not create a second authority over anything gh-inari already
// owns.
import { execFileSync } from "node:child_process";

const DEFAULT_PATTERN = "^(feat|fix|docs|refactor|test|chore)/\\d+-[a-z0-9-]+$";
const DEFAULT_EXEMPT = ["main"];

// `pattern` is caller-supplied config (the pr-governance.yml workflow_call
// `branch-name-pattern` input, set in a consumer repository's own committed
// workflow YAML) — not attacker-reachable through PR/issue content. It is
// still dynamic input to `RegExp`, so both the pattern and the branch name
// tested against it are length-bounded before compilation: this keeps any
// pathological (catastrophically backtracking) pattern's worst case bounded
// and cheap regardless of source, and a malformed pattern fails closed with
// a clear diagnostic instead of throwing.
const MAX_PATTERN_LENGTH = 200;
const MAX_BRANCH_LENGTH = 200;

/**
 * @param {string} branch
 * @param {{pattern?: string, exempt?: string[]}} [options]
 * @returns {string[]} errors, empty if valid
 */
export function validateBranchName(branch, options = {}) {
  const pattern = options.pattern ?? DEFAULT_PATTERN;
  const exempt = options.exempt ?? DEFAULT_EXEMPT;
  if (exempt.includes(branch)) return [];
  if (branch.length > MAX_BRANCH_LENGTH) {
    return [`branch name exceeds the maximum supported length of ${MAX_BRANCH_LENGTH} characters`];
  }
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return [`configured branch-name-pattern exceeds the maximum supported length of ${MAX_PATTERN_LENGTH} characters`];
  }
  let regex;
  try {
    // codeql[js/regex-injection]: pattern is trusted workflow-input config
    // (see the comment above MAX_PATTERN_LENGTH), length-bounded above, and
    // wrapped here so a malformed pattern fails closed instead of crashing.
    regex = new RegExp(pattern);
  } catch (cause) {
    return [`configured branch-name-pattern is not a valid regular expression: ${cause.message}`];
  }
  if (regex.test(branch)) return [];
  return [`branch name "${branch}" does not match required pattern ${pattern}`];
}

function parseList(value) {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function isMain() {
  return process.argv[1]?.endsWith("validate-branch-name.mjs") ?? false;
}

function main() {
  const argv = process.argv.slice(2);
  const get = (flag) => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };

  const branch =
    get("--branch") ?? execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim();
  const pattern = get("--pattern") ?? process.env.BRANCH_NAME_PATTERN ?? DEFAULT_PATTERN;
  const exemptRaw = get("--exempt") ?? process.env.BRANCH_NAME_EXEMPT;
  const exempt = exemptRaw ? parseList(exemptRaw) : DEFAULT_EXEMPT;

  const errors = validateBranchName(branch, { pattern, exempt });
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    process.exitCode = 1;
    return;
  }
  console.log(`branch name "${branch}" is valid.`);
}

if (isMain()) {
  main();
}
