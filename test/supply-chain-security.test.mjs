import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import yaml from "js-yaml";
import { validateActionPinsFile } from "../scripts/validate-action-pins.mjs";

const source = await readFile(
  ".github/workflows/supply-chain-security.yml",
  "utf8"
);
const workflow = yaml.load(source);

test("supply-chain provider exposes the quality CI contract", () => {
  const call = workflow.on.workflow_call;
  assert.ok(call);
  assert.deepEqual(Object.keys(call.inputs).sort(), [
    "codeql-config-file",
    "execution-mode",
    "license-policy-file",
    "severity",
    "working-directory"
  ]);
  assert.deepEqual(
    call.outputs.status.value,
    "${{ jobs.status.outputs.status }}"
  );
  assert.equal(call.inputs["working-directory"].default, ".");
  assert.equal(call.inputs["execution-mode"].default, "pr");
  assert.equal(call.inputs.severity.default, "high");
  assert.equal(call.inputs["license-policy-file"].default, "");
  assert.equal(call.inputs["codeql-config-file"].default, "");
  assert.equal(workflow.on.push, undefined);
  assert.equal(workflow.on.pull_request, undefined);
  assert.equal(workflow.on.schedule, undefined);
});

test("dependency review is PR-only and fail-closed", () => {
  const job = workflow.jobs["dependency-review"];
  assert.match(job.if, /execution-mode == 'pr'/);
  assert.match(job.if, /github\.event_name == 'pull_request'/);
  assert.deepEqual(job.permissions, {
    contents: "read",
    "pull-requests": "read"
  });

  const review = job.steps.find(
    (step) => step.name === "Review dependency changes"
  );
  assert.equal(
    review.uses,
    "actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294"
  );
  assert.equal(review.with["fail-on-scopes"], "runtime,development,unknown");
  assert.match(review.with["config-file"], /inputs\.license-policy-file/);
  assert.equal(review.with["license-check"], true);
  assert.equal(review.with["vulnerability-check"], true);
  assert.equal(review.with["warn-only"], false);
  assert.equal(review.with["comment-summary-in-pr"], "never");
});

test("CodeQL reuses the existing organization workflow and status fails closed", () => {
  const codeql = workflow.jobs.codeql;
  assert.equal(codeql.uses, "./.github/workflows/codeql.yml");
  assert.match(codeql.with["config-file"], /inputs\.codeql-config-file/);
  assert.deepEqual(codeql.permissions, {
    contents: "read",
    "security-events": "write",
    actions: "read"
  });

  const status = workflow.jobs.status;
  assert.equal(status.if, "always()");
  assert.deepEqual(status.needs, [
    "validate-policy",
    "dependency-review",
    "codeql"
  ]);
  const aggregate = status.steps.find(
    (step) => step.name === "Aggregate lane result"
  );
  assert.match(aggregate.run, /cancelled\|timed_out\|action_required/);
  assert.match(aggregate.run, /fails closed/);
});

test("provider contains no repository conditionals or OS matrix", () => {
  assert.equal(source.includes("github.repository"), false);
  assert.equal(source.includes("strategy:"), false);
  assert.equal(source.includes("codeql-action"), false);
});

test("provider actions are immutably pinned", () => {
  assert.deepEqual(
    validateActionPinsFile(".github/workflows/supply-chain-security.yml"),
    []
  );
});
