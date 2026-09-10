import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { validatePullRequest } from "../../scripts/validate-pr.mjs";
import { validateBranchName } from "../../scripts/validate-branch-name.mjs";

const root = process.cwd();
const releaseBody = await readFile(
  "test/fixtures/pr-governance/release.md",
  "utf8"
);
const defaultBody = await readFile(
  "test/fixtures/pr-governance/default.md",
  "utf8"
);

function pullRequest(
  branch,
  body,
  requestRoot = root,
  title = "feat(core): deliver governed change"
) {
  return {
    title,
    body,
    root: requestRoot,
    branch
  };
}

test("release/0.5.1 passes the release contract without an Issue", async () => {
  assert.deepEqual(validateBranchName("release/0.5.1"), []);
  const result = await validatePullRequest(
    pullRequest("release/0.5.1", releaseBody)
  );
  assert.equal(result.valid, true);
  assert.equal(result.branchClassification, "release");
  assert.equal(result.contract.templateIdentity.id, "release");
});

test("release/1.0.0 uses the same release contract", async () => {
  assert.deepEqual(validateBranchName("release/1.0.0"), []);
  const result = await validatePullRequest(
    pullRequest("release/1.0.0", releaseBody)
  );
  assert.equal(result.valid, true);
  assert.equal(result.contract.templateIdentity.id, "release");
});

test("release contract ignores an ordinary default-template policy", async (t) => {
  const fixtureRoot = await mkdtemp(
    path.join(tmpdir(), "pr-governance-release-")
  );
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));

  await mkdir(path.join(fixtureRoot, ".github", "inari"), { recursive: true });
  await cp(
    path.join(root, ".github", "PULL_REQUEST_TEMPLATE"),
    path.join(fixtureRoot, ".github", "PULL_REQUEST_TEMPLATE"),
    { recursive: true }
  );
  await writeFile(
    path.join(fixtureRoot, ".github", "inari", "pr-policy.yml"),
    [
      "version: 1",
      "template: default",
      "sections:",
      "  - section: summary",
      "    required: true",
      ""
    ].join("\n"),
    "utf8"
  );

  const result = await validatePullRequest(
    pullRequest("release/0.8.0", releaseBody, fixtureRoot)
  );
  assert.equal(result.valid, true);
  assert.equal(result.branchClassification, "release");
  assert.equal(result.contract.templateIdentity.id, "release");
});

test("malformed release branches are rejected before contract validation", async () => {
  for (const branch of ["release/foo", "release/0.5"]) {
    assert.equal(validateBranchName(branch).length, 1);
    const result = await validatePullRequest(pullRequest(branch, releaseBody));
    assert.equal(result.valid, false);
    assert.equal(result.branchClassification, "invalid-release");
    assert.equal(
      result.violations[0].code,
      "GOVERNANCE_RELEASE_BRANCH_INVALID"
    );
  }
});

test("epic/890-runtime-certification passes branch-name validation as an integration branch", async () => {
  assert.deepEqual(validateBranchName("epic/890-runtime-certification"), []);
  const result = await validatePullRequest(
    pullRequest("epic/890-runtime-certification", defaultBody)
  );
  // #177 is deliberately narrow: an epic branch is a new, protected
  // integration branch class, but it does not introduce a new PR *content*
  // contract or automatic child-Issue routing. PR content for an epic head
  // branch keeps the same ordinary auto-detection path as any other branch.
  assert.equal(result.valid, true);
  assert.equal(result.branchClassification, "ordinary");
  assert.equal(result.contract.templateIdentity.id, "default");
});

test("malformed epic branches are rejected by branch-name validation before reaching PR content checks", async () => {
  for (const branch of ["epic/foo", "epic/890"]) {
    const errors = validateBranchName(branch);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /must match epic\/<issue-number>-<slug>/);
  }
});

test("a canonical Epic branch with a canonical Epic PR title passes end to end", async () => {
  assert.deepEqual(validateBranchName("epic/890-runtime-certification"), []);
  const result = await validatePullRequest(
    pullRequest(
      "epic/890-runtime-certification",
      defaultBody,
      root,
      "epic(runtime): integrate certification pipeline"
    )
  );
  assert.equal(result.valid, true);
  assert.equal(result.branchClassification, "ordinary");
  assert.equal(result.contract.templateIdentity.id, "default");
});

test("a malformed Epic PR title fails closed even with an otherwise valid Epic branch and body", async () => {
  const result = await validatePullRequest(
    pullRequest(
      "epic/890-runtime-certification",
      defaultBody,
      root,
      "epic: integrate certification pipeline"
    )
  );
  assert.equal(result.valid, false);
  assert.equal(result.violations[0].code, "GOVERNANCE_EPIC_PR_TITLE_INVALID");
});

test("an ordinary PR title that merely mentions epic is unaffected", async () => {
  const result = await validatePullRequest(
    pullRequest(
      "fix/123-slug",
      defaultBody,
      root,
      "feat(core): improve epic dashboard filters"
    )
  );
  assert.equal(result.valid, true);
  assert.equal(result.branchClassification, "ordinary");
});

test("ordinary Issue-bound PRs keep default contract auto-detection", async () => {
  assert.equal(validateBranchName("fix/123-slug").length, 0);
  const result = await validatePullRequest(
    pullRequest("fix/123-slug", defaultBody)
  );
  assert.equal(result.valid, true);
  assert.equal(result.branchClassification, "ordinary");
  assert.equal(result.contract.templateIdentity.id, "default");
});

test("a synchronized consumer accepts an Inari-generated ordinary PR body without repair", async (t) => {
  const fixtureRoot = await mkdtemp(
    path.join(tmpdir(), "pr-governance-consumer-")
  );
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));

  await mkdir(path.join(fixtureRoot, ".github"), { recursive: true });
  await cp(
    path.join(root, ".github", "PULL_REQUEST_TEMPLATE"),
    path.join(fixtureRoot, ".github", "PULL_REQUEST_TEMPLATE"),
    { recursive: true }
  );
  await cp(
    path.join(root, ".github", "inari"),
    path.join(fixtureRoot, ".github", "inari"),
    { recursive: true }
  );

  const result = await validatePullRequest(
    pullRequest("fix/125-inari-governance", defaultBody, fixtureRoot)
  );
  assert.equal(result.valid, true);
  assert.equal(result.contract.templateIdentity.id, "default");
  assert.deepEqual(result.result.parse.values.validation, [
    "typecheck",
    "tests",
    "build"
  ]);
});

test("auto-detected ordinary PR is not aborted by an unrelated release candidate's default-only policy", async (t) => {
  const fixtureRoot = await mkdtemp(
    path.join(tmpdir(), "pr-governance-ordinary-")
  );
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));

  await mkdir(path.join(fixtureRoot, ".github", "inari"), { recursive: true });
  await cp(
    path.join(root, ".github", "PULL_REQUEST_TEMPLATE"),
    path.join(fixtureRoot, ".github", "PULL_REQUEST_TEMPLATE"),
    { recursive: true }
  );
  await cp(
    path.join(root, ".github", "inari", "pull-requests"),
    path.join(fixtureRoot, ".github", "inari", "pull-requests"),
    { recursive: true }
  );
  await writeFile(
    path.join(fixtureRoot, ".github", "inari", "pr-policy.yml"),
    [
      "version: 1",
      "template: default",
      "sections:",
      "  - section: summary",
      "    required: true",
      ""
    ].join("\n"),
    "utf8"
  );

  assert.equal(validateBranchName("fix/123-slug").length, 0);
  const result = await validatePullRequest(
    pullRequest("fix/123-slug", defaultBody, fixtureRoot)
  );
  assert.equal(result.valid, true);
  assert.equal(result.branchClassification, "ordinary");
  assert.equal(result.contract.templateIdentity.id, "default");
});

test("auto-detected ordinary PR still fails closed when the applicable default template itself violates policy", async (t) => {
  const fixtureRoot = await mkdtemp(
    path.join(tmpdir(), "pr-governance-ordinary-failclosed-")
  );
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));

  await mkdir(path.join(fixtureRoot, ".github", "inari"), { recursive: true });
  await cp(
    path.join(root, ".github", "PULL_REQUEST_TEMPLATE"),
    path.join(fixtureRoot, ".github", "PULL_REQUEST_TEMPLATE"),
    { recursive: true }
  );
  await cp(
    path.join(root, ".github", "inari", "pull-requests"),
    path.join(fixtureRoot, ".github", "inari", "pull-requests"),
    { recursive: true }
  );
  await writeFile(
    path.join(fixtureRoot, ".github", "inari", "pr-policy.yml"),
    [
      "version: 1",
      "template: default",
      "sections:",
      "  - section: review_focus",
      "    minLength: 10000",
      ""
    ].join("\n"),
    "utf8"
  );

  assert.equal(validateBranchName("fix/123-slug").length, 0);
  const result = await validatePullRequest(
    pullRequest("fix/123-slug", defaultBody, fixtureRoot)
  );
  assert.equal(result.valid, false);
  assert.equal(result.branchClassification, "ordinary");
  assert.equal(result.contract.templateIdentity.id, "default");
});
