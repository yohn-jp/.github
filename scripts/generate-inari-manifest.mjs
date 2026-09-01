#!/usr/bin/env node

import { createHash } from "node:crypto";
import { access, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const INARI_DIRECTORY = ".github/inari";
const MANIFEST_PATH = path.join(INARI_DIRECTORY, "manifest.json");
const SOURCE_REPOSITORY = "yohn-jp/.github";

/**
 * Return the machine-readable governance files that make up the snapshot.
 * The manifest is deliberately excluded from its own digest.
 */
export async function listInariContractFiles(root = REPOSITORY_ROOT) {
  const files = [];
  for (const domain of ["issues", "pull-requests"]) {
    const directory = path.join(root, INARI_DIRECTORY, domain);
    for (const name of (await readdir(directory))
      .filter((entry) => entry.endsWith(".json"))
      .sort()) {
      files.push(
        path.join(INARI_DIRECTORY, domain, name).replaceAll(path.sep, "/")
      );
    }
  }
  const policy = path.join(root, INARI_DIRECTORY, "pr-policy.yml");
  try {
    await access(policy);
    files.push(path.join(INARI_DIRECTORY, "pr-policy.yml"));
  } catch {
    // Older snapshots may not carry the optional PR policy overlay.
  }
  return files;
}

/**
 * Build a deterministic identity for the exact Inari contract files.
 * `revision` changes whenever a file's path or bytes change, without relying
 * on a mutable branch name or a timestamp.
 */
export async function buildInariManifest(root = REPOSITORY_ROOT) {
  const files = await Promise.all(
    (await listInariContractFiles(root)).map(async (relativePath) => {
      const bytes = await readFile(path.join(root, relativePath));
      return {
        path: relativePath,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.byteLength
      };
    })
  );
  const revision = createHash("sha256")
    .update(
      files
        .map(({ path: filePath, sha256 }) => `${filePath}\0${sha256}\n`)
        .join("")
    )
    .digest("hex");

  return {
    version: 1,
    kind: "inari-governance-manifest",
    source: {
      repository: SOURCE_REPOSITORY,
      directory: INARI_DIRECTORY
    },
    revision: `sha256:${revision}`,
    files
  };
}

export async function validateInariManifest(root = REPOSITORY_ROOT) {
  const manifestPath = path.join(root, MANIFEST_PATH);
  let actual;
  try {
    actual = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    return [
      `${MANIFEST_PATH}: cannot read a valid manifest (${error.message})`
    ];
  }

  const expected = await buildInariManifest(root);
  return JSON.stringify(actual) === JSON.stringify(expected)
    ? []
    : [
        `${MANIFEST_PATH}: provenance/revision does not match the synchronized Inari files`
      ];
}

async function main() {
  const check = process.argv.includes("--check");
  const manifestPath = path.join(REPOSITORY_ROOT, MANIFEST_PATH);
  if (check) {
    const errors = await validateInariManifest(process.cwd());
    for (const error of errors) console.error(error);
    if (errors.length > 0) process.exitCode = 1;
    return;
  }

  const manifest = await buildInariManifest(process.cwd());
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`${MANIFEST_PATH}: ${manifest.revision}`);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
