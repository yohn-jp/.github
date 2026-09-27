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
import {
  createPackageArtifact,
  verifyPackageArtifact
} from "../scripts/ci-package-artifact.mjs";

const sourceSha = "a".repeat(40);

function makeArchive({ includeDist = true, includeSource = false } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "ci-package-artifact-"));
  const packageRoot = path.join(root, "package");
  mkdirSync(packageRoot);
  if (includeDist) {
    mkdirSync(path.join(packageRoot, "dist"));
    writeFileSync(path.join(packageRoot, "dist", "index.js"), "export {};\n");
  }
  if (includeSource) {
    mkdirSync(path.join(packageRoot, "src"));
    writeFileSync(path.join(packageRoot, "src", "index.ts"), "export {};\n");
  }
  writeFileSync(path.join(packageRoot, "package.json"), '{"name":"fixture"}\n');
  const archivePath = path.join(root, "fixture.tgz");
  execFileSync("tar", ["-czf", archivePath, "-C", root, "package"]);
  return { root, archivePath, artifactDirectory: path.join(root, "artifact") };
}

test("created package artifact preserves verified archive bytes and revision", () => {
  const fixture = makeArchive();
  try {
    const before = readFileSync(fixture.archivePath);
    const manifest = createPackageArtifact({
      archivePath: fixture.archivePath,
      artifactDirectory: fixture.artifactDirectory,
      sourceSha
    });
    const verified = verifyPackageArtifact({
      artifactDirectory: fixture.artifactDirectory,
      expectedSha: sourceSha
    });

    assert.equal(manifest.sourceSha, sourceSha);
    assert.equal(verified.sourceSha, sourceSha);
    assert.equal(readFileSync(verified.archivePath).equals(before), true);
    assert.equal(verified.sha256, manifest.sha256);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("package artifact rejects a stale source revision", () => {
  const fixture = makeArchive();
  try {
    createPackageArtifact({
      archivePath: fixture.archivePath,
      artifactDirectory: fixture.artifactDirectory,
      sourceSha
    });

    assert.throws(
      () =>
        verifyPackageArtifact({
          artifactDirectory: fixture.artifactDirectory,
          expectedSha: "b".repeat(40)
        }),
      /manifest does not match this revision/
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("package artifact rejects bytes changed after preparation", () => {
  const fixture = makeArchive();
  try {
    createPackageArtifact({
      archivePath: fixture.archivePath,
      artifactDirectory: fixture.artifactDirectory,
      sourceSha
    });
    writeFileSync(
      path.join(fixture.artifactDirectory, "package.tgz"),
      "changed bytes\n"
    );

    assert.throws(
      () =>
        verifyPackageArtifact({
          artifactDirectory: fixture.artifactDirectory,
          expectedSha: sourceSha
        }),
      /bytes do not match their SHA-256/
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("package artifact rejects missing build output and source files", () => {
  const missingDist = makeArchive({ includeDist: false });
  try {
    assert.throws(
      () =>
        createPackageArtifact({
          archivePath: missingDist.archivePath,
          artifactDirectory: missingDist.artifactDirectory,
          sourceSha
        }),
      /does not contain dist/
    );
  } finally {
    rmSync(missingDist.root, { recursive: true, force: true });
  }

  const includedSource = makeArchive({ includeSource: true });
  try {
    assert.throws(
      () =>
        createPackageArtifact({
          archivePath: includedSource.archivePath,
          artifactDirectory: includedSource.artifactDirectory,
          sourceSha
        }),
      /unexpectedly contains files matching package\/src/
    );
  } finally {
    rmSync(includedSource.root, { recursive: true, force: true });
  }
});

test("package artifact rejects unexpected files", () => {
  const fixture = makeArchive();
  try {
    createPackageArtifact({
      archivePath: fixture.archivePath,
      artifactDirectory: fixture.artifactDirectory,
      sourceSha
    });
    writeFileSync(path.join(fixture.artifactDirectory, "extra.tgz"), "extra");

    assert.throws(
      () =>
        verifyPackageArtifact({
          artifactDirectory: fixture.artifactDirectory,
          expectedSha: sourceSha
        }),
      /must contain only package\.tgz and manifest\.json/
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
