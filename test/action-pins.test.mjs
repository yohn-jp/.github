import test from "node:test";
import assert from "node:assert/strict";
import { validateActionPinsFile } from "../scripts/validate-action-pins.mjs";

test("SHA-pinned third-party, @main organization, local, and digest-pinned refs all pass", () => {
  const errors = validateActionPinsFile("test/fixtures/workflows/valid-pins.yml");
  assert.deepEqual(errors, []);
});

test("tag refs, branch refs, missing refs, and unpinned docker images are all rejected", () => {
  const errors = validateActionPinsFile("test/fixtures/workflows/invalid-pins.yml");
  assert.equal(errors.length, 4, JSON.stringify(errors, null, 2));
  assert.ok(errors.some((e) => e.includes("actions/checkout@v4")));
  assert.ok(errors.some((e) => e.includes("actions/setup-node@main")));
  assert.ok(errors.some((e) => e.includes("some/action-without-ref")));
  assert.ok(errors.some((e) => e.includes("docker://alpine:latest")));
});

test("organization-owned reusable workflows reject SHA and non-main refs", () => {
  const errors = validateActionPinsFile("test/fixtures/workflows/invalid-org-workflow-ref.yml");
  assert.equal(errors.length, 2, JSON.stringify(errors, null, 2));
  assert.ok(errors.every((error) => error.includes("must use @main")));
});
