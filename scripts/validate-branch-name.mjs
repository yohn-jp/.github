#!/usr/bin/env node
// Generic branch-naming validator for the reusable PR governance workflow
// (.github/workflows/pr-governance.yml). Pattern and exempt list are
// configurable so consumer repositories can express real naming
// differences without forking this script. The default pattern matches
// yohn-jp/gh-inari's own <type>/<issue-number>-<slug> convention.
// release/<semver> is a separate, issue-less branch class;
// epic/<issue-number>-<slug> and issue/<issue-number>-<slug> are separate,
// Issue-bound integration branch classes. Inari owns all three semantics;
// this script only applies bounded transport configuration to ordinary names.
//
// Branch and release route semantics are delegated to gh-inari. Release
// branches remain Issue-less and use Inari's separate release publication
// surface rather than its canonical Change branch grammar.
import { execFileSync } from "node:child_process";
import { deriveReleasePrPublicationRoute } from "gh-inari";
import * as canonicalBranchNaming from "gh-inari/branch-naming";

const { recognizeBranchName, validateBranchName: validateCanonicalBranchName } =
  canonicalBranchNaming;

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
 * @param {{pattern?: string, exempt?: string[], sourceRevision?: string}} [options]
 * @returns {string[]} errors, empty if valid
 */
export function validateBranchName(branch, options = {}) {
  return classifyBranchName(branch, options).errors;
}

/**
 * Classify a branch before any PR-template detection occurs.
 *
 * Release and integration branches are handled before the configurable
 * ordinary branch pattern. This makes malformed reserved branches fail
 * closed even if a consumer supplies a broad custom pattern or exempts the
 * branch name.
 *
 * @param {string} branch
 * @param {{pattern?: string, exempt?: string[], sourceRevision?: string}} [options]
 * @returns {{kind: "release"|"invalid-release"|"epic"|"invalid-epic"|"issue"|"invalid-issue"|"ordinary"|"exempt", valid: boolean, version?: string, issueNumber?: string, slug?: string, errors: string[]}}
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
      kind: branch.startsWith("release/")
        ? "invalid-release"
        : branch.startsWith("epic/")
          ? "invalid-epic"
          : branch.startsWith("issue/")
            ? "invalid-issue"
            : "ordinary",
      valid: false,
      errors: [
        `branch name exceeds the maximum supported length of ${MAX_BRANCH_LENGTH} characters`
      ]
    };
  }

  // Release and integration classes are independent from the consumer-
  // configured ordinary branch-name-pattern. Each is classified before that
  // pattern is compiled, so a broad/exempting pattern can never authorize a
  // malformed reserved branch.
  if (branch.startsWith("release/")) {
    try {
      const route = deriveReleasePrPublicationRoute(
        branch.slice("release/".length),
        options.sourceRevision ?? ""
      );
      if (route.expectedHead !== branch) {
        return {
          kind: "invalid-release",
          valid: false,
          errors: [
            `canonical Inari release routing returned unexpected head "${route.expectedHead}"`
          ]
        };
      }
      return {
        kind: "release",
        valid: true,
        version: route.targetVersion,
        errors: []
      };
    } catch (cause) {
      return {
        kind: "invalid-release",
        valid: false,
        errors: [cause instanceof Error ? cause.message : String(cause)]
      };
    }
  }
  if (branch.startsWith("epic/") || branch.startsWith("issue/")) {
    const parts = recognizeBranchName(branch);
    const errors = validateCanonicalBranchName(branch);
    if (errors.length > 0 || parts === undefined) {
      return {
        kind: branch.startsWith("epic/") ? "invalid-epic" : "invalid-issue",
        valid: false,
        errors:
          errors.length > 0
            ? [...errors]
            : [
                `branch name "${branch}" is not recognized by canonical Inari branch naming`
              ]
      };
    }
    return {
      kind: parts.type,
      valid: true,
      issueNumber: String(parts.issueNumber),
      slug: parts.slug,
      errors: []
    };
  }

  if (exempt.includes(branch)) {
    return { kind: "exempt", valid: true, errors: [] };
  }

  const canonicalErrors = validateCanonicalBranchName(branch);
  // Explicit exemptions and a consumer's narrower legacy pattern remain
  // bounded transport compatibility, but cannot authorize a branch that
  // Inari rejects. Semantic branch grammar therefore remains canonical.
  if (canonicalErrors.length > 0) {
    return {
      kind: "ordinary",
      valid: false,
      errors: [
        `branch name "${branch}" does not match required pattern ${pattern}; ${canonicalErrors[0]}`
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

  const errors = validateBranchName(branch, {
    pattern,
    exempt,
    sourceRevision: process.env.HEAD_SHA
  });
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
