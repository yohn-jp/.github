import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { load } from "js-yaml";
import { INARI_GOVERNANCE_RUNTIME_VERSION } from "../scripts/inari-governance.mjs";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const lockfile = load(await readFile("pnpm-lock.yaml", "utf8"));
const inariVersion = packageJson.dependencies["gh-inari"];

test("frozen Inari runtime is an exact published version shared with its lock", () => {
  assert.match(inariVersion, /^\d+\.\d+\.\d+$/);
  assert.equal(
    lockfile.importers["."].dependencies["gh-inari"].specifier,
    inariVersion
  );
  assert.equal(
    lockfile.importers["."].dependencies["gh-inari"].version.split("(")[0],
    inariVersion
  );
  assert.ok(lockfile.packages[`gh-inari@${inariVersion}`]);
  assert.equal(INARI_GOVERNANCE_RUNTIME_VERSION, inariVersion);
  assert.equal(
    execFileSync(process.execPath, ["scripts/resolve-inari-version.mjs"], {
      encoding: "utf8"
    }).trim(),
    inariVersion
  );
});

test("all published Inari installers resolve the manifest's reviewed pin", async () => {
  const workflowDirectory = ".github/workflows";
  const workflows = await Promise.all(
    (await readdir(workflowDirectory))
      .filter((fileName) => fileName.endsWith(".yml"))
      .map(async (fileName) => [
        fileName,
        await readFile(`${workflowDirectory}/${fileName}`, "utf8")
      ])
  );
  const sources = new Map(workflows);

  for (const [fileName, source] of workflows) {
    assert.doesNotMatch(
      source,
      /gh-inari@latest/,
      `${fileName} must not resolve an independent moving latest version`
    );
  }

  for (const fileName of [
    "inari-canon.yml",
    "pr-governance.yml",
    "issue-governance.yml",
    "metadata-validation.yml"
  ]) {
    assert.match(
      sources.get(fileName) ?? "",
      /resolve-inari-version\.mjs/,
      `${fileName} must install the version declared by package.json`
    );
  }

  assert.match(
    sources.get("dashboard-pages.yml") ?? "",
    /pnpm install --frozen-lockfile/,
    "Portal collection must continue to use the exact lockfile resolution"
  );
});
