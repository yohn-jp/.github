#!/usr/bin/env node
// Generic branch-naming validator for the reusable PR governance workflow
// (.github/workflows/pr-governance.yml). Pattern and exempt list are
// configurable so consumer repositories can express real naming
// differences without forking this script. The default pattern matches
// yohn-jp/gh-inari's own <type>/<issue-number>-<slug> convention, while
// release/<semver> is a separate, issue-less branch class.
//
// Branch naming is not part of gh-inari's semantic authority (it governs
// Issue/PR *content* contracts, not branch names), so owning this check
// here does not create a second authority over anything gh-inari already
// owns.
import { execFileSync } from "node:child_process";
import { classifyReleaseBranch } from "./release-branch.mjs";

const DEFAULT_PATTERN = "^(feat|fix|docs|refactor|test|chore)/\\d+-[a-z0-9-]+$";
const DEFAULT_EXEMPT = ["main"];
export { RELEASE_BRANCH_PATTERN } from "./release-branch.mjs";

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
  return classifyBranchName(branch, options).errors;
}

/**
 * Classify a branch before any PR-template detection occurs.
 *
 * `release/` is intentionally handled before the configurable ordinary
 * branch pattern. This makes malformed release branches fail closed even if a
 * consumer supplies a broad custom pattern or exempts the branch name.
 *
 * @param {string} branch
 * @param {{pattern?: string, exempt?: string[]}} [options]
 * @returns {{kind: "release"|"invalid-release"|"ordinary"|"exempt", valid: boolean, version?: string, errors: string[]}}
 */
export function classifyBranchName(branch, options = {}) {
  const pattern = options.pattern ?? DEFAULT_PATTERN;
  const exempt = options.exempt ?? DEFAULT_EXEMPT;
  if (typeof branch !== "string") {
    return {
      kind: "ordinary",
      valid: false,
      errors: ["branch name must be a string"]
    };
  }
  if (branch.length > MAX_BRANCH_LENGTH) {
    return {
      kind: branch.startsWith("release/") ? "invalid-release" : "ordinary",
      valid: false,
      errors: [
        `branch name exceeds the maximum supported length of ${MAX_BRANCH_LENGTH} characters`
      ]
    };
  }
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return {
      kind: "ordinary",
      valid: false,
      errors: [
        `configured branch-name-pattern exceeds the maximum supported length of ${MAX_PATTERN_LENGTH} characters`
      ]
    };
  }
  let regex;
  try {
    // Trusted workflow-input config, length-bounded above (see the comment
    // near MAX_PATTERN_LENGTH); wrapped so a malformed pattern fails closed.
    regex = new RegExp(pattern); // codeql[js/regex-injection]
  } catch (cause) {
    return {
      kind: "ordinary",
      valid: false,
      errors: [
        `configured branch-name-pattern is not a valid regular expression: ${cause.message}`
      ]
    };
  }

  if (branch.startsWith("release/")) {
    return classifyReleaseBranch(branch);
  }

  if (exempt.includes(branch)) {
    return { kind: "exempt", valid: true, errors: [] };
  }
  if (regex.test(branch)) return { kind: "ordinary", valid: true, errors: [] };
  return {
    kind: "ordinary",
    valid: false,
    errors: [
      `branch name "${branch}" does not match required pattern ${pattern}`
    ]
  };
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
    get("--branch") ??
    execFileSync("git", ["branch", "--show-current"], {
      encoding: "utf8"
    }).trim();
  const pattern =
    get("--pattern") ?? process.env.BRANCH_NAME_PATTERN ?? DEFAULT_PATTERN;
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
