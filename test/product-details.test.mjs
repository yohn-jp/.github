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
  const details = await loadProductDetails("portal/product-details.json", catalog);
  assert.deepEqual(
    details.products.map((detail) => detail.id),
    catalog.products.map((product) => product.id)
  );
  for (const detail of details.products) {
    assert.ok(detail.why.length > 80);
    assert.ok(detail.core.length >= 3);
    assert.ok(detail.maturity.length > 60);
  }
});

test("details reject missing, duplicate, and unknown product entries", async () => {
  const catalog = await loadProductCatalog("portal/registry.json");
  const details = await loadProductDetails("portal/product-details.json", catalog);

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
  const details = await loadProductDetails("portal/product-details.json", catalog);
  const wabachi = details.products.find((detail) => detail.id === "wabachi");
  assert.match(wabachi.maturity, /early-stage/i);
  assert.match(wabachi.maturity, /README is still placeholder-level/i);
  assert.match(wabachi.why, /canonical truth/i);
});
