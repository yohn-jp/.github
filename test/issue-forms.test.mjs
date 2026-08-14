import test from "node:test";
import assert from "node:assert/strict";
import { validateIssueFormFile } from "../scripts/validate-issue-forms.mjs";

test("valid Issue Form passes validation", () => {
  const errors = validateIssueFormFile("test/fixtures/issue-forms/valid.yml");
  assert.deepEqual(errors, []);
});

test("unquoted-comma flow-mapping regression is caught", () => {
  const errors = validateIssueFormFile("test/fixtures/issue-forms/invalid-flow-mapping.yml");
  assert.ok(errors.length > 0, "expected validation errors");
  assert.ok(
    errors.some((e) => e.includes('"observed result"') || e.includes('"description"')),
    `expected an error naming the split key, got: ${JSON.stringify(errors)}`,
  );
});

test("unsupported element type is rejected", () => {
  const errors = validateIssueFormFile("test/fixtures/issue-forms/invalid-unknown-type.yml");
  assert.ok(errors.some((e) => e.includes("unsupported or missing")));
});

test("missing required top-level and attribute keys are rejected", () => {
  const errors = validateIssueFormFile("test/fixtures/issue-forms/invalid-missing-required.yml");
  assert.ok(errors.some((e) => e.includes('missing required top-level key "name"')));
  assert.ok(errors.some((e) => e.includes('attribute "options" is required')));
});

test("organization default Issue Forms pass validation", () => {
  for (const file of [".github/ISSUE_TEMPLATE/bug.yml", ".github/ISSUE_TEMPLATE/feature.yml"]) {
    const errors = validateIssueFormFile(file);
    assert.deepEqual(errors, [], `${file}: ${JSON.stringify(errors)}`);
  }
});
