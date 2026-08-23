#!/usr/bin/env node

import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectDashboardData } from "./dashboard-data.mjs";
import { loadProductCatalog } from "./product-catalog.mjs";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "..");
const PORTAL_DIRECTORY = join(REPOSITORY_ROOT, "portal");
const DASHBOARD_DIRECTORY = join(REPOSITORY_ROOT, "dashboard");

const PORTAL_FILES = ["index.html", "styles.css", "CNAME"];
const DASHBOARD_FILES = ["index.html", "styles.css", "app.js"];

export async function buildDashboard({
  outputDirectory = process.env.DASHBOARD_OUTPUT ??
    join(REPOSITORY_ROOT, "site"),
  configPath = join(DASHBOARD_DIRECTORY, "repositories.json"),
  catalogPath = join(PORTAL_DIRECTORY, "products.json"),
  fetchImpl = globalThis.fetch,
  token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? "",
  now
} = {}) {
  const [config, productCatalog] = await Promise.all([
    readFile(configPath, "utf8").then(JSON.parse),
    loadProductCatalog(catalogPath)
  ]);
  const data = await collectDashboardData({ config, fetchImpl, token, now });
  const portalDataDirectory = join(outputDirectory, "data");
  const workDirectory = join(outputDirectory, "work");
  const workDataDirectory = join(workDirectory, "data");
  await Promise.all([
    mkdir(portalDataDirectory, { recursive: true }),
    mkdir(workDataDirectory, { recursive: true })
  ]);

  for (const file of PORTAL_FILES) {
    await copyFile(join(PORTAL_DIRECTORY, file), join(outputDirectory, file));
  }

  for (const file of DASHBOARD_FILES) {
    await copyFile(join(DASHBOARD_DIRECTORY, file), join(workDirectory, file));
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
  return data;
}

function isMain() {
  return process.argv[1] === fileURLToPath(import.meta.url);
}

if (isMain()) {
  const data = await buildDashboard();
  console.log(
    `Portal generated: ${data.status} (${data.metrics.issueCount} issues, ${data.metrics.failedRepositories} repository failures)`
  );
}
