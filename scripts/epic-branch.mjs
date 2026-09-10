#!/usr/bin/env node

// Canonical Epic integration branch class: epic/<issue-number>-<slug>.
//
// An Epic branch is a temporary integration boundary for one tracking/Epic
// Issue and its independently implemented child Issues (see Issue #177). It
// is a distinct branch class, not a variant of the ordinary
// <type>/<issue-number>-<slug> convention: it is always Issue-bound (unlike
// release/<semver>) but is an integration branch, not an implementation
// leaf, so it must be classified and validated independently of the
// consumer-configured ordinary branch-name-pattern.
//
// This module intentionally mirrors release-branch.mjs's shape and
// precedence guarantees. It stops at branch-name classification: automatic
// Epic-child PR routing, merge-method semantics, certification freshness,
// and lifecycle automation are explicitly out of scope for #177 and belong
// to the follow-up Epic development model.

export const EPIC_BRANCH_PATTERN = /^epic\/\d+-[a-z0-9-]+$/;

/**
 * Classify an epic-prefixed branch independently from ordinary branch
 * conventions used by an individual consumer.
 *
 * @param {string} branch
 * @returns {{kind: "epic"|"invalid-epic", valid: boolean, issueNumber?: string, slug?: string, errors: string[]}|undefined}
 */
export function classifyEpicBranch(branch) {
  if (typeof branch !== "string" || !branch.startsWith("epic/")) {
    return undefined;
  }
  if (EPIC_BRANCH_PATTERN.test(branch)) {
    const rest = branch.slice("epic/".length);
    const separatorIndex = rest.indexOf("-");
    return {
      kind: "epic",
      valid: true,
      issueNumber: rest.slice(0, separatorIndex),
      slug: rest.slice(separatorIndex + 1),
      errors: []
    };
  }
  return {
    kind: "invalid-epic",
    valid: false,
    errors: [
      `epic branch "${branch}" must match epic/<issue-number>-<slug> (for example epic/890-runtime-certification)`
    ]
  };
}
