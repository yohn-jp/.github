import test from "node:test";
import assert from "node:assert/strict";
import { loadProductCatalog } from "../scripts/product-catalog.mjs";
import {
  loadProductDetails,
  validateProductDetails
} from "../scripts/product-details.mjs";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test("details cover every catalog product in catalog order", async () => {
  const catalog = await loadProductCatalog("portal/registry.json");
  const details = await loadProductDetails(
    "portal/product-details.json",
    catalog
  );
  assert.deepEqual(
    details.products.map((detail) => detail.id),
    catalog.products.map((product) => product.id)
  );
  for (const detail of details.products) {
    assert.ok(detail.why.length > 80);
    assert.ok(detail.core.length >= 3);
    assert.ok(detail.maturity.length > 60);
    assert.ok(detail.locales.ja.why.length > 80);
    assert.equal(detail.locales.en.why, detail.why);
    assert.notEqual(detail.locales.ja.why, detail.why);
  }
});

test("rejects missing required localized product detail content", async () => {
  const catalog = await loadProductCatalog("portal/registry.json");
  const details = await loadProductDetails(
    "portal/product-details.json",
    catalog
  );
  const invalid = clone(details);
  delete invalid.products[0].locales.ja.core[0].body;
  assert.throws(
    () => validateProductDetails(invalid, catalog),
    /products\[0\]\.locales\.ja\.core\[0\]\.body must be a non-empty string/
  );
});

test("details reject missing, duplicate, and unknown product entries", async () => {
  const catalog = await loadProductCatalog("portal/registry.json");
  const details = await loadProductDetails(
    "portal/product-details.json",
    catalog
  );

  const missing = clone(details);
  missing.products.pop();
  assert.throws(
    () => validateProductDetails(missing, catalog),
    /Missing product detail/
  );

  const duplicate = clone(details);
  duplicate.products[1].id = duplicate.products[0].id;
  assert.throws(
    () => validateProductDetails(duplicate, catalog),
    /Duplicate product detail id/
  );

  const unknown = clone(details);
  unknown.products[0].id = "unknown";
  assert.throws(
    () => validateProductDetails(unknown, catalog),
    /Unknown product detail id/
  );
});

test("Wabachi detail remains explicit about early authority-programme status", async () => {
  const catalog = await loadProductCatalog("portal/registry.json");
  const details = await loadProductDetails(
    "portal/product-details.json",
    catalog
  );
  const wabachi = details.products.find((detail) => detail.id === "wabachi");
  assert.match(wabachi.maturity, /early-stage/i);
  assert.match(wabachi.maturity, /README is still placeholder-level/i);
  assert.match(wabachi.why, /canonical truth/i);
});
