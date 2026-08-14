import test from "node:test";
import assert from "node:assert/strict";
import { validateBranchName } from "../scripts/validate-branch-name.mjs";

test("default pattern accepts a conventional branch name", () => {
  assert.deepEqual(validateBranchName("feat/42-add-init-command"), []);
});

test("default pattern rejects a branch missing the issue number", () => {
  const errors = validateBranchName("feat/add-init-command");
  assert.equal(errors.length, 1);
  assert.match(errors[0], /does not match required pattern/);
});

test("default pattern rejects an unknown type prefix", () => {
  const errors = validateBranchName("feature/42-add-init-command");
  assert.equal(errors.length, 1);
});

test("main is exempt by default", () => {
  assert.deepEqual(validateBranchName("main"), []);
});

test("exempt list is configurable", () => {
  assert.deepEqual(validateBranchName("develop", { exempt: ["main", "develop"] }), []);
  assert.equal(validateBranchName("develop", { exempt: ["main"] }).length, 1);
});

test("pattern is configurable", () => {
  assert.deepEqual(validateBranchName("release/1.2.3", { pattern: "^release/\\d+\\.\\d+\\.\\d+$" }), []);
  assert.equal(
    validateBranchName("feat/42-add-init-command", { pattern: "^release/\\d+\\.\\d+\\.\\d+$" }).length,
    1,
  );
});
