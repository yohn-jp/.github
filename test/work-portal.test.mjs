import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadProductCatalog } from "../scripts/product-catalog.mjs";
import {
  buildProductRepositoryIndex,
  buildWorkQuery,
  repositoryFullNameFromUrl,
  resolveRepositoryFilter,
  resolveSearchFilter
} from "../dashboard/work-model.js";

test("product catalog maps canonical repositories to product routes", async () => {
  const catalog = await loadProductCatalog("portal/products.json");
  const index = buildProductRepositoryIndex(catalog);
  assert.equal(index.get("yohn-jp/mottainai").id, "mottainai");
  assert.equal(index.get("yohn-jp/nawabari").name, "Nawabari");
  assert.equal(repositoryFullNameFromUrl("https://github.com/yohn-jp/gh-inari"), "yohn-jp/gh-inari");
  assert.equal(repositoryFullNameFromUrl("https://example.com/yohn-jp/gh-inari"), null);
});

test("repository query prefilter accepts only configured exact repositories", () => {
  const repositories = [
    { fullName: "yohn-jp/nawabari" },
    { fullName: "yohn-jp/.github" }
  ];
  assert.equal(
    resolveRepositoryFilter("?repository=yohn-jp%2Fnawabari", repositories),
    "yohn-jp/nawabari"
  );
  assert.equal(
    resolveRepositoryFilter("?repository=yohn-jp%2Funknown", repositories),
    ""
  );
  assert.equal(resolveSearchFilter("?q=claims"), "claims");
});

test("work query contract is stable and omits empty filters", () => {
  assert.equal(buildWorkQuery(), "");
  assert.equal(
    buildWorkQuery({ repository: "yohn-jp/nawabari", search: "claim mode" }),
    "?repository=yohn-jp%2Fnawabari&q=claim+mode"
  );
});

test("work UI shares portal visual system and loads product projection without credentials", async () => {
  const [html, app, model, css] = await Promise.all([
    readFile("dashboard/index.html", "utf8"),
    readFile("dashboard/app.js", "utf8"),
    readFile("dashboard/work-model.js", "utf8"),
    readFile("dashboard/work.css", "utf8")
  ]);
  assert.match(html, /href="\.\.\/styles\.css"/);
  assert.match(html, /type="module" src="\.\/app\.js"/);
  assert.match(html, /aria-current="page"/);
  assert.match(app, /fetch\("\.\/data\/dashboard\.json"/);
  assert.match(app, /fetch\("\.\.\/data\/products\.json"/);
  assert.match(app, /\.\.\/products\/\$\{encodeURIComponent\(product\.id\)\}\//);
  assert.match(model, /URLSearchParams/);
  assert.match(css, /\.work-hero/);
  assert.doesNotMatch(`${app}\n${model}`, /api\.github\.com|Authorization|GITHUB_TOKEN|GH_TOKEN/);
});
