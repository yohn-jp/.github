import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validatePullRequest } from "../../scripts/validate-pr.mjs";
import { validateBranchName } from "../../scripts/validate-branch-name.mjs";

const root = process.cwd();
const releaseBody = await readFile(
  "test/fixtures/pr-governance/release.md",
  "utf8"
);
const defaultBody = await readFile(
  "test/fixtures/pr-governance/default.md",
  "utf8"
);

function withMarker(body, path) {
  return `${body}\n<!-- inari:template {"version":"1","kind":"pull_request","path":"${path}"} -->\n`;
}

function stripTrailingMarker(body) {
  return body.replace(/\n<!-- inari:template.*-->\s*$/u, "\n");
}

function pullRequest(
  branch,
  body,
  requestRoot = root,
  title = "feat(core): deliver governed change"
) {
  return {
    title,
    body,
    root: requestRoot,
    branch
  };
}

test("a PR body with the default template's marker resolves the default contract", async () => {
  assert.equal(validateBranchName("fix/123-slug").length, 0);
  const result = await validatePullRequest(
    pullRequest("fix/123-slug", defaultBody)
  );
  assert.equal(result.valid, true);
  assert.equal(result.branchClassification, "ordinary");
  assert.equal(result.contract.templateIdentity.id, "default");
});

test("a PR body with the release template's marker resolves the release contract, independent of branch", async () => {
  const result = await validatePullRequest(
    pullRequest("release/0.5.1", releaseBody)
  );
  assert.equal(result.valid, true);
  assert.equal(result.branchClassification, "release");
  assert.equal(result.contract.templateIdentity.id, "release");
});

test("marker resolution does not depend on the release branch shape", async () => {
  // The marker alone selects the contract; an ordinary branch carrying a
  // release-templated body still resolves the release contract (Issue #211:
  // no branch/path/body-shape inference participates in template selection).
  const result = await validatePullRequest(
    pullRequest("fix/999-slug", releaseBody)
  );
  assert.equal(result.valid, true);
  assert.equal(result.branchClassification, "ordinary");
  assert.equal(result.contract.templateIdentity.id, "release");
});

test("malformed release branches are rejected before contract validation", async () => {
  for (const branch of ["release/foo", "release/0.5"]) {
    assert.equal(validateBranchName(branch).length, 1);
    const result = await validatePullRequest(pullRequest(branch, releaseBody));
    assert.equal(result.valid, false);
    assert.equal(result.branchClassification, "invalid-release");
    assert.equal(
      result.violations[0].code,
      "GOVERNANCE_RELEASE_BRANCH_INVALID"
    );
  }
});

test("epic/890-runtime-certification passes branch-name validation as an integration branch", async () => {
  assert.deepEqual(validateBranchName("epic/890-runtime-certification"), []);
  const result = await validatePullRequest(
    pullRequest("epic/890-runtime-certification", defaultBody)
  );
  // #177 is deliberately narrow: an epic branch is a new, protected
  // integration branch class, but it does not introduce a new PR *content*
  // contract or automatic child-Issue routing. PR content for an epic head
  // branch is resolved from its own marker like any other branch.
  assert.equal(result.valid, true);
  assert.equal(result.branchClassification, "ordinary");
  assert.equal(result.contract.templateIdentity.id, "default");
});

test("malformed epic branches are rejected by branch-name validation before reaching PR content checks", async () => {
  for (const branch of ["epic/foo", "epic/890"]) {
    const errors = validateBranchName(branch);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /must match epic\/<issue-number>-<slug>/);
  }
});

test("a canonical Epic branch with a canonical Epic PR title passes end to end", async () => {
  assert.deepEqual(validateBranchName("epic/890-runtime-certification"), []);
  const result = await validatePullRequest(
    pullRequest(
      "epic/890-runtime-certification",
      defaultBody,
      root,
      "epic(runtime): integrate certification pipeline"
    )
  );
  assert.equal(result.valid, true);
  assert.equal(result.branchClassification, "ordinary");
  assert.equal(result.contract.templateIdentity.id, "default");
});

test("a malformed Epic PR title fails closed even with an otherwise valid Epic branch and body", async () => {
  const result = await validatePullRequest(
    pullRequest(
      "epic/890-runtime-certification",
      defaultBody,
      root,
      "epic: integrate certification pipeline"
    )
  );
  assert.equal(result.valid, false);
  assert.equal(result.violations[0].code, "GOVERNANCE_EPIC_PR_TITLE_INVALID");
});

test("an ordinary PR title that merely mentions epic is unaffected", async () => {
  const result = await validatePullRequest(
    pullRequest(
      "fix/123-slug",
      defaultBody,
      root,
      "feat(core): improve epic dashboard filters"
    )
  );
  assert.equal(result.valid, true);
  assert.equal(result.branchClassification, "ordinary");
});

test("a synchronized consumer accepts an Inari-generated ordinary PR body without repair", async () => {
  const result = await validatePullRequest(
    pullRequest("fix/125-inari-governance", defaultBody)
  );
  assert.equal(result.valid, true);
  assert.equal(result.contract.templateIdentity.id, "default");
  assert.deepEqual(result.result.parse.values.validation, [
    "typecheck",
    "tests",
    "build"
  ]);
});

test("missing marker fails deterministically", async () => {
  const result = await validatePullRequest(
    pullRequest("fix/123-slug", stripTrailingMarker(defaultBody))
  );
  assert.equal(result.valid, false);
  assert.equal(result.violations[0].code, "GOVERNANCE_TEMPLATE_MARKER_MISSING");
});

test("malformed marker fails deterministically", async () => {
  const body = `${stripTrailingMarker(defaultBody)}\n<!-- inari:template {not-json} -->\n`;
  const result = await validatePullRequest(pullRequest("fix/123-slug", body));
  assert.equal(result.valid, false);
  assert.equal(result.violations[0].code, "GOVERNANCE_TEMPLATE_MARKER_INVALID");
});

test("multiple markers fail deterministically as ambiguous", async () => {
  const once = withMarker(
    stripTrailingMarker(defaultBody),
    ".github/PULL_REQUEST_TEMPLATE/default.md"
  );
  const twice = withMarker(once, ".github/PULL_REQUEST_TEMPLATE/release.md");
  const result = await validatePullRequest(pullRequest("fix/123-slug", twice));
  assert.equal(result.valid, false);
  assert.equal(
    result.violations[0].code,
    "GOVERNANCE_TEMPLATE_MARKER_AMBIGUOUS"
  );
});

test("a marker referencing an unavailable template fails deterministically", async () => {
  const body = withMarker(
    stripTrailingMarker(defaultBody),
    ".github/PULL_REQUEST_TEMPLATE/does-not-exist.md"
  );
  const result = await validatePullRequest(pullRequest("fix/123-slug", body));
  assert.equal(result.valid, false);
  assert.equal(result.violations[0].code, "GOVERNANCE_TEMPLATE_UNAVAILABLE");
});

test("a marker with kind other than pull_request is rejected", async () => {
  const body = `${stripTrailingMarker(defaultBody)}\n<!-- inari:template {"version":"1","kind":"issue","path":".github/ISSUE_TEMPLATE/bug.yml"} -->\n`;
  const result = await validatePullRequest(pullRequest("fix/123-slug", body));
  assert.equal(result.valid, false);
  assert.equal(
    result.violations[0].code,
    "GOVERNANCE_TEMPLATE_MARKER_WRONG_KIND"
  );
});
