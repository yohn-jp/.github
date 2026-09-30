#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { posix } from "node:path";
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
    return entry.deleteOrphaned === true
      ? { source: entry.source, dest: entry.dest, deleteOrphaned: true }
      : { source: entry.source, dest: entry.dest };
  }
  throw new Error(`invalid sync mapping: ${JSON.stringify(entry)}`);
}

export function expandSyncConfig(config) {
  if (config?.version !== 1) throw new Error("sync config version must be 1");
  const fileGroups = config["file-groups"];
  const bundles = config.bundles ?? {};
  const syncGroups = config["sync-groups"];
  if (!fileGroups || !syncGroups) {
    throw new Error("sync config requires file-groups and sync-groups");
  }

  for (const name of Object.keys(bundles)) {
    if (name in fileGroups) {
      throw new Error(`${name} is defined as both a file group and a bundle`);
    }
  }

  const repositories = {};
  for (const [syncGroupName, syncGroup] of Object.entries(syncGroups)) {
    for (const repository of syncGroup.repositories ?? []) {
      if (repositories[repository]) {
        throw new Error(`${repository} appears in multiple sync groups`);
      }
      const mappings = [];
      const seen = new Set();
      const included = [
        ...(config["default-include"] ?? []),
        ...(syncGroup.include ?? [])
      ];
      const destinations = new Map();
      for (const fileGroupName of included) {
        const entries = fileGroups[fileGroupName] ?? bundles[fileGroupName];
        if (!entries) {
          throw new Error(
            `sync group ${syncGroupName} references unknown file group or bundle ${fileGroupName}`
          );
        }
        for (const entry of entries) {
          const value = mapping(entry);
          const identity = `${value.source}\0${value.dest}`;
          if (seen.has(identity)) continue;
          seen.add(identity);
          if (destinations.has(value.dest)) {
            throw new Error(
              `${repository}: ${value.dest} is mapped from both ${destinations.get(value.dest)} and ${value.source}`
            );
          }
          destinations.set(value.dest, value.source);
          mappings.push(value);
        }
      }
      repositories[repository] = mappings;
    }
  }
  return repositories;
}

function workflowReferences(workflow) {
  const references = new Set();
  const visit = (value, key) => {
    if (typeof value === "string") {
      for (const match of value.matchAll(
        /(?<![\w/.-])\.\/((?:\.github|scripts)\/[\w./-]+)/g
      )) {
        references.add(match[1]);
      }
      if (key === "config-file") references.add(posix.normalize(value));
    } else if (Array.isArray(value)) {
      for (const item of value) visit(item, key);
    } else if (value && typeof value === "object") {
      for (const [childKey, child] of Object.entries(value)) {
        visit(child, childKey);
      }
    }
  };
  visit(workflow);
  return references;
}

function isDistributed(reference, mappings) {
  return mappings.some(({ dest }) =>
    dest.endsWith("/")
      ? reference.startsWith(dest)
      : dest === reference || dest.startsWith(`${reference}/`)
  );
}

// Every local path a distributed workflow references must be distributed to
// the same repository, otherwise the workflow fails there (e.g. CodeQL init
// without its config file).
export function findMissingWorkflowDependencies(repositories, readSource) {
  const problems = [];
  for (const [repository, mappings] of Object.entries(repositories)) {
    for (const { source, dest } of mappings) {
      if (!/^\.github\/workflows\/[^/]+\.ya?ml$/.test(dest)) continue;
      const workflow = yaml.load(readSource(source));
      for (const reference of workflowReferences(workflow)) {
        if (!isDistributed(reference, mappings)) {
          problems.push(
            `${repository}: ${dest} (from ${source}) references ${reference} which is not distributed to the repository`
          );
        }
      }
    }
  }
  return problems;
}

export function renderSyncConfig(config) {
  const repositories = expandSyncConfig(config);
  const lines = ["# Generated from .github/sync-groups.yml; do not edit."];
  for (const [repository, mappings] of Object.entries(repositories)) {
    lines.push(`${repository}:`);
    for (const { source, dest, deleteOrphaned } of mappings) {
      lines.push(`  - source: ${source}`);
      lines.push(`    dest: ${dest}`);
      if (deleteOrphaned) lines.push("    deleteOrphaned: true");
    }
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const check = process.argv.includes("--check");
  const config = yaml.load(await readFile(sourcePath, "utf8"));
  const expected = renderSyncConfig(config);
  if (check) {
    const problems = findMissingWorkflowDependencies(
      expandSyncConfig(config),
      (source) => readFileSync(source, "utf8")
    );
    for (const problem of problems) console.error(problem);
    if (problems.length > 0) process.exitCode = 1;
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
