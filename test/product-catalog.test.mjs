import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDashboard } from "../scripts/build-dashboard.mjs";
import {
  loadProductCatalog,
  validateProductCatalog
} from "../scripts/product-catalog.mjs";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function response(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

test("loads the versioned six-product portal catalog deterministically", async () => {
  const catalog = await loadProductCatalog("portal/registry.json");
  assert.equal(catalog.schemaVersion, 1);
  assert.deepEqual(
    catalog.products.map((product) => product.id),
    ["mottainai", "nawabari", "inari", "suzukuri", "wabachi", "majiwari"]
  );
  for (const product of catalog.products) {
    assert.match(product.repository, /^https:\/\/github\.com\/yohn-jp\//);
    assert.ok(product.owns.length > 0);
    assert.ok(product.doesNotOwn.length > 0);
    assert.deepEqual(Object.keys(product.locales), ["en", "ja"]);
    assert.equal(product.locales.en.summary, product.summary);
    assert.notEqual(product.locales.ja.summary, product.summary);
    for (const relation of product.relationships) {
      assert.ok(relation.localizedLabel.en);
      assert.ok(relation.localizedLabel.ja);
      assert.equal(relation.product, relation.product.toLowerCase());
    }
  }
});

test("keeps product identity and status locale-independent", async () => {
  const catalog = await loadProductCatalog("portal/registry.json");
  for (const product of catalog.products) {
    assert.equal(typeof product.id, "string");
    assert.equal(typeof product.name, "string");
    assert.equal(typeof product.repository, "string");
    assert.equal(typeof product.status, "string");
    assert.ok(product.status.length > 0);
    assert.match(product.statusTone, /^(positive|caution|negative|neutral)$/);
    assert.equal(product.locales.en.status, undefined);
    assert.equal(product.locales.ja.status, undefined);
    for (const relation of product.relationships) {
      assert.equal(typeof relation.product, "string");
      assert.equal(typeof relation.type, "string");
    }
  }
});

test("rejects missing required product locale content", async () => {
  const catalog = await loadProductCatalog("portal/registry.json");
  const invalid = clone(catalog);
  delete invalid.products[0].locales.ja.summary;
  assert.throws(
    () => validateProductCatalog(invalid),
    /products\[0\]\.locales\.ja\.summary must be a non-empty string/
  );
});

test("rejects duplicate product ids", async () => {
  const catalog = await loadProductCatalog("portal/registry.json");
  const invalid = clone(catalog);
  invalid.products[1].id = invalid.products[0].id;
  invalid.products[1].relationships = [];
  assert.throws(() => validateProductCatalog(invalid), /Duplicate product id/);
});

test("rejects self and unknown product relationships", async () => {
  const catalog = await loadProductCatalog("portal/registry.json");

  const self = clone(catalog);
  self.products[0].relationships[0].product = self.products[0].id;
  assert.throws(
    () => validateProductCatalog(self),
    /cannot reference its own product/
  );

  const unknown = clone(catalog);
  unknown.products[0].relationships[0].product = "unknown-product";
  assert.throws(
    () => validateProductCatalog(unknown),
    /Unknown related product/
  );
});

test("rejects non-canonical repository URLs", async () => {
  const catalog = await loadProductCatalog("portal/registry.json");
  const invalid = clone(catalog);
  invalid.products[0].repository = "https://example.com/yohn-jp/mottainai";
  assert.throws(
    () => validateProductCatalog(invalid),
    /canonical GitHub repository URL/
  );
});

test("rejects unknown semantic status tones", async () => {
  const catalog = await loadProductCatalog("portal/registry.json");
  const invalid = clone(catalog);
  invalid.products[0].statusTone = "mottainai";
  assert.throws(
    () => validateProductCatalog(invalid),
    /products\[0\]\.statusTone must be one of/
  );
});

test("portal build publishes only the validated catalog projection", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "product-catalog-"));
  const outputDirectory = join(temporaryDirectory, "site");
  const registryPath = join(temporaryDirectory, "registry.json");
  const registry = JSON.parse(await readFile("portal/registry.json", "utf8"));
  registry.collectionRepositories = ["example"];
  await writeFile(registryPath, JSON.stringify(registry));

  const fetchImpl = async (url) => {
    const repositoryMatch = url.match(/\/repos\/yohn-jp\/([^/]+)$/);
    if (repositoryMatch) {
      const name = repositoryMatch[1];
      return response({
        id: name,
        name,
        full_name: `yohn-jp/${name}`,
        html_url: `https://github.com/yohn-jp/${name}`,
        visibility: "public"
      });
    }
    if (url.includes("/issues")) return response([]);
    throw new Error(`Unexpected URL: ${url}`);
  };

  try {
    await buildDashboard({ outputDirectory, registryPath, fetchImpl });
    const published = JSON.parse(
      await readFile(join(outputDirectory, "data", "products.json"), "utf8")
    );
    assert.equal(published.schemaVersion, 1);
    assert.deepEqual(
      published.products.map((product) => product.id),
      ["mottainai", "nawabari", "inari", "suzukuri", "wabachi", "majiwari"]
    );
    assert.doesNotMatch(
      JSON.stringify(published),
      /GITHUB_TOKEN|Authorization/
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
