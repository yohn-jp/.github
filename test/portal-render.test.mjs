import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDashboard } from "../scripts/build-dashboard.mjs";
import { loadProductCatalog } from "../scripts/product-catalog.mjs";
import { loadProductDetails } from "../scripts/product-details.mjs";
import { renderPortalHome, renderProductOverviewPage } from "../scripts/render-portal.mjs";

function response(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

async function portalInputs() {
  const [template, catalog] = await Promise.all([
    readFile("portal/index.html", "utf8"),
    loadProductCatalog("portal/registry.json")
  ]);
  const details = await loadProductDetails("portal/product-details.json", catalog);
  return { template, catalog, details };
}

test("home renderer projects catalog products and relationships", async () => {
  const { template, catalog } = await portalInputs();
  const html = renderPortalHome(template, catalog);
  assert.doesNotMatch(html, /\{\{/);
  for (const product of catalog.products) {
    assert.match(html, new RegExp(`data-product="${product.id}"`));
    assert.match(html, new RegExp(`href="\\./products/${product.id}/"`));
  }
  assert.match(html, /id="products"/);
  assert.match(html, /id="system"/);
});

test("product renderer emits deep content and repository-filtered work link", async () => {
  const { catalog, details } = await portalInputs();
  const product = catalog.products.find((entry) => entry.id === "nawabari");
  const detail = details.products.find((entry) => entry.id === "nawabari");
  const html = renderProductOverviewPage(product, catalog, detail);
  assert.match(html, /<h1>Nawabari<\/h1>/);
  assert.match(html, /Why it exists/);
  assert.match(html, /Core model/);
  assert.match(html, /Current maturity/);
  assert.match(html, /href="\.\.\/mottainai\/"/);
  assert.match(html, /work\/\?repository=yohn-jp%2Fnawabari/);
  assert.match(html, /https:\/\/dev\.yohn\.jp\/products\/nawabari\//);
});

test("each product page carries product-specific grounded core concepts", async () => {
  const { catalog, details } = await portalInputs();
  const expectations = {
    mottainai: /Bounded context runtime/,
    nawabari: /Session and resource ownership/,
    inari: /Validate, render, then mutate/,
    suzukuri: /Provenance and loss semantics/,
    wabachi: /Immutable provider evidence/,
    majiwari: /Deterministic adapters, not reimplementation/
  };
  for (const product of catalog.products) {
    const detail = details.products.find((entry) => entry.id === product.id);
    assert.match(renderProductOverviewPage(product, catalog, detail), expectations[product.id]);
  }
});

test("renderer rejects malformed templates", async () => {
  const { catalog } = await portalInputs();
  assert.throws(() => renderPortalHome("{{PRODUCT_CARDS}}", catalog), /missing token/);
});

test("build publishes root and stable product routes", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "portal-render-"));
  const outputDirectory = join(temporaryDirectory, "site");
  const registryPath = join(temporaryDirectory, "registry.json");
  const registry = JSON.parse(await readFile("portal/registry.json", "utf8"));
  registry.collectionRepositories = ["example"];
  await writeFile(registryPath, JSON.stringify(registry));
  const fetchImpl = async (url) => {
    const repositoryMatch = url.match(/\/repos\/yohn-jp\/([^/]+)$/);
    if (repositoryMatch) {
      const name = repositoryMatch[1];
      return response({ id: name, name, full_name: `yohn-jp/${name}`, html_url: `https://github.com/yohn-jp/${name}`, visibility: "public" });
    }
    if (url.includes("/issues")) return response([]);
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    await buildDashboard({ outputDirectory, registryPath, fetchImpl });
    const root = await readFile(join(outputDirectory, "index.html"), "utf8");
    assert.match(root, /Small tools\./);
    for (const id of ["mottainai", "nawabari", "inari", "suzukuri", "wabachi", "majiwari"]) {
      const product = await readFile(join(outputDirectory, "products", id, "index.html"), "utf8");
      assert.match(product, new RegExp(`https://dev\\.yohn\\.jp/products/${id}/`));
      assert.match(product, /Why it exists/);
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("visual system includes focus responsive and reduced-motion contracts", async () => {
  const css = await readFile("portal/styles.css", "utf8");
  const productCss = await readFile("portal/product.css", "utf8");
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(productCss, /@media \(max-width: 700px\)/);
});
