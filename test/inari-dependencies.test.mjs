import test from "node:test";
import assert from "node:assert/strict";
import { collectDashboardData } from "../scripts/dashboard-data.mjs";

function response(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

function repositoryBody(id, fullName) {
  const [, name] = fullName.split("/");
  return {
    id,
    name,
    full_name: fullName,
    html_url: `https://github.com/${fullName}`,
    visibility: "public"
  };
}

function rawIssue(fullName, number, { state = "open" } = {}) {
  return {
    id: `${fullName}#${number}`,
    number,
    title: `Issue ${number}`,
    html_url: `https://github.com/${fullName}/issues/${number}`,
    state,
    labels: [],
    assignees: [],
    updated_at: "2026-08-23T00:00:00Z"
  };
}

function ref(fullName, repositoryId, number) {
  return {
    repositoryHost: "github.com",
    repositoryId,
    repository: fullName,
    number
  };
}

function validGovernance(dependencies) {
  return {
    authority: "Inari",
    status: "valid",
    valid: true,
    classification: "valid",
    template: null,
    violations: [],
    dependencies,
    revision: "sha256:tree",
    reason: null
  };
}

test("same-repository blocker keeps an Issue blocked until it is resolved", async () => {
  const config = { organization: "yohn-jp", repositories: ["alpha"] };
  const issues = {
    "yohn-jp/alpha": [
      rawIssue("yohn-jp/alpha", 1),
      rawIssue("yohn-jp/alpha", 2)
    ]
  };
  const fetchImpl = async (url) => {
    if (url.endsWith("/repos/yohn-jp/alpha"))
      return response(repositoryBody(10, "yohn-jp/alpha"));
    if (url.includes("/repos/yohn-jp/alpha/issues?state=open"))
      return response(issues["yohn-jp/alpha"]);
    if (url.endsWith("/repos/yohn-jp/alpha/issues/1"))
      return response(rawIssue("yohn-jp/alpha", 1));
    throw new Error(`Unexpected URL: ${url}`);
  };
  const governanceImpl = async ({ issue }) =>
    issue.number === 2
      ? validGovernance({
          blockedBy: [ref("yohn-jp/alpha", "10", 1)],
          blocks: []
        })
      : validGovernance({ blockedBy: [], blocks: [] });

  const data = await collectDashboardData({
    config,
    fetchImpl,
    token: "installation-token",
    governancePreflight: async () => ({ status: "healthy" }),
    governanceImpl
  });

  const blocked = data.issues.find((issue) => issue.number === 2);
  assert.equal(blocked.relationships.blockers.status, "available");
  assert.equal(blocked.relationships.blockers.blocked, true);
  assert.equal(blocked.relationships.blockers.blockedBy[0].number, 1);
  assert.equal(
    blocked.relationships.blockers.blockedBy[0].repository.fullName,
    "yohn-jp/alpha"
  );
  assert.equal(blocked.relationships.blockers.blockedBy[0].title, "Issue 1");
  assert.equal(blocked.relationships.blockers.blockedBy[0].resolved, false);
  assert.equal(data.metrics.blockedIssueCount, 1);
  assert.equal(data.metrics.unresolvedBlockerEdgeCount, 1);
});

test("cross-repository blocker references preserve the blocking repository identity", async () => {
  const config = { organization: "yohn-jp", repositories: ["alpha", "beta"] };
  const fetchImpl = async (url) => {
    if (url.endsWith("/repos/yohn-jp/alpha"))
      return response(repositoryBody(10, "yohn-jp/alpha"));
    if (url.endsWith("/repos/yohn-jp/beta"))
      return response(repositoryBody(20, "yohn-jp/beta"));
    if (url.includes("/repos/yohn-jp/alpha/issues?state=open"))
      return response([rawIssue("yohn-jp/alpha", 3)]);
    if (url.includes("/repos/yohn-jp/beta/issues?state=open"))
      return response([rawIssue("yohn-jp/beta", 9)]);
    if (url.endsWith("/repos/yohn-jp/beta/issues/9"))
      return response(rawIssue("yohn-jp/beta", 9));
    throw new Error(`Unexpected URL: ${url}`);
  };
  const governanceImpl = async ({ issue, repository }) =>
    repository.fullName === "yohn-jp/alpha" && issue.number === 3
      ? validGovernance({
          blockedBy: [ref("yohn-jp/beta", "20", 9)],
          blocks: []
        })
      : validGovernance({ blockedBy: [], blocks: [] });

  const data = await collectDashboardData({
    config,
    fetchImpl,
    token: "installation-token",
    governancePreflight: async () => ({ status: "healthy" }),
    governanceImpl
  });

  const blocked = data.issues.find(
    (issue) =>
      issue.repository.fullName === "yohn-jp/alpha" && issue.number === 3
  );
  assert.equal(blocked.relationships.blockers.blocked, true);
  const blocker = blocked.relationships.blockers.blockedBy[0];
  assert.equal(blocker.repository.fullName, "yohn-jp/beta");
  assert.equal(blocker.number, 9);
  assert.equal(blocker.url, "https://github.com/yohn-jp/beta/issues/9");
  assert.equal(data.metrics.blockedIssueCount, 1);
});

test("a closed blocker no longer keeps the Issue blocked", async () => {
  const config = { organization: "yohn-jp", repositories: ["alpha"] };
  const fetchImpl = async (url) => {
    if (url.endsWith("/repos/yohn-jp/alpha"))
      return response(repositoryBody(10, "yohn-jp/alpha"));
    if (url.includes("/repos/yohn-jp/alpha/issues?state=open"))
      return response([rawIssue("yohn-jp/alpha", 2)]);
    if (url.endsWith("/repos/yohn-jp/alpha/issues/1"))
      return response(rawIssue("yohn-jp/alpha", 1, { state: "closed" }));
    throw new Error(`Unexpected URL: ${url}`);
  };
  const governanceImpl = async () =>
    validGovernance({ blockedBy: [ref("yohn-jp/alpha", "10", 1)], blocks: [] });

  const data = await collectDashboardData({
    config,
    fetchImpl,
    token: "installation-token",
    governancePreflight: async () => ({ status: "healthy" }),
    governanceImpl
  });

  const issue = data.issues[0];
  assert.equal(issue.relationships.blockers.blocked, false);
  assert.equal(issue.relationships.blockers.blockedBy[0].resolved, true);
  assert.equal(issue.relationships.blockers.blockedBy[0].state, "closed");
  assert.equal(data.metrics.blockedIssueCount, 0);
  assert.equal(data.metrics.unresolvedBlockerEdgeCount, 0);
});

test("unavailable dependency projection fails closed and is never read as unblocked", async () => {
  const config = { organization: "yohn-jp", repositories: ["alpha"] };
  const fetchImpl = async (url) => {
    if (url.endsWith("/repos/yohn-jp/alpha"))
      return response(repositoryBody(10, "yohn-jp/alpha"));
    if (url.includes("/repos/yohn-jp/alpha/issues?state=open"))
      return response([rawIssue("yohn-jp/alpha", 1)]);
    throw new Error(`Unexpected URL: ${url}`);
  };

  const data = await collectDashboardData({
    config,
    fetchImpl,
    token: "installation-token",
    governancePreflight: async () => ({ status: "healthy" }),
    governanceImpl: async () => {
      throw new Error("evaluator failed");
    }
  });

  const issue = data.issues[0];
  assert.equal(issue.relationships.blockers.status, "unavailable");
  assert.equal(issue.relationships.blockers.blocked, false);
  assert.equal(issue.relationships.blockers.blockedBy.length, 0);
  assert.equal(data.metrics.dependencyProjectionUnavailable, 1);
  assert.equal(data.metrics.blockedIssueCount, 0);
});

test("governance-invalid Issues never expose a dependency projection either", async () => {
  const config = { organization: "yohn-jp", repositories: ["alpha"] };
  const fetchImpl = async (url) => {
    if (url.endsWith("/repos/yohn-jp/alpha"))
      return response(repositoryBody(10, "yohn-jp/alpha"));
    if (url.includes("/repos/yohn-jp/alpha/issues?state=open"))
      return response([rawIssue("yohn-jp/alpha", 1)]);
    throw new Error(`Unexpected URL: ${url}`);
  };

  const data = await collectDashboardData({
    config,
    fetchImpl,
    token: "installation-token",
    governancePreflight: async () => ({ status: "healthy" }),
    governanceImpl: async () => ({
      authority: "Inari",
      status: "invalid",
      valid: false,
      classification: "semantic",
      template: null,
      violations: [{ code: "FIELD_MISSING", path: "$.problem" }],
      revision: "sha256:tree",
      reason: null
      // gh-inari never projects `dependencies` for an invalid artifact.
    })
  });

  const issue = data.issues[0];
  assert.equal(issue.governance.status, "invalid");
  assert.equal(issue.relationships.blockers.status, "unavailable");
  assert.equal(data.metrics.dependencyProjectionUnavailable, 1);
});

test("a reciprocal blockedBy/blocks declaration counts as one unresolved edge", async () => {
  const config = { organization: "yohn-jp", repositories: ["alpha"] };
  const fetchImpl = async (url) => {
    if (url.endsWith("/repos/yohn-jp/alpha"))
      return response(repositoryBody(10, "yohn-jp/alpha"));
    if (url.includes("/repos/yohn-jp/alpha/issues?state=open"))
      return response([
        rawIssue("yohn-jp/alpha", 1),
        rawIssue("yohn-jp/alpha", 2)
      ]);
    if (url.endsWith("/repos/yohn-jp/alpha/issues/1"))
      return response(rawIssue("yohn-jp/alpha", 1));
    if (url.endsWith("/repos/yohn-jp/alpha/issues/2"))
      return response(rawIssue("yohn-jp/alpha", 2));
    throw new Error(`Unexpected URL: ${url}`);
  };
  // Issue 2 declares blockedBy 1, and Issue 1 independently declares blocks 2:
  // the same directed edge (1 -> 2) declared from both ends.
  const governanceImpl = async ({ issue }) => {
    if (issue.number === 2) {
      return validGovernance({
        blockedBy: [ref("yohn-jp/alpha", "10", 1)],
        blocks: []
      });
    }
    return validGovernance({
      blockedBy: [],
      blocks: [ref("yohn-jp/alpha", "10", 2)]
    });
  };

  const data = await collectDashboardData({
    config,
    fetchImpl,
    token: "installation-token",
    governancePreflight: async () => ({ status: "healthy" }),
    governanceImpl
  });

  assert.equal(data.metrics.unresolvedBlockerEdgeCount, 1);
  assert.equal(data.metrics.blockedIssueCount, 1);
  assert.equal(data.metrics.blockingIssueCount, 1);
});
