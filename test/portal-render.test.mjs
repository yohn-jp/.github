import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDashboard } from "../scripts/build-dashboard.mjs";
import { loadProductCatalog } from "../scripts/product-catalog.mjs";
import {
  renderPortalHome,
  renderProductOverviewPage
} from "../scripts/render-portal.mjs";

function response(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

test("home renderer projects product cards, system nodes, and relationships", async () => {
  const [template, catalog] = await Promise.all([
    readFile("portal/index.html", "utf8"),
    loadProductCatalog("portal/products.json")
  ]);
  const html = renderPortalHome(template, catalog);
  assert.doesNotMatch(html, /\{\{(?:PRODUCT_CARDS|SYSTEM_NODES|RELATIONSHIPS)\}\}/);
  for (const product of catalog.products) {
    assert.match(html, new RegExp(`data-product="${product.id}"`));
    assert.match(html, new RegExp(`href="\\./products/${product.id}/"`));
  }
  assert.match(html, /aria-label="Primary navigation"/);
  assert.match(html, /id="products"/);
  assert.match(html, /id="system"/);
});

test("product overview renderer preserves catalog boundaries and internal navigation", async () => {
  const catalog = await loadProductCatalog("portal/products.json");
  const product = catalog.products.find((entry) => entry.id === "nawabari");
  const html = renderProductOverviewPage(product, catalog);
  assert.match(html, /<h1>Nawabari<\/h1>/);
  assert.match(html, /Authority/);
  assert.match(html, /Boundary/);
  assert.match(html, /href="\.\.\/mottainai\/"/);
  assert.match(html, /href="\.\.\/\.\.\/work\/"/);
  assert.match(html, /https:\/\/dev\.yohn\.jp\/products\/nawabari\//);
});

test("renderer rejects malformed portal templates instead of publishing partial markup", async () => {
  const catalog = await loadProductCatalog("portal/products.json");
  assert.throws(
    () => renderPortalHome("{{PRODUCT_CARDS}}", catalog),
    /missing token \{\{SYSTEM_NODES\}\}/
  );
});

test("build publishes generated root and one stable route per product", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "portal-render-"));
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
    const root = await readFile(join(outputDirectory, "index.html"), "utf8");
    assert.match(root, /Small tools\./);
    assert.doesNotMatch(root, /\{\{/);

    for (const id of ["mottainai", "nawabari", "inari", "suzukuri", "wabachi"]) {
      const product = await readFile(
        join(outputDirectory, "products", id, "index.html"),
        "utf8"
      );
      assert.match(product, new RegExp(`https://dev\\.yohn\\.jp/products/${id}/`));
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("visual system includes responsive focus and reduced-motion contracts", async () => {
  const css = await readFile("portal/styles.css", "utf8");
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media \(max-width: 700px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});
