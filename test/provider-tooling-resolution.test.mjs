import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  validateProviderToolingResolution,
  validateProviderToolingResolutionFile
} from "../scripts/validate-provider-tooling-resolution.mjs";

test("correct job.workflow_repository/job.workflow_sha checkout and provider-relative local action pass", () => {
  const errors = validateProviderToolingResolutionFile(
    "test/fixtures/workflows/provider-tooling-valid.yml"
  );
  assert.deepEqual(errors, []);
});

test("rejects the yohn-jp/gh-makami PR #13 'not our ref' shape: ref resolved from github.sha / github.job_workflow_ref", () => {
  const errors = validateProviderToolingResolutionFile(
    "test/fixtures/workflows/provider-tooling-caller-sha-fallback.yml"
  );
  assert.ok(errors.length > 0, "expected at least one error");
  assert.ok(errors.some((e) => e.includes("CALLER's checked-out commit")));
  assert.ok(
    errors.some((e) => e.includes("not a real GitHub Actions context field"))
  );
});

test("rejects the yohn-jp/gh-makami PR #13 missing-caller-local-action shape: bare ./.github/actions/... reference", () => {
  const errors = validateProviderToolingResolutionFile(
    "test/fixtures/workflows/provider-tooling-bare-local-action.yml"
  );
  assert.equal(errors.length, 1, JSON.stringify(errors, null, 2));
  assert.ok(errors[0].includes("./.github/actions/setup-node-pnpm"));
  assert.ok(errors[0].includes("CALLER's checked-out workspace"));
});

test("trusted consumer default-branch authority is allowed but PR refs are rejected", () => {
  const checkout = (ref) => ({
    jobs: {
      format: {
        steps: [
          {
            uses: "actions/checkout@0123456789abcdef0123456789abcdef01234567",
            with: {
              repository: "${{ github.repository }}",
              ref,
              path: "formatter-authority"
            }
          }
        ]
      }
    }
  });

  assert.deepEqual(
    validateProviderToolingResolution(
      checkout("${{ github.event.repository.default_branch }}"),
      "trusted-consumer-authority"
    ),
    []
  );
  assert.ok(
    validateProviderToolingResolution(
      checkout("${{ github.event.pull_request.head.sha }}"),
      "untrusted-consumer-ref"
    ).some((error) => error.includes("provider tooling checkout"))
  );
});

test("consumer-oriented regression: provider files leave the consumer workspace before commands and metadata pnpm uses the provider workdir", () => {
  for (const workflow of [
    "typescript-cli-ci.yml",
    "metadata-validation.yml",
    "prettier-autofix.yml"
  ]) {
    const filePath = fileURLToPath(
      new URL(`../.github/workflows/${workflow}`, import.meta.url)
    );
    assert.deepEqual(
      validateProviderToolingResolutionFile(filePath),
      [],
      workflow
    );
  }
});

test("rejects provider installation that remains inside the consumer workspace", () => {
  const errors = validateProviderToolingResolutionFile(
    "test/fixtures/workflows/provider-tooling-consumer-workspace.yml"
  );
  assert.ok(errors.some((e) => e.includes("must be moved under $RUNNER_TEMP")));
  assert.ok(errors.some((e) => e.includes("provider dependency installation")));
  assert.ok(
    errors.some((e) => e.includes("pnpm setup must read package_json_file"))
  );
});
