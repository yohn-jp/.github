import test from "node:test";
import assert from "node:assert/strict";
import { validateProviderToolingResolutionFile } from "../scripts/validate-provider-tooling-resolution.mjs";

test("correct job.workflow_repository/job.workflow_sha checkout and provider-relative local action pass", () => {
  const errors = validateProviderToolingResolutionFile("test/fixtures/workflows/provider-tooling-valid.yml");
  assert.deepEqual(errors, []);
});

test("rejects the yohn-jp/gh-makami PR #13 'not our ref' shape: ref resolved from github.sha / github.job_workflow_ref", () => {
  const errors = validateProviderToolingResolutionFile(
    "test/fixtures/workflows/provider-tooling-caller-sha-fallback.yml",
  );
  assert.ok(errors.length > 0, "expected at least one error");
  assert.ok(errors.some((e) => e.includes("CALLER's checked-out commit")));
  assert.ok(errors.some((e) => e.includes("not a real GitHub Actions context field")));
});

test("rejects the yohn-jp/gh-makami PR #13 missing-caller-local-action shape: bare ./.github/actions/... reference", () => {
  const errors = validateProviderToolingResolutionFile(
    "test/fixtures/workflows/provider-tooling-bare-local-action.yml",
  );
  assert.equal(errors.length, 1, JSON.stringify(errors, null, 2));
  assert.ok(errors[0].includes("./.github/actions/setup-node-pnpm"));
  assert.ok(errors[0].includes("CALLER's checked-out workspace"));
});
