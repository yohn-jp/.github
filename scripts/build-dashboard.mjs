#!/usr/bin/env node

import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectDashboardData } from "./dashboard-data.mjs";
import { hydrateDashboardPullRequests } from "./pull-request-links.mjs";
import { loadProductDetails } from "./product-details.mjs";
import {
  dashboardConfigFromRegistry,
  loadPortalRegistry,
  productCatalogFromRegistry
} from "./portal-registry.mjs";
import {
  normalizePortalLocale,
  renderPortalHome,
  renderProductOverviewPage,
  renderLocalizedHtml
} from "./render-portal.mjs";
import { SUPPORTED_LOCALES } from "../messages.js";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "..");
const PORTAL_DIRECTORY = join(REPOSITORY_ROOT, "portal");
const DASHBOARD_DIRECTORY = join(REPOSITORY_ROOT, "dashboard");
const GRAPH_DIRECTORY = join(DASHBOARD_DIRECTORY, "graph");
const GOVERNANCE_DIRECTORY = join(DASHBOARD_DIRECTORY, "governance");

const PORTAL_COPY_FILES = ["styles.css", "product.css"];
const ROOT_COPY_FILES = ["messages.js"];
const DASHBOARD_FILES = ["index.html", "work.css", "app.js", "work-model.js"];
const GRAPH_FILES = ["index.html", "graph.css", "graph.js", "graph-model.js"];
const GOVERNANCE_FILES = ["index.html", "governance.css", "governance.js"];

export function resolvePortalLocales({ locale, locales } = {}) {
  const requested = Array.isArray(locales) ? locales : SUPPORTED_LOCALES;
  const resolved = [
    ...new Set(requested.map((value) => normalizePortalLocale(value)))
  ];
  return resolved.length > 0 ? resolved : [...SUPPORTED_LOCALES];
}

export function resolvePortalCollectionToken(environment = process.env) {
  return typeof environment.PORTAL_GITHUB_TOKEN === "string"
    ? environment.PORTAL_GITHUB_TOKEN
    : "";
}

export async function buildDashboard({
  outputDirectory = process.env.DASHBOARD_OUTPUT ??
    join(REPOSITORY_ROOT, "site"),
  registryPath = join(PORTAL_DIRECTORY, "registry.json"),
  locale,
  locales,
  detailsPath = join(PORTAL_DIRECTORY, "product-details.json"),
  portalTemplatePath = join(PORTAL_DIRECTORY, "index.html"),
  fetchImpl = globalThis.fetch,
  token = resolvePortalCollectionToken(),
  now,
  governanceImpl
} = {}) {
  const [registry, portalTemplate] = await Promise.all([
    loadPortalRegistry(registryPath),
    readFile(portalTemplatePath, "utf8")
  ]);
  const config = dashboardConfigFromRegistry(registry);
  const productCatalog = productCatalogFromRegistry(registry);
  const [rawDashboard, productDetails] = await Promise.all([
    collectDashboardData({ config, fetchImpl, token, now, governanceImpl }),
    loadProductDetails(detailsPath, productCatalog)
  ]);
  const data = await hydrateDashboardPullRequests({
    dashboard: rawDashboard,
    fetchImpl,
    token
  });
  const detailsById = new Map(
    productDetails.products.map((detail) => [detail.id, detail])
  );
  const buildVariant = async ({
    variantDirectory,
    variantLocale,
    localized,
    copyCname
  }) => {
    const portalDataDirectory = join(variantDirectory, "data");
    const productDirectory = join(variantDirectory, "products");
    const workDirectory = join(variantDirectory, "work");
    const workDataDirectory = join(workDirectory, "data");
    const graphOutputDirectory = join(workDirectory, "graph");
    const governanceOutputDirectory = join(workDirectory, "governance");
    await Promise.all([
      mkdir(portalDataDirectory, { recursive: true }),
      mkdir(productDirectory, { recursive: true }),
      mkdir(workDataDirectory, { recursive: true }),
      mkdir(graphOutputDirectory, { recursive: true }),
      mkdir(governanceOutputDirectory, { recursive: true })
    ]);

    for (const file of PORTAL_COPY_FILES) {
      await copyFile(
        join(PORTAL_DIRECTORY, file),
        join(variantDirectory, file)
      );
    }
    if (copyCname) {
      await copyFile(
        join(PORTAL_DIRECTORY, "CNAME"),
        join(variantDirectory, "CNAME")
      );
    }
    for (const file of ROOT_COPY_FILES) {
      await copyFile(join(REPOSITORY_ROOT, file), join(variantDirectory, file));
    }
    await writeFile(
      join(variantDirectory, "index.html"),
      renderPortalHome(portalTemplate, productCatalog, variantLocale, {
        localized,
        path: ""
      })
    );

    for (const product of productCatalog.products) {
      const directory = join(productDirectory, product.id);
      await mkdir(directory, { recursive: true });
      await writeFile(
        join(directory, "index.html"),
        renderProductOverviewPage(
          product,
          productCatalog,
          detailsById.get(product.id),
          variantLocale,
          {
            localized,
            path: `products/${encodeURIComponent(product.id)}/`
          }
        )
      );
    }

    for (const file of DASHBOARD_FILES) {
      const source = join(DASHBOARD_DIRECTORY, file);
      const target = join(workDirectory, file);
      if (file.endsWith(".html")) {
        await writeFile(
          target,
          renderLocalizedHtml(await readFile(source, "utf8"), {
            locale: variantLocale,
            path: "work/",
            localized
          })
        );
      } else {
        await copyFile(source, target);
      }
    }
    for (const file of GRAPH_FILES) {
      const source = join(GRAPH_DIRECTORY, file);
      const target = join(graphOutputDirectory, file);
      if (file.endsWith(".html")) {
        await writeFile(
          target,
          renderLocalizedHtml(await readFile(source, "utf8"), {
            locale: variantLocale,
            path: "work/graph/",
            localized
          })
        );
      } else {
        await copyFile(source, target);
      }
    }
    for (const file of GOVERNANCE_FILES) {
      const source = join(GOVERNANCE_DIRECTORY, file);
      const target = join(governanceOutputDirectory, file);
      if (file.endsWith(".html")) {
        await writeFile(
          target,
          renderLocalizedHtml(await readFile(source, "utf8"), {
            locale: variantLocale,
            path: "work/governance/",
            localized
          })
        );
      } else {
        await copyFile(source, target);
      }
    }

    await Promise.all([
      writeFile(
        join(portalDataDirectory, "products.json"),
        `${JSON.stringify(productCatalog, null, 2)}\n`
      ),
      writeFile(
        join(workDataDirectory, "dashboard.json"),
        `${JSON.stringify(data, null, 2)}\n`
      )
    ]);
  };

  await buildVariant({
    variantDirectory: outputDirectory,
    variantLocale:
      locale === undefined || locale === null
        ? "en"
        : normalizePortalLocale(locale),
    localized: false,
    copyCname: true
  });
  await Promise.all(
    resolvePortalLocales({ locale, locales }).map((variantLocale) =>
      buildVariant({
        variantDirectory: join(outputDirectory, variantLocale),
        variantLocale,
        localized: true,
        copyCname: false
      })
    )
  );
  return data;
}

function isMain() {
  return process.argv[1] === fileURLToPath(import.meta.url);
}

if (isMain()) {
  const data = await buildDashboard();
  console.log(
    `Portal generated: ${data.status} (${data.metrics.issueCount} issues, ${data.metrics.failedRepositories} repository failures, ${data.metrics.dependencyEdges ?? 0} dependency edges, ${data.metrics.linkedPullRequests ?? 0} linked pull requests)`
  );
}
