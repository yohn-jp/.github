#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import prettier from "prettier";

const REPOSITORY_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SYNC_FORMAT_CONFIG_RELATIVE_PATH = ".github/sync-script-format.json";
const SYNC_MAPPING_CONFIG_RELATIVE_PATH = ".github/sync.yml";

export const SYNCED_SCRIPT_PATHS = Object.freeze([
  "scripts/pr-contract-routing.mjs",
  "scripts/release-branch.mjs",
  "scripts/validate-issue.mjs",
  "scripts/validate-pr.mjs"
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sortedSetDifference(left, right) {
  const rightSet = new Set(right);
  return [...new Set(left)].filter((value) => !rightSet.has(value)).sort();
}

export function loadSyncedScriptFormatConfig(root = REPOSITORY_ROOT) {
  const configPath = join(root, SYNC_FORMAT_CONFIG_RELATIVE_PATH);
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  if (
    config.version !== 1 ||
    config.prettier === undefined ||
    JSON.stringify(config.files) !== JSON.stringify(SYNCED_SCRIPT_PATHS)
  ) {
    throw new Error(
      `${configPath}: unsupported synchronized script format configuration`
    );
  }
  return config;
}

export function loadSyncMappings(root = REPOSITORY_ROOT) {
  const configPath = join(root, SYNC_MAPPING_CONFIG_RELATIVE_PATH);
  return yaml.load(readFileSync(configPath, "utf8"));
}

function managedMappings(sync, repository) {
  const entries =
    isRecord(sync) && Array.isArray(sync[repository]) ? sync[repository] : [];
  return entries
    .filter((entry) => isRecord(entry))
    .filter(
      ({ source, dest }) =>
        SYNCED_SCRIPT_PATHS.includes(source) ||
        SYNCED_SCRIPT_PATHS.includes(dest)
    );
}

/**
 * Validate the byte-copy contract declared by sync-script-format.json against
 * sync.yml. A consumer is valid only when it is explicitly profiled and owns
 * exactly the four source=destination mappings; any profile or mapping drift
 * is rejected before a direct sync can distribute an ambiguous artifact.
 */
export function validateSyncedScriptMappings({ sync, config }) {
  if (!isRecord(config)) {
    return [
      "[SYNC_FORMAT_CONFIG_INVALID] sync-script-format.json must be a mapping"
    ];
  }

  const errors = [];
  const expectedPaths = new Set(SYNCED_SCRIPT_PATHS);

  if (!isRecord(sync)) {
    return [
      "[SYNC_FORMAT_SYNC_CONFIG_INVALID] .github/sync.yml must be a mapping"
    ];
  }
  if (!isRecord(config.profiles)) {
    errors.push(
      "[SYNC_FORMAT_PROFILES_INVALID] sync-script-format.json profiles must be a mapping"
    );
  }
  if (!isRecord(config.consumers)) {
    errors.push(
      "[SYNC_FORMAT_CONSUMERS_INVALID] sync-script-format.json consumers must be a mapping"
    );
  }

  const profiles = isRecord(config.profiles) ? config.profiles : {};
  const consumers = isRecord(config.consumers) ? config.consumers : {};
  const declaredConsumers = Object.keys(consumers).sort();
  const mappedConsumers = Object.keys(sync)
    .filter((repository) => managedMappings(sync, repository).length > 0)
    .sort();

  for (const repository of sortedSetDifference(
    declaredConsumers,
    mappedConsumers
  )) {
    errors.push(
      `[SYNC_FORMAT_CONSUMER_MISSING] ${repository}: declared consumer has no synchronized-script mapping`
    );
  }
  for (const repository of sortedSetDifference(
    mappedConsumers,
    declaredConsumers
  )) {
    errors.push(
      `[SYNC_FORMAT_CONSUMER_UNDECLARED] ${repository}: synchronized-script mapping is not declared in sync-script-format.json`
    );
  }

  for (const repository of declaredConsumers) {
    const profileName = consumers[repository];
    const profile = profiles[profileName];
    if (!isRecord(profile) || !isRecord(profile.prettier)) {
      errors.push(
        `[SYNC_FORMAT_PROFILE_MISSING] ${repository}: declared formatter profile ${String(profileName)} is missing`
      );
    } else if (
      JSON.stringify(profile.prettier) !== JSON.stringify(config.prettier)
    ) {
      errors.push(
        `[SYNC_FORMAT_PROFILE_MISMATCH] ${repository}: profile ${String(profileName)} differs from the canonical formatter profile`
      );
    }

    const actualMappings = managedMappings(sync, repository);
    const expectedKeys = new Set(
      SYNCED_SCRIPT_PATHS.map(
        (relativePath) => `${relativePath}\0${relativePath}`
      )
    );
    const actualKeys = actualMappings.map(
      ({ source, dest }) => `${String(source)}\0${String(dest)}`
    );
    const actualCounts = new Map();
    for (const key of actualKeys) {
      actualCounts.set(key, (actualCounts.get(key) ?? 0) + 1);
    }

    for (const relativePath of SYNCED_SCRIPT_PATHS) {
      const key = `${relativePath}\0${relativePath}`;
      if (!actualCounts.has(key)) {
        errors.push(
          `[SYNC_FORMAT_MAPPING_MISSING] ${repository}: expected ${relativePath} -> ${relativePath}`
        );
      }
    }
    for (const entry of actualMappings) {
      const source = String(entry.source);
      const dest = String(entry.dest);
      const key = `${source}\0${dest}`;
      if (expectedKeys.has(key)) {
        if ((actualCounts.get(key) ?? 0) > 1) {
          errors.push(
            `[SYNC_FORMAT_MAPPING_EXTRA] ${repository}: duplicate ${source} -> ${dest}`
          );
        }
        continue;
      }
      if (expectedPaths.has(entry.source) || expectedPaths.has(entry.dest)) {
        errors.push(
          `[SYNC_FORMAT_MAPPING_MISMATCH] ${repository}: ${source} -> ${dest}; synchronized scripts require source=dest`
        );
      } else {
        errors.push(
          `[SYNC_FORMAT_MAPPING_EXTRA] ${repository}: unexpected synchronized-script mapping ${source} -> ${dest}`
        );
      }
    }
  }

  return errors;
}

/**
 * Validate one synchronized script against the authority-owned formatter
 * profile. The explicit options prevent a consumer's own Prettier config from
 * changing the bytes that the authority distributes.
 */
export async function validateSyncedScriptFormatFile(filePath, config) {
  const raw = readFileSync(filePath, "utf8");
  const formatted = await prettier.format(raw, {
    ...config.prettier,
    filepath: filePath
  });
  if (formatted !== raw) {
    return `${filePath}: not formatted with the canonical synchronized-script Prettier profile`;
  }
  return undefined;
}

export async function validateSyncedScriptFormats(root = REPOSITORY_ROOT) {
  const config = loadSyncedScriptFormatConfig(root);
  const errors = validateSyncedScriptMappings({
    sync: loadSyncMappings(root),
    config
  });
  for (const relativePath of SYNCED_SCRIPT_PATHS) {
    const filePath = join(root, relativePath);
    if (!existsSync(filePath)) {
      errors.push(`${filePath}: canonical synchronized script is missing`);
      continue;
    }
    const error = await validateSyncedScriptFormatFile(filePath, config);
    if (error !== undefined) errors.push(error);
  }
  return errors;
}

function rootArgument() {
  const index = process.argv.indexOf("--root");
  if (index === -1) return REPOSITORY_ROOT;
  const root = process.argv[index + 1];
  if (root === undefined || root.startsWith("--")) {
    throw new Error("--root requires a repository path");
  }
  return root;
}

async function main() {
  const root = rootArgument();
  const errors = await validateSyncedScriptFormats(root);
  for (const relativePath of SYNCED_SCRIPT_PATHS) {
    const label = relative(root, join(root, relativePath));
    if (errors.some((error) => error.startsWith(join(root, relativePath)))) {
      console.log(`FAIL ${label}`);
    } else {
      console.log(`OK   ${label}`);
    }
  }
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
