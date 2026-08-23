import { readFile } from "node:fs/promises";

export const PRODUCT_DETAILS_SCHEMA_VERSION = 1;

function requiredString(value, path) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value.trim();
}

function normalizeDetail(detail, index) {
  const path = `products[${index}]`;
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) {
    throw new Error(`${path} must be an object`);
  }
  const id = requiredString(detail.id, `${path}.id`);
  const why = requiredString(detail.why, `${path}.why`);
  const maturity = requiredString(detail.maturity, `${path}.maturity`);
  if (!Array.isArray(detail.core) || detail.core.length < 3) {
    throw new Error(`${path}.core must contain at least three sections`);
  }
  const titles = new Set();
  const core = detail.core.map((entry, coreIndex) => {
    const corePath = `${path}.core[${coreIndex}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`${corePath} must be an object`);
    }
    const title = requiredString(entry.title, `${corePath}.title`);
    const body = requiredString(entry.body, `${corePath}.body`);
    if (titles.has(title)) throw new Error(`${path} contains duplicate core title: ${title}`);
    titles.add(title);
    return { title, body };
  });
  return { id, why, core, maturity };
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
    if (byId.has(detail.id)) throw new Error(`Duplicate product detail id: ${detail.id}`);
    if (!catalogIds.has(detail.id)) throw new Error(`Unknown product detail id: ${detail.id}`);
    byId.set(detail.id, detail);
  }
  for (const id of catalogIds) {
    if (!byId.has(id)) throw new Error(`Missing product detail for catalog product: ${id}`);
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
