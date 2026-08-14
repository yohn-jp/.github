import test from "node:test";
import assert from "node:assert/strict";
import { releaseTagMatchesPackageVersion } from "../scripts/check-release-version.mjs";

test("v-prefixed tag matching the package version is accepted", () => {
  assert.equal(releaseTagMatchesPackageVersion("1.2.3", "v1.2.3"), true);
});

test("bare tag matching the package version is accepted", () => {
  assert.equal(releaseTagMatchesPackageVersion("1.2.3", "1.2.3"), true);
});

test("mismatched version is rejected", () => {
  assert.equal(releaseTagMatchesPackageVersion("1.2.3", "v1.2.4"), false);
});

test("only a leading v is stripped, not any other prefix", () => {
  assert.equal(releaseTagMatchesPackageVersion("2.0.0", "version-2.0.0"), false);
});
