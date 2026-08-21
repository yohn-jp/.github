import test from "node:test";
import assert from "node:assert/strict";
import { resolvePullRequestTemplate } from "../scripts/pr-contract-routing.mjs";

test("release branch explicitly routes to the release contract", () => {
  assert.deepEqual(resolvePullRequestTemplate({ branch: "release/0.5.1" }), {
    classification: "release",
    template: "release",
    version: "0.5.1",
    errors: []
  });
});

test("release routing wins over an ambiguous caller template input", () => {
  assert.equal(
    resolvePullRequestTemplate({
      branch: "release/1.0.0",
      template: "default"
    }).template,
    "release"
  );
});

test("malformed release branches cannot reach template validation", () => {
  const result = resolvePullRequestTemplate({ branch: "release/foo" });
  assert.equal(result.classification, "invalid-release");
  assert.equal(result.template, undefined);
  assert.match(result.errors[0], /must match release\/<semver>/);
});

test("ordinary PRs preserve explicit template routing", () => {
  assert.deepEqual(
    resolvePullRequestTemplate({
      branch: "fix/123-slug",
      template: "default"
    }),
    { classification: "ordinary", template: "default", errors: [] }
  );
});
