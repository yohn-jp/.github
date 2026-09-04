import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";

const workflowPath = ".github/workflows/typescript-cli-ci.yml";
const workflowSource = readFileSync(workflowPath, "utf8");
const workflow = yaml.load(workflowSource);
const packInspectionStep = workflow.jobs["package-validate"].steps.find(
  (step) => step.name === "Pack and inspect tarball contents"
);

function createFixture({ includeDist }) {
  const fixturePath = mkdtempSync(path.join(os.tmpdir(), "typescript-cli-ci-"));
  writeFileSync(
    path.join(fixturePath, "package.json"),
    JSON.stringify({
      name: "typescript-cli-ci-tarball-fixture",
      version: "1.0.0",
      files: ["dist"]
    })
  );

  if (includeDist) {
    const distPath = path.join(fixturePath, "dist");
    mkdirSync(distPath);
    for (let i = 0; i < 4096; i += 1) {
      writeFileSync(path.join(distPath, `entry-${i}.js`), "export {};\n");
    }
  }

  return fixturePath;
}

function runPackInspection(fixturePath) {
  const githubEnvPath = path.join(fixturePath, "github-env");
  return execFileSync(
    "bash",
    ["-euo", "pipefail", "-c", packInspectionStep.run],
    {
      cwd: fixturePath,
      env: { ...process.env, GITHUB_ENV: githubEnvPath },
      maxBuffer: 2 * 1024 * 1024,
      encoding: "utf8"
    }
  );
}

test("pack inspection avoids piped grep short-circuiting", () => {
  assert.doesNotMatch(workflowSource, /echo "\$contents" \| grep/);
  assert.match(packInspectionStep.run, /grep -Eq '[^']*' <<< "\$contents"/);
});

test("pack inspection accepts a valid packed tarball containing dist/", () => {
  const fixturePath = createFixture({ includeDist: true });
  try {
    assert.doesNotThrow(() => runPackInspection(fixturePath));
  } finally {
    rmSync(fixturePath, { recursive: true, force: true });
  }
});

test("pack inspection fails when the packed tarball lacks dist/", () => {
  const fixturePath = createFixture({ includeDist: false });
  try {
    assert.throws(
      () => runPackInspection(fixturePath),
      /packed tarball does not contain dist\//
    );
  } finally {
    rmSync(fixturePath, { recursive: true, force: true });
  }
});
