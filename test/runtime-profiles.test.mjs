import test from "node:test";
import assert from "node:assert/strict";
import {
  validateRuntimeProfilesStructure,
  validateRuntimeProfilesAuthorityIntegrity,
  validateRuntimeProfilesFile
} from "../scripts/validate-runtime-profiles.mjs";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

test("accepts a structurally valid runtime-profiles document", () => {
  const doc = loadJson("test/fixtures/runtime-profiles/valid.json");
  assert.deepEqual(validateRuntimeProfilesStructure(doc), []);
});

test("rejects a profile missing a required key (yohn-jp/.github#184: invalid schema)", () => {
  const doc = loadJson("test/fixtures/runtime-profiles/invalid-schema.json");
  const errors = validateRuntimeProfilesStructure(doc);
  assert.ok(errors.length > 0, "expected at least one error");
  assert.ok(
    errors.some((e) => e.includes('missing required key "contextStrategy"'))
  );
});

test("rejects duplicate profile ids (yohn-jp/.github#184: duplicate IDs)", () => {
  const doc = loadJson("test/fixtures/runtime-profiles/duplicate-ids.json");
  const errors = validateRuntimeProfilesStructure(doc);
  assert.ok(
    errors.some((e) => e.includes('duplicate profile id "example-worker"'))
  );
});

test("accepts authority references whose canonical path exists and whose projected path matches sync-agents.yml", () => {
  const doc = loadJson("test/fixtures/runtime-profiles/valid.json");
  const syncAgentsDoc = yaml.load(
    readFileSync("test/fixtures/runtime-profiles/sync-agents-valid.yml", "utf8")
  );
  const errors = validateRuntimeProfilesAuthorityIntegrity(
    doc,
    process.cwd(),
    syncAgentsDoc
  );
  assert.deepEqual(errors, []);
});

test("rejects a projected authority path that does not match sync-agents.yml's dest (yohn-jp/.github#184: broken projection path)", () => {
  const doc = loadJson("test/fixtures/runtime-profiles/valid.json");
  const syncAgentsDoc = yaml.load(
    readFileSync(
      "test/fixtures/runtime-profiles/sync-agents-broken-projection.yml",
      "utf8"
    )
  );
  const errors = validateRuntimeProfilesAuthorityIntegrity(
    doc,
    process.cwd(),
    syncAgentsDoc
  );
  assert.ok(errors.length > 0, "expected at least one error");
  assert.ok(
    errors.some(
      (e) =>
        e.includes("authority.promptGuide.projected") &&
        e.includes(".github/agent-governance/runtime-profiles.md") &&
        e.includes("docs/agent-runtime-profiles.md")
    )
  );
});

test("rejects a canonical authority path that does not exist in this repository", () => {
  const doc = loadJson("test/fixtures/runtime-profiles/valid.json");
  doc.authority.workflow.canonical = "docs/does-not-exist.md";
  const syncAgentsDoc = yaml.load(
    readFileSync("test/fixtures/runtime-profiles/sync-agents-valid.yml", "utf8")
  );
  const errors = validateRuntimeProfilesAuthorityIntegrity(
    doc,
    process.cwd(),
    syncAgentsDoc
  );
  assert.ok(
    errors.some((e) =>
      e.includes(
        'authority.workflow.canonical: "docs/does-not-exist.md" does not exist'
      )
    )
  );
});

test("the real .github/agents/runtime-profiles.json passes end-to-end validation against .github/sync-agents.yml", () => {
  const errors = validateRuntimeProfilesFile();
  assert.deepEqual(errors, []);
});
