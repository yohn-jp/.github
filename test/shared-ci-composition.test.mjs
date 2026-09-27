import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";

const fixtureRoot = "test/fixtures/shared-ci-composition";
const loadFixture = (name) =>
  yaml.load(readFileSync(fixtureRoot + "/" + name, "utf8"));

test("standard consumers keep the unconfigured shared CI contract", () => {
  const fixture = loadFixture("standard-consumer.yml");

  assert.equal(
    fixture.jobs.ci.uses,
    "yohn-jp/.github/.github/workflows/typescript-cli-ci.yml@main"
  );
  assert.equal(fixture.jobs.ci.with, undefined);
});

test("product conformance can reuse the exact provider package artifact", () => {
  const fixture = loadFixture("product-conformance-consumer.yml");

  assert.equal(
    fixture.jobs.ci.uses,
    "yohn-jp/.github/.github/workflows/typescript-cli-ci.yml@main"
  );
  assert.equal(
    fixture.jobs.ci.with["package-preparation-command"],
    "pnpm pack"
  );
  assert.deepEqual(fixture.jobs["product-conformance"].needs, "ci");
  const download = fixture.jobs["product-conformance"].steps.find((step) =>
    step.uses?.startsWith("actions/download-artifact@")
  );
  assert.equal(
    download.with.name,
    "$" + "{{ needs.ci.outputs.package-artifact-name }}"
  );
  assert.match(
    fixture.jobs["product-conformance"].steps[2].env.PACKAGE_TARBALL,
    /package-artifact\/package\.tgz$/
  );
});

test("delegated system proof stays consumer-owned and independently composed", () => {
  const fixture = loadFixture("delegated-system-consumer.yml");

  assert.equal(
    fixture.jobs.ci.uses,
    "yohn-jp/.github/.github/workflows/typescript-cli-ci.yml@main"
  );
  assert.equal(
    fixture.jobs["linux-system-e2e"].uses,
    "yohn-jp/.github/.github/workflows/linux-system-e2e.yml@main"
  );
  assert.equal(
    fixture.jobs["linux-system-e2e"].with.command,
    "pnpm run test:system"
  );
  assert.equal(fixture.jobs["linux-system-e2e"].needs, undefined);
});
