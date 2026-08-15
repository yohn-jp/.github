#!/usr/bin/env node
// Validates that every `uses:` reference in GitHub Actions workflow/action
// YAML follows the organization reference policy:
//   - yohn-jp/.github reusable workflows: `@main`
//   - other external actions: `owner/repo[/path]@<40-char commit SHA>`
//   - docker actions:   `docker://image@sha256:<digest>`
//   - local actions:    `./path/to/action` (not applicable; skipped)
//
// A moving ref (branch or tag, e.g. `@v4`) is rejected for third-party actions.
// The organization-owned reusable workflows intentionally follow `@main`, so
// the shared authority is updated for all consumers at one explicit branch.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const SHA_PIN = /@[0-9a-f]{40}$/;
const DOCKER_DIGEST_PIN = /@sha256:[0-9a-f]{64}$/;
const ORG_REUSABLE_WORKFLOW = /^yohn-jp\/\.github\/\.github\/workflows\/[^@]+@([^@]+)$/u;

/**
 * @param {unknown} node parsed YAML (sub)tree
 * @param {string} sourceLabel path used in error messages
 * @returns {string[]} errors
 */
export function validateActionPins(node, sourceLabel) {
  const errors = [];
  walk(node, []);
  return errors;

  function walk(value, path) {
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, [...path, String(i)]));
      return;
    }
    if (value !== null && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        if (key === "uses" && typeof child === "string") {
          checkUses(child, [...path, key]);
        } else {
          walk(child, [...path, key]);
        }
      }
    }
  }

  function checkUses(ref, path) {
    const where = `${sourceLabel}:${path.join(".")}`;

    if (ref.startsWith("./") || ref.startsWith("../")) {
      return; // local action reference; no remote ref to pin
    }

    if (ref.startsWith("docker://")) {
      if (!DOCKER_DIGEST_PIN.test(ref)) {
        errors.push(
          `${where}: docker action "${ref}" must be pinned by digest (docker://image@sha256:<64-hex-digest>)`,
        );
      }
      return;
    }

    const organizationWorkflow = ref.match(ORG_REUSABLE_WORKFLOW);
    if (organizationWorkflow !== null) {
      if (organizationWorkflow[1] !== "main") {
        errors.push(
          `${where}: organization-owned reusable workflow "${ref}" must use @main (third-party Actions remain SHA-pinned)`,
        );
      }
      return;
    }

    if (!ref.includes("@")) {
      errors.push(`${where}: "${ref}" has no @ref; must be pinned to a full commit SHA`);
      return;
    }

    if (!SHA_PIN.test(ref)) {
      errors.push(
        `${where}: "${ref}" is not pinned to an immutable 40-character commit SHA (found a moving ref such as a tag or branch)`,
      );
    }
  }
}

/**
 * @param {string} filePath
 * @returns {string[]} errors
 */
export function validateActionPinsFile(filePath) {
  const raw = readFileSync(filePath, "utf8");
  let doc;
  try {
    doc = yaml.load(raw);
  } catch (cause) {
    return [`${filePath}: invalid YAML: ${cause.message}`];
  }
  return validateActionPins(doc, filePath);
}

function isMain() {
  return process.argv[1] === fileURLToPath(import.meta.url);
}

function collectTargets(root) {
  const targets = [];

  const workflowsDir = join(root, ".github", "workflows");
  if (existsSync(workflowsDir)) {
    for (const name of readdirSync(workflowsDir)) {
      if (name.endsWith(".yml") || name.endsWith(".yaml")) {
        targets.push(join(workflowsDir, name));
      }
    }
  }

  const actionsDir = join(root, ".github", "actions");
  if (existsSync(actionsDir)) {
    for (const dir of readdirSync(actionsDir)) {
      for (const name of ["action.yml", "action.yaml"]) {
        const p = join(actionsDir, dir, name);
        if (existsSync(p)) targets.push(p);
      }
    }
  }

  return targets;
}

function main() {
  const targets = collectTargets(process.cwd());

  if (targets.length === 0) {
    console.log("No workflow/action files found; nothing to validate.");
    return;
  }

  let failed = false;
  for (const target of targets) {
    const errors = validateActionPinsFile(target);
    if (errors.length === 0) {
      console.log(`OK   ${target}`);
    } else {
      failed = true;
      console.log(`FAIL ${target}`);
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
