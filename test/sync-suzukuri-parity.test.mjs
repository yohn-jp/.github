import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";

const sync = yaml.load(readFileSync(".github/sync.yml", "utf8"));
const syncWorkflow = readFileSync(
  ".github/workflows/sync-org-templates.yml",
  "utf8"
);

function normalizedMappings(config, repository) {
  return (config[repository] ?? [])
    .map(({ source, dest }) => `${source} -> ${dest}`)
    .sort();
}

test("Suzukuri receives the same managed repository metadata as Wabachi", () => {
  assert.deepEqual(
    normalizedMappings(sync, "yohn-jp/suzukuri"),
    normalizedMappings(sync, "yohn-jp/wabachi")
  );
});

test("Suzukuri stays in the template-sync GitHub App repository scope", () => {
  const workflow = yaml.load(syncWorkflow);
  const repositories =
    workflow.jobs.sync.steps
      .find((step) => step.name === "Create GitHub App token")
      ?.with?.repositories?.split(/\s+/)
      .filter(Boolean) ?? [];

  assert.ok(
    repositories.includes("suzukuri"),
    "sync-org-templates.yml must request an installation token for suzukuri"
  );
});
