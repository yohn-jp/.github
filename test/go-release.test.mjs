import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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

const workflowPath = ".github/workflows/go-release.yml";
const workflow = yaml.load(readFileSync(workflowPath, "utf8"));
const buildJob = workflow.jobs.build;
const publishJob = workflow.jobs.publish;

function stepNamed(job, name) {
  const step = job.steps.find((candidate) => candidate.name === name);
  assert.ok(step, "expected workflow step " + name);
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

test("Go release exposes only the explicit build inputs", () => {
  const inputs = workflow.on.workflow_call.inputs;
  assert.deepEqual(Object.keys(inputs).sort(), [
    "binary-name",
    "build-target",
    "working-directory"
  ]);
  assert.equal(inputs["binary-name"].required, true);
  assert.equal(inputs["build-target"].required, true);
  assert.equal(inputs["working-directory"].default, ".");
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.deepEqual(buildJob.permissions, {
    actions: "read",
    contents: "read"
  });
  assert.deepEqual(publishJob.permissions, {
    actions: "read",
    contents: "write"
  });
  assert.deepEqual(publishJob.needs, "build");
});

test("the provider tests and builds one exact Linux amd64 artifact", () => {
  const checkout = stepNamed(buildJob, "Checkout exact triggering commit");
  assert.equal(checkout.with.ref, "${{ github.sha }}");
  assert.equal(checkout.with["persist-credentials"], false);

  const setupGo = stepNamed(buildJob, "Set up Go from go.mod");
  assert.equal(
    setupGo.with["go-version-file"],
    "${{ inputs.working-directory }}/go.mod"
  );

  assert.equal(stepNamed(buildJob, "Run Go tests").run, "go test ./...");
  assert.equal(stepNamed(buildJob, "Run Go vet").run, "go vet ./...");
  const build = stepNamed(buildJob, "Build Linux amd64 binary");
  assert.match(build.run, /CGO_ENABLED=0 GOOS=linux GOARCH=amd64/);
  assert.match(build.run, /go build -o/);

  const verify = stepNamed(buildJob, "Verify binary and record SHA-256");
  assert.match(verify.run, /\[ ! -s "\$binary" \]/);
  assert.match(verify.run, /\[ ! -x "\$binary" \]/);
  assert.match(verify.run, /sha256sum/);
  assert.equal(buildJob.outputs.sha256, "${{ steps.verify.outputs.sha256 }}");

  const upload = stepNamed(buildJob, "Upload verified build bytes");
  assert.equal(upload.with.path, "${{ runner.temp }}/go-development-release/");
  assert.equal(upload.with["if-no-files-found"], "error");
});

test("input validation keeps the binary name to one filename", () => {
  const validate = stepNamed(buildJob, "Validate reusable inputs");
  const root = mkdtempSync(join(tmpdir(), "go-development-inputs-"));
  try {
    const outputPath = join(root, "github-output");
    writeFileSync(outputPath, "");
    runStep(validate.run, root, {
      BINARY_NAME: "fixture name",
      BUILD_TARGET: ".",
      GITHUB_OUTPUT: outputPath
    });
    assert.equal(
      readFileSync(outputPath, "utf8"),
      "binary_filename=fixture name-linux-amd64\n"
    );

    for (const binaryName of [
      "../escape",
      "fixture\\name",
      "fixture\nsha256=forged"
    ]) {
      assertStepFails(
        validate.run,
        root,
        {
          BINARY_NAME: binaryName,
          BUILD_TARGET: ".",
          GITHUB_OUTPUT: outputPath
        },
        /binary-name must be a single filename/
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("artifact verification requires a non-empty executable and records its digest", () => {
  const verify = stepNamed(buildJob, "Verify binary and record SHA-256");
  const root = mkdtempSync(join(tmpdir(), "go-development-artifact-"));
  try {
    const artifactDirectory = join(root, "artifacts");
    mkdirSync(artifactDirectory, { recursive: true });
    const binaryFilename = "fixture-linux-amd64";
    const binaryPath = join(artifactDirectory, binaryFilename);
    const outputPath = join(root, "github-output");
    const bytes = Buffer.from("verified executable bytes\n");
    const expectedSha = createHash("sha256").update(bytes).digest("hex");
    writeFileSync(binaryPath, bytes);
    chmodSync(binaryPath, 0o755);
    writeFileSync(outputPath, "");

    runStep(verify.run, root, {
      ARTIFACT_DIRECTORY: artifactDirectory,
      BINARY_FILENAME: binaryFilename,
      GITHUB_OUTPUT: outputPath
    });
    assert.deepEqual(readFileSync(outputPath, "utf8").trimEnd().split("\n"), [
      `binary_filename=${binaryFilename}`,
      `sha256=${expectedSha}`
    ]);
    assert.equal(
      readFileSync(join(artifactDirectory, `${binaryFilename}.sha256`), "utf8"),
      `${expectedSha}  ${binaryFilename}\n`
    );

    chmodSync(binaryPath, 0o644);
    assertStepFails(
      verify.run,
      root,
      {
        ARTIFACT_DIRECTORY: artifactDirectory,
        BINARY_FILENAME: binaryFilename,
        GITHUB_OUTPUT: outputPath
      },
      /non-empty executable regular file/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("publication verifies the transferred bytes and serializes per repository", () => {
  assert.deepEqual(publishJob.concurrency, {
    group: "go-development-release-${{ github.repository }}",
    "cancel-in-progress": false
  });

  const download = stepNamed(publishJob, "Download verified build bytes");
  assert.equal(
    download.with.name,
    "go-development-release-${{ github.run_id }}-${{ github.run_attempt }}"
  );
  const verify = stepNamed(publishJob, "Verify downloaded build bytes");
  assert.match(verify.run, /\$EXPECTED_SHA256/);
  assert.match(
    verify.run,
    /downloaded binary differs from the verified build bytes/
  );

  const release = stepNamed(publishJob, "Publish dev-N prerelease");
  assert.equal(
    release.if,
    "github.event_name == 'push' && github.ref == 'refs/heads/main'"
  );
  assert.equal(release.env.GH_TOKEN, "${{ github.token }}");
  for (const job of Object.values(workflow.jobs)) {
    for (const step of job.steps ?? []) {
      if (step === release) continue;
      assert.notEqual(step.env?.GH_TOKEN, "${{ github.token }}");
    }
  }
  assert.match(release.run, /git\/matching-refs\/tags\/dev-/);
  assert.match(release.run, /\^refs\/tags\/dev-\(\[0-9\]\+\)\$/);
  assert.match(release.run, /gh release create "\$release_tag"/);
  assert.match(release.run, /--target "\$RELEASE_SHA"/);
  assert.match(release.run, /--prerelease/);
  assert.match(release.run, /--latest=false/);
  assert.doesNotMatch(release.run, /refs\/tags\/v|--latest(?:\s|$)/);
});

test("release allocation ignores stable and non-numeric dev tags", () => {
  const release = stepNamed(publishJob, "Publish dev-N prerelease");
  const root = mkdtempSync(join(tmpdir(), "go-development-release-"));
  try {
    const artifactDirectory = join(root, "artifacts");
    const fakeBin = join(root, "bin");
    mkdirSync(artifactDirectory, { recursive: true });
    mkdirSync(fakeBin, { recursive: true });

    const binaryFilename = "fixture-linux-amd64";
    const binaryPath = join(artifactDirectory, binaryFilename);
    const checksumPath = binaryPath + ".sha256";
    const binaryBytes = Buffer.from("verified Linux amd64 bytes\n");
    const sha256 = createHash("sha256").update(binaryBytes).digest("hex");
    writeFileSync(binaryPath, binaryBytes);
    writeFileSync(checksumPath, `${sha256}  ${binaryFilename}\n`);

    const refsFile = join(root, "refs");
    writeFileSync(
      refsFile,
      [
        "refs/tags/dev-1",
        "refs/tags/dev-003",
        "refs/tags/dev-12",
        "refs/tags/dev-label",
        "refs/tags/dev-13/metadata",
        "refs/tags/v99.0.0"
      ].join("\n") + "\n"
    );
    const releaseArgsFile = join(root, "release-args");
    const fakeGh = join(fakeBin, "gh");
    writeFileSync(
      fakeGh,
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        'if [ "${1:-}" = "api" ]; then',
        '  cat "$GH_REFS_FILE"',
        'elif [ "${1:-}" = "release" ]; then',
        "  shift",
        '  printf \'%s\\n\' "$@" > "$GH_RELEASE_ARGS_FILE"',
        "else",
        '  echo "unexpected gh command: $*" >&2',
        "  exit 1",
        "fi"
      ].join("\n") + "\n"
    );
    chmodSync(fakeGh, 0o755);

    runStep(release.run, root, {
      ARTIFACT_DIRECTORY: artifactDirectory,
      BINARY_FILENAME: binaryFilename,
      EXPECTED_SHA256: sha256,
      GH_REPOSITORY: "example/fixture",
      GH_REFS_FILE: refsFile,
      GH_RELEASE_ARGS_FILE: releaseArgsFile,
      GH_TOKEN: "test-token",
      PATH: fakeBin + ":" + (process.env.PATH ?? ""),
      RELEASE_SHA: "0123456789abcdef0123456789abcdef01234567",
      RUNNER_TEMP: root
    });

    const args = readFileSync(releaseArgsFile, "utf8").trimEnd().split("\n");
    assert.equal(args[0], "create");
    assert.equal(args[1], "dev-13");
    assert.deepEqual(args.slice(2, 4), [binaryPath, checksumPath]);
    assert.ok(args.includes("--prerelease"));
    assert.ok(args.includes("--latest=false"));
    assert.ok(args.includes("0123456789abcdef0123456789abcdef01234567"));
    assert.equal(readFileSync(binaryPath).toString(), binaryBytes.toString());
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("release refuses bytes that no longer match the verified SHA-256", () => {
  const release = stepNamed(publishJob, "Publish dev-N prerelease");
  const root = mkdtempSync(join(tmpdir(), "go-development-release-mismatch-"));
  try {
    const artifactDirectory = join(root, "artifacts");
    const fakeBin = join(root, "bin");
    mkdirSync(artifactDirectory, { recursive: true });
    mkdirSync(fakeBin, { recursive: true });
    const binaryFilename = "fixture-linux-amd64";
    const binaryPath = join(artifactDirectory, binaryFilename);
    writeFileSync(binaryPath, "changed bytes\n");
    writeFileSync(
      binaryPath + ".sha256",
      `0000000000000000000000000000000000000000000000000000000000000000  ${binaryFilename}\n`
    );
    const fakeGh = join(fakeBin, "gh");
    const calledFile = join(root, "gh-called");
    writeFileSync(
      fakeGh,
      '#!/usr/bin/env bash\nprintf called > "$GH_CALLED_FILE"\n'
    );
    chmodSync(fakeGh, 0o755);

    assertStepFails(
      release.run,
      root,
      {
        ARTIFACT_DIRECTORY: artifactDirectory,
        BINARY_FILENAME: binaryFilename,
        EXPECTED_SHA256:
          "0000000000000000000000000000000000000000000000000000000000000000",
        GH_CALLED_FILE: calledFile,
        GH_REPOSITORY: "example/fixture",
        GH_TOKEN: "test-token",
        PATH: fakeBin + ":" + (process.env.PATH ?? ""),
        RELEASE_SHA: "0123456789abcdef0123456789abcdef01234567",
        RUNNER_TEMP: root
      },
      /binary changed after verification/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
