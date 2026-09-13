import test from "node:test";
import assert from "node:assert/strict";
import { classifyPullRequestBranch } from "../scripts/pr-contract-routing.mjs";

test("release branch classifies as release with its version", () => {
  assert.deepEqual(classifyPullRequestBranch({ branch: "release/0.5.1" }), {
    classification: "release",
    version: "0.5.1",
    errors: []
  });
});

test("malformed release branches cannot reach template validation", () => {
  const result = classifyPullRequestBranch({ branch: "release/foo" });
  assert.equal(result.classification, "invalid-release");
  assert.match(result.errors[0], /must match release\/<semver>/);
});

test("ordinary branches classify as ordinary", () => {
  assert.deepEqual(classifyPullRequestBranch({ branch: "fix/123-slug" }), {
    classification: "ordinary",
    errors: []
  });
});
