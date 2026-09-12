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

test("release certification gate is optional and receives only the generic exact-release context", () => {
  const verifyStep = stepNamed("Verify release certification");
  assert.equal(verifyStep.if, "inputs.certification-verification-script != ''");
  assert.deepEqual(verifyStep.env, {
    CERTIFICATION_VERIFICATION_SCRIPT:
      "${{ inputs.certification-verification-script }}",
    RELEASE_SOURCE_SHA: "${{ steps.release-context.outputs.source_sha }}",
    RELEASE_TAG: "${{ steps.release-context.outputs.tag }}",
    RELEASE_ARTIFACT_PATH: "${{ steps.pack.outputs.path }}"
  });
  assert.match(verifyStep.run, /node --import tsx/);
  assert.match(stepNamed("Resolve release context").run, /git rev-parse HEAD/);
  assert.equal(
    stepNamed("Checkout").with.ref,
    "refs/tags/${{ github.event.release.tag_name }}"
  );

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
    writeFileSync(
      failingScript,
      'console.error("certification failed"); process.exitCode = 1;\n'
    );
    chmodSync(failingScript, 0o644);
    assertStepFails(
      verifyStep.run,
      root,
      {
        CERTIFICATION_VERIFICATION_SCRIPT:
          "scripts/verify-release-certification.mjs",
        RELEASE_SOURCE_SHA: "0123456789abcdef",
        RELEASE_TAG: "v1.0.0",
        RELEASE_ARTIFACT_PATH: failingScript
      },
      /certification failed/
    );

    const tarballPath = join(root, "package-1.0.0.tgz");
    writeFileSync(tarballPath, "the exact packed bytes\n");
    writeFileSync(
      failingScript,
      [
        'import { existsSync, readFileSync } from "node:fs";',
        'if (process.env.RELEASE_SOURCE_SHA !== "0123456789abcdef") process.exitCode = 1;',
        'if (process.env.RELEASE_TAG !== "v1.0.0") process.exitCode = 1;',
        "if (!existsSync(process.env.RELEASE_ARTIFACT_PATH)) process.exitCode = 1;",
        'if (readFileSync(process.env.RELEASE_ARTIFACT_PATH, "utf8") !== "the exact packed bytes\\n") process.exitCode = 1;'
      ].join("\n") + "\n"
    );
    runStep(verifyStep.run, root, {
      CERTIFICATION_VERIFICATION_SCRIPT:
        "scripts/verify-release-certification.mjs",
      RELEASE_SOURCE_SHA: "0123456789abcdef",
      RELEASE_TAG: "v1.0.0",
      RELEASE_ARTIFACT_PATH: tarballPath
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("npm certification runs after one pack and before the exact tarball is uploaded", () => {
  const packStep = stepNamed("Pack tarball");
  const verifyIndex = buildJob.steps.findIndex(
    (step) => step.name === "Verify release certification"
  );
  const packIndex = buildJob.steps.findIndex(
    (step) => step.name === "Pack tarball"
  );
  const uploadIndex = buildJob.steps.findIndex(
    (step) => step.name === "Upload tarball"
  );
  const unchangedIndex = buildJob.steps.findIndex(
    (step) => step.name === "Verify packed tarball unchanged"
  );
  assert.ok(
    verifyIndex !== -1 &&
      packIndex !== -1 &&
      unchangedIndex !== -1 &&
      uploadIndex !== -1
  );
  assert.ok(packIndex < verifyIndex);
  assert.ok(verifyIndex < unchangedIndex);
  assert.ok(unchangedIndex < uploadIndex);
  assert.equal((packStep.run.match(/\bpnpm pack\b/g) ?? []).length, 1);
  assert.equal(
    stepNamed("Upload tarball").with.path,
    "${{ steps.pack.outputs.path }}"
  );
});

test("smoke and publish consume the packed artifact without repacking", () => {
  assert.deepEqual(workflow.jobs.build.outputs, {
    "package-name": "${{ steps.package.outputs.name }}",
    "package-version": "${{ steps.package.outputs.version }}",
    "tarball-name": "${{ steps.pack.outputs.name }}",
    "tarball-sha256": "${{ steps.pack.outputs.sha256 }}"
  });

  const smokeStep = workflow.jobs["smoke-test"].steps.find(
    (step) => step.name === "Smoke test packed tarball"
  );
  const publishJob = workflow.jobs.publish;
  const publishStep = publishJob.steps.find((step) => step.name === "Publish");
  assert.ok(smokeStep && publishStep);
  assert.equal(
    smokeStep.env.TARBALL_NAME,
    "${{ needs.build.outputs.tarball-name }}"
  );
  assert.equal(
    publishStep.env.TARBALL_NAME,
    "${{ needs.build.outputs.tarball-name }}"
  );
  assert.match(
    smokeStep.run,
    /node scripts\/smoke-test\.mjs --tarball "\$TARBALL_NAME"/
  );
  assert.match(publishStep.run, /npm publish "\$TARBALL_NAME"/);
  assert.doesNotMatch(smokeStep.run, /\b(?:pnpm|npm) pack\b/);
  assert.doesNotMatch(publishStep.run, /\b(?:pnpm|npm) pack\b/);
  assert.deepEqual(publishJob.needs, ["build", "smoke-test"]);
});

test("certification-verification-script input defaults to empty (gate disabled)", () => {
  assert.equal(
    workflow.on.workflow_call.inputs["certification-verification-script"]
      .default,
    ""
  );
});
