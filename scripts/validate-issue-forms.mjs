#!/usr/bin/env node
// Deterministic structural validator for GitHub Issue Form YAML files.
//
// A plain YAML parse is not sufficient acceptance for Issue Forms: flow
// mappings such as
//
//   attributes: { label: Reproduction, description: Minimal steps, observed result, expected result, and environment }
//
// are syntactically valid YAML, but the unquoted commas inside the flow
// mapping split the intended single `description` value into additional
// mapping entries (`observed result`, `expected result`, `and environment`).
// js-yaml parses this without error, so a schema-aware check is required to
// catch it.

import { readFileSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const TOP_LEVEL_KEYS = new Set([
  "name",
  "description",
  "title",
  "labels",
  "assignees",
  "body",
]);
const TOP_LEVEL_REQUIRED = ["name", "description", "body"];

const ITEM_TOP_KEYS = new Set(["type", "id", "attributes", "validations"]);
const VALIDATIONS_KEYS = new Set(["required"]);

// Allowed `attributes` keys per Issue Form element `type`, per GitHub's
// documented schema. `label` is required for every type except markdown.
const ATTRIBUTE_SCHEMA = {
  markdown: {
    allowed: new Set(["value"]),
    required: new Set(["value"]),
  },
  textarea: {
    allowed: new Set(["label", "description", "placeholder", "value", "render"]),
    required: new Set(["label"]),
  },
  input: {
    allowed: new Set(["label", "description", "placeholder", "value"]),
    required: new Set(["label"]),
  },
  dropdown: {
    allowed: new Set(["label", "description", "multiple", "options", "default"]),
    required: new Set(["label", "options"]),
  },
  checkboxes: {
    allowed: new Set(["label", "description", "options"]),
    required: new Set(["label", "options"]),
  },
};

const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * @param {unknown} doc parsed YAML document
 * @param {string} sourceLabel path/name used in error messages
 * @returns {string[]} list of human-readable error messages, empty if valid
 */
export function validateIssueForm(doc, sourceLabel) {
  const errors = [];
  const err = (msg) => errors.push(`${sourceLabel}: ${msg}`);

  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    err("top-level document must be a mapping");
    return errors;
  }

  for (const key of Object.keys(doc)) {
    if (!TOP_LEVEL_KEYS.has(key)) {
      err(`unexpected top-level key "${key}"`);
    }
  }
  for (const key of TOP_LEVEL_REQUIRED) {
    if (!(key in doc)) {
      err(`missing required top-level key "${key}"`);
    }
  }

  if ("body" in doc) {
    if (!Array.isArray(doc.body)) {
      err('"body" must be a sequence of form elements');
    } else {
      doc.body.forEach((item, index) => {
        validateBodyItem(item, index, err);
      });
    }
  }

  return errors;
}

function validateBodyItem(item, index, err) {
  const where = `body[${index}]`;

  if (item === null || typeof item !== "object" || Array.isArray(item)) {
    err(`${where}: element must be a mapping`);
    return;
  }

  for (const key of Object.keys(item)) {
    if (!ITEM_TOP_KEYS.has(key)) {
      err(`${where}: unexpected key "${key}"`);
    }
  }

  const type = item.type;
  if (typeof type !== "string" || !(type in ATTRIBUTE_SCHEMA)) {
    err(
      `${where}: unsupported or missing "type" (expected one of: ${Object.keys(ATTRIBUTE_SCHEMA).join(", ")})`,
    );
    return;
  }

  if ("id" in item) {
    if (typeof item.id !== "string" || !ID_PATTERN.test(item.id)) {
      err(`${where}: "id" must match ${ID_PATTERN} (no spaces or punctuation)`);
    }
  }

  const schema = ATTRIBUTE_SCHEMA[type];
  const attributes = item.attributes;

  if (attributes === undefined) {
    err(`${where}: missing "attributes"`);
  } else if (attributes === null || typeof attributes !== "object" || Array.isArray(attributes)) {
    err(`${where}: "attributes" must be a mapping`);
  } else {
    for (const key of Object.keys(attributes)) {
      if (!schema.allowed.has(key)) {
        const hint = /\s/.test(key)
          ? " (a key containing spaces is a strong signal of an unquoted-comma flow-mapping regression splitting a single value into multiple keys)"
          : "";
        err(`${where}: attribute "${key}" is not valid for type "${type}"${hint}`);
      }
    }
    for (const key of schema.required) {
      if (!(key in attributes)) {
        err(`${where}: attribute "${key}" is required for type "${type}"`);
      }
    }
  }

  if ("validations" in item) {
    const validations = item.validations;
    if (validations === null || typeof validations !== "object" || Array.isArray(validations)) {
      err(`${where}: "validations" must be a mapping`);
    } else {
      for (const key of Object.keys(validations)) {
        if (!VALIDATIONS_KEYS.has(key)) {
          err(`${where}: unexpected "validations" key "${key}"`);
        }
      }
      if ("required" in validations && typeof validations.required !== "boolean") {
        err(`${where}: "validations.required" must be a boolean`);
      }
    }
    if (type === "markdown") {
      err(`${where}: "markdown" elements do not support "validations"`);
    }
  }
}

/**
 * @param {string} filePath
 * @returns {string[]} errors
 */
export function validateIssueFormFile(filePath) {
  const raw = readFileSync(filePath, "utf8");
  let doc;
  try {
    doc = yaml.load(raw);
  } catch (cause) {
    return [`${filePath}: invalid YAML: ${cause.message}`];
  }
  return validateIssueForm(doc, filePath);
}

function isMain() {
  return process.argv[1] === fileURLToPath(import.meta.url);
}

function main() {
  const dir = join(process.cwd(), ".github", "ISSUE_TEMPLATE");
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    console.log(`No ${dir} directory found; nothing to validate.`);
    return;
  }

  const targets = entries
    .filter((name) => (name.endsWith(".yml") || name.endsWith(".yaml")) && basename(name) !== "config.yml")
    .map((name) => join(dir, name));

  if (targets.length === 0) {
    console.log("No Issue Form files found; nothing to validate.");
    return;
  }

  let failed = false;
  for (const target of targets) {
    const errors = validateIssueFormFile(target);
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
