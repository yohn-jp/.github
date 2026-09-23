#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import yaml from "js-yaml";

const sourcePath = ".github/sync-groups.yml";
const outputPath = ".github/sync.yml";

function mapping(entry) {
  if (typeof entry === "string") return { source: entry, dest: entry };
  if (
    entry &&
    typeof entry === "object" &&
    typeof entry.source === "string" &&
    typeof entry.dest === "string"
  ) {
    return { source: entry.source, dest: entry.dest };
  }
  throw new Error(`invalid sync mapping: ${JSON.stringify(entry)}`);
}

export function expandSyncConfig(config) {
  if (config?.version !== 1) throw new Error("sync config version must be 1");
  const fileGroups = config["file-groups"];
  const syncGroups = config["sync-groups"];
  if (!fileGroups || !syncGroups) {
    throw new Error("sync config requires file-groups and sync-groups");
  }

  const repositories = {};
  for (const [syncGroupName, syncGroup] of Object.entries(syncGroups)) {
    for (const repository of syncGroup.repositories ?? []) {
      if (repositories[repository]) {
        throw new Error(`${repository} appears in multiple sync groups`);
      }
      const mappings = [];
      const seen = new Set();
      for (const fileGroupName of syncGroup.include ?? []) {
        const entries = fileGroups[fileGroupName];
        if (!entries) {
          throw new Error(
            `sync group ${syncGroupName} references unknown file group ${fileGroupName}`
          );
        }
        for (const entry of entries) {
          const value = mapping(entry);
          const identity = `${value.source}\0${value.dest}`;
          if (seen.has(identity)) continue;
          seen.add(identity);
          mappings.push(value);
        }
      }
      repositories[repository] = mappings;
    }
  }
  return repositories;
}

export function renderSyncConfig(config) {
  return `# Generated from .github/sync-groups.yml; do not edit.\n${yaml.dump(
    expandSyncConfig(config),
    { lineWidth: -1, noRefs: true }
  )}`;
}

async function main() {
  const check = process.argv.includes("--check");
  const config = yaml.load(await readFile(sourcePath, "utf8"));
  const expected = renderSyncConfig(config);
  if (check) {
    const actual = await readFile(outputPath, "utf8");
    if (actual !== expected) {
      console.error(
        `${outputPath}: generated output drifts from ${sourcePath}; run node scripts/generate-sync-config.mjs`
      );
      process.exitCode = 1;
    }
    return;
  }
  await writeFile(outputPath, expected);
  console.log(`${outputPath}: generated from ${sourcePath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
