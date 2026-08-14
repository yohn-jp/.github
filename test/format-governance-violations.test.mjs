import test from "node:test";
import assert from "node:assert/strict";
import { formatGovernanceViolations } from "../scripts/format-governance-violations.mjs";

test("formats a violation with code, path, and message", () => {
  const body = formatGovernanceViolations([{ code: "REQUIRED_FIELD_MISSING", path: "$.fields.summary", message: "summary is required" }]);
  assert.equal(body, "Issue governance contract violation:\n\n- [REQUIRED_FIELD_MISSING] $.fields.summary: summary is required\n");
});

test("omits the path segment when absent", () => {
  const body = formatGovernanceViolations([{ code: "WRONG_TEMPLATE", message: "body does not match any known template" }]);
  assert.equal(body, "Issue governance contract violation:\n\n- [WRONG_TEMPLATE] body does not match any known template\n");
});

test("lists multiple violations in order", () => {
  const body = formatGovernanceViolations([
    { code: "A", message: "first" },
    { code: "B", message: "second" },
  ]);
  assert.equal(
    body,
    "Issue governance contract violation:\n\n- [A] first\n- [B] second\n",
  );
});

test("falls back to a generic diagnostic when there are no violations", () => {
  const body = formatGovernanceViolations([]);
  assert.match(body, /GOVERNANCE_VALIDATION_FAILED/);
  assert.match(body, /did not produce structured diagnostics/);
});
