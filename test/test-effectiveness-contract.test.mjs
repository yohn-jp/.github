import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import {
  aggregateTestEffectivenessStatus,
  selectMutationMode,
  selectConsumerSha,
  validateExecutionContext,
  validateTestEffectivenessConfig,
  workflowInputsToConfig
} from "../scripts/test-effectiveness-contract.mjs";

const workflow = yaml.load(
  readFileSync(".github/workflows/test-effectiveness.yml", "utf8")
);

const base = {
  workingDirectory: ".",
  executionMode: "pr",
  coverageEnabled: false,
  propertyEnabled: false,
  propertyRandomized: false,
  mutationEnabled: false,
  mutationTimeoutSeconds: 600
};

function valid(overrides = {}) {
  return { ...base, ...overrides };
}

test("workflow exposes independent capabilities and stable status", () => {
  const call = workflow.on.workflow_call;
  assert.ok(call);
  const inputs = call.inputs;

  for (const input of [
    "coverage-enabled",
    "property-enabled",
    "mutation-enabled",
    "property-randomized"
  ]) {
    assert.equal(inputs[input].type, "boolean");
  }
  assert.equal(inputs["execution-mode"].default, "pr");
  assert.equal(inputs["mutation-timeout-seconds"].type, "number");
  assert.equal(inputs["coverage-regression-command"].type, "string");
  assert.equal(inputs["replay-seed"].type, "string");
  assert.equal(call.outputs.status.value, "${{ jobs.verify.outputs.status }}");
  assert.equal(
    workflow.jobs.plan.outputs.consumer_sha,
    "${{ steps.consumer-ref.outputs.consumer_sha }}"
  );
  assert.match(
    workflow.jobs.plan.steps.find((step) =>
      step.name.includes("Select consumer checkout")
    ).run,
    /--select-consumer-sha/
  );
  assert.deepEqual(Object.keys(workflow.jobs).sort(), [
    "coverage",
    "mutation",
    "plan",
    "property",
    "verify"
  ]);
  for (const job of ["coverage", "property", "mutation"]) {
    assert.equal("strategy" in workflow.jobs[job], false);
    const checkout = workflow.jobs[job].steps.find(
      (step) => step.name === "Checkout consumer repository"
    );
    assert.equal(checkout.with.ref, "${{ needs.plan.outputs.consumer_sha }}");
    assert.ok(
      workflow.jobs[job].steps.some(
        (step) => step.name === "Record consumer revision"
      )
    );
    const manifest = workflow.jobs[job].steps.find((step) =>
      step.name.includes("reproducibility manifest")
    );
    assert.match(manifest.run, /consumerSha/);
  }
  assert.match(
    workflow.jobs.coverage.steps.find((step) =>
      step.name.includes("Run coverage")
    ).run,
    /coverage-regression-command|COVERAGE_REGRESSION_COMMAND/
  );
  assert.match(
    workflow.jobs.property.steps.find(
      (step) => step.name === "Run property tests"
    ).env.PROPERTY_SEED,
    /replay-seed/
  );
  assert.match(
    workflow.jobs.mutation.steps.find((step) =>
      step.name.includes("event-selected")
    ).run,
    /timeout --signal=TERM/
  );
  assert.match(workflow.jobs.verify.steps[0].run, /!= "success"/);
  assert.match(workflow.jobs.verify.steps[0].run, /!= "skipped"/);
});

test("mutation mode follows explicit execution mode", () => {
  assert.equal(selectMutationMode({ executionMode: "pr" }), "pr-bounded");
  assert.equal(selectMutationMode({ executionMode: "main" }), "main-full");
  assert.equal(
    selectMutationMode({ executionMode: "nightly" }),
    "nightly-deep"
  );
  assert.equal(selectMutationMode({ executionMode: "invalid" }), "main-full");
});

test("consumer checkout selects PR head and caller SHA explicitly", () => {
  assert.equal(
    selectConsumerSha({
      eventName: "pull_request",
      pullRequestHeadSha: "head-sha-131",
      callerSha: "merge-sha-131"
    }),
    "head-sha-131"
  );
  assert.equal(
    selectConsumerSha({ eventName: "push", callerSha: "push-sha-131" }),
    "push-sha-131"
  );
  assert.throws(
    () =>
      selectConsumerSha({
        eventName: "pull_request",
        pullRequestHeadSha: "",
        callerSha: "merge-sha-131"
      }),
    /pull_request head SHA is unavailable/
  );
});

test("execution mode must match its caller event", () => {
  assert.deepEqual(
    validateExecutionContext({
      executionMode: "pr",
      eventName: "pull_request"
    }),
    []
  );
  assert.deepEqual(
    validateExecutionContext({ executionMode: "main", eventName: "push" }),
    []
  );
  assert.deepEqual(
    validateExecutionContext({
      executionMode: "nightly",
      eventName: "pull_request"
    }),
    [
      "execution-mode 'nightly' must match caller event (pr=pull_request, main=push/workflow_dispatch, nightly=schedule); received 'pull_request'"
    ]
  );
});

test("aggregate status fails closed", () => {
  assert.equal(
    aggregateTestEffectivenessStatus(["success", "skipped"]),
    "success"
  );
  assert.equal(
    aggregateTestEffectivenessStatus(["success", "failure"]),
    "failure"
  );
  assert.equal(
    aggregateTestEffectivenessStatus(["success", "cancelled"]),
    "failure"
  );
  assert.equal(aggregateTestEffectivenessStatus(undefined), "failure");
  assert.equal(aggregateTestEffectivenessStatus([]), "failure");
});

test("each capability can be configured independently", () => {
  assert.deepEqual(
    validateTestEffectivenessConfig(
      valid({
        coverageEnabled: true,
        coverageCommand: "pnpm coverage",
        coverageRegressionCommand: "pnpm coverage:check",
        coverageBaselinePath: "quality/coverage-baseline.json",
        coverageReportPath: "quality/coverage-report.json"
      })
    ),
    []
  );
  assert.deepEqual(
    validateTestEffectivenessConfig(
      valid({
        propertyEnabled: true,
        propertyCommand: "pnpm property",
        propertyReportPath: "quality/property-report.json"
      })
    ),
    []
  );
  assert.deepEqual(
    validateTestEffectivenessConfig(
      valid({
        mutationEnabled: true,
        mutationCommand: "pnpm mutation",
        mutationReportPath: "quality/mutation-report.json"
      })
    ),
    []
  );
});

test("enabled capabilities reject missing or unsafe consumer configuration", () => {
  const errors = validateTestEffectivenessConfig(
    valid({
      coverageEnabled: true,
      coverageCommand: "",
      coverageRegressionCommand: "pnpm coverage:check",
      coverageBaselinePath: "../baseline.json",
      coverageReportPath: "quality/coverage-report.json",
      propertyEnabled: true,
      propertyCommand: "pnpm property",
      propertyRandomized: true,
      propertyReportPath: "quality/property-report.json",
      mutationEnabled: true,
      mutationCommand: "pnpm mutation",
      mutationTimeoutSeconds: 0,
      mutationReportPath: "/tmp/mutation.json"
    })
  );
  assert.match(errors.join("\n"), /coverage-command is required/);
  assert.match(errors.join("\n"), /coverage-baseline-path must be a safe path/);
  assert.match(errors.join("\n"), /replay-seed is required/);
  assert.match(errors.join("\n"), /property-replay-command is required/);
  assert.match(
    errors.join("\n"),
    /mutation-timeout-seconds must be a positive integer/
  );
  assert.match(errors.join("\n"), /mutation-report-path must be a safe path/);
});

test("randomized properties require deterministic replay information", () => {
  const missingReplay = validateTestEffectivenessConfig(
    valid({
      propertyEnabled: true,
      propertyCommand: "pnpm property",
      propertyRandomized: true,
      replaySeed: "seed-131",
      propertyReportPath: "quality/property-report.json"
    })
  );
  assert.deepEqual(missingReplay, ["property-replay-command is required"]);

  assert.deepEqual(
    validateTestEffectivenessConfig(
      valid({
        propertyEnabled: true,
        propertyCommand: "pnpm property",
        propertyRandomized: true,
        replaySeed: "seed-131",
        propertyReplayCommand: "pnpm property:replay",
        propertyReportPath: "quality/property-report.json"
      })
    ),
    []
  );
});

test("workflow input mapping keeps commands and paths consumer-owned", () => {
  const config = workflowInputsToConfig({
    "working-directory": "packages/cli",
    "execution-mode": "nightly",
    "coverage-enabled": true,
    "coverage-command": "pnpm coverage",
    "coverage-regression-command": "pnpm coverage:check",
    "coverage-baseline-path": "quality/baseline.json",
    "coverage-report-path": "quality/report.json",
    "property-enabled": false,
    "mutation-enabled": true,
    "mutation-command": "pnpm mutation",
    "mutation-timeout-seconds": 1200,
    "mutation-report-path": "quality/mutation.json"
  });
  assert.equal(config.workingDirectory, "packages/cli");
  assert.equal(config.executionMode, "nightly");
  assert.equal(config.coverageCommand, "pnpm coverage");
  assert.equal(config.mutationTimeoutSeconds, 1200);
});
