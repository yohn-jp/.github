import { readFile } from "node:fs/promises";
import { SUPPORTED_LOCALES } from "../messages.js";

export const PRODUCT_CATALOG_SCHEMA_VERSION = 1;
export const PRODUCT_CONTENT_LOCALES = SUPPORTED_LOCALES;
export const PRODUCT_STATUS_TONES = Object.freeze([
  "positive",
  "caution",
  "negative",
  "neutral"
]);

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RELATION_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function requiredString(value, path) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value.trim();
}

function statusTone(value, path) {
  const normalized = requiredString(value, path);
  if (!PRODUCT_STATUS_TONES.includes(normalized)) {
    throw new Error(
      `${path} must be one of ${PRODUCT_STATUS_TONES.join(", ")}`
    );
  }
  return normalized;
}

function stringList(value, path) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${path} must be a non-empty array`);
  }
  return value.map((entry, index) =>
    requiredString(entry, `${path}[${index}]`)
  );
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

function localizedStringList(value, path) {
  const source = record(value, path);
  return Object.fromEntries(
    PRODUCT_CONTENT_LOCALES.map((locale) => [
      locale,
      stringList(source[locale], `${path}.${locale}`)
    ])
  );
}

function localizedProductContent(product, path) {
  if (product.locales !== undefined) {
    const source = record(product.locales, `${path}.locales`);
    return Object.fromEntries(
      PRODUCT_CONTENT_LOCALES.map((locale) => {
        const entry = record(source[locale], `${path}.locales.${locale}`);
        return [
          locale,
          {
            role: requiredString(entry.role, `${path}.locales.${locale}.role`),
            summary: requiredString(
              entry.summary,
              `${path}.locales.${locale}.summary`
            ),
            owns: stringList(entry.owns, `${path}.locales.${locale}.owns`),
            doesNotOwn: stringList(
              entry.doesNotOwn,
              `${path}.locales.${locale}.doesNotOwn`
            )
          }
        ];
      })
    );
  }

  return Object.fromEntries(
    PRODUCT_CONTENT_LOCALES.map((locale) => [
      locale,
      {
        role: localizedString(product.role, `${path}.role`)[locale],
        summary: localizedString(product.summary, `${path}.summary`)[locale],
        owns: localizedStringList(product.owns, `${path}.owns`)[locale],
        doesNotOwn: localizedStringList(
          product.doesNotOwn,
          `${path}.doesNotOwn`
        )[locale]
      }
    ])
  );
}

function repositoryUrl(value, path) {
  const text = requiredString(value, path);
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`${path} must be a valid URL`);
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.search ||
    url.hash ||
    url.pathname.split("/").filter(Boolean).length !== 2
  ) {
    throw new Error(`${path} must be a canonical GitHub repository URL`);
  }
  return url.href.replace(/\/$/, "");
}

function normalizeRelationship(relation, productId, index) {
  const path = `products[${productId}].relationships[${index}]`;
  if (!relation || typeof relation !== "object" || Array.isArray(relation)) {
    throw new Error(`${path} must be an object`);
  }
  const product = requiredString(relation.product, `${path}.product`);
  const type = requiredString(relation.type, `${path}.type`);
  const labels = relation.localizedLabel
    ? localizedString(relation.localizedLabel, `${path}.localizedLabel`)
    : localizedString(relation.label, `${path}.label`);
  if (!ID_PATTERN.test(product)) {
    throw new Error(`${path}.product must be a stable product id`);
  }
  if (!RELATION_PATTERN.test(type)) {
    throw new Error(`${path}.type must be a stable relation id`);
  }
  if (product === productId) {
    throw new Error(`${path} cannot reference its own product`);
  }
  return { product, type, label: labels.en, localizedLabel: labels };
}

function normalizeProduct(product, index) {
  const path = `products[${index}]`;
  if (!product || typeof product !== "object" || Array.isArray(product)) {
    throw new Error(`${path} must be an object`);
  }
  const id = requiredString(product.id, `${path}.id`);
  if (!ID_PATTERN.test(id))
    throw new Error(`${path}.id must be a stable product id`);
  if (!Number.isInteger(product.order) || product.order < 0) {
    throw new Error(`${path}.order must be a non-negative integer`);
  }
  if (!Array.isArray(product.relationships)) {
    throw new Error(`${path}.relationships must be an array`);
  }
  const locales = localizedProductContent(product, path);
  return {
    id,
    order: product.order,
    name: requiredString(product.name, `${path}.name`),
    role: locales.en.role,
    repository: repositoryUrl(product.repository, `${path}.repository`),
    documentation: requiredString(
      product.documentation,
      `${path}.documentation`
    ),
    summary: locales.en.summary,
    status: requiredString(product.status, `${path}.status`),
    statusTone: statusTone(product.statusTone, `${path}.statusTone`),
    owns: locales.en.owns,
    doesNotOwn: locales.en.doesNotOwn,
    locales,
    relationships: product.relationships.map((relation, relationIndex) =>
      normalizeRelationship(relation, id, relationIndex)
    )
  };
}

export function validateProductCatalog(catalog) {
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) {
    throw new Error("Product catalog must be an object");
  }
  if (catalog.schemaVersion !== PRODUCT_CATALOG_SCHEMA_VERSION) {
    throw new Error(
      `Product catalog schemaVersion must be ${PRODUCT_CATALOG_SCHEMA_VERSION}`
    );
  }
  if (!Array.isArray(catalog.products) || catalog.products.length === 0) {
    throw new Error("Product catalog requires at least one product");
  }

  const products = catalog.products.map(normalizeProduct);
  const ids = new Set();
  for (const product of products) {
    if (ids.has(product.id))
      throw new Error(`Duplicate product id: ${product.id}`);
    ids.add(product.id);
  }
  for (const product of products) {
    for (const relation of product.relationships) {
      if (!ids.has(relation.product)) {
        throw new Error(
          `Unknown related product ${relation.product} referenced by ${product.id}`
        );
      }
    }
  }

  products.sort(
    (left, right) => left.order - right.order || left.id.localeCompare(right.id)
  );
  return {
    schemaVersion: PRODUCT_CATALOG_SCHEMA_VERSION,
    products
  };
}

export async function loadProductCatalog(path) {
  const source = JSON.parse(await readFile(path, "utf8"));
  if (
    !Object.hasOwn(source, "organization") ||
    !Object.hasOwn(source, "collectionRepositories")
  ) {
    throw new Error("Product catalog source must be a portal registry");
  }
  const { productCatalogFromRegistry } = await import("./portal-registry.mjs");
  return productCatalogFromRegistry(source);
}
