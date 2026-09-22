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

test("cli-canon receives the same managed repository metadata as Wabachi", () => {
  assert.deepEqual(
    normalizedMappings(sync, "yohn-jp/cli-canon"),
    normalizedMappings(sync, "yohn-jp/wabachi")
  );
});

test("cli-canon receives the same shared agent governance as Wabachi", () => {
  assert.deepEqual(
    normalizedMappings(agentSync, "yohn-jp/cli-canon"),
    normalizedMappings(agentSync, "yohn-jp/wabachi")
  );
});

test("cli-canon stays in the template-sync GitHub App repository scope", () => {
  const workflow = yaml.load(syncWorkflow);
  const repositories =
    workflow.jobs.sync.steps
      .find((step) => step.name === "Create GitHub App token")
      ?.with?.repositories?.split(/\s+/)
      .filter(Boolean) ?? [];

  assert.ok(
    repositories.includes("cli-canon"),
    "sync-org-templates.yml must request an installation token for cli-canon"
  );
});
