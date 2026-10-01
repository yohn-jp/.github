import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";

const workflowPath = ".github/workflows/go-windows-release.yml";
const workflow = yaml.load(readFileSync(workflowPath, "utf8"));
const publishJob = workflow.jobs.publish;
const releaseStepName = "Publish SemVer development prerelease";
const releaseSha = "0123456789abcdef0123456789abcdef01234567";

function stepNamed(job, name) {
  const step = job.steps.find((candidate) => candidate.name === name);
  assert.ok(step, "expected workflow step " + name);
  return step;
}

function allocate(refs, developmentLine = "0.1") {
  const release = stepNamed(publishJob, releaseStepName);
  const root = mkdtempSync(join(tmpdir(), "go-windows-release-"));
  try {
    const artifactDirectory = join(root, "artifacts");
    const fakeBin = join(root, "bin");
    mkdirSync(artifactDirectory, { recursive: true });
    mkdirSync(fakeBin, { recursive: true });
    const binaryFilename = "fixture-windows-amd64.exe";
    const binaryPath = join(artifactDirectory, binaryFilename);
    const bytes = Buffer.from("verified Windows amd64 bytes\n");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    writeFileSync(binaryPath, bytes);
    writeFileSync(binaryPath + ".sha256", `${sha256}  ${binaryFilename}\n`);

    const refsFile = join(root, "refs");
    writeFileSync(refsFile, refs.map((ref) => ref + "\n").join(""));
    const apiArgsFile = join(root, "api-args");
    const releaseArgsFile = join(root, "release-args");
    writeFileSync(
      join(fakeBin, "gh"),
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        'if [ "${1:-}" = "api" ]; then',
        '  printf \'%s\\n\' "$@" > "$GH_API_ARGS_FILE"',
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
    chmodSync(join(fakeBin, "gh"), 0o755);

    let error;
    try {
      execFileSync("bash", ["-euo", "pipefail", "-c", release.run], {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          ARTIFACT_DIRECTORY: artifactDirectory,
          BINARY_FILENAME: binaryFilename,
          DEVELOPMENT_LINE: developmentLine,
          EXPECTED_SHA256: sha256,
          GH_API_ARGS_FILE: apiArgsFile,
          GH_REFS_FILE: refsFile,
          GH_RELEASE_ARGS_FILE: releaseArgsFile,
          GH_REPOSITORY: "example/fixture",
          GH_TOKEN: "test-token",
          PATH: fakeBin + ":" + (process.env.PATH ?? ""),
          RELEASE_SHA: releaseSha,
          RUNNER_TEMP: root
        },
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (caught) {
      error = String(caught.stderr ?? "") + String(caught.stdout ?? "");
    }
    const read = (path) =>
      existsSync(path) ? readFileSync(path, "utf8").trimEnd().split("\n") : [];
    return {
      error,
      api: read(apiArgsFile),
      release: read(releaseArgsFile)
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function allocatedTag(refs, developmentLine) {
  const result = allocate(refs, developmentLine);
  assert.equal(result.error, undefined);
  assert.equal(result.release[0], "create");
  return result.release[1];
}

test("development line input is optional and defaults to 0.1", () => {
  const inputs = workflow.on.workflow_call.inputs;
  assert.deepEqual(Object.keys(inputs).sort(), [
    "binary-name",
    "build-target",
    "development-line",
    "working-directory"
  ]);
  assert.equal(inputs["development-line"].default, "0.1");
  assert.notEqual(inputs["development-line"].required, true);
  assert.equal(
    stepNamed(publishJob, releaseStepName).env.DEVELOPMENT_LINE,
    "${{ inputs.development-line }}"
  );
});

test("publication stays serialized, main-only, prerelease, and not latest", () => {
  assert.deepEqual(publishJob.concurrency, {
    group: "go-windows-development-release-${{ github.repository }}",
    "cancel-in-progress": false
  });
  const release = stepNamed(publishJob, releaseStepName);
  assert.equal(
    release.if,
    "github.event_name == 'push' && github.ref == 'refs/heads/main'"
  );
  const result = allocate([]);
  assert.deepEqual(result.api.slice(0, 3), [
    "api",
    "--paginate",
    "repos/example/fixture/git/matching-refs/tags/0.1."
  ]);
  assert.ok(result.release.includes("--prerelease"));
  assert.ok(result.release.includes("--latest=false"));
  const target = result.release.indexOf("--target");
  assert.equal(result.release[target + 1], releaseSha);
});

test("empty new-format history starts at patch 1", () => {
  assert.equal(allocatedTag([]), "0.1.1-dev");
});

test("sequential development tags advance numerically", () => {
  assert.equal(
    allocatedTag(["refs/tags/0.1.1-dev", "refs/tags/0.1.2-dev"]),
    "0.1.3-dev"
  );
  assert.equal(
    allocatedTag([
      "refs/tags/0.1.10-dev",
      "refs/tags/0.1.9-dev",
      "refs/tags/0.1.2-dev"
    ]),
    "0.1.11-dev"
  );
});

test("legacy dev-N history is ignored", () => {
  const legacy = Array.from({ length: 23 }, (_, i) => `refs/tags/dev-${i + 1}`);
  assert.equal(allocatedTag(legacy), "0.1.1-dev");
});

test("malformed and unrelated tags are ignored", () => {
  assert.equal(
    allocatedTag([
      "refs/tags/v1.0.0",
      "refs/tags/test-1",
      "refs/tags/0.1.07-dev",
      "refs/tags/0.1.40-devel",
      "refs/tags/0.1.50-dev/x",
      "refs/tags/0.10.90-dev",
      "refs/tags/0.1.x-dev",
      "refs/tags/0.1.3-dev"
    ]),
    "0.1.4-dev"
  );
});

test("an existing tag at the candidate patch is skipped, never reused", () => {
  assert.equal(
    allocatedTag(["refs/tags/0.1.9-dev", "refs/tags/0.1.10"]),
    "0.1.11-dev"
  );
  assert.equal(
    allocatedTag([
      "refs/tags/0.1.1-dev",
      "refs/tags/0.1.2",
      "refs/tags/0.1.3-rc.1",
      "refs/tags/0.1.4+build"
    ]),
    "0.1.5-dev"
  );
});

test("selected development line filters other lines", () => {
  assert.equal(
    allocatedTag(
      ["refs/tags/0.1.30-dev", "refs/tags/1.2.4-dev", "refs/tags/1.20.9-dev"],
      "1.2"
    ),
    "1.2.5-dev"
  );
});

test("malformed development lines fail before any GitHub call", () => {
  for (const line of [
    "",
    "0",
    "0.1.2",
    "01.1",
    "0.01",
    "v0.1",
    "0.1-dev",
    "0.*"
  ]) {
    const result = allocate([], line);
    assert.match(result.error ?? "", /development-line must be MAJOR\.MINOR/);
    assert.deepEqual(result.api, []);
    assert.deepEqual(result.release, []);
  }
});
