import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyBranchName,
  validateBranchName
} from "../scripts/validate-branch-name.mjs";

test("default pattern accepts a conventional branch name", () => {
  assert.deepEqual(validateBranchName("feat/42-add-init-command"), []);
});

test("default pattern rejects a branch missing the issue number", () => {
  const errors = validateBranchName("feat/add-init-command");
  assert.equal(errors.length, 1);
  assert.match(errors[0], /does not match required pattern/);
});

test("default pattern accepts a release branch without an Issue number", () => {
  assert.deepEqual(validateBranchName("release/0.5.1"), []);
  assert.deepEqual(classifyBranchName("release/0.5.1"), {
    kind: "release",
    valid: true,
    version: "0.5.1",
    errors: []
  });
});

test("a release branch accepts a complete prerelease and build semver", () => {
  assert.deepEqual(validateBranchName("release/1.0.0-rc.1+build.7"), []);
});

test("malformed release branches are rejected explicitly", () => {
  for (const branch of ["release/foo", "release/0.5"]) {
    const errors = validateBranchName(branch);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /must match release\/<semver>/);
    assert.equal(classifyBranchName(branch).kind, "invalid-release");
  }
});

test("default pattern rejects an unknown type prefix", () => {
  const errors = validateBranchName("feature/42-add-init-command");
  assert.equal(errors.length, 1);
});

test("main is exempt by default", () => {
  assert.deepEqual(validateBranchName("main"), []);
});

test("exempt list is configurable", () => {
  assert.deepEqual(
    validateBranchName("develop", { exempt: ["main", "develop"] }),
    []
  );
  assert.equal(validateBranchName("develop", { exempt: ["main"] }).length, 1);
});

test("pattern is configurable", () => {
  assert.deepEqual(
    validateBranchName("release/1.2.3", {
      pattern: "^release/\\d+\\.\\d+\\.\\d+$"
    }),
    []
  );
  assert.equal(
    validateBranchName("feat/42-add-init-command", {
      pattern: "^release/\\d+\\.\\d+\\.\\d+$"
    }).length,
    1
  );
});

test("an ordinary Issue-less feature branch remains rejected", () => {
  assert.equal(validateBranchName("fix/foo").length, 1);
});

test("overlong branch name is rejected before regex compilation", () => {
  const errors = validateBranchName(`feat/1-${"a".repeat(300)}`);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /exceeds the maximum supported length/);
});

test("overlong configured pattern is rejected before regex compilation", () => {
  const errors = validateBranchName("feat/1-x", {
    pattern: `^(${"a|".repeat(150)}z)$`
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /exceeds the maximum supported length/);
});

test("an invalid configured pattern fails closed with a clear diagnostic", () => {
  const errors = validateBranchName("feat/1-x", { pattern: "(unterminated" });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /is not a valid regular expression/);
});

test("a valid release branch passes even with a malformed configured ordinary pattern", () => {
  assert.deepEqual(
    validateBranchName("release/0.5.1", { pattern: "[invalid" }),
    []
  );
  assert.equal(
    classifyBranchName("release/0.5.1", { pattern: "[invalid" }).kind,
    "release"
  );
});

test("a valid release branch passes even with an overlong configured ordinary pattern", () => {
  assert.deepEqual(
    validateBranchName("release/0.5.1", {
      pattern: `^(${"a|".repeat(150)}z)$`
    }),
    []
  );
});

test("a malformed release branch is rejected as invalid-release even with a broad configured ordinary pattern", () => {
  const result = classifyBranchName("release/foo", { pattern: ".*" });
  assert.equal(result.kind, "invalid-release");
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /must match release\/<semver>/);
});

test("a malformed release branch is rejected as invalid-release even with a malformed configured ordinary pattern", () => {
  const result = classifyBranchName("release/foo", { pattern: "[invalid" });
  assert.equal(result.kind, "invalid-release");
  assert.match(result.errors[0], /must match release\/<semver>/);
});

test("release prefix cannot be overridden by branch-name-exempt", () => {
  const errors = validateBranchName("release/foo", {
    exempt: ["release/foo"]
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /must match release\/<semver>/);
});
