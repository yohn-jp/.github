import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadProductCatalog } from "../scripts/product-catalog.mjs";
import { loadProductDetails } from "../scripts/product-details.mjs";
import { renderProductOverviewPage } from "../scripts/render-portal.mjs";

const LEGACY_IDENTITY = /yohn\.dev/;

test("static portal surfaces use yohn-jp and dev.yohn.jp identity", async () => {
  for (const path of [
    "portal/index.html",
    "dashboard/index.html",
    "dashboard/graph/index.html"
  ]) {
    const source = await readFile(path, "utf8");
    assert.doesNotMatch(source, LEGACY_IDENTITY, `${path} must not claim yohn.dev`);
    assert.match(source, /yohn-jp/);
    assert.match(source, /https:\/\/dev\.yohn\.jp\//);
  }
});

test("generated product pages use canonical organization and domain identity", async () => {
  const catalog = await loadProductCatalog("portal/registry.json");
  const details = await loadProductDetails("portal/product-details.json", catalog);
  const detailsById = new Map(details.products.map((detail) => [detail.id, detail]));

  for (const product of catalog.products) {
    const html = renderProductOverviewPage(
      product,
      catalog,
      detailsById.get(product.id)
    );
    assert.doesNotMatch(html, LEGACY_IDENTITY, `${product.id} must not claim yohn.dev`);
    assert.match(html, />yohn-jp<\/span>/);
    assert.match(
      html,
      new RegExp(`https://dev\\.yohn\\.jp/products/${product.id}/`)
    );
  }
});
