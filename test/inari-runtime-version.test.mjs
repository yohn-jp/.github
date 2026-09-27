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

// Two intentionally separate Inari version authorities exist, for separate
// purposes; they are not version drift:
//
// - Governance/conformance execution runs the reviewed exact pin declared in
//   package.json (and locked in pnpm-lock.yaml), resolved through
//   scripts/resolve-inari-version.mjs, so a frozen install never silently runs
//   a different Inari generation from these surfaces (Issue #295).
// - Release preparation (npm-release-prepare.yml, #306) deliberately resolves
//   the current published gh-inari, floors it at the release-preparation
//   minimum, installs that exact resolved version, and records its version,
//   tarball, and integrity as per-run evidence.
//
// Every workflow that resolves or installs gh-inari must be classified into
// exactly one authority below.
const GOVERNANCE_PIN_INSTALLERS = [
  "inari-canon.yml",
  "pr-governance.yml",
  "issue-governance.yml",
  "metadata-validation.yml"
];
const GOVERNANCE_LOCKFILE_CONSUMERS = ["dashboard-pages.yml"];
const RELEASE_PREPARATION_RESOLVERS = ["npm-release-prepare.yml"];

const INARI_REGISTRY_OPERATION =
  /\bnpm\s+(?:install|i|view)\b[^\n]*(?:\\\n[^\n]*)*gh-inari@[^\s]*/gu;

async function readWorkflows() {
  const workflowDirectory = ".github/workflows";
  return new Map(
    await Promise.all(
      (await readdir(workflowDirectory))
        .filter((fileName) => fileName.endsWith(".yml"))
        .map(async (fileName) => [
          fileName,
          await readFile(`${workflowDirectory}/${fileName}`, "utf8")
        ])
    )
  );
}

test("every workflow resolving published Inari belongs to exactly one version authority", async () => {
  const classified = new Set([
    ...GOVERNANCE_PIN_INSTALLERS,
    ...RELEASE_PREPARATION_RESOLVERS
  ]);
  const workflows = await readWorkflows();
  for (const [fileName, source] of workflows) {
    const operations = source.match(INARI_REGISTRY_OPERATION) ?? [];
    if (operations.length === 0) continue;
    assert.ok(
      classified.has(fileName),
      `${fileName} resolves published gh-inari but is not classified as governance/conformance or release preparation`
    );
  }
  for (const fileName of classified) {
    assert.ok(workflows.has(fileName), `${fileName} must exist`);
  }
  assert.equal(
    GOVERNANCE_PIN_INSTALLERS.filter((fileName) =>
      RELEASE_PREPARATION_RESOLVERS.includes(fileName)
    ).length,
    0
  );
});

test("governance/conformance workflows install only the reviewed exact pin", async () => {
  const workflows = await readWorkflows();
  for (const fileName of GOVERNANCE_PIN_INSTALLERS) {
    const source = workflows.get(fileName) ?? "";
    assert.doesNotMatch(
      source,
      /gh-inari@latest/u,
      `${fileName} must not resolve an independent moving latest version`
    );
    const operations = source.match(INARI_REGISTRY_OPERATION) ?? [];
    assert.ok(operations.length > 0, `${fileName} must install gh-inari`);
    for (const operation of operations) {
      assert.match(
        operation,
        /"gh-inari@\$\{INARI_VERSION\}"/u,
        `${fileName} must install the version declared by package.json`
      );
    }
    const resolutions =
      source.match(
        /INARI_VERSION="\$\(node "?[^\n]*scripts\/resolve-inari-version\.mjs"?\)"/gu
      ) ?? [];
    assert.equal(
      resolutions.length,
      operations.length,
      `${fileName} must resolve the reviewed pin for every Inari install`
    );
  }

  for (const fileName of GOVERNANCE_LOCKFILE_CONSUMERS) {
    const source = workflows.get(fileName) ?? "";
    assert.match(
      source,
      /pnpm install --frozen-lockfile/u,
      "Portal collection must continue to use the exact lockfile resolution"
    );
    assert.doesNotMatch(source, INARI_REGISTRY_OPERATION);
  }
});

test("release preparation keeps its separate published-version resolution boundary", async () => {
  const workflows = await readWorkflows();
  for (const fileName of RELEASE_PREPARATION_RESOLVERS) {
    const source = workflows.get(fileName) ?? "";
    // Release preparation is not governance-runtime execution: it must not be
    // forced onto the repository's reviewed governance pin.
    assert.doesNotMatch(
      source,
      /resolve-inari-version\.mjs/u,
      `${fileName} must not consume the governance-runtime pin`
    );
    assert.match(
      source,
      /npm view gh-inari@latest name version dist\.integrity dist\.tarball --json/u,
      `${fileName} resolves the current published gh-inari`
    );
    assert.match(
      source,
      /MINIMUM_INARI_VERSION: "\d+\.\d+\.\d+"/u,
      `${fileName} floors the resolved version at the release-preparation minimum`
    );
    assert.match(
      source,
      /npm install [^\n]*"gh-inari@\$version"/u,
      `${fileName} installs the exact resolved version`
    );
    assert.match(
      source,
      /installed gh-inari \$installed does not match resolved \$version/u,
      `${fileName} verifies the installed version against the resolution`
    );
    assert.match(
      source,
      /inari-integrity:/u,
      `${fileName} records the resolved integrity as run evidence`
    );
  }
});
