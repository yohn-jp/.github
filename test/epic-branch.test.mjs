import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyEpicBranch,
  classifyEpicPrTitle
} from "../scripts/epic-branch.mjs";

test("classifyEpicBranch accepts a canonical Epic integration branch", () => {
  assert.deepEqual(classifyEpicBranch("epic/890-runtime-certification"), {
    kind: "epic",
    valid: true,
    issueNumber: "890",
    slug: "runtime-certification",
    errors: []
  });
});

test("classifyEpicBranch rejects a malformed epic branch", () => {
  const result = classifyEpicBranch("epic/foo");
  assert.equal(result.kind, "invalid-epic");
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /must match epic\/<issue-number>-<slug>/);
});

test("classifyEpicBranch returns undefined for a non-epic branch", () => {
  assert.equal(classifyEpicBranch("feat/42-add-init-command"), undefined);
  assert.equal(classifyEpicBranch("release/1.2.3"), undefined);
});

test("classifyEpicPrTitle accepts a canonical Epic PR title", () => {
  assert.deepEqual(
    classifyEpicPrTitle("epic(runtime): integrate certification pipeline"),
    {
      kind: "epic",
      valid: true,
      scope: "runtime",
      description: "integrate certification pipeline",
      errors: []
    }
  );
});

test("classifyEpicPrTitle accepts a hyphenated scope", () => {
  const result = classifyEpicPrTitle(
    "epic(runtime-cert): integrate certification pipeline"
  );
  assert.equal(result.kind, "epic");
  assert.equal(result.valid, true);
  assert.equal(result.scope, "runtime-cert");
});

test("classifyEpicPrTitle rejects a title missing the scope parentheses", () => {
  const result = classifyEpicPrTitle("epic: integrate certification pipeline");
  assert.equal(result.kind, "invalid-epic-title");
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /must match epic\(<scope>\): <description>/);
});

test("classifyEpicPrTitle rejects a title with an empty description", () => {
  const result = classifyEpicPrTitle("epic(runtime):");
  assert.equal(result.kind, "invalid-epic-title");
  assert.equal(result.valid, false);
});

test("classifyEpicPrTitle rejects a title with an empty scope", () => {
  const result = classifyEpicPrTitle(
    "epic(): integrate certification pipeline"
  );
  assert.equal(result.kind, "invalid-epic-title");
  assert.equal(result.valid, false);
});

test("classifyEpicPrTitle returns undefined for an ordinary title, even one mentioning epic", () => {
  assert.equal(
    classifyEpicPrTitle("feat(core): improve epic dashboard filters"),
    undefined
  );
  assert.equal(classifyEpicPrTitle("fix: correct off-by-one error"), undefined);
});

test("classifyEpicPrTitle returns undefined for a release PR title", () => {
  assert.equal(classifyEpicPrTitle("release: 1.2.3"), undefined);
});
