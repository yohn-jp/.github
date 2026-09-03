import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import {
  validateQualityContract,
  validateQualityWorkflowSource,
  validateAggregateInputForwarding
} from "../scripts/validate-quality-contract.mjs";

function load(path) {
  return yaml.load(readFileSync(path, "utf8"));
}

test("canonical organization quality contract is valid", () => {
  assert.deepEqual(
    validateQualityContract(load(".github/quality-ci-contract.yml")),
    []
  );
});

test("contract rejects aggregate semantics that are not stable and fail-closed", () => {
  const errors = validateQualityContract(
    load("test/fixtures/quality-contract/invalid-aggregate.yml")
  );
  assert.ok(
    errors.some((error) => error.includes("aggregate.condition must be always"))
  );
  assert.ok(errors.some((error) => error.includes("result-policy.pass")));
  assert.ok(errors.some((error) => error.includes("lanes must be exactly")));
});

test("contract rejects write permissions", () => {
  const errors = validateQualityContract(
    load("test/fixtures/quality-contract/invalid-permissions.yml")
  );
  assert.ok(
    errors.some((error) =>
      error.includes("lanes.static-quality.permissions.contents must be read")
    )
  );
});

test("contract rejects malformed input declarations", () => {
  const errors = validateQualityContract(
    load("test/fixtures/quality-contract/invalid-inputs.yml")
  );
  assert.ok(errors.some((error) => error.includes("check-command.type")));
  assert.ok(errors.some((error) => error.includes("check-command.default")));
  assert.ok(errors.some((error) => error.includes("execution-mode.allowed")));
});

test("quality workflow wiring rejects repository conditionals and matrices", () => {
  const errors = validateQualityWorkflowSource(
    readFileSync("test/fixtures/quality-contract/invalid-wiring.yml", "utf8"),
    "invalid-wiring.yml"
  );
  assert.ok(errors.some((error) => error.includes("repository identity")));
  assert.ok(errors.some((error) => error.includes("matrices")));
});

test("the canonical aggregate forwards every lane's workflow_call inputs", () => {
  const contract = load(".github/quality-ci-contract.yml");
  const aggregateDoc = load(`.github/workflows/${contract.aggregate.workflow}`);
  assert.deepEqual(
    validateAggregateInputForwarding(
      aggregateDoc,
      ".github/workflows/organization-quality.yml",
      contract.lanes
    ),
    []
  );
});

test("aggregate forwarding check catches a lane input the aggregate never forwards", () => {
  const aggregateDoc = load(
    "test/fixtures/quality-contract/aggregate-missing-forward.yml"
  );
  const errors = validateAggregateInputForwarding(
    aggregateDoc,
    "aggregate-missing-forward.yml",
    {
      "test-effectiveness": { workflow: "test-effectiveness.yml" }
    }
  );
  assert.ok(
    errors.some((error) =>
      error.includes("jobs.test-effectiveness.with.property-seed is missing")
    )
  );
  assert.ok(
    errors.some((error) =>
      error.includes("jobs.test-effectiveness.with.node-version is missing")
    )
  );
});
