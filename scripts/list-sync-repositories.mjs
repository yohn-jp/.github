#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import yaml from "js-yaml";

const sourcePath = ".github/sync-groups.yml";

export function listSyncRepositories(config) {
  if (config?.version !== 1) throw new Error("sync config version must be 1");
  const syncGroups = config["sync-groups"];
  if (!syncGroups) throw new Error("sync config requires sync-groups");

  const repositories = [];
  const seen = new Set();
  for (const syncGroup of Object.values(syncGroups)) {
    for (const repository of syncGroup.repositories ?? []) {
      if (seen.has(repository)) {
        throw new Error(`${repository} appears in multiple sync groups`);
      }
      seen.add(repository);
      repositories.push(repository);
    }
  }
  return repositories;
}

export function renderTokenRepositories(config) {
  return listSyncRepositories(config)
    .map((repository) => repository.replace(/^yohn-jp\//, ""))
    .join("\n");
}

async function main() {
  const config = yaml.load(await readFile(sourcePath, "utf8"));
  process.stdout.write(`${renderTokenRepositories(config)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
