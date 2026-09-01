import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import { validateActionPinsFile } from "../scripts/validate-action-pins.mjs";

const sync = yaml.load(readFileSync(".github/sync.yml", "utf8"));
const targets = Object.entries(sync);
const requiredSnapshot = [
  ".github/PULL_REQUEST_TEMPLATE/release.md",
  ".github/inari/pull-requests/release.json",
  ".github/inari/pr-policy.yml",
  ".github/inari/manifest.json"
];

function mappingsFor(repository) {
  return new Map(
    (sync[repository] ?? []).map(({ source, dest }) => [dest, source])
  );
}

test("every synchronized consumer receives the canonical release snapshot", () => {
  assert.deepEqual(
    targets.map(([repository]) => repository).sort(),
    [
      "yohn-jp/gh-inari",
      "yohn-jp/gh-makami",
      "yohn-jp/majiwari",
      "yohn-jp/mottainai",
      "yohn-jp/nawabari",
      "yohn-jp/suzukuri",
      "yohn-jp/wabachi"
    ].sort()
  );

  for (const [repository, entries] of targets) {
    const mappings = mappingsFor(repository);
    for (const destination of requiredSnapshot) {
      assert.equal(
        mappings.get(destination),
        destination,
        `${repository} must receive ${destination}`
      );
    }
    for (const { source } of entries) {
      assert.equal(
        existsSync(source),
        true,
        `${repository}: missing ${source}`
      );
    }
  }
});

test("release governance rollout has one canonical path per consumer class", () => {
  for (const repository of ["yohn-jp/gh-makami", "yohn-jp/suzukuri"]) {
    assert.equal(
      mappingsFor(repository).get(".github/workflows/governance.yml"),
      "templates/workflows/governance.yml",
      `${repository} must roll its PR governance caller to @main`
    );
  }
  assert.equal(
    mappingsFor("yohn-jp/mottainai").get(".github/workflows/governance.yml"),
    undefined,
    "mottainai's governance.yml stays repository-owned, not synced from templates/workflows/ (Issue #49)"
  );
  assert.equal(
    mappingsFor("yohn-jp/mottainai").get(
      ".github/workflows/release-governance.yml"
    ),
    undefined,
    "mottainai must not receive a separate release-only governance wrapper (Issue #49)"
  );
  assert.equal(
    mappingsFor("yohn-jp/nawabari").get("scripts/pr-contract-routing.mjs"),
    "scripts/pr-contract-routing.mjs"
  );
  assert.equal(
    mappingsFor("yohn-jp/nawabari").get("scripts/release-branch.mjs"),
    "scripts/release-branch.mjs"
  );
});

test("release path contains no linked-Issue fetch step", () => {
  const sharedWorkflow = readFileSync(
    ".github/workflows/pr-governance.yml",
    "utf8"
  );
  assert.doesNotMatch(sharedWorkflow, /Fetch linked Issue|gh issue view/);
  assert.match(sharedWorkflow, /PR_BRANCH/);
  assert.match(sharedWorkflow, /--branch/);
});

test("templates/workflows/release-governance.yml no longer exists as a Mottainai-only exception", () => {
  assert.equal(existsSync("templates/workflows/release-governance.yml"), false);
});

// Regression for Issue #49: org sync previously installed
// .github/workflows/release-governance.yml on yohn-jp/mottainai (bot commit
// 4949e486) referencing yohn-jp/.github/.github/workflows/pr-governance.yml@main
// — a mutable ref that Mottainai's own repository-local action-pin
// validation rejected, so Mottainai's main failed its own required check on
// a file it never authored. Every canonical wrapper this repository
// distributes, and Mottainai's own (unsynced, repository-owned)
// governance.yml, must pass that same governance/pin validation before
// rollout is trusted.
test("every synced canonical workflow wrapper passes the consumer's own action-pin governance", () => {
  const templatesDir = "templates/workflows";
  for (const name of readdirSync(templatesDir)) {
    if (!name.endsWith(".yml") && !name.endsWith(".yaml")) continue;
    const errors = validateActionPinsFile(join(templatesDir, name));
    assert.deepEqual(errors, [], `${name}: ${JSON.stringify(errors)}`);
  }
});

test("the canonical sync snapshot does not make Mottainai's main fail its own required action-pin check", () => {
  const errors = validateActionPinsFile(
    "test/fixtures/mottainai-consumer/governance.yml"
  );
  assert.deepEqual(errors, []);
});
