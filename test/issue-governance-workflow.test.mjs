import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import { validateActionPinsFile } from "../scripts/validate-action-pins.mjs";

const workflowPath = ".github/workflows/issue-governance.yml";
const workflow = yaml.load(readFileSync(workflowPath, "utf8"));
const validateJob = workflow.jobs["validate-issue"];

function stepNamed(name) {
  const step = validateJob.steps.find((candidate) => candidate.name === name);
  assert.ok(step, `expected Issue governance step: ${name}`);
  return step;
}

test("Issue governance validates the consumer snapshot from the consumer workspace", () => {
  const consumerCheckout = stepNamed("Checkout consumer governance snapshot");
  const providerCheckout = stepNamed(
    "Checkout governance tooling (yohn-jp/.github)"
  );
  const consumerIndex = validateJob.steps.indexOf(consumerCheckout);
  const providerIndex = validateJob.steps.indexOf(providerCheckout);

  assert.ok(
    consumerIndex < providerIndex,
    "the consumer snapshot must be checked out before provider tooling"
  );
  assert.equal(consumerCheckout.uses, providerCheckout.uses);
  assert.equal(consumerCheckout.with.ref, "${{ github.sha }}");
  assert.equal(consumerCheckout.with["persist-credentials"], false);
  assert.equal(
    providerCheckout.with.repository,
    "${{ job.workflow_repository }}"
  );
  assert.equal(providerCheckout.with.ref, "${{ job.workflow_sha }}");
  assert.equal(providerCheckout.with.path, ".governance-tools");

  const manifestCheck = stepNamed("Validate synchronized governance snapshot");
  const issueValidation = stepNamed("Validate Issue contract");
  assert.equal(manifestCheck["working-directory"], undefined);
  assert.equal(issueValidation["working-directory"], undefined);
  assert.match(manifestCheck.run, /generate-inari-manifest\.mjs.*--check/u);
  assert.match(issueValidation.run, /validate-issue\.mjs/u);
});

test("Issue governance keeps all workflow references within the repository policy", () => {
  assert.deepEqual(validateActionPinsFile(workflowPath), []);
});
