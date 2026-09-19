import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";

const sync = yaml.load(readFileSync(".github/sync.yml", "utf8"));
const agentSync = yaml.load(readFileSync(".github/sync-agents.yml", "utf8"));
const syncWorkflow = readFileSync(
  ".github/workflows/sync-org-templates.yml",
  "utf8"
);

function normalizedMappings(config, repository) {
  return (config[repository] ?? [])
    .map(({ source, dest }) => `${source} -> ${dest}`)
    .sort();
}

test("Wabachi receives the same managed repository metadata as gh-inari", () => {
  assert.deepEqual(
    normalizedMappings(sync, "yohn-jp/wabachi"),
    normalizedMappings(sync, "yohn-jp/gh-inari")
  );
});

test("Wabachi receives the same shared agent governance as gh-inari", () => {
  assert.deepEqual(
    normalizedMappings(agentSync, "yohn-jp/wabachi"),
    normalizedMappings(agentSync, "yohn-jp/gh-inari")
  );
});

test("Wabachi stays in the template-sync GitHub App repository scope", () => {
  const workflow = yaml.load(syncWorkflow);
  const repositories =
    workflow.jobs.sync.steps
      .find((step) => step.name === "Create GitHub App token")
      ?.with?.repositories?.split(/\s+/)
      .filter(Boolean) ?? [];

  assert.ok(
    repositories.includes("wabachi"),
    "sync-org-templates.yml must request an installation token for wabachi"
  );
});
