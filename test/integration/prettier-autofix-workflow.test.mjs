import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import { validateActionPinsFile } from "../../scripts/validate-action-pins.mjs";
import { validatePatch } from "../../scripts/prettier-autofix/lib.mjs";

const wrapperPath = "templates/workflows/prettier-autofix.yml";
const reusablePath = ".github/workflows/prettier-autofix.yml";
const wrapperSource = readFileSync(wrapperPath, "utf8");
const reusableSource = readFileSync(reusablePath, "utf8");
const wrapper = yaml.load(wrapperSource);
const reusable = yaml.load(reusableSource);
const sync = yaml.load(readFileSync(".github/sync.yml", "utf8"));

const compatibleConsumers = [
  "yohn-jp/gh-inari",
  "yohn-jp/gh-makami",
  "yohn-jp/suzukuri",
  "yohn-jp/shikitari",
  "yohn-jp/nawabari",
  "yohn-jp/wabachi",
  "yohn-jp/cli-canon",
  "yohn-jp/majiwari"
];

test("default-branch pull_request_target wrapper excludes external forks before reusable remediation", () => {
    assert.ok(wrapper.on.pull_request_target);
    assert.ok(wrapper.on.pull_request_target.types.includes("opened"));
    assert.ok(wrapper.on.pull_request_target.types.includes("synchronize"));

    const forkJob = wrapper.jobs["skip-external-fork"];
    assert.equal(
      forkJob.if,
      "github.event.pull_request.head.repo.full_name != github.repository"
    );
    assert.match(forkJob.steps[0].run, /explicitly skipped for external fork/u);
    assert.match(forkJob.steps[0].run, /ordinary format check is unchanged/u);
    assert.equal(forkJob.secrets, undefined);

    const remediation = wrapper.jobs.autofix;
    assert.match(remediation.if, /head\.repo\.full_name == github\.repository/u);
    assert.match(
      remediation.if,
      /!startsWith\(github\.event\.pull_request\.head\.ref/u
    );
    assert.equal(
      remediation.uses,
      "yohn-jp/.github/.github/workflows/prettier-autofix.yml@main"
    );
    assert.equal(
      remediation.with["autofix-app-id"],
      "${{ vars.AUTOFIX_APP_ID }}"
    );
    assert.deepEqual(Object.keys(remediation.secrets).sort(), [
      "AUTOFIX_APP_PRIVATE_KEY"
    ]);

    const forkRuntimeRoute =
      forkJob.if.includes("!= github.repository") &&
      !remediation.if.includes("head.repo.full_name != github.repository");
    assert.equal(forkRuntimeRoute, true);
});

test("reusable workflow skips forks and recursion before formatter or writer jobs", () => {
    const eligibility = reusable.jobs.eligibility;
    const check = eligibility.steps.find((step) => step.id === "check");
    assert.match(check.run, /HEAD_REPOSITORY.*BASE_REPOSITORY/su);
    assert.match(check.run, /reason=external-fork/u);
    assert.match(check.run, /reason=autofix-recursion/u);
    assert.equal(
      reusable.jobs.format.if,
      "needs.eligibility.outputs.eligible == 'true'"
    );
    assert.match(
      reusable.jobs.writer.if,
      /needs\.eligibility\.outputs\.eligible == 'true'/u
    );
    assert.match(
      reusable.jobs.writer.if,
      /needs\.format\.outputs\.changed == 'true'/u
    );
    assert.deepEqual(reusable.jobs.writer.needs, ["eligibility", "format"]);
    assert.equal(
      reusable.jobs.writer.steps.some((step) =>
        step.uses?.includes("create-github-app-token")
      ),
      true
    );
});

test("trusted default-branch Prettier authority is separate from source data and App writes", () => {
    const formatter = reusable.jobs.format;
    const sourceCheckout = formatter.steps.find(
      (step) => step.name === "Checkout exact source PR head as data"
    );
    assert.equal(
      sourceCheckout.with.ref,
      "${{ github.event.pull_request.head.sha }}"
    );
    assert.equal(sourceCheckout.with.path, "source");
    assert.equal(sourceCheckout.with["persist-credentials"], false);
    assert.equal(sourceCheckout.with.repository, undefined);

    const authorityCheckout = formatter.steps.find(
      (step) =>
        step.name === "Checkout consumer default-branch formatter authority"
    );
    assert.equal(authorityCheckout.with.repository, "${{ github.repository }}");
    assert.equal(
      authorityCheckout.with.ref,
      "${{ github.event.repository.default_branch }}"
    );
    assert.equal(authorityCheckout.with.path, "formatter-authority");
    assert.equal(authorityCheckout.with["persist-credentials"], false);

    const setup = formatter.steps.find((step) =>
      step.uses?.endsWith("/.github/actions/setup-node-pnpm")
    );
    assert.equal(setup.with["working-directory"], "formatter-authority");
    const trustedFormat = formatter.steps.find(
      (step) => step.name === "Run trusted Prettier against PR source data"
    );
    assert.equal(
      trustedFormat.run,
      'node "$RUNNER_TEMP/prettier-autofix-tools/scripts/prettier-autofix/format.mjs"'
    );
    assert.equal(
      trustedFormat.env.FORMATTER_AUTHORITY_DIRECTORY,
      "${{ github.workspace }}/formatter-authority"
    );
    assert.equal(
      trustedFormat.env.SOURCE_CHECKOUT,
      "${{ github.workspace }}/source"
    );
    assert.equal(
      formatter.steps.some((step) => /pnpm run format/u.test(step.run ?? "")),
      false
    );
    assert.ok(
      formatter.steps.some((step) =>
        step.run?.includes(
          'mv .prettier-autofix-tools "$RUNNER_TEMP/prettier-autofix-tools"'
        )
      )
    );
    assert.equal(
      formatter.steps.some((step) =>
        step.uses?.includes("create-github-app-token")
      ),
      false
    );
    assert.equal(formatter.permissions.contents, "read");

    const formatterScript = readFileSync(
      "scripts/prettier-autofix/format.mjs",
      "utf8"
    );
    assert.match(formatterScript, /node_modules\/prettier\/bin\/prettier\.cjs/u);
    assert.match(formatterScript, /"--config"/u);
    assert.match(formatterScript, /"--ignore-path"/u);
    assert.match(formatterScript, /"--no-editorconfig"/u);
    assert.match(formatterScript, /FORMATTER_AUTHORITY_DIRECTORY/u);
    assert.doesNotMatch(formatterScript, /pnpm run format/u);

    const writer = reusable.jobs.writer;
    const validationIndex = writer.steps.findIndex((step) =>
      step.name?.startsWith("Reject stale, malformed, or unsafe patch")
    );
    const tokenIndex = writer.steps.findIndex((step) =>
      step.uses?.includes("create-github-app-token")
    );
    const publishIndex = writer.steps.findIndex((step) =>
      step.name?.startsWith("Publish deterministic autofix branch")
    );
    assert.ok(
      validationIndex >= 0 &&
        validationIndex < tokenIndex &&
        tokenIndex < publishIndex
    );
    assert.equal(
      writer.steps.some(
        (step) =>
          step.uses?.includes("actions/checkout") &&
          step.with?.ref === "${{ github.event.pull_request.head.sha }}"
      ),
      false,
      "the App writer does not check out PR-controlled files"
    );
    assert.equal(
      writer.steps.some((step) => step.run?.includes("pnpm run")),
      false
    );
    assert.equal(writer.permissions.contents, "read");
    assert.equal(writer.permissions["pull-requests"], "read");
    assert.equal(
      reusable.on.workflow_call.inputs["autofix-app-id"].type,
      "string"
    );
    assert.equal(
      writer.steps[tokenIndex].with["app-id"],
      "${{ inputs.autofix-app-id }}"
    );
    assert.equal(writer.steps[tokenIndex].with["permission-contents"], "write");
    assert.equal(writer.steps[tokenIndex].with["permission-metadata"], "read");
    assert.equal(
      writer.steps[tokenIndex].with["permission-pull-requests"],
      "write"
    );
    assert.equal(writer.steps[tokenIndex].with["permission-workflows"], "write");
    assert.equal(writer.steps[tokenIndex].with["installation-id"], undefined);
});

test("workflow-file formatting remains in scope and requires App Workflows write", () => {
    const workflowPatch = Buffer.from(
      [
        "diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml",
        "index 1111111..2222222 100644",
        "--- a/.github/workflows/ci.yml",
        "+++ b/.github/workflows/ci.yml",
        "@@ -1 +1 @@",
        "-name:ci",
        "+name: ci",
        ""
      ].join("\n")
    );
    assert.deepEqual(validatePatch(workflowPatch).files, [
      ".github/workflows/ci.yml"
    ]);
    const token = reusable.jobs.writer.steps.find((step) =>
      step.uses?.includes("create-github-app-token")
    );
    assert.equal(token.with["permission-workflows"], "write");
});

test("clean output gates off writer work and reruns replace the run-scoped artifact", () => {
    const formatter = reusable.jobs.format;
    const upload = formatter.steps.find(
      (step) => step.name === "Upload patch and provenance handoff"
    );
    const download = reusable.jobs.writer.steps.find(
      (step) => step.name === "Download patch and provenance handoff"
    );
    assert.equal(upload.if, "steps.capture.outputs.changed == 'true'");
    assert.equal(
      reusable.jobs.format.outputs.changed,
      "${{ steps.capture.outputs.changed }}"
    );
    assert.match(
      reusable.jobs.writer.if,
      /needs\.format\.outputs\.changed == 'true'/u
    );
    assert.equal(upload.with.name, "prettier-autofix-${{ github.run_id }}");
    assert.equal(download.with.name, upload.with.name);
    assert.equal(upload.with.overwrite, true);
});

test("recursion is reported and excluded by both the wrapper and provider eligibility guard", () => {
    const recursionJob = wrapper.jobs["skip-recursion"];
    assert.match(
      recursionJob.if,
      /startsWith\(github\.event\.pull_request\.head\.ref, 'autofix\/prettier\/pr-'/u
    );
    assert.match(
      recursionJob.steps[0].run,
      /excluded from recursive remediation/u
    );
    assert.match(
      reusable.jobs.eligibility.steps[0].run,
      /autofix\/prettier\/pr-/u
    );
});

test("organization sync opts in only current TypeScript CLI format-compatible consumers", () => {
    const actual = Object.entries(sync)
      .filter(([, entries]) =>
        entries.some(
          (entry) => entry.source === "templates/workflows/prettier-autofix.yml"
        )
      )
      .map(([repository]) => repository)
      .sort();
    assert.deepEqual(actual, [...compatibleConsumers].sort());
    for (const repository of compatibleConsumers) {
      assert.ok(
        sync[repository].some(
          (entry) =>
            entry.source === "templates/workflows/prettier-autofix.yml" &&
            entry.dest === ".github/workflows/prettier-autofix.yml"
        ),
        `${repository} must receive the canonical wrapper`
      );
    }
});

test("all remote Actions in the reusable workflow follow organization pin policy", () => {
    assert.deepEqual(validateActionPinsFile(reusablePath), []);
    assert.match(
      wrapperSource,
      /uses: yohn-jp\/\.github\/\.github\/workflows\/prettier-autofix\.yml@main/u
    );
    assert.match(wrapperSource, /pull_request_target:/u);
}
);


test("publisher maps trusted pullRequest provenance to runPublish pullRequestNumber", () => {
    const publisherSource = readFileSync(
      "scripts/prettier-autofix/publish.mjs",
      "utf8"
    );
    assert.match(
      publisherSource,
      /runPublish\(\{[\s\S]*?\.\.\.expected,[\s\S]*?pullRequestNumber: expected\.pullRequest,/u
    );
});
