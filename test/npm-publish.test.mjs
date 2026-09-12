import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";

const workflowPath = ".github/workflows/npm-publish.yml";
const workflowSource = readFileSync(workflowPath, "utf8");
const workflow = yaml.load(workflowSource);
const buildJob = workflow.jobs.build;

function stepNamed(name) {
  const step = buildJob.steps.find((candidate) => candidate.name === name);
  assert.ok(step, "expected build job step " + name);
  return step;
}

function runStep(run, cwd, environment) {
  return execFileSync("bash", ["-euo", "pipefail", "-c", run], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...environment },
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function assertStepFails(run, cwd, environment, expectedMessage) {
  assert.throws(
    () => runStep(run, cwd, environment),
    (error) => {
      assert.notEqual(error.status, 0);
      const output =
        String(error.stdout ?? "") + "\n" + String(error.stderr ?? "");
      assert.match(output, expectedMessage);
      return true;
    }
  );
}

// The step always invokes `node --import tsx`; stub an empty, resolvable
// "tsx" package so the fixture doesn't need the real dependency the
// consumer's own pnpm install would provide.
function stubTsx(root) {
  const tsxDir = join(root, "node_modules", "tsx");
  mkdirSync(tsxDir, { recursive: true });
  writeFileSync(
    join(tsxDir, "package.json"),
    JSON.stringify({ name: "tsx", version: "0.0.0", exports: "./index.mjs" })
  );
  writeFileSync(join(tsxDir, "index.mjs"), "");
}

test("verify release certification step is gated by input and fails closed", () => {
  const verifyStep = stepNamed("Verify release certification");
  assert.equal(verifyStep.if, "inputs.certification-verification-script != ''");

  const root = mkdtempSync(join(tmpdir(), "npm-publish-certification-"));
  try {
    assertStepFails(
      verifyStep.run,
      root,
      {
        CERTIFICATION_VERIFICATION_SCRIPT:
          "scripts/verify-release-certification.mjs"
      },
      /not found/
    );

    stubTsx(root);
    const scripts = join(root, "scripts");
    mkdirSync(scripts, { recursive: true });
    const failingScript = join(scripts, "verify-release-certification.mjs");
    writeFileSync(failingScript, "process.exitCode = 1;\n");
    chmodSync(failingScript, 0o644);
    assertStepFails(
      verifyStep.run,
      root,
      {
        CERTIFICATION_VERIFICATION_SCRIPT:
          "scripts/verify-release-certification.mjs"
      },
      /.*/
    );

    writeFileSync(failingScript, "process.exitCode = 0;\n");
    runStep(verifyStep.run, root, {
      CERTIFICATION_VERIFICATION_SCRIPT:
        "scripts/verify-release-certification.mjs"
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verify release certification step runs before packing the tarball", () => {
  const verifyIndex = buildJob.steps.findIndex(
    (step) => step.name === "Verify release certification"
  );
  const packIndex = buildJob.steps.findIndex(
    (step) => step.name === "Pack tarball"
  );
  assert.ok(verifyIndex !== -1 && packIndex !== -1);
  assert.ok(verifyIndex < packIndex);
});

test("certification-verification-script input defaults to empty (gate disabled)", () => {
  assert.equal(
    workflow.on.workflow_call.inputs["certification-verification-script"]
      .default,
    ""
  );
});
