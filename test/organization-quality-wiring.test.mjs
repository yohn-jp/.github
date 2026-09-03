import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";

// Covers the actual organization-quality.yml aggregate wiring, not just the
// pure pass/fail/skip decision (see aggregate-quality-status.test.mjs) or
// input forwarding (see quality-ci-contract.test.mjs). Required-by-default
// vs configuration-optional is a lane-workflow property, not something the
// aggregate itself encodes (the aggregate calls every lane unconditionally
// and lets each lane's own job graph decide whether it does anything); this
// test asserts that property against the real lane workflow files so a
// lane silently gaining/losing a disabling input is caught here, matching
// docs/quality-ci.md "Reusable workflow boundary".

const REQUIRED_BY_DEFAULT_LANES = [
  "supply-chain-security",
  "workflow-security"
];
const CONFIGURATION_OPTIONAL_LANES = ["static-quality", "test-effectiveness"];

function loadWorkflow(name) {
  return yaml.load(readFileSync(`.github/workflows/${name}`, "utf8"));
}

/**
 * A lane input can make its lane a no-op when left at its empty/false
 * default: an `-enabled` boolean gate (test-effectiveness's
 * coverage/property/mutation-enabled), or a string input whose description
 * says as much (static-quality's config-file).
 */
function hasDisablingInput(inputs) {
  return Object.entries(inputs ?? {}).some(([name, input]) => {
    if (input?.type === "boolean" && name.endsWith("-enabled")) return true;
    const description = String(input?.description ?? "");
    return /disables? (this|the) lane/i.test(description);
  });
}

test("the aggregate calls every lane job unconditionally (gating is a lane-internal concern)", () => {
  const aggregate = loadWorkflow("organization-quality.yml");
  const laneJobs = [
    "static-quality",
    "supply-chain-security",
    "workflow-security",
    "test-effectiveness"
  ];
  for (const laneJob of laneJobs) {
    const job = aggregate.jobs[laneJob];
    assert.ok(job, `jobs.${laneJob} must exist on the aggregate`);
    assert.equal(
      "if" in job,
      false,
      `jobs.${laneJob} must not gate the lane call itself; disabling is the lane workflow's own responsibility`
    );
  }
  assert.deepEqual(
    [...aggregate.jobs.quality.needs].sort(),
    [...laneJobs].sort()
  );
});

for (const laneName of REQUIRED_BY_DEFAULT_LANES) {
  test(`${laneName} has no disabling input and is required-by-default`, () => {
    const contract = yaml.load(
      readFileSync(".github/quality-ci-contract.yml", "utf8")
    );
    const workflow = loadWorkflow(contract.lanes[laneName].workflow);
    assert.equal(
      hasDisablingInput(workflow.on.workflow_call.inputs),
      false,
      `${laneName} gained an input that looks like a lane-disabling gate; ` +
        "if this is intentional, move it to CONFIGURATION_OPTIONAL_LANES here and update docs/quality-ci.md"
    );
  });
}

for (const laneName of CONFIGURATION_OPTIONAL_LANES) {
  test(`${laneName} has at least one disabling input and is configuration-optional`, () => {
    const contract = yaml.load(
      readFileSync(".github/quality-ci-contract.yml", "utf8")
    );
    const workflow = loadWorkflow(contract.lanes[laneName].workflow);
    assert.equal(
      hasDisablingInput(workflow.on.workflow_call.inputs),
      true,
      `${laneName} lost the input that lets a consumer leave it unconfigured; ` +
        "docs/quality-ci.md documents this lane as configuration-optional"
    );
  });
}
