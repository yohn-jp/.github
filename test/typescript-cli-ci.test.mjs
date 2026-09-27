import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { verifyPackageArtifact } from "../scripts/ci-package-artifact.mjs";

const workflowPath = ".github/workflows/typescript-cli-ci.yml";
const workflowSource = readFileSync(workflowPath, "utf8");
const workflow = yaml.load(workflowSource);
const expression = (body) => "$" + "{{ " + body + " }}";
const packagePreparationStep = workflow.jobs.build.steps.find(
  (step) => step.name === "Prepare, inspect, and identify package artifact"
);

function createPreparationFixture({ prepack = false } = {}) {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), "typescript-cli-preparation-")
  );
  mkdirSync(path.join(directory, "scripts"));
  writeFileSync(
    path.join(directory, "package.json"),
    JSON.stringify({
      name: "typescript-cli-preparation-fixture",
      version: "1.0.0",
      type: "module",
      files: ["dist"],
      packageManager: "pnpm@11.25.0",
      scripts: {
        build: "node scripts/build.mjs",
        ...(prepack ? { prepack: "pnpm run build" } : {})
      }
    })
  );
  writeFileSync(
    path.join(directory, "scripts/build.mjs"),
    [
      'import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";',
      'appendFileSync("build-count.txt", "build\\n");',
      'mkdirSync("dist", { recursive: true });',
      'writeFileSync("dist/index.js", "export {};\\n");',
      ""
    ].join("\n")
  );

  const runnerTemp = path.join(directory, "runner-temp");
  const providerScriptDirectory = path.join(
    runnerTemp,
    "provider-tools",
    "scripts"
  );
  mkdirSync(providerScriptDirectory, { recursive: true });
  copyFileSync(
    "scripts/ci-package-artifact.mjs",
    path.join(providerScriptDirectory, "ci-package-artifact.mjs")
  );
  return { directory, runnerTemp };
}

function runPackagePreparation(fixture, command) {
  const outputPath = path.join(fixture.directory, "github-output");
  execFileSync("bash", ["-euo", "pipefail", "-c", packagePreparationStep.run], {
    cwd: fixture.directory,
    env: {
      ...process.env,
      GITHUB_OUTPUT: outputPath,
      PACKAGE_PREPARATION_COMMAND: command,
      RUNNER_TEMP: fixture.runnerTemp,
      SOURCE_SHA: "c".repeat(40)
    },
    encoding: "utf8"
  });
  return {
    output: readFileSync(outputPath, "utf8"),
    artifactDirectory: path.join(fixture.runnerTemp, "typescript-cli-package")
  };
}

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

test("standard preparation builds and packages once", () => {
  const fixture = createPreparationFixture();
  try {
    const result = runPackagePreparation(fixture, "");
    const verified = verifyPackageArtifact({
      artifactDirectory: result.artifactDirectory,
      expectedSha: "c".repeat(40)
    });

    assert.equal(
      readFileSync(path.join(fixture.directory, "build-count.txt"), "utf8"),
      "build\n"
    );
    assert.equal(verified.sourceSha, "c".repeat(40));
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("consumer prepack prepares and publishes its package exactly once", () => {
  const fixture = createPreparationFixture({ prepack: true });
  try {
    const result = runPackagePreparation(fixture, "pnpm pack");
    const verified = verifyPackageArtifact({
      artifactDirectory: result.artifactDirectory,
      expectedSha: "c".repeat(40)
    });

    assert.equal(
      readFileSync(path.join(fixture.directory, "build-count.txt"), "utf8"),
      "build\n"
    );
    assert.equal(verified.sourceSha, "c".repeat(40));
    assert.equal(
      result.output,
      "artifact_name=typescript-cli-package-" + "c".repeat(40) + "\n"
    );
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
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
