import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import { SYNCED_SCRIPT_PATHS } from "../scripts/validate-synced-script-format.mjs";

// Regression for Issue #180: PR #179 added scripts/epic-branch.mjs and wired
// it into scripts/validate-pr.mjs, but the org sync trigger and sync.yml
// mappings were never updated. Consumers kept receiving validate-pr.mjs with
// an import ("./epic-branch.mjs") that resolved to nothing on disk.

const sync = yaml.load(readFileSync(".github/sync.yml", "utf8"));
const syncWorkflow = readFileSync(
  ".github/workflows/sync-org-templates.yml",
  "utf8"
);

function mappingsFor(repository) {
  return new Map(
    (sync[repository] ?? []).map(({ source, dest }) => [dest, source])
  );
}

function localImportsOf(scriptPath) {
  const source = readFileSync(scriptPath, "utf8");
  const matches = [...source.matchAll(/from\s+["']\.\/([\w.-]+\.mjs)["']/g)];
  return matches.map((match) => `scripts/${match[1]}`);
}

test("scripts/epic-branch.mjs changes trigger organization template sync", () => {
  const pushPaths = yaml.load(syncWorkflow).on.push.paths;
  assert.ok(
    pushPaths.includes("scripts/epic-branch.mjs"),
    "sync-org-templates.yml must trigger on scripts/epic-branch.mjs"
  );
});

test("every consumer that receives a synced governance script also receives its relative imports", () => {
  for (const repository of Object.keys(sync)) {
    const mappings = mappingsFor(repository);
    for (const scriptPath of SYNCED_SCRIPT_PATHS) {
      if (mappings.get(scriptPath) !== scriptPath) continue;
      for (const importPath of localImportsOf(scriptPath)) {
        assert.equal(
          mappings.get(importPath),
          importPath,
          `${repository} receives ${scriptPath}, which imports ${importPath}, but does not receive ${importPath}`
        );
      }
    }
  }
});

test("yohn-jp/nawabari receives scripts/epic-branch.mjs as a byte-copy mapping", () => {
  assert.equal(
    mappingsFor("yohn-jp/nawabari").get("scripts/epic-branch.mjs"),
    "scripts/epic-branch.mjs"
  );
});

test("scripts/epic-branch.mjs is declared in the synced-script format authority", () => {
  assert.ok(SYNCED_SCRIPT_PATHS.includes("scripts/epic-branch.mjs"));
});

// This task is scoped to #180's synchronization fix only; Mottainai's
// migration to canonical shared governance is a separate follow-up (see
// docs/governance.md's Release PR path section and Issue #49).
test("yohn-jp/mottainai is not given local governance-script copies by this fix", () => {
  const mottainaiMappings = mappingsFor("yohn-jp/mottainai");
  for (const scriptPath of SYNCED_SCRIPT_PATHS) {
    assert.equal(
      mottainaiMappings.get(scriptPath),
      undefined,
      `yohn-jp/mottainai must not receive ${scriptPath} from this narrow sync fix`
    );
  }
});
