import { readFile } from "node:fs/promises";
import {
  PRODUCT_CATALOG_SCHEMA_VERSION,
  validateProductCatalog
} from "./product-catalog.mjs";

export const PORTAL_REGISTRY_SCHEMA_VERSION = 1;

const ORGANIZATION_PATTERN = /^[A-Za-z0-9-]+$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9._-]+$/;

function repositoryKey(fullName) {
  return fullName.toLowerCase();
}

function requiredString(value, path) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value.trim();
}

function repositoryFromUrl(value, path) {
  const text = requiredString(value, path);
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`${path} must be a valid URL`);
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.search ||
    url.hash ||
    parts.length !== 2 ||
    !ORGANIZATION_PATTERN.test(parts[0]) ||
    !REPOSITORY_PATTERN.test(parts[1]) ||
    text.endsWith("/")
  ) {
    throw new Error(`${path} must be a canonical GitHub repository URL`);
  }
  return { owner: parts[0], name: parts[1], fullName: parts.join("/") };
}

function additionalRepository(value, index, organization) {
  const path = `collectionRepositories[${index}]`;
  const name = requiredString(value, path);
  if (!REPOSITORY_PATTERN.test(name)) {
    throw new Error(`${path} must be a valid repository name`);
  }
  return {
    owner: organization,
    name,
    fullName: `${organization}/${name}`
  };
}

function assertRegistryShape(registry) {
  if (!registry || typeof registry !== "object" || Array.isArray(registry)) {
    throw new Error("Portal registry must be an object");
  }
  if (registry.schemaVersion !== PORTAL_REGISTRY_SCHEMA_VERSION) {
    throw new Error(
      `Portal registry schemaVersion must be ${PORTAL_REGISTRY_SCHEMA_VERSION}`
    );
  }
  const organization = requiredString(registry.organization, "organization");
  if (!ORGANIZATION_PATTERN.test(organization)) {
    throw new Error("organization must be a valid GitHub organization");
  }
  if (!Array.isArray(registry.collectionRepositories)) {
    throw new Error("Portal registry requires collectionRepositories");
  }
  return organization;
}

export function validatePortalRegistry(registry) {
  const organization = assertRegistryShape(registry);
  const catalog = validateProductCatalog({
    schemaVersion: PRODUCT_CATALOG_SCHEMA_VERSION,
    products: registry.products
  });
  const repositories = new Map();

  for (const product of catalog.products) {
    const repository = repositoryFromUrl(
      product.repository,
      `products[${product.id}].repository`
    );
    if (repository.owner.toLowerCase() !== organization.toLowerCase()) {
      throw new Error(
        `Product ${product.id} repository must belong to ${organization}: ${repository.fullName}`
      );
    }
    if (repositories.has(repositoryKey(repository.fullName))) {
      throw new Error(`Duplicate repository mapping: ${repository.fullName}`);
    }
    repositories.set(repositoryKey(repository.fullName), product.id);
  }

  const collectionRepositories = registry.collectionRepositories.map(
    (entry, index) => additionalRepository(entry, index, organization)
  );
  for (const repository of collectionRepositories) {
    if (repositories.has(repositoryKey(repository.fullName))) {
      throw new Error(`Duplicate repository mapping: ${repository.fullName}`);
    }
    repositories.set(repositoryKey(repository.fullName), null);
  }

  return {
    schemaVersion: PORTAL_REGISTRY_SCHEMA_VERSION,
    organization,
    collectionRepositories: collectionRepositories.map(({ name }) => name),
    products: catalog.products
  };
}

export function productCatalogFromRegistry(registry) {
  const validated = validatePortalRegistry(registry);
  return {
    schemaVersion: PRODUCT_CATALOG_SCHEMA_VERSION,
    products: validated.products
  };
}

export function dashboardConfigFromRegistry(registry) {
  const validated = validatePortalRegistry(registry);
  const productRepositories = validated.products.map(
    (product) =>
      repositoryFromUrl(
        product.repository,
        `products[${product.id}].repository`
      ).name
  );
  return {
    organization: validated.organization,
    repositories: [...productRepositories, ...validated.collectionRepositories]
  };
}

export async function loadPortalRegistry(path) {
  const source = JSON.parse(await readFile(path, "utf8"));
  return validatePortalRegistry(source);
}
