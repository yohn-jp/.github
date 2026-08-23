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

function list(items, className = "boundary-list") {
  return `<ul class="${className}">${items
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("")}</ul>`;
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
    <a class="text-link" href="${productPath(product.id)}">Explore ${escapeHtml(product.name)}</a>
    <a class="quiet-link" href="${escapeHtml(product.repository)}" rel="noreferrer">GitHub</a>
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
  const byId = new Map(catalog.products.map((product) => [product.id, product]));
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
  output = replaceOnce(output, "{{RELATIONSHIPS}}", renderRelationships(catalog));
  return output;
}

export function renderProductOverviewPage(product, catalog) {
  const byId = new Map(catalog.products.map((entry) => [entry.id, entry]));
  const relationships = product.relationships
    .map((relation) => {
      const target = byId.get(relation.product);
      return `<li><span>${escapeHtml(relation.label)}</span><a href="../${escapeHtml(
        target.id
      )}/">${escapeHtml(target.name)}</a></li>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="${escapeHtml(product.summary)}" />
    <link rel="canonical" href="https://dev.yohn.jp/products/${escapeHtml(product.id)}/" />
    <title>${escapeHtml(product.name)} · yohn-jp</title>
    <link rel="stylesheet" href="../../styles.css" />
  </head>
  <body class="product-page">
    <header class="site-nav-wrap">
      <nav class="shell site-nav" aria-label="Primary navigation">
        <a class="brand" href="../../"><span class="brand-slash">/</span><span>yohn.dev</span></a>
        <div class="nav-links"><a href="../../#products">Products</a><a href="../../#system">System</a><a href="../../work/">Work</a></div>
      </nav>
    </header>
    <main>
      <section class="shell product-hero">
        <a class="back-link" href="../../#products">← All products</a>
        <p class="eyebrow">${escapeHtml(product.role)}</p>
        <h1>${escapeHtml(product.name)}</h1>
        <p class="product-page-summary">${escapeHtml(product.summary)}</p>
        <div class="product-meta"><span>${escapeHtml(product.status)}</span><a href="${escapeHtml(
          product.repository
        )}" rel="noreferrer">Repository ↗</a><a href="${escapeHtml(
          product.documentation
        )}" rel="noreferrer">Documentation ↗</a></div>
      </section>
      <section class="shell boundary-grid" aria-label="Product responsibility boundary">
        <article class="boundary-panel"><p class="eyebrow">Owns</p><h2>Authority</h2>${list(
          product.owns
        )}</article>
        <article class="boundary-panel muted-panel"><p class="eyebrow">Does not own</p><h2>Boundary</h2>${list(
          product.doesNotOwn
        )}</article>
      </section>
      <section class="shell product-relations"><p class="eyebrow">Relationships</p><h2>Fits into a larger system</h2><ul>${relationships}</ul></section>
      <section class="shell product-next"><div><p class="eyebrow">Public work</p><h2>Follow implementation in GitHub</h2><p>Live work remains a read-only projection. GitHub is source of truth.</p></div><a class="button dark" href="../../work/">Open work dashboard</a></section>
    </main>
    <footer class="shell footer"><span>dev.yohn.jp</span><a href="../../">Portal home</a></footer>
  </body>
</html>\n`;
}
