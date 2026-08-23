#!/usr/bin/env node

import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectDashboardData } from "./dashboard-data.mjs";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "..");
const DASHBOARD_DIRECTORY = join(REPOSITORY_ROOT, "dashboard");

export async function buildDashboard({
  outputDirectory = process.env.DASHBOARD_OUTPUT ??
    join(REPOSITORY_ROOT, "site"),
  configPath = join(DASHBOARD_DIRECTORY, "repositories.json"),
  fetchImpl = globalThis.fetch,
  token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? "",
  now
} = {}) {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const data = await collectDashboardData({ config, fetchImpl, token, now });
  const dataDirectory = join(outputDirectory, "data");
  await mkdir(dataDirectory, { recursive: true });

  for (const file of ["index.html", "styles.css", "app.js"]) {
    await copyFile(
      join(DASHBOARD_DIRECTORY, file),
      join(outputDirectory, file)
    );
  }
  await writeFile(
    join(dataDirectory, "dashboard.json"),
    `${JSON.stringify(data, null, 2)}\n`
  );
  return data;
}

function isMain() {
  return process.argv[1] === fileURLToPath(import.meta.url);
}

if (isMain()) {
  const data = await buildDashboard();
  console.log(
    `Dashboard generated: ${data.status} (${data.metrics.issueCount} issues, ${data.metrics.failedRepositories} repository failures)`
  );
}
