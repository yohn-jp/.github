import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";

// Regression for Issue #186: this repository's synchronization workflow
// must not publish managed artifacts from a revision that fails canonical
// Prettier formatting validation.

const syncWorkflow = yaml.load(
  readFileSync(".github/workflows/sync-org-templates.yml", "utf8")
);

test("sync-org-templates.yml gates distribution on canonical Prettier formatting", () => {
  const formatCheckJob = syncWorkflow.jobs["format-check"];
  assert.ok(
    formatCheckJob,
    "sync-org-templates.yml must define a format-check job"
  );

  const steps = formatCheckJob.steps ?? [];
  assert.ok(
    steps.some((step) => step.run === "pnpm run format:check"),
    "format-check job must run the canonical `pnpm run format:check` command"
  );

  const syncJob = syncWorkflow.jobs.sync;
  const needs = Array.isArray(syncJob.needs) ? syncJob.needs : [syncJob.needs];
  assert.ok(
    needs.includes("format-check"),
    "sync job must depend on format-check so a formatting failure blocks distribution"
  );
  assert.ok(
    needs.includes("validate"),
    "sync job must still depend on validate (Issue #185 fail-closed ordering)"
  );
});

test("format:check is defined and enforces the repository's canonical Prettier profile", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["format:check"], "prettier --check .");
  assert.equal(packageJson.scripts.format, "prettier --write .");
});
