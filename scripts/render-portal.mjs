import { message, resolveHtmlMessages } from "../messages.js";

const t = (key, values = {}) => message(key, values, "en");

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function productPath(id, prefix = "./") {
  return `${prefix}products/${encodeURIComponent(id)}/`;
}

function repositoryFullName(product) {
  const url = new URL(product.repository);
  return url.pathname.split("/").filter(Boolean).join("/");
}

function list(items, className = "boundary-list") {
  return `<ul class="${className}">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderProductCard(product) {
  return `
<article class="product-card" data-product="${escapeHtml(product.id)}">
  <div class="product-card-topline">
    <span class="product-index">${String(product.order / 10).padStart(2, "0")}</span>
    <span class="status-dot" aria-hidden="true"></span>
    <span class="product-status">${escapeHtml(product.status)}</span>
  </div>
  <p class="product-role">${escapeHtml(product.role)}</p>
  <h3>${escapeHtml(product.name)}</h3>
  <p class="product-summary">${escapeHtml(product.summary)}</p>
  <div class="product-actions">
    <a class="text-link" href="${productPath(product.id)}">${escapeHtml(t("portal.product.explore", { name: product.name }))}</a>
    <a class="quiet-link" href="${escapeHtml(product.repository)}" rel="noreferrer">${escapeHtml(t("portal.product.github"))}</a>
  </div>
</article>`;
}

function renderSystemNode(product) {
  return `<a class="system-node" data-product="${escapeHtml(product.id)}" href="${productPath(product.id)}">
  <span class="system-node-role">${escapeHtml(product.role)}</span>
  <strong>${escapeHtml(product.name)}</strong>
</a>`;
}

function renderRelationships(catalog) {
  const byId = new Map(
    catalog.products.map((product) => [product.id, product])
  );
  return catalog.products
    .flatMap((source) =>
      source.relationships.map((relation) => ({
        source,
        relation,
        target: byId.get(relation.product)
      }))
    )
    .map(
      ({ source, relation, target }) => `<li>
  <a href="${productPath(source.id)}">${escapeHtml(source.name)}</a>
  <span>${escapeHtml(relation.label)}</span>
  <a href="${productPath(target.id)}">${escapeHtml(target.name)}</a>
</li>`
    )
    .join("");
}

function replaceOnce(template, token, value) {
  const first = template.indexOf(token);
  if (first === -1) throw new Error(`Portal template missing token ${token}`);
  if (template.indexOf(token, first + token.length) !== -1) {
    throw new Error(`Portal template contains duplicate token ${token}`);
  }
  return template.replace(token, value);
}

export function renderPortalHome(template, catalog) {
  let output = template;
  output = replaceOnce(
    output,
    "{{PRODUCT_CARDS}}",
    catalog.products.map(renderProductCard).join("\n")
  );
  output = replaceOnce(
    output,
    "{{SYSTEM_NODES}}",
    catalog.products.map(renderSystemNode).join("\n")
  );
  output = replaceOnce(
    output,
    "{{RELATIONSHIPS}}",
    renderRelationships(catalog)
  );
  return resolveHtmlMessages(output, "en");
}

function renderCoreSections(detail) {
  return detail.core
    .map(
      (section, index) => `<article class="concept-card">
  <span class="concept-index">${String(index + 1).padStart(2, "0")}</span>
  <h3>${escapeHtml(section.title)}</h3>
  <p>${escapeHtml(section.body)}</p>
</article>`
    )
    .join("\n");
}

export function renderProductOverviewPage(product, catalog, detail) {
  if (!detail || detail.id !== product.id)
    throw new Error(`Product detail mismatch for ${product.id}`);
  const byId = new Map(catalog.products.map((entry) => [entry.id, entry]));
  const relationships = product.relationships
    .map((relation) => {
      const target = byId.get(relation.product);
      return `<li><span>${escapeHtml(relation.label)}</span><a href="../${escapeHtml(target.id)}/">${escapeHtml(target.name)}</a></li>`;
    })
    .join("");
  const workHref = `../../work/?repository=${encodeURIComponent(repositoryFullName(product))}`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="${escapeHtml(product.summary)}" />
    <link rel="canonical" href="https://dev.yohn.jp/products/${escapeHtml(product.id)}/" />
    <title>${escapeHtml(t("portal.product.title", { name: product.name }))}</title>
    <link rel="stylesheet" href="../../styles.css" />
    <link rel="stylesheet" href="../../product.css" />
  </head>
  <body class="product-page">
    <header class="site-nav-wrap">
      <nav class="shell site-nav" aria-label="${escapeHtml(t("portal.nav.primary"))}">
        <a class="brand" href="../../" aria-label="${escapeHtml(t("portal.nav.home"))}"><span class="brand-slash">/</span><span>yohn-jp</span></a>
        <div class="nav-links"><a href="../../#products">${escapeHtml(t("portal.nav.products"))}</a><a href="../../#system">${escapeHtml(t("portal.nav.system"))}</a><a href="${workHref}">${escapeHtml(t("portal.nav.work"))}</a></div>
      </nav>
    </header>
    <main>
      <section class="shell product-hero">
        <a class="back-link" href="../../#products">${escapeHtml(t("portal.product.backToProducts"))}</a>
        <p class="eyebrow">${escapeHtml(product.role)}</p>
        <h1>${escapeHtml(product.name)}</h1>
        <p class="product-page-summary">${escapeHtml(product.summary)}</p>
        <div class="product-meta"><span>${escapeHtml(product.status)}</span><a href="${escapeHtml(product.repository)}" rel="noreferrer">${escapeHtml(t("portal.product.repository"))}</a><a href="${escapeHtml(product.documentation)}" rel="noreferrer">${escapeHtml(t("portal.product.documentation"))}</a></div>
      </section>

      <section class="product-why-wrap"><div class="shell product-why"><p class="eyebrow">${escapeHtml(t("portal.product.why"))}</p><p class="why-copy">${escapeHtml(detail.why)}</p></div></section>

      <section class="shell boundary-grid" aria-label="${escapeHtml(t("portal.product.boundaryLabel"))}">
        <article class="boundary-panel"><p class="eyebrow">${escapeHtml(t("portal.product.owns"))}</p><h2>${escapeHtml(t("portal.product.authority"))}</h2>${list(product.owns)}</article>
        <article class="boundary-panel muted-panel"><p class="eyebrow">${escapeHtml(t("portal.product.doesNotOwn"))}</p><h2>${escapeHtml(t("portal.product.boundary"))}</h2>${list(product.doesNotOwn)}</article>
      </section>

      <section class="shell concept-section" aria-labelledby="concepts-${escapeHtml(product.id)}">
        <div class="section-head compact-head"><div><p class="eyebrow">${escapeHtml(t("portal.product.coreModel"))}</p><h2 id="concepts-${escapeHtml(product.id)}">${escapeHtml(t("portal.product.howItWorks", { name: product.name }))}</h2></div><p>${escapeHtml(t("portal.product.operationalDetail"))}</p></div>
        <div class="concept-grid">${renderCoreSections(detail)}</div>
      </section>

      <section class="maturity-wrap"><div class="shell maturity-block"><p class="eyebrow">${escapeHtml(t("portal.product.currentMaturity"))}</p><h2>${escapeHtml(product.status)}</h2><p>${escapeHtml(detail.maturity)}</p></div></section>

      <section class="shell product-relations"><p class="eyebrow">${escapeHtml(t("portal.product.relationships"))}</p><h2>${escapeHtml(t("portal.product.fitsSystem"))}</h2><ul>${relationships}</ul></section>
      <section class="shell product-next"><div><p class="eyebrow">${escapeHtml(t("portal.product.publicWork"))}</p><h2>${escapeHtml(t("portal.product.followImplementation", { name: product.name }))}</h2><p>${escapeHtml(t("portal.product.prefilteredWork"))}</p></div><a class="button dark" href="${workHref}">${escapeHtml(t("portal.product.openWork", { name: product.name }))}</a></section>
    </main>
    <footer class="shell footer"><span>${escapeHtml(t("portal.footer.domain"))}</span><a href="../../">${escapeHtml(t("portal.footer.portalHome"))}</a></footer>
  </body>
</html>\n`;
}
