import { readFile } from "node:fs/promises";
import { PRODUCT_CONTENT_LOCALES } from "./product-catalog.mjs";

export const PRODUCT_DETAILS_SCHEMA_VERSION = 1;
const PRODUCT_IDENTITY_TONES = new Set([
  "moss",
  "blue",
  "ember",
  "lime",
  "violet",
  "ochre",
  "stone",
  "teal"
]);

function requiredString(value, path) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value.trim();
}

function record(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value;
}

function localizedString(value, path) {
  const source = record(value, path);
  return Object.fromEntries(
    PRODUCT_CONTENT_LOCALES.map((locale) => [
      locale,
      requiredString(source[locale], `${path}.${locale}`)
    ])
  );
}

function normalizeCore(value, path) {
  if (!Array.isArray(value) || value.length < 3) {
    throw new Error(`${path} must contain at least three sections`);
  }
  const titles = new Set();
  return value.map((entry, coreIndex) => {
    const corePath = `${path}[${coreIndex}]`;
    const source = record(entry, corePath);
    const title = requiredString(source.title, `${corePath}.title`);
    const body = requiredString(source.body, `${corePath}.body`);
    if (titles.has(title)) {
      throw new Error(`${path} contains duplicate core title: ${title}`);
    }
    titles.add(title);
    return { title, body };
  });
}

function localizedDetailContent(detail, path) {
  if (detail.locales !== undefined) {
    const source = record(detail.locales, `${path}.locales`);
    return Object.fromEntries(
      PRODUCT_CONTENT_LOCALES.map((locale) => {
        const entry = record(source[locale], `${path}.locales.${locale}`);
        return [
          locale,
          {
            why: requiredString(entry.why, `${path}.locales.${locale}.why`),
            core: normalizeCore(entry.core, `${path}.locales.${locale}.core`),
            maturity: requiredString(
              entry.maturity,
              `${path}.locales.${locale}.maturity`
            )
          }
        ];
      })
    );
  }

  const why = localizedString(detail.why, `${path}.why`);
  const maturity = localizedString(detail.maturity, `${path}.maturity`);
  if (!Array.isArray(detail.core)) {
    throw new Error(`${path}.core must contain at least three sections`);
  }
  const coreByLocale = Object.fromEntries(
    PRODUCT_CONTENT_LOCALES.map((locale) => [
      locale,
      normalizeCore(
        detail.core.map((entry, index) => {
          const entryPath = `${path}.core[${index}]`;
          const source = record(entry, entryPath);
          return {
            title: localizedString(source.title, `${entryPath}.title`)[locale],
            body: localizedString(source.body, `${entryPath}.body`)[locale]
          };
        }),
        `${path}.core.${locale}`
      )
    ])
  );
  return Object.fromEntries(
    PRODUCT_CONTENT_LOCALES.map((locale) => [
      locale,
      {
        why: why[locale],
        core: coreByLocale[locale],
        maturity: maturity[locale]
      }
    ])
  );
}

function productIdentity(value, path) {
  const source = record(value, path);
  const asset = source.asset;
  if (asset !== null && typeof asset !== "string") {
    throw new Error(`${path}.asset must be a string or null`);
  }
  if (typeof asset === "string") {
    requiredString(asset, `${path}.asset`);
    if (!/^[a-z0-9][a-z0-9.-]*\.webp$/.test(asset)) {
      throw new Error(`${path}.asset must be a product WebP filename`);
    }
  }
  const fallback = requiredString(source.fallback, `${path}.fallback`);
  if (!/^[A-Z]{2,4}$/.test(fallback)) {
    throw new Error(`${path}.fallback must be an uppercase monogram`);
  }
  const tone = requiredString(source.tone, `${path}.tone`);
  if (!PRODUCT_IDENTITY_TONES.has(tone)) {
    throw new Error(`${path}.tone is not a supported identity tone: ${tone}`);
  }
  if (source.source !== null && source.source !== undefined) {
    const provenance = record(source.source, `${path}.source`);
    const repository = requiredString(
      provenance.repository,
      `${path}.source.repository`
    );
    if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(repository)) {
      throw new Error(`${path}.source.repository must be owner/name`);
    }
    const sourcePath = requiredString(provenance.path, `${path}.source.path`);
    if (sourcePath.includes("..") || sourcePath.startsWith("/")) {
      throw new Error(`${path}.source.path must be a repository-relative path`);
    }
    const revision = requiredString(
      provenance.revision,
      `${path}.source.revision`
    );
    const sha256 = requiredString(provenance.sha256, `${path}.source.sha256`);
    if (!/^[a-f0-9]{64}$/i.test(sha256)) {
      throw new Error(`${path}.source.sha256 must be a SHA-256 digest`);
    }
    return {
      asset,
      fallback,
      tone,
      source: { repository, path: sourcePath, revision, sha256 }
    };
  }
  if (asset !== null) {
    throw new Error(`${path}.source is required when an asset is present`);
  }
  return { asset, fallback, tone, source: null };
}

function normalizeDetail(detail, index) {
  const path = `products[${index}]`;
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) {
    throw new Error(`${path} must be an object`);
  }
  const id = requiredString(detail.id, `${path}.id`);
  const identity = productIdentity(detail.identity, `${path}.identity`);
  const locales = localizedDetailContent(detail, path);
  return {
    id,
    identity,
    why: locales.en.why,
    core: locales.en.core,
    maturity: locales.en.maturity,
    locales
  };
}

export function validateProductDetails(document, catalog) {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new Error("Product details must be an object");
  }
  if (document.schemaVersion !== PRODUCT_DETAILS_SCHEMA_VERSION) {
    throw new Error(
      `Product details schemaVersion must be ${PRODUCT_DETAILS_SCHEMA_VERSION}`
    );
  }
  if (!Array.isArray(document.products) || document.products.length === 0) {
    throw new Error("Product details require at least one product");
  }

  const catalogIds = new Set(catalog.products.map((product) => product.id));
  const details = document.products.map(normalizeDetail);
  const byId = new Map();
  for (const detail of details) {
    if (byId.has(detail.id))
      throw new Error(`Duplicate product detail id: ${detail.id}`);
    if (!catalogIds.has(detail.id))
      throw new Error(`Unknown product detail id: ${detail.id}`);
    byId.set(detail.id, detail);
  }
  for (const id of catalogIds) {
    if (!byId.has(id))
      throw new Error(`Missing product detail for catalog product: ${id}`);
  }

  return {
    schemaVersion: PRODUCT_DETAILS_SCHEMA_VERSION,
    products: catalog.products.map((product) => byId.get(product.id))
  };
}

export async function loadProductDetails(path, catalog) {
  const source = JSON.parse(await readFile(path, "utf8"));
  return validateProductDetails(source, catalog);
}
