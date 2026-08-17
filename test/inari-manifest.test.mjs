import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildInariManifest,
  validateInariManifest
} from "../scripts/generate-inari-manifest.mjs";

test("canonical Inari manifest matches the exact contract snapshot", async () => {
  const expected = await buildInariManifest(process.cwd());
  const actual = JSON.parse(
    await readFile(".github/inari/manifest.json", "utf8")
  );
  assert.deepEqual(actual, expected);
  assert.deepEqual(await validateInariManifest(process.cwd()), []);
});

test("changing a contract changes its manifest revision and file digest", async () => {
  const root = await mkdtemp(join(tmpdir(), "inari-manifest-"));
  try {
    await mkdir(join(root, ".github", "inari", "issues"), { recursive: true });
    await mkdir(join(root, ".github", "inari", "pull-requests"), {
      recursive: true
    });
    await writeFile(
      join(root, ".github", "inari", "issues", "bug.json"),
      '{"id":"bug"}\n'
    );
    await writeFile(
      join(root, ".github", "inari", "pull-requests", "default.json"),
      '{"id":"default"}\n'
    );

    const before = await buildInariManifest(root);
    await writeFile(
      join(root, ".github", "inari", "pull-requests", "default.json"),
      '{"id":"changed"}\n'
    );
    const after = await buildInariManifest(root);

    assert.notEqual(after.revision, before.revision);
    assert.notEqual(after.files[1].sha256, before.files[1].sha256);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a stale snapshot manifest fails validation", async () => {
  const root = await mkdtemp(join(tmpdir(), "inari-manifest-stale-"));
  try {
    await mkdir(join(root, ".github", "inari", "issues"), { recursive: true });
    await mkdir(join(root, ".github", "inari", "pull-requests"), {
      recursive: true
    });
    await writeFile(
      join(root, ".github", "inari", "issues", "bug.json"),
      '{"id":"bug"}\n'
    );
    await writeFile(
      join(root, ".github", "inari", "pull-requests", "default.json"),
      '{"id":"default"}\n'
    );
    const manifest = await buildInariManifest(root);
    await writeFile(
      join(root, ".github", "inari", "manifest.json"),
      JSON.stringify(manifest)
    );
    assert.deepEqual(await validateInariManifest(root), []);

    await writeFile(
      join(root, ".github", "inari", "manifest.json"),
      JSON.stringify({ ...manifest, revision: "sha256:stale" })
    );
    assert.equal((await validateInariManifest(root)).length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
