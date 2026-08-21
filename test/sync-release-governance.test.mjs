import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import yaml from "js-yaml";

const sync = yaml.load(readFileSync(".github/sync.yml", "utf8"));
const targets = Object.entries(sync);
const requiredSnapshot = [
  ".github/PULL_REQUEST_TEMPLATE/release.md",
  ".github/inari/pull-requests/release.json",
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
    mappingsFor("yohn-jp/mottainai").get(
      ".github/workflows/release-governance.yml"
    ),
    "templates/workflows/release-governance.yml"
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
  const releaseWrapper = readFileSync(
    "templates/workflows/release-governance.yml",
    "utf8"
  );
  assert.doesNotMatch(sharedWorkflow, /Fetch linked Issue|gh issue view/);
  assert.doesNotMatch(releaseWrapper, /Fetch linked Issue|gh issue view/);
  assert.match(sharedWorkflow, /PR_BRANCH/);
  assert.match(sharedWorkflow, /--branch/);
});
