import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";

const workflowPath = ".github/workflows/typescript-cli-ci.yml";
const workflowSource = readFileSync(workflowPath, "utf8");
const workflow = yaml.load(workflowSource);
const expression = (body) => "$" + "{{ " + body + " }}";

test("package artifact is revision-bound and exposed for caller reuse", () => {
  const packageStep = workflow.jobs.build.steps.find(
    (step) => step.name === "Prepare, inspect, and identify package artifact"
  );
  const uploadStep = workflow.jobs.build.steps.find(
    (step) =>
      step.uses?.startsWith("actions/upload-artifact@") &&
      step.with?.name === expression("steps.package.outputs.artifact_name")
  );
  const downloadStep = workflow.jobs["package-validate"].steps.find(
    (step) =>
      step.uses?.startsWith("actions/download-artifact@") &&
      step.with?.name ===
        expression("needs.build.outputs.package_artifact_name")
  );

  assert.equal(
    workflow.on.workflow_call.outputs["package-artifact-name"].value,
    expression("jobs.build.outputs.package_artifact_name")
  );
  assert.equal(
    workflow.jobs.build.outputs.package_artifact_name,
    expression("steps.package.outputs.artifact_name")
  );
  assert.equal(packageStep.id, "package");
  assert.match(packageStep.run, /SOURCE_SHA/);
  assert.match(packageStep.run, /pnpm run build/);
  assert.match(packageStep.run, /pnpm pack/);
  assert.match(packageStep.run, /ci-package-artifact\.mjs/);
  assert.match(uploadStep.with.path, /typescript-cli-package/);
  assert.equal(uploadStep.with["if-no-files-found"], "error");
  assert.equal(
    downloadStep.with.path,
    expression("runner.temp") + "/typescript-cli-package"
  );
  assert.equal(workflow.jobs["package-validate"].needs.includes("build"), true);
});

test("consumer preparation is opt-in and leaves lifecycle scripts enabled", () => {
  assert.equal(
    workflow.on.workflow_call.inputs["package-preparation-command"].default,
    ""
  );
  const packageStep = workflow.jobs.build.steps.find(
    (step) => step.name === "Prepare, inspect, and identify package artifact"
  );
  assert.match(packageStep.run, /bash -euo pipefail -c/);
  assert.doesNotMatch(packageStep.run, /--ignore-scripts/);
  assert.match(packageStep.run, /exactly one \.tgz/);
});

test("verify remains the stable fail-closed status", () => {
  const verify = workflow.jobs.verify;
  assert.equal(verify.name, "verify");
  assert.equal(verify.if, "always()");
  assert.equal(
    verify.needs.includes("package-validate") &&
      verify.needs.includes("conformance") &&
      verify.needs.includes("build"),
    true
  );
  assert.match(verify.steps[0].run, /success/);
  assert.match(verify.steps[0].run, /skipped/);
  assert.match(verify.steps[0].run, /exit 1/);
});
