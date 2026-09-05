import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDashboard } from "../scripts/build-dashboard.mjs";
import { loadProductCatalog } from "../scripts/product-catalog.mjs";
import { loadProductDetails } from "../scripts/product-details.mjs";
import {
  localizedPortalPath,
  renderLocaleMetadata,
  renderPortalHome,
  renderProductOverviewPage
} from "../scripts/render-portal.mjs";

function response(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

async function portalInputs() {
  const [template, catalog] = await Promise.all([
    readFile("portal/index.html", "utf8"),
    loadProductCatalog("portal/registry.json")
  ]);
  const details = await loadProductDetails(
    "portal/product-details.json",
    catalog
  );
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

test("variable-length product cards and Work CTAs stay in document flow", async () => {
  const { template, catalog } = await portalInputs();
  const html = renderPortalHome(template, catalog, "ja");
  const cardStart = html.indexOf(
    '<article class="product-card" data-product="majiwari">'
  );
  const cardEnd = html.indexOf("</article>", cardStart);
  assert.ok(cardStart >= 0);
  assert.ok(cardEnd > cardStart);
  const majiwariCard = html.slice(cardStart, cardEnd);
  assert.match(
    majiwariCard,
    /<div class="product-card-content">[\s\S]*<p class="product-summary">[\s\S]*<\/div>\s*<div class="product-actions">/
  );

  assert.match(
    template,
    /<div class="work-actions">[\s\S]*data-message="portal\.work\.openDashboard"[\s\S]*data-message="portal\.work\.openGovernance"[\s\S]*<\/div>/
  );

  const css = await readFile("portal/styles.css", "utf8");
  const productCardRule = css.match(/\.product-card \{[^}]+\}/)?.[0];
  const productActionsRule = css.match(/\.product-actions \{[^}]+\}/)?.[0];
  assert.ok(productCardRule);
  assert.ok(productActionsRule);
  assert.match(productCardRule, /display:\s*flex/);
  assert.doesNotMatch(productCardRule, /min-height|position:\s*absolute/);
  assert.match(productActionsRule, /margin-top:\s*32px/);
  assert.doesNotMatch(productActionsRule, /position:\s*absolute/);
  assert.match(css, /\.work-actions \{[\s\S]*display:\s*flex/);
});

test("localized renderers emit route-specific language metadata and switching", async () => {
  const { template, catalog, details } = await portalInputs();
  const home = renderPortalHome(template, catalog, "ja");
  assert.match(home, /<html lang="ja">/);
  assert.match(
    home,
    /<link rel="canonical" href="https:\/\/dev\.yohn\.jp\/ja\/"/
  );
  assert.match(home, /hreflang="en" href="https:\/\/dev\.yohn\.jp\/en\/"/);
  assert.match(home, /hreflang="ja" href="https:\/\/dev\.yohn\.jp\/ja\/"/);
  assert.match(home, /data-locale-switch="en" href="\/en\/"/);
  assert.match(home, /プロダクト/);
  assert.match(home, /コーディングエージェントのオーケストレーション/);
  assert.doesNotMatch(home, /Coding-agent orchestration and context runtime/);

  const product = catalog.products.find((entry) => entry.id === "nawabari");
  const detail = details.products.find((entry) => entry.id === "nawabari");
  const productPage = renderProductOverviewPage(
    product,
    catalog,
    detail,
    "ja",
    {
      localized: true,
      path: "products/nawabari/"
    }
  );
  assert.match(productPage, /<html lang="ja">/);
  assert.match(
    productPage,
    /<link rel="canonical" href="https:\/\/dev\.yohn\.jp\/ja\/products\/nawabari\/"/
  );
  assert.match(productPage, /href="\/en\/products\/nawabari\/"/);
  assert.match(
    productPage,
    /href="\.\.\/\.\.\/work\/\?repository=yohn-jp%2Fnawabari"/
  );
  assert.match(productPage, /独立したGit\/session所有権ランタイム/);
  assert.match(productPage, /セッションとリソースの所有権/);
  assert.doesNotMatch(productPage, /Standalone Git\/session ownership runtime/);
  assert.equal(localizedPortalPath("ja", "work/graph/"), "/ja/work/graph/");

  const metadata = renderLocaleMetadata({ locale: "en", path: "work/" });
  assert.match(metadata.links, /hreflang="x-default"/);
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
    assert.match(
      renderProductOverviewPage(product, catalog, detail),
      expectations[product.id]
    );
  }
});

test("renderer rejects malformed templates", async () => {
  const { catalog } = await portalInputs();
  assert.throws(
    () => renderPortalHome("{{PRODUCT_CARDS}}", catalog),
    /missing token/
  );
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
    const root = await readFile(join(outputDirectory, "index.html"), "utf8");
    assert.match(root, /Small tools\./);
    for (const id of [
      "mottainai",
      "nawabari",
      "inari",
      "suzukuri",
      "wabachi",
      "majiwari"
    ]) {
      const product = await readFile(
        join(outputDirectory, "products", id, "index.html"),
        "utf8"
      );
      assert.match(
        product,
        new RegExp(`https://dev\\.yohn\\.jp/products/${id}/`)
      );
      assert.match(product, /Why it exists/);
    }
    for (const locale of ["en", "ja"]) {
      const home = await readFile(
        join(outputDirectory, locale, "index.html"),
        "utf8"
      );
      const work = await readFile(
        join(outputDirectory, locale, "work", "index.html"),
        "utf8"
      );
      const workApp = await readFile(
        join(outputDirectory, locale, "work", "app.js"),
        "utf8"
      );
      const graph = await readFile(
        join(outputDirectory, locale, "work", "graph", "index.html"),
        "utf8"
      );
      assert.match(home, new RegExp(`<html lang="${locale}">`));
      assert.match(home, new RegExp(`https://dev\\.yohn\\.jp/${locale}/`));
      assert.match(work, new RegExp(`https://dev\\.yohn\\.jp/${locale}/work/`));
      assert.match(
        graph,
        new RegExp(`https://dev\\.yohn\\.jp/${locale}/work/graph/`)
      );
      assert.match(work, /data-locale-switch="ja"/);
      assert.match(
        work,
        new RegExp(
          `data-message="work\\.filters\\.governance">${
            locale === "ja" ? "ガバナンス" : "Governance"
          }<\\/span\\s*>`
        )
      );
      assert.match(workApp, /preserveLocaleQuery/);
      assert.match(graph, /data-locale-switch="en"/);
      const product = await readFile(
        join(outputDirectory, locale, "products", "nawabari", "index.html"),
        "utf8"
      );
      assert.match(
        product,
        locale === "ja"
          ? /セッションとリソースの所有権/
          : /Session and resource ownership/
      );
    }
    const [englishCatalog, japaneseCatalog] = await Promise.all(
      ["en", "ja"].map((locale) =>
        readFile(
          join(outputDirectory, locale, "data", "products.json"),
          "utf8"
        ).then(JSON.parse)
      )
    );
    const identityProjection = (catalog) =>
      catalog.products.map((entry) => ({
        id: entry.id,
        name: entry.name,
        repository: entry.repository,
        status: entry.status,
        relationships: entry.relationships.map(({ product, type }) => ({
          product,
          type
        }))
      }));
    assert.deepEqual(
      identityProjection(englishCatalog),
      identityProjection(japaneseCatalog)
    );
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

test("all portal surfaces share a no-JavaScript responsive navigation", async () => {
  const sourcePaths = [
    "portal/index.html",
    "dashboard/index.html",
    "dashboard/graph/index.html",
    "dashboard/governance/index.html"
  ];
  const sources = await Promise.all(
    sourcePaths.map((path) => readFile(path, "utf8"))
  );
  for (const source of sources) {
    assert.match(source, /<details class="mobile-nav">/);
    assert.match(source, /<summary class="mobile-nav-toggle">/);
    assert.match(source, /class="mobile-nav-panel"/);
    assert.match(source, /class="mobile-nav-links"/);
  }

  const { catalog, details } = await portalInputs();
  const product = catalog.products[0];
  const productPage = renderProductOverviewPage(
    product,
    catalog,
    details.products.find((detail) => detail.id === product.id),
    "ja"
  );
  assert.match(productPage, /<details class="mobile-nav">/);
  assert.match(productPage, /メニュー/);

  const css = await readFile("portal/styles.css", "utf8");
  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /\.nav-links \{\s*display: none;/);
  assert.match(css, /\.mobile-nav \{\s*position: relative;/);
  assert.match(
    css,
    /\.mobile-nav-panel \{[\s\S]*width: min\(260px, calc\(100vw - 30px\)\)/
  );
  assert.match(css, /\.system-section :focus-visible \{/);
  assert.doesNotMatch(css, /\.product-page \.site-nav-wrap/);
});
