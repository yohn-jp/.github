import test from "node:test";
import assert from "node:assert/strict";
import {
  validateActionPinsFile,
  validateIssueGovernanceDelegation,
} from "../scripts/validate-action-pins.mjs";

test("SHA-pinned third-party, @main organization, local, and digest-pinned refs all pass", () => {
  const errors = validateActionPinsFile("test/fixtures/workflows/valid-pins.yml");
  assert.deepEqual(errors, []);
});

test("tag refs, branch refs, missing refs, and unpinned docker images are all rejected", () => {
  const errors = validateActionPinsFile("test/fixtures/workflows/invalid-pins.yml");
  assert.equal(errors.length, 4, JSON.stringify(errors, null, 2));
  assert.ok(errors.some((e) => e.includes("actions/checkout@v4")));
  assert.ok(errors.some((e) => e.includes("actions/setup-node@main")));
  assert.ok(errors.some((e) => e.includes("some/action-without-ref")));
  assert.ok(errors.some((e) => e.includes("docker://alpine:latest")));
});

test("organization-owned reusable workflows reject SHA and non-main refs", () => {
  const errors = validateActionPinsFile("test/fixtures/workflows/invalid-org-workflow-ref.yml");
  assert.equal(errors.length, 2, JSON.stringify(errors, null, 2));
  assert.ok(errors.every((error) => error.includes("must use @main")));
});

test("a workflow delegating to issue-governance.yml is rejected if it also runs scripts/validate-issue.mjs locally", () => {
  const errors = validateActionPinsFile("test/fixtures/workflows/duplicated-issue-governance.yml");
  assert.equal(errors.length, 1, JSON.stringify(errors, null, 2));
  assert.ok(errors[0].includes("scripts/validate-issue.mjs"));
});

test("validateIssueGovernanceDelegation passes when there is no local duplication", () => {
  const raw = "uses: yohn-jp/.github/.github/workflows/issue-governance.yml@main\n";
  assert.deepEqual(validateIssueGovernanceDelegation(raw, "wf.yml"), []);
});

test("validateIssueGovernanceDelegation is a no-op for workflows that don't delegate at all", () => {
  const raw = "run: node scripts/validate-issue.mjs\n";
  assert.deepEqual(validateIssueGovernanceDelegation(raw, "wf.yml"), []);
});
