// Imports from dist/ rather than src/ because this fixture enables the
// committed-dist capability, so dist/ is committed to git and present in
// every CI job's checkout independent of the build job's own artifact.
import test from "node:test";
import assert from "node:assert/strict";
import { version } from "../dist/version.js";
import pkg from "../package.json" with { type: "json" };

test("built version export matches package.json version", () => {
  assert.equal(version, pkg.version);
});
