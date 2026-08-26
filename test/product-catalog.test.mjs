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
  const catalog = await loadProductCatalog("portal/products.json");
  assert.equal(catalog.schemaVersion, 1);
  assert.deepEqual(
    catalog.products.map((product) => product.id),
    ["mottainai", "nawabari", "inari", "suzukuri", "wabachi", "majiwari"]
  );
  for (const product of catalog.products) {
    assert.match(product.repository, /^https:\/\/github\.com\/yohn-jp\//);
    assert.ok(product.owns.length > 0);
    assert.ok(product.doesNotOwn.length > 0);
  }
});

test("rejects duplicate product ids", async () => {
  const catalog = await loadProductCatalog("portal/products.json");
  const invalid = clone(catalog);
  invalid.products[1].id = invalid.products[0].id;
  invalid.products[1].relationships = [];
  assert.throws(() => validateProductCatalog(invalid), /Duplicate product id/);
});

test("rejects self and unknown product relationships", async () => {
  const catalog = await loadProductCatalog("portal/products.json");

  const self = clone(catalog);
  self.products[0].relationships[0].product = self.products[0].id;
  assert.throws(
    () => validateProductCatalog(self),
    /cannot reference its own product/
  );

  const unknown = clone(catalog);
  unknown.products[0].relationships[0].product = "unknown-product";
  assert.throws(() => validateProductCatalog(unknown), /Unknown related product/);
});

test("rejects non-canonical repository URLs", async () => {
  const catalog = await loadProductCatalog("portal/products.json");
  const invalid = clone(catalog);
  invalid.products[0].repository = "https://example.com/yohn-jp/mottainai";
  assert.throws(
    () => validateProductCatalog(invalid),
    /canonical GitHub repository URL/
  );
});

test("portal build publishes only the validated catalog projection", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "product-catalog-"));
  const outputDirectory = join(temporaryDirectory, "site");
  const configPath = join(temporaryDirectory, "repositories.json");
  await writeFile(
    configPath,
    JSON.stringify({ organization: "yohn-jp", repositories: ["example"] })
  );

  const fetchImpl = async (url) => {
    if (url.endsWith("/repos/yohn-jp/example")) {
      return response({
        id: 1,
        name: "example",
        full_name: "yohn-jp/example",
        html_url: "https://github.com/yohn-jp/example",
        visibility: "public"
      });
    }
    if (url.includes("/repos/yohn-jp/example/issues")) return response([]);
    throw new Error(`Unexpected URL: ${url}`);
  };

  try {
    await buildDashboard({ outputDirectory, configPath, fetchImpl });
    const published = JSON.parse(
      await readFile(join(outputDirectory, "data", "products.json"), "utf8")
    );
    assert.equal(published.schemaVersion, 1);
    assert.deepEqual(
      published.products.map((product) => product.id),
      ["mottainai", "nawabari", "inari", "suzukuri", "wabachi", "majiwari"]
    );
    assert.doesNotMatch(JSON.stringify(published), /GITHUB_TOKEN|Authorization/);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
