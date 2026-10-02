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
import {
  normalizeRepositoryUrl,
  repositoryMatches
} from "../scripts/check-repository-url.mjs";

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
  assert.equal(
    verifyStep.if,
    "inputs.certification-verification-script != '' && !inputs.dry-run"
  );
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.deepEqual(buildJob.permissions, {
    actions: "read",
    contents: "read"
  });
  assert.deepEqual(workflow.jobs.publish.permissions, {
    contents: "read",
    "id-token": "write"
  });
  assert.deepEqual(verifyStep.env, {
    CERTIFICATION_VERIFICATION_SCRIPT:
      "${{ inputs.certification-verification-script }}",
    GITHUB_TOKEN: "${{ github.token }}",
    RELEASE_SOURCE_SHA: "${{ steps.release-context.outputs.source_sha }}",
    RELEASE_TAG: "${{ steps.release-context.outputs.tag }}",
    RELEASE_ARTIFACT_PATH: "${{ steps.pack.outputs.path }}",
    RELEASE_ARTIFACT_SHA256: "${{ steps.pack.outputs.sha256 }}"
  });
  assert.match(verifyStep.run, /node --import tsx/);
  assert.match(stepNamed("Resolve release context").run, /git rev-parse HEAD/);
  assert.equal(
    stepNamed("Checkout").with.ref,
    "refs/tags/${{ github.event.release.tag_name }}"
  );
  assert.equal(stepNamed("Checkout").if, "${{ !inputs.dry-run }}");

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
        RELEASE_ARTIFACT_PATH: failingScript,
        RELEASE_ARTIFACT_SHA256: "packed-sha256"
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
        'if (process.env.GITHUB_TOKEN !== "job-token") process.exitCode = 1;',
        'if (process.env.RELEASE_ARTIFACT_SHA256 !== "packed-sha256") process.exitCode = 1;',
        "if (!existsSync(process.env.RELEASE_ARTIFACT_PATH)) process.exitCode = 1;",
        'if (readFileSync(process.env.RELEASE_ARTIFACT_PATH, "utf8") !== "the exact packed bytes\\n") process.exitCode = 1;'
      ].join("\n") + "\n"
    );
    runStep(verifyStep.run, root, {
      CERTIFICATION_VERIFICATION_SCRIPT:
        "scripts/verify-release-certification.mjs",
      RELEASE_SOURCE_SHA: "0123456789abcdef",
      RELEASE_TAG: "v1.0.0",
      RELEASE_ARTIFACT_PATH: tarballPath,
      RELEASE_ARTIFACT_SHA256: "packed-sha256",
      GITHUB_TOKEN: "job-token"
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
  const smokeCheckoutStep = workflow.jobs["smoke-test"].steps.find(
    (step) => step.name === "Checkout"
  );
  const publishJob = workflow.jobs.publish;
  const publishStep = publishJob.steps.find((step) => step.name === "Publish");
  assert.ok(smokeCheckoutStep && smokeStep && publishStep);
  assert.equal(
    smokeCheckoutStep.with.ref,
    "refs/tags/${{ github.event.release.tag_name }}"
  );
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
  assert.match(smokeStep.run, /sha256sum "\$TARBALL_NAME"/);
  assert.match(
    smokeStep.run,
    /"\$actual_sha256" != "\$EXPECTED_TARBALL_SHA256"/
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

test("the shared workflow keeps the certification token scoped to its verifier", () => {
  const verifyStep = stepNamed("Verify release certification");
  assert.equal(verifyStep.env.GITHUB_TOKEN, "${{ github.token }}");
  for (const job of Object.values(workflow.jobs)) {
    for (const step of job.steps ?? []) {
      if (step === verifyStep) continue;
      assert.notEqual(step.env?.GITHUB_TOKEN, "${{ github.token }}");
    }
  }
  assert.doesNotMatch(workflowSource, /\b(?:gh-inari|Inari)\b|evidence schema/);
});

test("dry-run input defaults to false and the publish job never runs under it", () => {
  const input = workflow.on.workflow_call.inputs["dry-run"];
  assert.equal(input.type, "boolean");
  assert.equal(input.default, false);
  assert.equal(workflow.jobs.publish.if, "${{ !inputs.dry-run }}");
  assert.deepEqual(workflow.jobs.publish.needs, ["build", "smoke-test"]);
  for (const name of ["build", "smoke-test"]) {
    assert.equal(workflow.jobs[name].if, undefined);
  }
});

test("dry-run checks out the PR ref and derives the release context from package.json", () => {
  const dryCheckout = stepNamed("Checkout (dry-run)");
  assert.equal(dryCheckout.if, "${{ inputs.dry-run }}");
  assert.equal(dryCheckout.with.ref, "${{ github.sha }}");
  const smokeSteps = workflow.jobs["smoke-test"].steps;
  assert.equal(
    smokeSteps.find((step) => step.name === "Checkout (dry-run)").with.ref,
    "${{ github.sha }}"
  );

  const contextStep = stepNamed("Resolve release context");
  const root = mkdtempSync(join(tmpdir(), "npm-publish-context-"));
  try {
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "x", version: "1.2.3" })
    );
    const outputFile = join(root, "output");
    writeFileSync(outputFile, "");
    runStep(contextStep.run, root, {
      DRY_RUN: "true",
      WORKING_DIRECTORY: ".",
      RELEASE_TAG: "",
      DRY_RUN_SHA: "feedface",
      GITHUB_OUTPUT: outputFile
    });
    const output = readFileSync(outputFile, "utf8");
    assert.match(output, /^source_sha=feedface$/m);
    assert.match(output, /^tag=v1\.2\.3$/m);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("dry-run skips the certification gate but fails when its script is missing", () => {
  const existsStep = stepNamed("Check certification script exists (dry-run)");
  assert.equal(
    existsStep.if,
    "${{ inputs.dry-run && inputs.certification-verification-script != '' }}"
  );
  const root = mkdtempSync(join(tmpdir(), "npm-publish-dry-run-gate-"));
  try {
    const environment = {
      CERTIFICATION_VERIFICATION_SCRIPT:
        "scripts/verify-release-certification.mjs"
    };
    assertStepFails(existsStep.run, root, environment, /not found/);
    mkdirSync(join(root, "scripts"));
    writeFileSync(
      join(root, "scripts", "verify-release-certification.mjs"),
      "process.exitCode = 1;\n"
    );
    // Existence only: the (failing) script is not executed.
    runStep(existsStep.run, root, environment);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("package.json repository.url must match the publishing repository in dry-run and release", () => {
  const steps = buildJob.steps.map((step) => step.name);
  const urlIndex = steps.indexOf("Verify package.json repository.url");
  assert.ok(urlIndex !== -1);
  assert.equal(buildJob.steps[urlIndex].if, undefined);
  assert.ok(urlIndex < steps.indexOf("Pack tarball"));
  assert.equal(
    buildJob.steps[urlIndex].env.GITHUB_REPOSITORY_SLUG,
    "${{ github.repository }}"
  );
});

test("repository.url normalization accepts each npm spelling of the same GitHub repository", () => {
  const expected = "https://github.com/yohn-jp/tsukai";
  for (const repository of [
    "https://github.com/yohn-jp/tsukai",
    "git+https://github.com/yohn-jp/tsukai.git",
    "https://github.com/yohn-jp/tsukai.git",
    "git@github.com:yohn-jp/tsukai.git",
    "github:yohn-jp/tsukai",
    { type: "git", url: "git+https://github.com/yohn-jp/tsukai.git" }
  ]) {
    assert.equal(normalizeRepositoryUrl(repository), expected);
    assert.ok(repositoryMatches(repository, "yohn-jp/tsukai"));
  }
  for (const repository of [
    undefined,
    "",
    {},
    { type: "git", url: "" },
    "git+https://github.com/yohn-jp/other.git",
    "git+https://example.com/yohn-jp/tsukai.git"
  ]) {
    assert.ok(!repositoryMatches(repository, "yohn-jp/tsukai"));
  }
});

test("repository.url step fails with the E422 cause when missing or mismatched", () => {
  const step = stepNamed("Verify package.json repository.url");
  const root = mkdtempSync(join(tmpdir(), "npm-publish-repo-url-"));
  try {
    const tools = join(root, "release-tools");
    mkdirSync(join(tools, "scripts"), { recursive: true });
    writeFileSync(
      join(tools, "scripts", "check-repository-url.mjs"),
      readFileSync("scripts/check-repository-url.mjs", "utf8")
    );
    const environment = {
      RUNNER_TEMP: root,
      GITHUB_REPOSITORY_SLUG: "yohn-jp/tsukai"
    };
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "x" }));
    assertStepFails(step.run, root, environment, /not set[\s\S]*E422/);
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ repository: { url: "git+https://github.com/a/b.git" } })
    );
    assertStepFails(step.run, root, environment, /does not match[\s\S]*E422/);
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ repository: "github:yohn-jp/tsukai" })
    );
    runStep(step.run, root, environment);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
