import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  dashboardConfigFromRegistry,
  loadPortalRegistry,
  productCatalogFromRegistry,
  validatePortalRegistry
} from "../scripts/portal-registry.mjs";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test("portal registry preserves product mappings and derives all collection repositories", async () => {
  const registry = await loadPortalRegistry("portal/registry.json");
  const catalog = productCatalogFromRegistry(registry);
  const config = dashboardConfigFromRegistry(registry);

  assert.deepEqual(
    catalog.products.map(({ id, repository }) => [id, repository]),
    [
      ["mottainai", "https://github.com/yohn-jp/mottainai"],
      ["nawabari", "https://github.com/yohn-jp/nawabari"],
      ["inari", "https://github.com/yohn-jp/gh-inari"],
      ["suzukuri", "https://github.com/yohn-jp/suzukuri"],
      ["wabachi", "https://github.com/yohn-jp/wabachi"],
      ["majiwari", "https://github.com/yohn-jp/majiwari"]
    ]
  );
  assert.deepEqual(config, {
    organization: "yohn-jp",
    repositories: [
      "mottainai",
      "nawabari",
      "gh-inari",
      "suzukuri",
      "wabachi",
      "majiwari",
      "gh-makami",
      ".github"
    ]
  });
});

test("portal registry rejects duplicate repository mappings", async () => {
  const registry = await loadPortalRegistry("portal/registry.json");
  const invalid = clone(registry);
  invalid.collectionRepositories.push("mottainai");
  assert.throws(
    () => validatePortalRegistry(invalid),
    /Duplicate repository mapping: yohn-jp\/mottainai/
  );
});

test("portal registry rejects missing and malformed repository mappings", async () => {
  const registry = await loadPortalRegistry("portal/registry.json");

  const missing = clone(registry);
  delete missing.products[0].repository;
  assert.throws(
    () => validatePortalRegistry(missing),
    /products\[0\]\.repository must be a non-empty string/
  );

  const malformed = clone(registry);
  malformed.collectionRepositories[0] = "not/a/repository";
  assert.throws(
    () => validatePortalRegistry(malformed),
    /collectionRepositories\[0\] must be a valid repository name/
  );
});

test("portal registry rejects cross-organization product mappings", async () => {
  const source = JSON.parse(await readFile("portal/registry.json", "utf8"));
  source.products[0].repository = "https://github.com/other-org/mottainai";
  assert.throws(
    () => validatePortalRegistry(source),
    /Product mottainai repository must belong to yohn-jp/
  );
});
