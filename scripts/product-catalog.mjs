import { readFile } from "node:fs/promises";

export const PRODUCT_CATALOG_SCHEMA_VERSION = 1;

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RELATION_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function requiredString(value, path) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value.trim();
}

function stringList(value, path) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${path} must be a non-empty array`);
  }
  return value.map((entry, index) => requiredString(entry, `${path}[${index}]`));
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
  const label = requiredString(relation.label, `${path}.label`);
  if (!ID_PATTERN.test(product)) {
    throw new Error(`${path}.product must be a stable product id`);
  }
  if (!RELATION_PATTERN.test(type)) {
    throw new Error(`${path}.type must be a stable relation id`);
  }
  if (product === productId) {
    throw new Error(`${path} cannot reference its own product`);
  }
  return { product, type, label };
}

function normalizeProduct(product, index) {
  const path = `products[${index}]`;
  if (!product || typeof product !== "object" || Array.isArray(product)) {
    throw new Error(`${path} must be an object`);
  }
  const id = requiredString(product.id, `${path}.id`);
  if (!ID_PATTERN.test(id)) throw new Error(`${path}.id must be a stable product id`);
  if (!Number.isInteger(product.order) || product.order < 0) {
    throw new Error(`${path}.order must be a non-negative integer`);
  }
  if (!Array.isArray(product.relationships)) {
    throw new Error(`${path}.relationships must be an array`);
  }
  return {
    id,
    order: product.order,
    name: requiredString(product.name, `${path}.name`),
    role: requiredString(product.role, `${path}.role`),
    repository: repositoryUrl(product.repository, `${path}.repository`),
    documentation: requiredString(product.documentation, `${path}.documentation`),
    summary: requiredString(product.summary, `${path}.summary`),
    status: requiredString(product.status, `${path}.status`),
    owns: stringList(product.owns, `${path}.owns`),
    doesNotOwn: stringList(product.doesNotOwn, `${path}.doesNotOwn`),
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
    if (ids.has(product.id)) throw new Error(`Duplicate product id: ${product.id}`);
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
  return validateProductCatalog(source);
}
