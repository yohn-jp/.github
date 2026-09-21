import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validatePullRequest } from "../../scripts/validate-pr.mjs";

const defaultBody = await readFile(
  "test/fixtures/pr-governance/default.md",
  "utf8"
);
const repository = {
  repositoryHost: "github.com",
  repositoryId: "100",
  repository: "acme/inari"
};
const implementation = { ...repository, number: 700 };
const sourceIssue = { ...repository, number: 680 };
const epic = { ...repository, number: 640 };

const inari = await import("gh-inari");
const branchNaming = await import("gh-inari/branch-naming");
const canonicalRoutingAvailable =
  typeof inari.tryAdaptIntegrationRouting === "function" ||
  typeof inari.tryValidateIntegrationRouting === "function" ||
  typeof inari.tryProjectIntegrationRouting === "function";
const canonicalIntegrationBranchesAvailable =
  branchNaming.validateBranchName("issue/680-source-routing").length === 0;

function route(overrides = {}) {
  return {
    version: 1,
    kind: "integration-routing",
    mode: "issue-integration",
    implementation,
    sourceIssue,
    epic,
    relationships: {
      implementationParent: sourceIssue,
      sourceIssueParent: epic
    },
    branches: {
      default: "main",
      implementation: "feat/700-source-routing",
      issue: "issue/680-source-routing",
      epic: "epic/640-governance"
    },
    head: "feat/700-source-routing",
    base: "issue/680-source-routing",
    ...overrides
  };
}

async function validate(branch, routing) {
  return validatePullRequest({
    title: "feat(core): deliver governed change",
    body: defaultBody,
    branch,
    routing
  });
}

function assertCanonicalPositive(result) {
  if (!canonicalRoutingAvailable || !canonicalIntegrationBranchesAvailable) {
    assert.equal(result.valid, false);
    assert.ok(
      result.violations.length > 0,
      "unavailable canonical routing must fail closed"
    );
    return false;
  }
  assert.equal(result.valid, true);
  return true;
}

test("Implementation -> Issue route is accepted by canonical Inari routing", async () => {
  const result = await validate("feat/700-source-routing", route());
  if (!assertCanonicalPositive(result)) return;
  assert.equal(result.routing.pullRequest.role, "implementation");
  assert.equal(result.routing.expectedBase, "issue/680-source-routing");
});

test("Issue -> Epic and Epic -> default routes are selected canonically", async () => {
  const issueResult = await validate(
    "issue/680-source-routing",
    route({
      role: "issue-integration",
      head: "issue/680-source-routing",
      base: "epic/640-governance"
    })
  );
  const epicResult = await validate(
    "epic/640-governance",
    route({
      role: "epic-integration",
      head: "epic/640-governance",
      base: "main"
    })
  );
  if (!assertCanonicalPositive(issueResult)) return;
  assert.equal(issueResult.routing.pullRequest.role, "issue-integration");
  assert.equal(issueResult.routing.expectedBase, "epic/640-governance");
  assertCanonicalPositive(epicResult);
  if (epicResult.valid) {
    assert.equal(epicResult.routing.pullRequest.role, "epic-integration");
    assert.equal(epicResult.routing.expectedBase, "main");
  }
});

test("standalone and explicit legacy routes remain compatible", async () => {
  const standalone = await validate("feat/700-standalone", {
    mode: "standalone",
    implementation,
    branches: { default: "main", implementation: "feat/700-standalone" },
    role: "implementation",
    head: "feat/700-standalone",
    base: "main"
  });
  const legacy = await validate("feat/700-legacy", {
    mode: "legacy",
    implementation,
    epic,
    relationships: { implementationParent: epic },
    branches: {
      default: "main",
      implementation: "feat/700-legacy",
      epic: "epic/640-governance"
    },
    role: "implementation",
    head: "feat/700-legacy",
    base: "epic/640-governance"
  });
  if (!assertCanonicalPositive(standalone)) return;
  assert.equal(standalone.routing.expectedBase, "main");
  assertCanonicalPositive(legacy);
  if (legacy.valid)
    assert.equal(legacy.routing.expectedBase, "epic/640-governance");
});

test("cross-Issue, cross-Epic, and layer-skipping routes fail closed", async () => {
  const wrongSource = await validate(
    "feat/700-source-routing",
    route({
      relationships: {
        implementationParent: { ...repository, number: 681 },
        sourceIssueParent: epic
      }
    })
  );
  const wrongEpic = await validate(
    "feat/700-source-routing",
    route({
      relationships: {
        implementationParent: sourceIssue,
        sourceIssueParent: { ...repository, number: 641 }
      }
    })
  );
  const layerSkip = await validate(
    "feat/700-source-routing",
    route({
      relationships: {
        implementationParent: epic,
        sourceIssueParent: epic
      }
    })
  );
  for (const result of [wrongSource, wrongEpic, layerSkip]) {
    assert.equal(result.valid, false);
    assert.ok(result.violations.length > 0);
    if (canonicalRoutingAvailable && canonicalIntegrationBranchesAvailable) {
      assert.ok(
        result.violations.some((entry) =>
          String(entry.code).startsWith("INTEGRATION_ROUTING_")
        )
      );
    }
  }
});

test("observed PR base cannot override canonical route evidence", async () => {
  const result = await validate(
    "feat/700-source-routing",
    route({ base: "epic/640-governance" })
  );
  assert.equal(result.valid, false);
  assert.ok(result.violations.length > 0);
});
