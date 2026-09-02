import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import { validateActionPinsFile } from "../scripts/validate-action-pins.mjs";

const workflowPath = ".github/workflows/workflow-security.yml";
const workflowSource = readFileSync(workflowPath, "utf8");
const workflow = yaml.load(workflowSource);

function zizmorStep() {
  return workflow.jobs.audit.steps.find(
    (step) => step.name === "Run zizmor security audit"
  );
}

test("workflow security gate is reusable and least-privilege", () => {
  assert.ok(workflow.on.workflow_call);
  assert.equal(
    workflow.on.workflow_call.inputs["workflow-paths"].default,
    ".github/workflows/**"
  );
  assert.equal(workflow.on.workflow_call.inputs["config-file"].default, "");
  assert.equal(
    workflow.on.workflow_call.inputs["execution-mode"].default,
    "pr"
  );
  assert.equal(
    workflow.on.workflow_call.outputs.status.value,
    "${{ jobs.audit.outputs.status }}"
  );
  assert.deepEqual(workflow.permissions, {});
  assert.equal(workflow.jobs.audit["runs-on"], "ubuntu-latest");
  assert.deepEqual(workflow.jobs.audit.permissions, { contents: "read" });
  assert.equal(
    workflow.jobs.audit.outputs.status,
    "${{ steps.report.outputs.status }}"
  );
  assert.doesNotMatch(workflowSource, /matrix:/);
  assert.doesNotMatch(workflowSource, /github\.event\.repository\.name/);
  assert.doesNotMatch(workflowSource, /github\.repository(?:\s|\.)/);
});

test("provider actions in the security gate are immutably pinned", () => {
  assert.deepEqual(validateActionPinsFile(workflowPath), []);
});

test("zizmor is fixed, offline, actionable, and limited to distinct audits", () => {
  const step = zizmorStep();
  assert.equal(
    step.with.inputs,
    "${{ inputs.workflow-paths }} ${{ steps.probe.outputs.path }}"
  );
  assert.equal(step.with.collect, "workflows");
  assert.equal(step.with.version, "1.25.0");
  assert.equal(step.with.persona, "regular");
  assert.equal(step.with["online-audits"], false);
  assert.equal(step.with["advanced-security"], false);
  assert.equal(step.with.annotations, false);
  assert.equal(step.with.color, false);
  assert.equal(step.with.token, "");
  assert.equal(
    step.with.config,
    "${{ inputs.config-file || 'zizmor-gate.yml' }}"
  );
  assert.equal(step.with["fail-on-no-inputs"], false);
  assert.match(workflowSource, /unpinned-uses:\s*\n\s+disable: true/u);
  assert.match(
    workflowSource,
    /zizmor-policy-probe-\$\{\{ github\.run_id \}\}/u
  );
  assert.match(
    workflowSource,
    /inputs: \$\{\{ inputs\.workflow-paths \}\} \$\{\{ steps\.probe\.outputs\.path \}\}/u
  );
});

test("known-good fixture satisfies the existing immutable-reference baseline", () => {
  assert.deepEqual(
    validateActionPinsFile(
      "test/fixtures/workflows/workflow-security-safe.yml"
    ),
    []
  );
});

test("unsafe fixture exposes baseline and distinct zizmor hazards", () => {
  const path = "test/fixtures/workflows/workflow-security-unsafe.yml";
  const errors = validateActionPinsFile(path);
  assert.equal(errors.length, 1, JSON.stringify(errors, null, 2));
  assert.match(errors[0], /actions\/checkout@v4/);

  const unsafe = yaml.load(readFileSync(path, "utf8"));
  assert.ok(unsafe.on.pull_request_target);
  assert.equal(unsafe.permissions.contents, "write");
  assert.match(
    unsafe.jobs.untrusted.steps[1].run,
    /github\.event\.pull_request\.title/
  );
});

test("malformed fixture produces a deterministic YAML diagnostic", () => {
  const errors = validateActionPinsFile(
    "test/fixtures/workflows/workflow-security-invalid.yml"
  );
  assert.equal(errors.length, 1, JSON.stringify(errors, null, 2));
  assert.match(errors[0], /invalid YAML:/);
});
