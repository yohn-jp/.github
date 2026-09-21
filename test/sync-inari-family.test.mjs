import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";

const sync = yaml.load(readFileSync(".github/sync.yml", "utf8"));
const pullRequestContractsDirectory = ".github/inari/pull-requests";
const pullRequestTemplatesDirectory = ".github/PULL_REQUEST_TEMPLATE";
const manifestPath = ".github/inari/manifest.json";
const policyPath = ".github/inari/pr-policy.yml";

function filesIn(directory, extension) {
  return readdirSync(directory)
    .filter((name) => name.endsWith(extension))
    .sort()
    .map((name) => join(directory, name).replaceAll("\\", "/"));
}

const canonicalContracts = filesIn(pullRequestContractsDirectory, ".json");
const canonicalTemplates = filesIn(pullRequestTemplatesDirectory, ".md");
const canonicalFamily = [
  ...canonicalTemplates,
  ...canonicalContracts,
  policyPath,
  manifestPath
];

function familyId(filePath) {
  return filePath
    .replace(pullRequestContractsDirectory, "")
    .replace(pullRequestTemplatesDirectory, "")
    .replace(/^\//, "")
    .replace(/\.(?:json|md)$/u, "");
}

function mappingsFor(repository) {
  return new Map(
    (sync[repository] ?? []).map(({ source, dest }) => [dest, source])
  );
}

function receivesPullRequestFamily(mappings) {
  return [...canonicalContracts, ...canonicalTemplates].some((path) =>
    mappings.has(path)
  );
}

test("canonical PR contracts and native templates are a paired family", () => {
  assert.deepEqual(
    canonicalContracts.map(familyId),
    canonicalTemplates.map(familyId),
    "every canonical PR contract must have its generated/native template"
  );
});

test("every applicable consumer receives the complete canonical PR/Inari family", () => {
  assert.ok(canonicalContracts.length > 0, "expected canonical PR contracts");
  assert.ok(canonicalTemplates.length > 0, "expected canonical PR templates");

  for (const [repository] of Object.entries(sync)) {
    const mappings = mappingsFor(repository);
    if (!receivesPullRequestFamily(mappings)) continue;

    for (const destination of canonicalFamily) {
      assert.equal(
        mappings.get(destination),
        destination,
        `${repository} must receive ${destination} as a canonical byte-copy mapping`
      );
    }
  }
});

test("every mapped Inari snapshot includes its canonical manifest", () => {
  for (const [repository, entries] of Object.entries(sync)) {
    const mappings = mappingsFor(repository);
    const mapsInariSnapshot = entries.some(
      ({ source }) =>
        source.startsWith(".github/inari/") && source !== manifestPath
    );
    if (!mapsInariSnapshot) continue;

    assert.equal(
      mappings.get(manifestPath),
      manifestPath,
      `${repository} maps an Inari snapshot without ${manifestPath}`
    );
  }
});
