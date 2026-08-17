#!/usr/bin/env node
// Prettier formatting gate for canonical Inari JSON templates
// (.github/inari/**/*.json).
//
// These files are distributed byte-for-byte to consumer repositories
// (see .github/sync.yml). A consumer's repository-wide `prettier --check`
// then re-formats them locally, which makes otherwise-unrelated consumer CI
// red and is not durable: the next sync overwrites the local fix. The
// canonical source must own formatting quality so synchronization stays a
// deterministic projection/copy, never a repair.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import prettier from "prettier";

const INARI_ROOT = join(process.cwd(), ".github", "inari");

// Always the config this repo ships next to this script, regardless of
// which repository's checkout the script runs against (this validator is
// also invoked by consumers through the shared metadata-validation reusable
// workflow). Resolving config by searching upward from the target file
// instead would let a consumer's own .prettierrc silently override the
// canonical formatting contract.
const CANONICAL_CONFIG_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", ".prettierrc.json");
const canonicalConfig = JSON.parse(readFileSync(CANONICAL_CONFIG_PATH, "utf8"));

/**
 * @param {string} dir directory to walk
 * @returns {string[]} absolute paths of every *.json file under dir
 */
function listJsonFilesRecursive(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...listJsonFilesRecursive(full));
    } else if (entry.endsWith(".json")) {
      files.push(full);
    }
  }
  return files;
}

/**
 * @param {string} filePath absolute or relative path to a JSON file
 * @returns {Promise<string[]>} errors, empty when the file is already
 *   canonically formatted
 */
export async function validateInariFormatFile(filePath) {
  const raw = readFileSync(filePath, "utf8");
  const formatted = await prettier.format(raw, { ...canonicalConfig, filepath: filePath });
  if (formatted !== raw) {
    return [`${filePath}: not formatted with the canonical Prettier configuration (run \`prettier --write\`)`];
  }
  return [];
}

function isMain() {
  return process.argv[1] === fileURLToPath(import.meta.url);
}

async function main() {
  const targets = listJsonFilesRecursive(INARI_ROOT);

  if (targets.length === 0) {
    console.log(`No JSON files found under ${INARI_ROOT}; nothing to validate.`);
    return;
  }

  let failed = false;
  for (const target of targets) {
    const errors = await validateInariFormatFile(target);
    const label = relative(process.cwd(), target);
    if (errors.length === 0) {
      console.log(`OK   ${label}`);
    } else {
      failed = true;
      console.log(`FAIL ${label}`);
      for (const e of errors) {
        console.log(`     ${e}`);
      }
    }
  }

  if (failed) {
    process.exitCode = 1;
  }
}

if (isMain()) {
  main();
}
