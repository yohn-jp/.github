import {
  message,
  normalizeLocale,
  resolveHtmlLocale,
  resolveHtmlMessages,
  SUPPORTED_LOCALES
} from "../messages.js";

const SITE_ORIGIN = "https://dev.yohn.jp";

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

function localizedProductContent(product, locale) {
  const content = product?.locales?.[locale];
  if (!content) {
    throw new Error(
      `Missing localized product content for ${product?.id ?? "unknown"}:${locale}`
    );
  }
  return content;
}

function localizedDetailContent(detail, locale) {
  const content = detail?.locales?.[locale];
  if (!content) {
    throw new Error(
      `Missing localized product detail for ${detail?.id ?? "unknown"}:${locale}`
    );
  }
  return content;
}

function localizedRelationshipLabel(relation, locale) {
  const label = relation?.localizedLabel?.[locale];
  if (!label) {
    throw new Error(
      `Missing localized relationship label for ${relation?.product ?? "unknown"}:${locale}`
    );
  }
  return label;
}

export function normalizePortalLocale(locale) {
  const base = normalizeLocale(locale).split("-")[0];
  return SUPPORTED_LOCALES.includes(base) ? base : "en";
}

function logicalPath(value = "") {
  const path = String(value).replace(/^\/+/, "");
  return path && !path.endsWith("/") ? `${path}/` : path;
}

export function localizedPortalPath(locale, path = "") {
  const resolvedLocale = normalizePortalLocale(locale);
  const suffix = logicalPath(path);
  return `/${resolvedLocale}/${suffix}`;
}

function portalUrl(path) {
  return `${SITE_ORIGIN}${path}`;
}

export function renderLocaleMetadata({
  locale = "en",
  path = "",
  localized = true
} = {}) {
  const resolvedLocale = normalizePortalLocale(locale);
  const canonicalPath = localized
    ? localizedPortalPath(resolvedLocale, path)
    : `/${logicalPath(path)}`;
  const links = SUPPORTED_LOCALES.map(
    (targetLocale) =>
      `<link rel="alternate" hreflang="${targetLocale}" href="${escapeHtml(
        portalUrl(localizedPortalPath(targetLocale, path))
      )}" />`
  );
  links.push(
    `<link rel="alternate" hreflang="x-default" href="${escapeHtml(
      portalUrl(localizedPortalPath("en", path))
    )}" />`
  );
  return {
    canonical: portalUrl(canonicalPath),
    links: links.join("\n    ")
  };
}

export function renderLocaleSelector({ locale = "en", path = "", t } = {}) {
  const resolvedLocale = normalizePortalLocale(locale);
  const translate =
    t ?? ((key, values = {}) => message(key, values, resolvedLocale));
  const links = SUPPORTED_LOCALES.map((targetLocale) => {
    const label =
      targetLocale === "ja"
        ? translate("portal.locale.japanese")
        : translate("portal.locale.english");
    const current =
      targetLocale === resolvedLocale ? ' aria-current="page"' : "";
    return `<a data-locale-switch="${targetLocale}" href="${escapeHtml(
      localizedPortalPath(targetLocale, path)
    )}" hreflang="${targetLocale}" lang="${targetLocale}"${current}>${escapeHtml(label)}</a>`;
  }).join("");
  return `<div class="locale-switcher" aria-label="${escapeHtml(
    translate("portal.locale.selector")
  )}"><span class="locale-switcher-label">${escapeHtml(
    translate("portal.locale.selector")
  )}</span>${links}</div>`;
}

function renderProductCard(product, t, locale) {
  const content = localizedProductContent(product, locale);
  return `
<article class="product-card" data-product="${escapeHtml(product.id)}">
  <div class="product-card-topline">
    <span class="product-index">${String(product.order / 10).padStart(2, "0")}</span>
    <span class="status-dot" aria-hidden="true"></span>
    <span class="product-status">${escapeHtml(product.status)}</span>
  </div>
  <div class="product-card-content">
    <p class="product-role">${escapeHtml(content.role)}</p>
    <h3>${escapeHtml(product.name)}</h3>
    <p class="product-summary">${escapeHtml(content.summary)}</p>
  </div>
  <div class="product-actions">
    <a class="text-link" href="${productPath(product.id)}">${escapeHtml(t("portal.product.explore", { name: product.name }))}</a>
    <a class="quiet-link" href="${escapeHtml(product.repository)}" rel="noreferrer">${escapeHtml(t("portal.product.github"))}</a>
  </div>
</article>`;
}

function renderSystemNode(product, locale) {
  const content = localizedProductContent(product, locale);
  return `<a class="system-node" data-product="${escapeHtml(product.id)}" href="${productPath(product.id)}">
  <span class="system-node-role">${escapeHtml(content.role)}</span>
  <strong>${escapeHtml(product.name)}</strong>
</a>`;
}

function renderRelationships(catalog, locale) {
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
  <span>${escapeHtml(localizedRelationshipLabel(relation, locale))}</span>
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

export function renderLocalizedHtml(
  template,
  { locale = "en", path = "", localized = true, t } = {}
) {
  const resolvedLocale = normalizePortalLocale(locale);
  const translate =
    t ?? ((key, values = {}) => message(key, values, resolvedLocale));
  const metadata = renderLocaleMetadata({
    locale: resolvedLocale,
    path,
    localized
  });
  let output = String(template);
  output = replaceOnce(
    output,
    "{{CANONICAL_URL}}",
    escapeHtml(metadata.canonical)
  );
  output = replaceOnce(output, "{{HREFLANG_LINKS}}", metadata.links);
  output = replaceOnce(
    output,
    "{{LANGUAGE_SELECTOR}}",
    renderLocaleSelector({ locale: resolvedLocale, path, t: translate })
  );
  return resolveHtmlMessages(output, resolvedLocale);
}

export function renderPortalHome(template, catalog, locale, options = {}) {
  const resolvedLocale = normalizePortalLocale(
    resolveHtmlLocale(template, locale)
  );
  const localized = options.localized ?? locale !== undefined;
  const t = (key, values = {}) => message(key, values, resolvedLocale);
  let output = template;
  output = replaceOnce(
    output,
    "{{PRODUCT_CARDS}}",
    catalog.products
      .map((product) => renderProductCard(product, t, resolvedLocale))
      .join("\n")
  );
  output = replaceOnce(
    output,
    "{{SYSTEM_NODES}}",
    catalog.products
      .map((product) => renderSystemNode(product, resolvedLocale))
      .join("\n")
  );
  output = replaceOnce(
    output,
    "{{RELATIONSHIPS}}",
    renderRelationships(catalog, resolvedLocale)
  );
  return renderLocalizedHtml(output, {
    locale: resolvedLocale,
    path: options.path ?? "",
    localized,
    t
  });
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

export function renderProductOverviewPage(
  product,
  catalog,
  detail,
  locale,
  options = {}
) {
  if (!detail || detail.id !== product.id)
    throw new Error(`Product detail mismatch for ${product.id}`);
  const resolvedLocale = normalizePortalLocale(locale ?? "en");
  const localized = options.localized ?? locale !== undefined;
  const t = (key, values = {}) => message(key, values, resolvedLocale);
  const productContent = localizedProductContent(product, resolvedLocale);
  const detailContent = localizedDetailContent(detail, resolvedLocale);
  const byId = new Map(catalog.products.map((entry) => [entry.id, entry]));
  const relationships = product.relationships
    .map((relation) => {
      const target = byId.get(relation.product);
      return `<li><span>${escapeHtml(localizedRelationshipLabel(relation, resolvedLocale))}</span><a href="../${escapeHtml(target.id)}/">${escapeHtml(target.name)}</a></li>`;
    })
    .join("");
  const workHref = `../../work/?repository=${encodeURIComponent(repositoryFullName(product))}`;
  const productPathname =
    options.path ?? `products/${encodeURIComponent(product.id)}/`;
  const metadata = renderLocaleMetadata({
    locale: resolvedLocale,
    path: productPathname,
    localized
  });

  return `<!doctype html>
<html lang="${escapeHtml(resolvedLocale)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="${escapeHtml(productContent.summary)}" />
    <link rel="canonical" href="${escapeHtml(metadata.canonical)}" />
    ${metadata.links}
    <title>${escapeHtml(t("portal.product.title", { name: product.name }))}</title>
    <link rel="stylesheet" href="../../styles.css" />
    <link rel="stylesheet" href="../../product.css" />
  </head>
  <body class="product-page">
    <header class="site-nav-wrap">
      <nav class="shell site-nav" aria-label="${escapeHtml(t("portal.nav.primary"))}">
        <a class="brand" href="../../" aria-label="${escapeHtml(t("portal.nav.home"))}"><span class="brand-slash">/</span><span>yohn-jp</span></a>
        <div class="nav-links"><a href="../../#products">${escapeHtml(t("portal.nav.products"))}</a><a href="../../#system">${escapeHtml(t("portal.nav.system"))}</a><a href="../../work/">${escapeHtml(t("portal.nav.work"))}</a><a href="../../work/governance/">${escapeHtml(t("portal.nav.governance"))}</a><a href="../../work/graph/">${escapeHtml(t("portal.nav.graph"))}</a><a href="https://github.com/yohn-jp" rel="noreferrer">${escapeHtml(t("portal.nav.github"))}</a></div>
        <details class="mobile-nav">
          <summary class="mobile-nav-toggle">
            <span class="mobile-nav-icon" aria-hidden="true"><span></span><span></span><span></span></span>
            <span>${escapeHtml(t("portal.nav.menu"))}</span>
          </summary>
          <div class="mobile-nav-panel">
            <div class="mobile-nav-links"><a href="../../#products">${escapeHtml(t("portal.nav.products"))}</a><a href="../../#system">${escapeHtml(t("portal.nav.system"))}</a><a href="../../work/">${escapeHtml(t("portal.nav.work"))}</a><a href="../../work/governance/">${escapeHtml(t("portal.nav.governance"))}</a><a href="../../work/graph/">${escapeHtml(t("portal.nav.graph"))}</a><a href="https://github.com/yohn-jp" rel="noreferrer">${escapeHtml(t("portal.nav.github"))}</a></div>
          </div>
        </details>
        ${renderLocaleSelector({ locale: resolvedLocale, path: productPathname, t })}
      </nav>
    </header>
    <main>
      <section class="shell product-hero">
        <a class="back-link" href="../../#products">${escapeHtml(t("portal.product.backToProducts"))}</a>
        <p class="eyebrow">${escapeHtml(productContent.role)}</p>
        <h1>${escapeHtml(product.name)}</h1>
        <p class="product-page-summary">${escapeHtml(productContent.summary)}</p>
        <div class="product-meta"><span>${escapeHtml(product.status)}</span><a href="${escapeHtml(product.repository)}" rel="noreferrer">${escapeHtml(t("portal.product.repository"))}</a><a href="${escapeHtml(product.documentation)}" rel="noreferrer">${escapeHtml(t("portal.product.documentation"))}</a></div>
      </section>

      <section class="product-why-wrap"><div class="shell product-why"><p class="eyebrow">${escapeHtml(t("portal.product.why"))}</p><p class="why-copy">${escapeHtml(detailContent.why)}</p></div></section>

      <section class="shell boundary-grid" aria-label="${escapeHtml(t("portal.product.boundaryLabel"))}">
        <article class="boundary-panel"><p class="eyebrow">${escapeHtml(t("portal.product.owns"))}</p><h2>${escapeHtml(t("portal.product.authority"))}</h2>${list(productContent.owns)}</article>
        <article class="boundary-panel muted-panel"><p class="eyebrow">${escapeHtml(t("portal.product.doesNotOwn"))}</p><h2>${escapeHtml(t("portal.product.boundary"))}</h2>${list(productContent.doesNotOwn)}</article>
      </section>

      <section class="shell concept-section" aria-labelledby="concepts-${escapeHtml(product.id)}">
        <div class="section-head compact-head"><div><p class="eyebrow">${escapeHtml(t("portal.product.coreModel"))}</p><h2 id="concepts-${escapeHtml(product.id)}">${escapeHtml(t("portal.product.howItWorks", { name: product.name }))}</h2></div><p>${escapeHtml(t("portal.product.operationalDetail"))}</p></div>
        <div class="concept-grid">${renderCoreSections(detailContent)}</div>
      </section>

      <section class="maturity-wrap"><div class="shell maturity-block"><p class="eyebrow">${escapeHtml(t("portal.product.currentMaturity"))}</p><h2>${escapeHtml(product.status)}</h2><p>${escapeHtml(detailContent.maturity)}</p></div></section>

      <section class="shell product-relations"><p class="eyebrow">${escapeHtml(t("portal.product.relationships"))}</p><h2>${escapeHtml(t("portal.product.fitsSystem"))}</h2><ul>${relationships}</ul></section>
      <section class="shell product-next"><div><p class="eyebrow">${escapeHtml(t("portal.product.publicWork"))}</p><h2>${escapeHtml(t("portal.product.followImplementation", { name: product.name }))}</h2><p>${escapeHtml(t("portal.product.prefilteredWork"))}</p></div><a class="button dark" href="${workHref}">${escapeHtml(t("portal.product.openWork", { name: product.name }))}</a></section>
    </main>
    <footer class="shell footer"><span>${escapeHtml(t("portal.footer.domain"))}</span><a href="../../">${escapeHtml(t("portal.footer.portalHome"))}</a></footer>
  </body>
</html>\n`;
}
