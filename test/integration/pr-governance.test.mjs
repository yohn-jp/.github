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

function pullRequest(branch, body) {
  return {
    title: "feat(core): deliver governed change",
    body,
    root,
    branch
  };
}

test("release/0.5.1 passes the release contract without an Issue", async () => {
  assert.deepEqual(validateBranchName("release/0.5.1"), []);
  const result = await validatePullRequest(
    pullRequest("release/0.5.1", releaseBody)
  );
  assert.equal(result.valid, true);
  assert.equal(result.branchClassification, "release");
  assert.equal(result.contract.templateIdentity.id, "release");
});

test("release/1.0.0 uses the same release contract", async () => {
  assert.deepEqual(validateBranchName("release/1.0.0"), []);
  const result = await validatePullRequest(
    pullRequest("release/1.0.0", releaseBody)
  );
  assert.equal(result.valid, true);
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

test("ordinary Issue-bound PRs keep default contract auto-detection", async () => {
  assert.equal(validateBranchName("fix/123-slug").length, 0);
  const result = await validatePullRequest(
    pullRequest("fix/123-slug", defaultBody)
  );
  assert.equal(result.valid, true);
  assert.equal(result.branchClassification, "ordinary");
  assert.equal(result.contract.templateIdentity.id, "default");
});
