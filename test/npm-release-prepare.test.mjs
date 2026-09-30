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
import { devNull, tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";
import {
  validateProviderToolingIsolation,
  validateProviderToolingResolution
} from "../scripts/validate-provider-tooling-resolution.mjs";
import { validateActionPinsFile } from "../scripts/validate-action-pins.mjs";

// Git fixtures must not inherit the developer's global/system Git config
// (signing, push negotiation, hooks).
process.env.GIT_CONFIG_GLOBAL = devNull;
process.env.GIT_CONFIG_NOSYSTEM = "1";

const workflowPath = ".github/workflows/npm-release-prepare.yml";
const workflowSource = readFileSync(workflowPath, "utf8");
const workflow = yaml.load(workflowSource);
const job = workflow.jobs.prepare;
const wrapperPath = "templates/workflows/release-prepare.yml";
const wrapper = yaml.load(readFileSync(wrapperPath, "utf8"));

function stepNamed(name) {
  const step = job.steps.find((candidate) => candidate.name === name);
  assert.ok(step, "expected prepare job step " + name);
  return step;
}

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function runStep(run, cwd, environment) {
  return execFileSync("bash", ["-euo", "pipefail", "-c", run], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GH_TOKEN: "", ...environment },
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function assertStepFails(run, cwd, environment, expectedMessage) {
  assert.throws(
    () => runStep(run, cwd, environment),
    (error) => {
      assert.notEqual(error.status, 0);
      const output =
        String(error.stdout ?? "") + "\n" + String(error.stderr ?? "");
      assert.match(output, expectedMessage);
      return true;
    }
  );
}

function readOutputs(file) {
  return Object.fromEntries(
    readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line.includes("="))
      .map((line) => [
        line.slice(0, line.indexOf("=")),
        line.slice(line.indexOf("=") + 1)
      ])
  );
}

// A caller repository whose default branch is the exact source revision,
// with a bare "origin" standing in for GitHub.
function callerFixture() {
  const root = mkdtempSync(join(tmpdir(), "npm-release-prepare-"));
  const origin = join(root, "origin.git");
  const seed = join(root, "seed");
  execFileSync("git", [
    "init",
    "--quiet",
    "--bare",
    "--initial-branch=main",
    origin
  ]);
  mkdirSync(seed);
  git(seed, "init", "--quiet", "--initial-branch=main");
  git(seed, "config", "user.name", "fixture");
  git(seed, "config", "user.email", "fixture@example.invalid");
  writeFileSync(
    join(seed, "package.json"),
    '{\n  "name": "fixture",\n  "version": "1.1.0"\n}\n'
  );
  git(seed, "add", ".");
  git(seed, "commit", "--quiet", "-m", "source");
  git(seed, "remote", "add", "origin", origin);
  git(seed, "push", "--quiet", "origin", "main");
  return { root, origin, source: git(seed, "rev-parse", "HEAD") };
}

// Simulates the workspace canonical Inari leaves behind: the exact source
// checkout plus the prepared version file and release document.
function preparedCheckout(fixture, name, { releaseNotes = "notes\n" } = {}) {
  const checkout = join(fixture.root, name);
  execFileSync("git", ["clone", "--quiet", fixture.origin, checkout]);
  git(checkout, "checkout", "--quiet", "--detach", fixture.source);
  writeFileSync(
    join(checkout, "package.json"),
    '{\n  "name": "fixture",\n  "version": "1.2.0"\n}\n'
  );
  mkdirSync(join(checkout, "docs", "releases"), { recursive: true });
  writeFileSync(join(checkout, "docs", "releases", "1.2.0.md"), releaseNotes);
  return checkout;
}

function branchEnvironment(fixture, checkout) {
  return {
    GITHUB_OUTPUT: join(checkout, "..", `${checkout.split("/").pop()}.out`),
    GITHUB_STEP_SUMMARY: join(
      checkout,
      "..",
      `${checkout.split("/").pop()}.summary`
    ),
    GITHUB_SERVER_URL: "",
    SOURCE_REVISION: fixture.source,
    TARGET_VERSION: "1.2.0",
    CHANGED_PATHS: JSON.stringify(["docs/releases/1.2.0.md", "package.json"])
  };
}

const branchRun = () =>
  stepNamed("Commit prepared changes to release branch").run;

test("workflow_call contract takes an exact source revision and explicit intent", () => {
  const call = workflow.on.workflow_call;
  assert.deepEqual(Object.keys(call.inputs).sort(), [
    "node-version",
    "release-intent",
    "source-revision"
  ]);
  assert.equal(call.inputs["source-revision"].required, true);
  assert.equal(call.inputs["release-intent"].required, true);
  assert.equal(call.inputs["release-intent"].default, undefined);
  assert.deepEqual(call.secrets, {});
  for (const output of [
    "source-revision",
    "inari-version",
    "inari-integrity",
    "target-version",
    "release-branch",
    "release-head-revision",
    "pull-request-url"
  ]) {
    assert.ok(call.outputs[output], `missing output ${output}`);
  }
  const checkout = stepNamed("Checkout caller default branch");
  assert.equal(
    checkout.with.ref,
    "${{ github.event.repository.default_branch }}"
  );
  assert.doesNotMatch(workflowSource, /ref: \$\{\{ inputs\./);
  assert.equal(checkout.with["persist-credentials"], false);
  assert.match(
    stepNamed("Record exact caller source revision").run,
    /git rev-parse HEAD/
  );
});

test("release request validation rejects non-exact revisions and option-like intents", () => {
  const run = stepNamed("Validate release request").run;
  const cwd = mkdtempSync(join(tmpdir(), "npm-release-request-"));
  try {
    const sha = "a".repeat(40);
    runStep(run, cwd, { SOURCE_REVISION: sha, RELEASE_INTENT: "minor" });
    runStep(run, cwd, { SOURCE_REVISION: sha, RELEASE_INTENT: "1.2.3" });
    assertStepFails(
      run,
      cwd,
      { SOURCE_REVISION: "main", RELEASE_INTENT: "minor" },
      /exact 40-character/
    );
    assertStepFails(
      run,
      cwd,
      { SOURCE_REVISION: sha, RELEASE_INTENT: "--target-version=9.9.9" },
      /one explicit intent/
    );
    assertStepFails(
      run,
      cwd,
      { SOURCE_REVISION: sha, RELEASE_INTENT: "" },
      /one explicit intent/
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("published Inari is resolved, floored at the release surface, installed exactly and recorded", () => {
  const step = stepNamed("Resolve published Inari");
  assert.equal(step.env.MINIMUM_INARI_VERSION, "0.18.0");
  assert.match(step.run, /npm view gh-inari@latest/);
  assert.match(step.run, /"gh-inari@\$version"/);
  assert.match(step.run, /installed gh-inari .* does not match resolved/);
  assert.match(step.run, /GITHUB_STEP_SUMMARY/);
  assert.equal(
    job.outputs["inari-version"],
    "${{ steps.inari.outputs.version }}"
  );
});

test("release semantics and PR publication are delegated to canonical Inari", () => {
  const prepare = stepNamed("Prepare release with canonical Inari");
  assert.match(
    prepare.run,
    /node "\$INARI_CLI" release prepare "\$RELEASE_INTENT" --repository "\$GITHUB_REPOSITORY" --json/
  );
  const publish = stepNamed("Publish release PR with canonical Inari");
  assert.match(publish.run, /pr render --template release --json/);
  assert.match(publish.run, /createReleasePrPublicationRequest/);
  assert.match(
    publish.run,
    /node "\$INARI_CLI" pr publish --from "\$request" --repository "\$GITHUB_REPOSITORY" --json/
  );
  // No local re-implementation of version, history, or PR semantics.
  assert.doesNotMatch(workflowSource, /gh pr create|gh api|npm version/);
  assert.doesNotMatch(workflowSource, /pulls\?|compare\//);
});

test("no publication, tag, release, force-push, or OIDC capability exists", () => {
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.deepEqual(job.permissions, {
    contents: "write",
    "pull-requests": "write"
  });
  assert.doesNotMatch(workflowSource, /id-token/);
  assert.doesNotMatch(workflowSource, /npm publish|pnpm publish/);
  assert.doesNotMatch(workflowSource, /gh release|git tag|--tags|refs\/tags/);
  assert.doesNotMatch(workflowSource, /--force|\+HEAD:|push -f/);
  assert.doesNotMatch(workflowSource, /secrets\.NPM|NODE_AUTH_TOKEN/);
});

test("provider tooling resolves at the caller-pinned provider revision and leaves the workspace", () => {
  assert.deepEqual(
    validateProviderToolingResolution(workflow, workflowPath),
    []
  );
  assert.deepEqual(
    validateProviderToolingIsolation(workflow, workflowPath),
    []
  );
  assert.deepEqual(validateActionPinsFile(workflowPath), []);
});

test("consumer wrapper calls the provider @main and is authored through sync-groups", () => {
  assert.deepEqual(Object.keys(wrapper.on), ["workflow_dispatch"]);
  assert.equal(
    wrapper.on.workflow_dispatch.inputs["release-intent"].required,
    true
  );
  assert.deepEqual(wrapper.permissions, { contents: "read" });
  const call = wrapper.jobs.prepare;
  assert.equal(
    call.uses,
    "yohn-jp/.github/.github/workflows/npm-release-prepare.yml@main"
  );
  assert.deepEqual(call.with, {
    "source-revision": "${{ github.sha }}",
    "release-intent": "${{ inputs.release-intent }}"
  });
  assert.deepEqual(call.permissions, {
    contents: "write",
    "pull-requests": "write"
  });
  assert.deepEqual(validateActionPinsFile(wrapperPath), []);

  const groups = yaml.load(readFileSync(".github/sync-groups.yml", "utf8"));
  assert.ok(
    groups["file-groups"]["npm-release"].some(
      (entry) =>
        entry.source === wrapperPath &&
        entry.dest === ".github/workflows/release-prepare.yml"
    )
  );
  const sync = yaml.load(readFileSync(".github/sync.yml", "utf8"));
  assert.ok(
    sync["yohn-jp/gh-inari"].some(
      (entry) =>
        entry.source === wrapperPath &&
        entry.dest === ".github/workflows/release-prepare.yml"
    )
  );
});

test("prepared changes create release/<version> on first run", () => {
  const fixture = callerFixture();
  try {
    const checkout = preparedCheckout(fixture, "first");
    const environment = branchEnvironment(fixture, checkout);
    runStep(branchRun(), checkout, environment);
    const outputs = readOutputs(environment.GITHUB_OUTPUT);
    assert.equal(outputs.branch, "release/1.2.0");
    const remoteHead = git(
      fixture.origin,
      "rev-parse",
      "refs/heads/release/1.2.0"
    );
    assert.equal(outputs["head-revision"], remoteHead);
    assert.equal(
      git(fixture.origin, "rev-parse", `${remoteHead}^`),
      fixture.source
    );
    assert.deepEqual(
      git(fixture.origin, "diff", "--name-only", fixture.source, remoteHead)
        .split("\n")
        .sort(),
      ["docs/releases/1.2.0.md", "package.json"]
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("an exact retry reuses the existing release branch without pushing", () => {
  const fixture = callerFixture();
  try {
    const first = preparedCheckout(fixture, "first");
    runStep(branchRun(), first, branchEnvironment(fixture, first));
    const remoteHead = git(
      fixture.origin,
      "rev-parse",
      "refs/heads/release/1.2.0"
    );

    const retry = preparedCheckout(fixture, "retry");
    const environment = branchEnvironment(fixture, retry);
    const log = runStep(branchRun(), retry, environment);
    assert.match(log, /Reused release\/1\.2\.0/);
    assert.equal(
      readOutputs(environment.GITHUB_OUTPUT)["head-revision"],
      remoteHead
    );
    assert.equal(
      git(fixture.origin, "rev-parse", "refs/heads/release/1.2.0"),
      remoteHead
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("a conflicting existing release branch fails closed and is not overwritten", () => {
  const fixture = callerFixture();
  try {
    const first = preparedCheckout(fixture, "first", {
      releaseNotes: "different\n"
    });
    runStep(branchRun(), first, branchEnvironment(fixture, first));
    const remoteHead = git(
      fixture.origin,
      "rev-parse",
      "refs/heads/release/1.2.0"
    );

    const conflicting = preparedCheckout(fixture, "conflicting");
    assertStepFails(
      branchRun(),
      conflicting,
      branchEnvironment(fixture, conflicting),
      /is not the exact prepared release .* refusing to reuse or overwrite/
    );
    assert.equal(
      git(fixture.origin, "rev-parse", "refs/heads/release/1.2.0"),
      remoteHead
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("a release branch prepared from another source revision fails closed", () => {
  const fixture = callerFixture();
  try {
    const first = preparedCheckout(fixture, "first");
    runStep(branchRun(), first, branchEnvironment(fixture, first));

    const other = join(fixture.root, "other");
    execFileSync("git", ["clone", "--quiet", fixture.origin, other]);
    git(other, "config", "user.name", "fixture");
    git(other, "config", "user.email", "fixture@example.invalid");
    git(other, "commit", "--quiet", "--allow-empty", "-m", "newer source");
    git(other, "push", "--quiet", "origin", "HEAD:main");
    const newer = { ...fixture, source: git(other, "rev-parse", "HEAD") };

    const retry = preparedCheckout(newer, "retry");
    assertStepFails(
      branchRun(),
      retry,
      branchEnvironment(newer, retry),
      /refusing to reuse or overwrite/
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("changes outside the Inari-reported paths fail before any push", () => {
  const fixture = callerFixture();
  try {
    const checkout = preparedCheckout(fixture, "first");
    writeFileSync(join(checkout, "unexpected.txt"), "x\n");
    assertStepFails(
      branchRun(),
      checkout,
      branchEnvironment(fixture, checkout),
      /outside the Inari-reported set/
    );
    assert.equal(
      git(fixture.origin, "ls-remote", "--heads", ".", "release/1.2.0"),
      ""
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

// Stub Inari CLI/module recording what orchestration passes through.
function inariStub(
  root,
  { publishExit = 0, publishClassification = "created" } = {}
) {
  const cli = join(root, "inari-cli.mjs");
  const module = join(root, "inari-module.mjs");
  writeFileSync(
    cli,
    `import { appendFileSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(join(root, "calls.log"))}, JSON.stringify(args) + "\\n");
if (args[0] === "release") {
  console.log(JSON.stringify(JSON.parse(process.env.STUB_PREPARE)));
} else if (args[0] === "pr" && args[1] === "render") {
  console.log(JSON.stringify({ valid: true, body: "rendered body" }));
} else if (args[0] === "pr" && args[1] === "publish") {
  const request = JSON.parse(readFileSync(args[args.indexOf("--from") + 1], "utf8"));
  appendFileSync(${JSON.stringify(join(root, "requests.log"))}, JSON.stringify(request) + "\\n");
  const ok = ${publishExit} === 0;
  console.log(JSON.stringify({ ok, classification: ok ? ${JSON.stringify(publishClassification)} : "failed",
    ...(ok ? { pullRequest: { number: 7, url: "https://github.com/o/r/pull/7" } } : {}) }));
  process.exit(${publishExit});
}
`
  );
  writeFileSync(
    module,
    `export function createReleasePrPublicationRequest(input) {
  return { kind: "pr-publication", input };
}
`
  );
  return { cli, module };
}

test("prepare step fails closed when Inari prepared a different source", () => {
  const root = mkdtempSync(join(tmpdir(), "npm-release-inari-"));
  try {
    const { cli } = inariStub(root);
    const output = join(root, "out");
    const base = {
      GITHUB_OUTPUT: output,
      GITHUB_STEP_SUMMARY: join(root, "summary"),
      GITHUB_REPOSITORY: "o/r",
      RUNNER_TEMP: root,
      INARI_CLI: cli,
      RELEASE_INTENT: "minor",
      SOURCE_REVISION: "a".repeat(40)
    };
    const prepared = {
      ok: true,
      operation: "release.prepare",
      targetVersion: "1.2.0",
      previousRelease: { version: "1.1.0" },
      source: { sourceRevision: "a".repeat(40) },
      changedPaths: ["docs/releases/1.2.0.md", "package.json"],
      planDigest: "d".repeat(64)
    };
    const run = stepNamed("Prepare release with canonical Inari").run;
    runStep(run, root, { ...base, STUB_PREPARE: JSON.stringify(prepared) });
    const outputs = readOutputs(output);
    assert.equal(outputs["target-version"], "1.2.0");
    assert.deepEqual(
      JSON.parse(outputs["changed-paths"]),
      prepared.changedPaths
    );
    assert.deepEqual(
      JSON.parse(readFileSync(join(root, "calls.log"), "utf8").trim()),
      ["release", "prepare", "minor", "--repository", "o/r", "--json"]
    );

    assertStepFails(
      run,
      root,
      {
        ...base,
        STUB_PREPARE: JSON.stringify({
          ...prepared,
          source: { sourceRevision: "b".repeat(40) }
        })
      },
      /not the requested source/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function publishEnvironment(root, stub) {
  return {
    GITHUB_OUTPUT: join(root, "out"),
    GITHUB_STEP_SUMMARY: join(root, "summary"),
    GITHUB_REPOSITORY: "o/r",
    GITHUB_SERVER_URL: "https://github.com",
    RUNNER_TEMP: root,
    INARI_CLI: stub.cli,
    INARI_MODULE: stub.module,
    REPOSITORY_ID: "123",
    SOURCE_REVISION: "a".repeat(40),
    TARGET_VERSION: "1.2.0",
    PREVIOUS_VERSION: "1.1.0",
    RELEASE_INTENT: "minor",
    PLAN_DIGEST: "d".repeat(64),
    HEAD_REVISION: "c".repeat(40)
  };
}

test("release PR publication binds the release head and returns Inari's PR", () => {
  for (const classification of ["created", "returned-existing"]) {
    const root = mkdtempSync(join(tmpdir(), "npm-release-publish-"));
    try {
      const stub = inariStub(root, { publishClassification: classification });
      const environment = publishEnvironment(root, stub);
      runStep(
        stepNamed("Publish release PR with canonical Inari").run,
        root,
        environment
      );
      const outputs = readOutputs(environment.GITHUB_OUTPUT);
      assert.equal(outputs.url, "https://github.com/o/r/pull/7");
      assert.equal(outputs.classification, classification);
      const request = JSON.parse(
        readFileSync(join(root, "requests.log"), "utf8").trim()
      );
      assert.deepEqual(request.input, {
        repository: {
          repositoryHost: "github.com",
          repositoryId: "123",
          repository: "o/r"
        },
        targetVersion: "1.2.0",
        sourceRevision: "c".repeat(40),
        title: "chore(release): v1.2.0",
        body: "rendered body"
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("a conflicting release PR reported by Inari fails the run closed", () => {
  const root = mkdtempSync(join(tmpdir(), "npm-release-publish-"));
  try {
    const stub = inariStub(root, { publishExit: 3 });
    assertStepFails(
      stepNamed("Publish release PR with canonical Inari").run,
      root,
      publishEnvironment(root, stub),
      /release PR publication failed closed \(exit 3\)/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
