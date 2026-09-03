#!/usr/bin/env node
// Validate the machine-readable boundary shared by the organization quality
// lane providers and their aggregate caller.  This is deliberately a schema
// check: repository-specific commands, thresholds, paths, and exceptions stay
// in consumer repositories and are never encoded here.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const CONTRACT_PATH = ".github/quality-ci-contract.yml";
const EXPECTED_LANES = [
  "static-quality",
  "supply-chain-security",
  "workflow-security",
  "test-effectiveness"
];
const INPUT_TYPES = new Set(["string", "boolean", "number"]);
const EXECUTION_MODES = ["pr", "main", "nightly"];
const FORBIDDEN_KEYS = new Set([
  "strategy.matrix",
  "github.repository",
  "github.repository_owner"
]);

/**
 * @param {unknown} value
 * @param {string} sourceLabel
 * @returns {string[]}
 */
export function validateQualityContract(value, sourceLabel = CONTRACT_PATH) {
  const errors = [];
  const contract = requireRecord(value, "contract", sourceLabel, errors);
  if (contract === null) return errors;

  if (contract["schema-version"] !== 1) {
    errors.push(`${sourceLabel}: schema-version must be 1`);
  }
  if (contract.kind !== "organization-quality-ci-contract") {
    errors.push(
      `${sourceLabel}: kind must be organization-quality-ci-contract`
    );
  }

  const defaults = requireRecord(
    contract.defaults,
    "defaults",
    sourceLabel,
    errors
  );
  if (defaults !== null) {
    if (defaults.runner !== "ubuntu-latest") {
      errors.push(`${sourceLabel}: defaults.runner must be ubuntu-latest`);
    }
    const permissions = requireRecord(
      defaults.permissions,
      "defaults.permissions",
      sourceLabel,
      errors
    );
    if (permissions !== null && permissions.contents !== "read") {
      errors.push(`${sourceLabel}: defaults.permissions.contents must be read`);
    }
    const forbidden = asStringArray(defaults["forbidden-keys"]);
    for (const key of FORBIDDEN_KEYS) {
      if (!forbidden.includes(key)) {
        errors.push(
          `${sourceLabel}: defaults.forbidden-keys must include ${key}`
        );
      }
    }
  }

  const aggregate = requireRecord(
    contract.aggregate,
    "aggregate",
    sourceLabel,
    errors
  );
  if (aggregate !== null) {
    for (const key of ["workflow", "job-id", "status"]) {
      if (typeof aggregate[key] !== "string" || aggregate[key].trim() === "") {
        errors.push(
          `${sourceLabel}: aggregate.${key} must be a non-empty string`
        );
      }
    }
    validateWorkflowName(
      aggregate.workflow,
      `${sourceLabel}: aggregate.workflow`,
      errors
    );
    if (aggregate.condition !== "always") {
      errors.push(`${sourceLabel}: aggregate.condition must be always`);
    }
    const policy = requireRecord(
      aggregate["result-policy"],
      "aggregate.result-policy",
      sourceLabel,
      errors
    );
    if (policy !== null) {
      expectExactStrings(
        policy.pass,
        ["success", "skipped"],
        `${sourceLabel}: aggregate.result-policy.pass`,
        errors
      );
      expectExactStrings(
        policy.fail,
        ["failure", "cancelled", "timed_out", "action_required"],
        `${sourceLabel}: aggregate.result-policy.fail`,
        errors
      );
    }
  }

  const lanes = requireRecord(contract.lanes, "lanes", sourceLabel, errors);
  if (lanes === null) return errors;

  const actualLanes = Object.keys(lanes).sort();
  if (actualLanes.join("\0") !== [...EXPECTED_LANES].sort().join("\0")) {
    errors.push(
      `${sourceLabel}: lanes must be exactly ${EXPECTED_LANES.join(", ")}`
    );
  }

  for (const laneName of EXPECTED_LANES) {
    const lane = requireRecord(
      lanes[laneName],
      `lanes.${laneName}`,
      sourceLabel,
      errors
    );
    if (lane === null) continue;
    for (const key of ["workflow", "output"]) {
      if (typeof lane[key] !== "string" || lane[key].trim() === "") {
        errors.push(
          `${sourceLabel}: lanes.${laneName}.${key} must be a non-empty string`
        );
      }
    }
    validateWorkflowName(
      lane.workflow,
      `${sourceLabel}: lanes.${laneName}.workflow`,
      errors
    );
    if (lane.output !== "status") {
      errors.push(`${sourceLabel}: lanes.${laneName}.output must be status`);
    }
    if (asStringArray(lane.capabilities).length === 0) {
      errors.push(
        `${sourceLabel}: lanes.${laneName}.capabilities must be a non-empty string list`
      );
    }
    validatePermissions(
      lane.permissions,
      `${sourceLabel}: lanes.${laneName}.permissions`,
      errors
    );
    validateInputs(
      lane.inputs,
      `${sourceLabel}: lanes.${laneName}.inputs`,
      errors
    );
  }

  return errors;
}

/**
 * Validate a quality workflow's structural coupling rules.  Existing
 * organization workflows are intentionally outside this check: some of them
 * legitimately use matrices (for example CodeQL and publishing).  Only the
 * workflows named by the quality contract are inspected.
 *
 * @param {string} raw workflow YAML
 * @param {string} sourceLabel path used in diagnostics
 * @returns {string[]}
 */
export function validateQualityWorkflowSource(raw, sourceLabel) {
  let document;
  try {
    document = yaml.load(raw);
  } catch (cause) {
    return [`${sourceLabel}: invalid YAML: ${cause.message}`];
  }

  const errors = [];
  walk(document, []);
  return errors;

  function walk(value, path) {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, [...path, String(index)]));
      return;
    }
    if (value === null || typeof value !== "object") {
      if (
        typeof value === "string" &&
        /github\.repository(?:_owner)?/u.test(value)
      ) {
        errors.push(
          `${sourceLabel}:${path.join(".")}: quality workflows must not branch on repository identity`
        );
      }
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (key === "matrix" && path.at(-1) === "strategy") {
        errors.push(
          `${sourceLabel}:${[...path, key].join(".")}: OS/repository matrices are not part of the quality contract`
        );
      }
      walk(child, [...path, key]);
    }
  }
}

/**
 * Inspect quality workflow files that are present in this provider checkout.
 * Missing lane files are allowed because lane issues land independently; the
 * aggregate integration issue supplies them before consumer rollout.
 *
 * @param {unknown} value parsed quality contract
 * @param {string} root repository root
 * @returns {string[]}
 */
export function validateQualityWorkflowFiles(value, root = ".") {
  const errors = [];
  const contract = value !== null && typeof value === "object" ? value : {};
  const aggregate = contract.aggregate;
  const lanes = contract.lanes;
  const names = [
    aggregate?.workflow,
    ...Object.values(lanes ?? {}).map((lane) => lane?.workflow)
  ];
  for (const name of names) {
    if (typeof name !== "string" || name.trim() === "") continue;
    const path = join(root, ".github", "workflows", name);
    if (!existsSync(path)) continue;
    errors.push(
      ...validateQualityWorkflowSource(readFileSync(path, "utf8"), path)
    );
  }

  const aggregateName = aggregate?.workflow;
  if (typeof aggregateName === "string" && aggregateName.trim() !== "") {
    const aggregatePath = join(root, ".github", "workflows", aggregateName);
    if (existsSync(aggregatePath)) {
      errors.push(
        ...validateAggregateInputForwarding(
          yaml.load(readFileSync(aggregatePath, "utf8")),
          aggregatePath,
          lanes ?? {},
          root
        )
      );
    }
  }

  return errors;
}

/**
 * The aggregate caller must forward every lane's own workflow_call input
 * (minus the aggregate-shared execution-mode) through to that lane's job, so
 * a lane feature (e.g. test-effectiveness's replay-seed) is never reachable
 * from the contract/lane workflow but silently unreachable through the
 * aggregate. Job ids are expected to match the contract's lane names, and a
 * forwarded input is expected under `<lane>-<input-name>` (execution-mode is
 * shared verbatim across every lane and is exempt).
 *
 * @param {unknown} aggregateDoc parsed aggregate workflow YAML
 * @param {string} sourceLabel path used in diagnostics
 * @param {Record<string, unknown>} lanes contract lanes
 * @param {string} root repository root, to resolve lane workflow files
 * @returns {string[]}
 */
export function validateAggregateInputForwarding(
  aggregateDoc,
  sourceLabel,
  lanes,
  root = "."
) {
  const errors = [];
  const aggregateInputs = asRecord(
    aggregateDoc?.on?.workflow_call?.inputs,
    "on.workflow_call.inputs"
  );
  const jobs = asRecord(aggregateDoc?.jobs, "jobs");
  if (aggregateInputs === null || jobs === null) return errors;

  for (const [laneName, lane] of Object.entries(lanes)) {
    const laneWorkflowName = lane?.workflow;
    if (typeof laneWorkflowName !== "string" || laneWorkflowName.trim() === "")
      continue;
    const lanePath = join(root, ".github", "workflows", laneWorkflowName);
    if (!existsSync(lanePath)) continue;

    const laneDoc = yaml.load(readFileSync(lanePath, "utf8"));
    const laneInputs = asRecord(
      laneDoc?.on?.workflow_call?.inputs,
      `${laneWorkflowName}: on.workflow_call.inputs`
    );
    if (laneInputs === null) continue;

    const job = asRecord(jobs[laneName], `jobs.${laneName}`);
    if (job === null) {
      errors.push(
        `${sourceLabel}: jobs.${laneName} must exist and call ${laneWorkflowName} so its inputs can be forwarded`
      );
      continue;
    }
    const forwarded = asRecord(job.with, `jobs.${laneName}.with`) ?? {};

    for (const inputName of Object.keys(laneInputs)) {
      if (inputName === "execution-mode") {
        if (!("execution-mode" in forwarded)) {
          errors.push(
            `${sourceLabel}: jobs.${laneName}.with.execution-mode must forward the aggregate's execution-mode input`
          );
        }
        continue;
      }
      if (!(inputName in forwarded)) {
        errors.push(
          `${sourceLabel}: jobs.${laneName}.with.${inputName} is missing; ${laneWorkflowName} declares this workflow_call input but the aggregate never forwards it, making it unreachable through the aggregate`
        );
        continue;
      }
      const prefixedName = `${laneName}-${inputName}`;
      if (!(prefixedName in aggregateInputs)) {
        errors.push(
          `${sourceLabel}: on.workflow_call.inputs.${prefixedName} is missing; jobs.${laneName}.with.${inputName} has no corresponding aggregate input to forward from`
        );
      }
    }
  }

  return errors;
}

function asRecord(value, label) {
  if (value !== null && typeof value === "object" && !Array.isArray(value))
    return value;
  return null;
}

function requireRecord(value, label, sourceLabel, errors) {
  const record = asRecord(value, label);
  if (record === null)
    errors.push(`${sourceLabel}: ${label} must be a mapping`);
  return record;
}

function asStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : [];
}

function expectExactStrings(value, expected, label, errors) {
  const actual = asStringArray(value);
  if (actual.join("\0") !== expected.join("\0")) {
    errors.push(`${label} must be exactly ${expected.join(", ")}`);
  }
}

function validateWorkflowName(value, label, errors) {
  if (
    typeof value === "string" &&
    /^[a-z0-9][a-z0-9._-]*\.ya?ml$/u.test(value)
  ) {
    return;
  }
  errors.push(`${label} must be a workflow filename under .github/workflows`);
}

function validatePermissions(value, label, errors) {
  const permissions = asRecord(value, label);
  if (permissions === null) {
    errors.push(`${label} must be a mapping`);
    return;
  }
  if (permissions.contents !== "read") {
    errors.push(`${label}.contents must be read`);
  }
  for (const [name, access] of Object.entries(permissions)) {
    if (name === "job-scoped") {
      const jobs = asRecord(access, `${label}.job-scoped`);
      if (jobs === null) {
        errors.push(`${label}.job-scoped must be a mapping`);
        continue;
      }
      for (const [jobName, jobPermissions] of Object.entries(jobs)) {
        const scoped = asRecord(
          jobPermissions,
          `${label}.job-scoped.${jobName}`
        );
        if (scoped === null) {
          errors.push(`${label}.job-scoped.${jobName} must be a mapping`);
          continue;
        }
        for (const [permission, jobAccess] of Object.entries(scoped)) {
          if (
            jobAccess !== "read" &&
            !(permission === "security-events" && jobAccess === "write")
          ) {
            errors.push(
              `${label}.job-scoped.${jobName}.${permission} must be read; only isolated CodeQL security-events upload may write`
            );
          }
        }
      }
      continue;
    }
    if (access !== "read") {
      errors.push(
        `${label}.${name} must be read; write permissions require a separately reviewed workflow`
      );
    }
  }
}

function validateInputs(value, label, errors) {
  const inputs = asRecord(value, label);
  if (inputs === null || Object.keys(inputs).length === 0) {
    errors.push(`${label} must declare at least one input`);
    return;
  }
  for (const [name, rawInput] of Object.entries(inputs)) {
    const input = asRecord(rawInput, `${label}.${name}`);
    if (input === null) {
      errors.push(`${label}.${name} must be a mapping`);
      continue;
    }
    if (!INPUT_TYPES.has(input.type)) {
      errors.push(`${label}.${name}.type must be string, boolean, or number`);
    }
    if (typeof input.required !== "boolean") {
      errors.push(`${label}.${name}.required must be boolean`);
    }
    if (!("default" in input)) {
      errors.push(`${label}.${name}.default must be explicit`);
    } else if (!matchesInputType(input.default, input.type)) {
      errors.push(
        `${label}.${name}.default must match its declared ${input.type} type`
      );
    }
    if (input.allowed !== undefined) {
      const allowed = asStringArray(input.allowed);
      if (allowed.length === 0) {
        errors.push(`${label}.${name}.allowed must be a non-empty string list`);
      }
      if (
        name === "execution-mode" &&
        allowed.join("\0") !== EXECUTION_MODES.join("\0")
      ) {
        errors.push(
          `${label}.${name}.allowed must be ${EXECUTION_MODES.join(", ")}`
        );
      }
    }
  }
}

function matchesInputType(value, type) {
  if (type === "string") return typeof value === "string";
  if (type === "boolean") return typeof value === "boolean";
  if (type === "number") {
    return typeof value === "number" && Number.isFinite(value);
  }
  return false;
}

function isMain() {
  return process.argv[1] === fileURLToPath(import.meta.url);
}

function main() {
  let parsed;
  try {
    parsed = yaml.load(readFileSync(CONTRACT_PATH, "utf8"));
  } catch (cause) {
    console.error(`${CONTRACT_PATH}: invalid YAML: ${cause.message}`);
    process.exitCode = 1;
    return;
  }
  const errors = validateQualityContract(parsed);
  errors.push(...validateQualityWorkflowFiles(parsed));
  if (errors.length > 0) {
    for (const error of errors) console.error(`FAIL ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`OK   ${CONTRACT_PATH}`);
}

if (isMain()) main();
