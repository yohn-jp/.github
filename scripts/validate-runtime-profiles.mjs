#!/usr/bin/env node
// Structural + semantic validator for the machine-readable agent runtime
// profile source (.github/agents/runtime-profiles.json).
//
// The JSON Schema (.github/agents/runtime-profiles.schema.json) covers
// shape/type but cannot express two invariants that matter for distribution
// integrity (yohn-jp/.github#184):
//
//   1. Profile `id` values must be unique. The schema can only mark the
//      array `uniqueItems` on scalar lists (requiredPromptClauses,
//      prohibitions); it cannot deduplicate on one object field.
//   2. Every `authority.*` reference is a { canonical, projected } pair.
//      `canonical` must resolve to a real file in THIS (provider)
//      repository. `projected` must resolve to a real file after
//      .github/sync-agents.yml projection — but no consumer repository is
//      checked out here, so "resolves" is checked as: every sync-agents.yml
//      target maps the same canonical source to that exact projected dest.
//      A drifted or missing mapping means the projected path in the profile
//      document does not describe what sync-agents.yml will actually
//      produce, which is exactly the defect that let a projected path point
//      at a nonexistent consumer file.
//
// This intentionally duplicates a subset of the structural schema (rather
// than depending on a JSON Schema library not otherwise used in this
// repository) so it can also carry semantic checks in one pass, matching
// this repository's existing hand-rolled validator convention (see
// scripts/validate-issue-forms.mjs).

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const REPOSITORY_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PROFILES_PATH = join(
  REPOSITORY_ROOT,
  ".github/agents/runtime-profiles.json"
);
const SYNC_AGENTS_PATH = join(REPOSITORY_ROOT, ".github/sync-agents.yml");

const PROFILE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REQUIRED_PROFILE_KEYS = [
  "id",
  "runtime",
  "role",
  "implementationAuthority",
  "delegation",
  "parallelism",
  "topLevelSession",
  "contextStrategy",
  "requiredPromptClauses",
  "prohibitions"
];
const REQUIRED_STRING_KEYS = REQUIRED_PROFILE_KEYS.filter(
  (key) =>
    key !== "id" && key !== "requiredPromptClauses" && key !== "prohibitions"
);
const REQUIRED_ARRAY_KEYS = ["requiredPromptClauses", "prohibitions"];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateAuthorityReference(ref, label, errors) {
  if (!isRecord(ref)) {
    errors.push(
      `${label}: must be an object with "canonical" and "projected" string paths`
    );
    return;
  }
  for (const key of ["canonical", "projected"]) {
    if (typeof ref[key] !== "string" || ref[key].length === 0) {
      errors.push(`${label}.${key}: must be a non-empty string`);
    }
  }
}

function validateProfile(profile, index, errors, seenIds) {
  const label = `profiles[${index}]`;
  if (!isRecord(profile)) {
    errors.push(`${label}: must be an object`);
    return;
  }

  for (const key of REQUIRED_PROFILE_KEYS) {
    if (!(key in profile)) {
      errors.push(`${label}: missing required key "${key}"`);
    }
  }

  if (typeof profile.id === "string") {
    if (!PROFILE_ID_PATTERN.test(profile.id)) {
      errors.push(
        `${label}.id: "${profile.id}" does not match ${PROFILE_ID_PATTERN}`
      );
    }
    if (seenIds.has(profile.id)) {
      errors.push(`${label}.id: duplicate profile id "${profile.id}"`);
    }
    seenIds.add(profile.id);
  } else if ("id" in profile) {
    errors.push(`${label}.id: must be a string`);
  }

  for (const key of REQUIRED_STRING_KEYS) {
    if (
      key in profile &&
      (typeof profile[key] !== "string" || profile[key].length === 0)
    ) {
      errors.push(`${label}.${key}: must be a non-empty string`);
    }
  }

  for (const key of REQUIRED_ARRAY_KEYS) {
    if (!(key in profile)) continue;
    const value = profile[key];
    if (!Array.isArray(value) || value.length === 0) {
      errors.push(`${label}.${key}: must be a non-empty array`);
      continue;
    }
    if (!value.every((item) => typeof item === "string" && item.length > 0)) {
      errors.push(`${label}.${key}: every item must be a non-empty string`);
    }
    if (new Set(value).size !== value.length) {
      errors.push(`${label}.${key}: items must be unique`);
    }
  }
}

/**
 * @param {unknown} doc parsed runtime-profiles.json
 * @returns {string[]} structural errors
 */
export function validateRuntimeProfilesStructure(doc) {
  const errors = [];
  if (!isRecord(doc)) {
    return ["document root must be an object"];
  }

  if (doc.version !== 1) {
    errors.push(`version: expected 1, got ${JSON.stringify(doc.version)}`);
  }
  if (doc.kind !== "yohn-agent-runtime-profiles") {
    errors.push(
      `kind: expected "yohn-agent-runtime-profiles", got ${JSON.stringify(doc.kind)}`
    );
  }

  if (!isRecord(doc.authority)) {
    errors.push(
      'authority: must be an object with "workflow" and "promptGuide"'
    );
  } else {
    validateAuthorityReference(
      doc.authority.workflow,
      "authority.workflow",
      errors
    );
    validateAuthorityReference(
      doc.authority.promptGuide,
      "authority.promptGuide",
      errors
    );
  }

  if (!Array.isArray(doc.profiles) || doc.profiles.length === 0) {
    errors.push("profiles: must be a non-empty array");
  } else {
    const seenIds = new Set();
    doc.profiles.forEach((profile, index) =>
      validateProfile(profile, index, errors, seenIds)
    );
  }

  return errors;
}

/**
 * Confirm every authority reference actually resolves in the context it
 * claims to describe: `canonical` against this provider repository's
 * working tree, `projected` against what .github/sync-agents.yml declares
 * it will produce in every consumer repository that receives the
 * corresponding canonical source file.
 *
 * @param {unknown} doc parsed runtime-profiles.json
 * @param {string} repoRoot provider repository root, for resolving `canonical`
 * @param {unknown} syncAgentsDoc parsed .github/sync-agents.yml
 * @returns {string[]} semantic errors
 */
export function validateRuntimeProfilesAuthorityIntegrity(
  doc,
  repoRoot,
  syncAgentsDoc
) {
  const errors = [];
  const authority = isRecord(doc) ? doc.authority : undefined;
  if (!isRecord(authority)) return errors;

  if (!isRecord(syncAgentsDoc)) {
    errors.push(
      ".github/sync-agents.yml: must parse to an object to check authority projection"
    );
    return errors;
  }

  for (const [authorityKey, ref] of Object.entries(authority)) {
    if (!isRecord(ref)) continue;
    const { canonical, projected } = ref;

    if (
      typeof canonical === "string" &&
      !existsSync(join(repoRoot, canonical))
    ) {
      errors.push(
        `authority.${authorityKey}.canonical: "${canonical}" does not exist in this repository`
      );
    }
    if (typeof canonical !== "string" || typeof projected !== "string")
      continue;

    const targets = Object.entries(syncAgentsDoc).filter(([, entries]) =>
      Array.isArray(entries)
    );
    if (targets.length === 0) {
      errors.push(
        ".github/sync-agents.yml: no sync targets defined; cannot confirm projected authority paths"
      );
      continue;
    }

    for (const [target, entries] of targets) {
      const mapping = entries.find(
        (entry) => isRecord(entry) && entry.source === canonical
      );
      if (!mapping) {
        errors.push(
          `authority.${authorityKey}: canonical source "${canonical}" is not synced to ${target} by .github/sync-agents.yml`
        );
        continue;
      }
      if (mapping.dest !== projected) {
        errors.push(
          `authority.${authorityKey}.projected: "${projected}" does not match .github/sync-agents.yml dest ` +
            `"${mapping.dest}" for ${target} (source "${canonical}")`
        );
      }
    }
  }

  return errors;
}

export function validateRuntimeProfilesFile(
  profilesPath = PROFILES_PATH,
  syncAgentsPath = SYNC_AGENTS_PATH
) {
  const raw = readFileSync(profilesPath, "utf8");
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (cause) {
    return [`${profilesPath}: invalid JSON: ${cause.message}`];
  }

  const structuralErrors = validateRuntimeProfilesStructure(doc).map(
    (e) => `${profilesPath}: ${e}`
  );
  if (structuralErrors.length > 0) {
    // Authority/projection checks assume a structurally valid document;
    // skip them so one root cause is reported instead of cascading noise.
    return structuralErrors;
  }

  let syncAgentsDoc;
  try {
    syncAgentsDoc = yaml.load(readFileSync(syncAgentsPath, "utf8"));
  } catch (cause) {
    return [`${syncAgentsPath}: invalid YAML: ${cause.message}`];
  }

  const repoRoot = dirname(dirname(dirname(profilesPath)));
  return validateRuntimeProfilesAuthorityIntegrity(
    doc,
    repoRoot,
    syncAgentsDoc
  ).map((e) => `${profilesPath}: ${e}`);
}

function isMain() {
  return process.argv[1] === fileURLToPath(import.meta.url);
}

function main() {
  const errors = validateRuntimeProfilesFile();
  if (errors.length === 0) {
    console.log(`OK   ${PROFILES_PATH}`);
    return;
  }
  console.log(`FAIL ${PROFILES_PATH}`);
  for (const e of errors) {
    console.log(`     ${e}`);
  }
  process.exitCode = 1;
}

if (isMain()) {
  main();
}
