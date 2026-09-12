import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import yaml from "js-yaml";

const workflowPath = ".github/workflows/gh-extension-release.yml";
const workflowSource = readFileSync(workflowPath, "utf8");
const workflow = yaml.load(workflowSource);
const releaseJob = workflow.jobs.release;

function stepNamed(name) {
  const step = releaseJob.steps.find((candidate) => candidate.name === name);
  assert.ok(step, "expected release workflow step " + name);
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

test("release artifacts are isolated from consumer build output", () => {
  const root = mkdtempSync(join(tmpdir(), "gh-extension-release-"));
  const workspace = join(root, "workspace");
  const runnerTemp = join(root, "runner-temp");
  const scripts = join(workspace, "scripts");
  mkdirSync(scripts, { recursive: true });
  mkdirSync(runnerTemp, { recursive: true });

  const buildStep = stepNamed("Run consumer build entrypoint");
  const verifyStep = stepNamed("Verify artifacts");
  const uploadStep = releaseJob.steps.find((candidate) =>
    candidate.name.startsWith("Upload assets to release")
  );
  assert.ok(uploadStep, "expected release upload step");

  const runnerTempExpression = "$" + "{{ runner.temp }}";
  const artifactExpressions = [
    buildStep.env?.ARTIFACT_DIR,
    verifyStep.env?.ARTIFACT_DIR,
    uploadStep.env?.ARTIFACT_DIR
  ];
  assert.deepEqual(
    artifactExpressions,
    artifactExpressions.map(
      () => runnerTempExpression + "/gh-extension-artifacts"
    )
  );
  assert.equal(releaseJob.env?.ARTIFACT_DIR, undefined);
  assert.match(verifyStep.run, /assets=\("\$ARTIFACT_DIR"\/\*\)/);
  assert.match(uploadStep.run, /"\$ARTIFACT_DIR"\/\*/);

  const artifactDir = artifactExpressions[0].replace(
    runnerTempExpression,
    runnerTemp
  );
  const workspaceDist = join(workspace, "dist");
  const entrypoint = join(scripts, "build-gh-extension-release.sh");
  writeFileSync(
    entrypoint,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'rm -rf -- "$PWD/dist"',
      'mkdir -p -- "$PWD/dist/chunks"',
      "printf '%s\\n' 'compiled TypeScript entrypoint' > \"$PWD/dist/index.js\"",
      "printf '%s\\n' 'compiled TypeScript chunk' > \"$PWD/dist/chunks/cli.js\"",
      "printf '%s\\n' 'precompiled release binary' > \"$ARTIFACT_DIR/fixture-linux-amd64\""
    ].join("\n") + "\n"
  );
  chmodSync(entrypoint, 0o755);
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(join(artifactDir, "stale-from-previous-attempt"), "stale");

  try {
    runStep(buildStep.run, workspace, {
      ARTIFACT_DIR: artifactDir,
      WORKING_DIRECTORY: "."
    });

    assert.notEqual(resolve(artifactDir), resolve(workspaceDist));
    assert.deepEqual(readdirSync(workspaceDist).sort(), ["chunks", "index.js"]);
    assert.deepEqual(readdirSync(artifactDir), ["fixture-linux-amd64"]);

    const commonVerifyEnvironment = {
      EXTENSION_NAME: "fixture",
      GITHUB_REPOSITORY: "example/fixture"
    };
    assertStepFails(
      verifyStep.run,
      workspace,
      { ...commonVerifyEnvironment, ARTIFACT_DIR: workspaceDist },
      /does not match/
    );
    runStep(verifyStep.run, workspace, {
      ...commonVerifyEnvironment,
      ARTIFACT_DIR: artifactDir
    });

    const unexpectedFile = join(artifactDir, "README.md");
    writeFileSync(unexpectedFile, "not a release asset");
    assertStepFails(
      verifyStep.run,
      workspace,
      { ...commonVerifyEnvironment, ARTIFACT_DIR: artifactDir },
      /README\.md.*does not match/
    );
    rmSync(unexpectedFile);

    const fakeBin = join(root, "bin");
    const argsFile = join(root, "gh-args");
    mkdirSync(fakeBin);
    const fakeGh = join(fakeBin, "gh");
    writeFileSync(
      fakeGh,
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        'printf \'%s\\n\' "$@" > "$GH_ARGS_FILE"'
      ].join("\n") + "\n"
    );
    chmodSync(fakeGh, 0o755);
    runStep(uploadStep.run, workspace, {
      ARTIFACT_DIR: artifactDir,
      GH_ARGS_FILE: argsFile,
      GH_TOKEN: "test-token",
      GITHUB_REPOSITORY: "example/fixture",
      PATH: fakeBin + ":" + (process.env.PATH ?? ""),
      RELEASE_TAG: "v0.1.0"
    });

    const uploadArgs = readFileSync(argsFile, "utf8").trimEnd().split("\n");
    const separator = uploadArgs.indexOf("--");
    assert.notEqual(separator, -1);
    assert.deepEqual(uploadArgs.slice(separator + 1), [
      join(artifactDir, "fixture-linux-amd64")
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("release certification gate is optional, fails closed, and runs before the build entrypoint", () => {
  const verifyStep = stepNamed("Verify release certification");
  assert.equal(verifyStep.if, "inputs.certification-verification-script != ''");
  assert.equal(
    workflow.on.workflow_call.inputs["certification-verification-script"]
      .default,
    ""
  );

  const gatedStepNames = [
    "Checkout release tooling (yohn-jp/.github)",
    "Setup Node.js and pnpm for release certification",
    "Isolate release tooling",
    "Verify release certification"
  ];
  for (const name of gatedStepNames) {
    const step = stepNamed(name);
    assert.equal(
      step.if,
      "inputs.certification-verification-script != ''",
      name + " must be gated by the same input"
    );
  }

  const isolateStep = stepNamed("Isolate release tooling");
  assert.match(
    isolateStep.run,
    /mv \.release-tools "\$RUNNER_TEMP\/release-tools"/
  );

  const restoreStep = stepNamed("Restore release tooling for action cleanup");
  assert.equal(
    restoreStep.if,
    "always() && inputs.certification-verification-script != ''"
  );
  assert.match(
    restoreStep.run,
    /mv "\$RUNNER_TEMP\/release-tools" \.release-tools/
  );

  const verifyIndex = releaseJob.steps.findIndex(
    (step) => step.name === "Verify release certification"
  );
  const buildIndex = releaseJob.steps.findIndex(
    (step) => step.name === "Run consumer build entrypoint"
  );
  assert.ok(verifyIndex !== -1 && buildIndex !== -1);
  assert.ok(verifyIndex < buildIndex);

  const root = mkdtempSync(join(tmpdir(), "gh-extension-certification-"));
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

    const tsxDir = join(root, "node_modules", "tsx");
    mkdirSync(tsxDir, { recursive: true });
    writeFileSync(
      join(tsxDir, "package.json"),
      JSON.stringify({ name: "tsx", version: "0.0.0", exports: "./index.mjs" })
    );
    writeFileSync(join(tsxDir, "index.mjs"), "");

    const scripts = join(root, "scripts");
    mkdirSync(scripts, { recursive: true });
    const script = join(scripts, "verify-release-certification.mjs");
    writeFileSync(script, "process.exitCode = 1;\n");
    assertStepFails(
      verifyStep.run,
      root,
      {
        CERTIFICATION_VERIFICATION_SCRIPT:
          "scripts/verify-release-certification.mjs"
      },
      /.*/
    );

    writeFileSync(script, "process.exitCode = 0;\n");
    runStep(verifyStep.run, root, {
      CERTIFICATION_VERIFICATION_SCRIPT:
        "scripts/verify-release-certification.mjs"
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
