import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";

// This fixture is a frozen copy of yohn-jp/mottainai's single, canonical
// `.github/workflows/governance.yml` (Issue #49: one PR-governance caller,
// not separate ordinary and release governance workflows). Mottainai cannot
// be driven as a live GitHub Actions consumer from inside this PR's CI, so
// this reconstructs the actual job-level `if` gating and evaluates it
// against the two PR shapes governance must distinguish. It is not a
// substitute for a real consumer smoke run — see docs/governance.md and the
// PR description for what merge-then-sync must still confirm on
// yohn-jp/mottainai itself.

const governanceWorkflow = yaml.load(
  readFileSync("test/fixtures/mottainai-consumer/governance.yml", "utf8")
);

/**
 * Evaluate the small subset of GitHub Actions expression syntax these two
 * job-level `if:` conditions actually use, against a synthetic
 * `pull_request` event context. Not a general expression evaluator.
 */
function evaluateIf(expression, context) {
  const js = expression
    .trim()
    .replace(/\$\{\{|\}\}/g, "")
    .replace(/github\.event_name/g, "context.eventName")
    .replace(/github\.actor/g, "context.actor")
    .replace(
      /github\.event\.pull_request\.user\.login/g,
      "context.pullRequest.user.login"
    )
    .replace(
      /github\.event\.pull_request\.head\.ref/g,
      "context.pullRequest.head.ref"
    )
    .replace(
      /startsWith\(([^,]+),\s*'([^']*)'\)/g,
      (_m, subject, prefix) => `(${subject}).startsWith('${prefix}')`
    );
  // eslint-disable-next-line no-new-func
  return new Function("context", `return (${js});`)(context);
}

function contextFor(branch) {
  return {
    eventName: "pull_request",
    actor: "someone",
    pullRequest: {
      user: { login: "someone" },
      head: { ref: branch }
    }
  };
}

function jobIf(workflow, jobName) {
  return workflow.jobs[jobName].if;
}

test("mottainai fixture: ordinary feat/123-x runs existing governance and skips the release-only job", () => {
  const context = contextFor("feat/123-x");

  assert.equal(
    evaluateIf(jobIf(governanceWorkflow, "standards-self-check"), context),
    true,
    "existing ordinary governance (standards-self-check) must run"
  );
  assert.equal(
    evaluateIf(jobIf(governanceWorkflow, "validate-pr"), context),
    true,
    "existing ordinary governance (validate-pr, including linked-Issue fetch) must run"
  );
  assert.equal(
    evaluateIf(jobIf(governanceWorkflow, "validate-release"), context),
    false,
    "release-only job must not run for an ordinary branch"
  );
});

test("mottainai fixture: release/0.2.1 skips ordinary linked-Issue governance and runs validate-release only", () => {
  const context = contextFor("release/0.2.1");

  assert.equal(
    evaluateIf(jobIf(governanceWorkflow, "standards-self-check"), context),
    false,
    "ordinary governance must be skipped for a release branch"
  );
  assert.equal(
    evaluateIf(jobIf(governanceWorkflow, "validate-pr"), context),
    false,
    "ordinary linked-Issue governance (validate-pr) must be skipped for a release branch"
  );
  assert.equal(
    evaluateIf(jobIf(governanceWorkflow, "validate-release"), context),
    true,
    "validate-release must run for a release branch"
  );
});

test("mottainai fixture: ordinary governance.yml contains the linked-Issue fetch step that release PRs must never reach", () => {
  const steps = governanceWorkflow.jobs["validate-pr"].steps;
  const fetchStep = steps.find((step) => step.name === "Fetch linked Issue");
  assert.ok(fetchStep, "expected a 'Fetch linked Issue' step in validate-pr");
  assert.match(fetchStep.run, /gh issue view/);
});

test("mottainai fixture: validate-release selects the canonical release contract via the shared reusable workflow, with no local Issue fetch", () => {
  const job = governanceWorkflow.jobs["validate-release"];
  assert.equal(job.uses, "yohn-jp/.github/.github/workflows/pr-governance.yml@main");
  assert.equal(JSON.stringify(job).includes("gh issue view"), false);
});

test("mottainai fixture: single workflow file owns both ordinary and release governance", () => {
  assert.deepEqual(
    Object.keys(governanceWorkflow.jobs).sort(),
    ["standards-self-check", "validate-pr", "validate-release"].sort()
  );
});
