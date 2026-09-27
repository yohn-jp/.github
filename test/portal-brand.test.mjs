import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { loadProductCatalog } from "../scripts/product-catalog.mjs";
import { loadProductDetails } from "../scripts/product-details.mjs";
import {
  renderPortalHome,
  renderProductOverviewPage
} from "../scripts/render-portal.mjs";

const assetRoot = "portal/assets/products";

test("curated product identity assets have reviewable provenance", async () => {
  const catalog = await loadProductCatalog("portal/registry.json");
  const details = await loadProductDetails(
    "portal/product-details.json",
    catalog
  );

  for (const detail of details.products) {
    if (!detail.identity.asset) {
      assert.equal(detail.identity.source, null);
      continue;
    }
    const bytes = await readFile(`${assetRoot}/${detail.identity.asset}`);
    const digest = createHash("sha256").update(bytes).digest("hex");
    assert.equal(digest, detail.identity.source.sha256, detail.id);
  }
});

test("Home and Product detail render curated marks with deterministic fallbacks", async () => {
  const [template, catalog, details] = await Promise.all([
    readFile("portal/index.html", "utf8"),
    loadProductCatalog("portal/registry.json"),
    loadProductDetails(
      "portal/product-details.json",
      await loadProductCatalog("portal/registry.json")
    )
  ]);
  const home = renderPortalHome(template, catalog, "en", {
    productDetails: details
  });
  assert.match(
    home,
    /src="\.\/assets\/products\/mottainai\.webp"[^>]+loading="lazy"/
  );
  assert.match(
    home,
    /data-product="cli-canon"[\s\S]*data-identity-source="fallback"[\s\S]*>CC</
  );

  const wabachi = catalog.products.find((product) => product.id === "wabachi");
  const wabachiDetail = details.products.find(
    (detail) => detail.id === "wabachi"
  );
  const wabachiPage = renderProductOverviewPage(
    wabachi,
    catalog,
    wabachiDetail,
    "en"
  );
  assert.match(wabachiPage, /\.\.\/\.\.\/assets\/products\/wabachi\.webp/);

  const shikitari = catalog.products.find(
    (product) => product.id === "shikitari"
  );
  const shikitariDetail = details.products.find(
    (detail) => detail.id === "shikitari"
  );
  const shikitariPage = renderProductOverviewPage(
    shikitari,
    catalog,
    shikitariDetail,
    "ja"
  );
  assert.match(
    shikitariPage,
    /class="product-identity product-hero-identity" data-identity-tone="stone" data-identity-source="fallback"[^>]*>[\s\S]*SH/
  );
});
