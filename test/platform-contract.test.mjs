import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import yaml from "js-yaml";

test("organization CI platform contract is explicit and narrow", () => {
  const contract = yaml.load(fs.readFileSync(".github/platform-contract.yml", "utf8"));
  assert.equal(contract.architecture, "x86_64");
  assert.equal(contract.linux.canonical_runner, "ubuntu-24.04");
  assert.deepEqual(contract.linux.supported_distributions, ["ubuntu-24.04", "nixos"]);
  assert.equal(contract.linux.init, "systemd");
  assert.equal(contract.linux.cgroups, "v2");
  assert.equal(contract.runtime.node, "24");
  assert.equal(contract.runtime.nix, "required");
  assert.deepEqual(contract.unsupported, ["windows", "macos"]);
  assert.equal(contract.policy.reusable_workflows_ref, "@main");
  assert.equal(contract.policy.product_verification_owner, "consumer");
});

test("shared TypeScript CI uses the canonical runner and runtime action", () => {
  const workflow = fs.readFileSync(".github/workflows/typescript-cli-ci.yml", "utf8");
  assert.equal(workflow.includes("ubuntu-latest"), false);
  assert.equal(workflow.includes("runs-on: ubuntu-24.04"), true);
  assert.equal(workflow.includes(".github/actions/setup-runtime"), true);
});
