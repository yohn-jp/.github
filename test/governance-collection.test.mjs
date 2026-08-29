import test from "node:test";
import assert from "node:assert/strict";
import { collectDashboardData } from "../scripts/dashboard-data.mjs";
import {
  createGovernanceDiagnostic,
  GOVERNANCE_REASON_CODES
} from "../scripts/inari-governance.mjs";

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function rawIssue(repository, number) {
  return {
    id: `${repository}-${number}`,
    number,
    title: `Issue ${number}`,
    html_url: `https://github.com/yohn-jp/${repository}/issues/${number}`,
    state: "open",
    labels: [],
    assignees: [],
    updated_at: "2026-08-23T00:00:00Z"
  };
}

function publicRepository(name) {
  return {
    id: name,
    name,
    full_name: `yohn-jp/${name}`,
    html_url: `https://github.com/yohn-jp/${name}`,
    visibility: "public"
  };
}

function restForRepositories(repositoryIssues) {
  return async (url) => {
    const match = url.match(/\/repos\/yohn-jp\/([^/]+)/);
    const name = match?.[1];
    if (url.endsWith(`/repos/yohn-jp/${name}`)) {
      return response(publicRepository(name));
    }
    if (url.includes(`/repos/yohn-jp/${name}/issues`)) {
      return response(repositoryIssues[name] ?? []);
    }
    throw new Error(`unexpected URL: ${url}`);
  };
}

test("authentication preflight runs before evaluation and leaves every Issue unknown", async () => {
  let evaluations = 0;
  const data = await collectDashboardData({
    config: { organization: "yohn-jp", repositories: ["example"] },
    fetchImpl: restForRepositories({ example: [rawIssue("example", 1)] }),
    governanceImpl: async () => {
      evaluations += 1;
      return { status: "valid", valid: true };
    }
  });

  assert.equal(evaluations, 0);
  assert.equal(data.status, "partial");
  assert.equal(data.issues[0].governance.status, "unavailable");
  assert.equal(
    data.issues[0].governance.reason,
    GOVERNANCE_REASON_CODES.AUTHENTICATION_UNAVAILABLE
  );
  assert.equal(data.issues[0].governance.valid, null);
  assert.equal(data.repositories[0].governance.status, "unavailable");
  assert.equal(data.governanceHealth.collection.status, "unavailable");
  assert.deepEqual(data.governanceHealth.collection.causes, [
    {
      reason: GOVERNANCE_REASON_CODES.AUTHENTICATION_UNAVAILABLE,
      code: "AUTHENTICATION_UNAVAILABLE",
      issueCount: 1,
      repositoryCount: 1,
      count: 2,
      messages: [
        "Portal collection token is unavailable; authenticated Inari repository access is required."
      ]
    }
  ]);
});

test("repository source permission failures remain distinct from source outages", async () => {
  const data = await collectDashboardData({
    config: { organization: "yohn-jp", repositories: ["limited"] },
    token: "installation-token",
    fetchImpl: async (url) => {
      if (url.endsWith("/repos/yohn-jp/limited")) {
        return response(publicRepository("limited"));
      }
      if (url.includes("/issues?state=open")) {
        return response(
          { message: "Resource not accessible by integration" },
          403
        );
      }
      throw new Error(`unexpected URL: ${url}`);
    }
  });

  assert.equal(data.repositories[0].governance.status, "unavailable");
  assert.equal(
    data.repositories[0].governance.reason,
    GOVERNANCE_REASON_CODES.INSUFFICIENT_PERMISSIONS
  );
  assert.equal(data.governanceHealth.collection.status, "unavailable");
  assert.equal(
    data.governanceHealth.collection.causes[0].reason,
    GOVERNANCE_REASON_CODES.INSUFFICIENT_PERMISSIONS
  );
  assert.equal(data.status, "failed");
});

test("partial repository governance degradation is projected with cause counts", async () => {
  const events = [];
  const data = await collectDashboardData({
    config: {
      organization: "yohn-jp",
      repositories: ["healthy", "limited"]
    },
    token: "installation-token",
    fetchImpl: restForRepositories({
      healthy: [rawIssue("healthy", 1)],
      limited: [rawIssue("limited", 2)]
    }),
    governancePreflight: async ({ repository }) => {
      events.push(`preflight:${repository.name}`);
      if (repository.name === "limited") {
        return {
          status: "unavailable",
          reason: GOVERNANCE_REASON_CODES.INSUFFICIENT_PERMISSIONS,
          diagnostics: [
            createGovernanceDiagnostic({
              reason: GOVERNANCE_REASON_CODES.INSUFFICIENT_PERMISSIONS,
              stage: "preflight",
              repository: repository.fullName,
              message: "Issues read permission is missing."
            })
          ]
        };
      }
      return { status: "healthy" };
    },
    governanceImpl: async ({ issue }) => {
      events.push(`evaluate:${issue.repository.name}`);
      return { status: "valid", valid: true, violations: [] };
    }
  });

  assert.deepEqual(events, [
    "preflight:healthy",
    "evaluate:healthy",
    "preflight:limited"
  ]);
  assert.equal(data.issues.length, 2);
  assert.equal(
    data.issues.find((issue) => issue.repository.name === "limited").governance
      .valid,
    null
  );
  assert.equal(data.repositories[0].governance.status, "healthy");
  assert.equal(data.repositories[1].governance.status, "unavailable");
  assert.equal(data.governanceHealth.collection.status, "degraded");
  assert.equal(data.governanceHealth.collection.unavailableRepositories, 1);
  assert.equal(
    data.governanceHealth.collection.causes[0].reason,
    "insufficient-permissions"
  );
  assert.equal(data.governanceHealth.collection.causes[0].repositoryCount, 1);
  assert.equal(data.governanceHealth.collection.causes[0].issueCount, 1);
});

test("unexpected evaluator failure is a distinct fail-closed diagnostic", async () => {
  const data = await collectDashboardData({
    config: { organization: "yohn-jp", repositories: ["example"] },
    token: "installation-token",
    fetchImpl: restForRepositories({ example: [rawIssue("example", 1)] }),
    governancePreflight: async () => ({ status: "healthy" }),
    governanceImpl: async () => {
      throw new Error("unexpected evaluator failure");
    }
  });

  const governance = data.issues[0].governance;
  assert.equal(governance.status, "unavailable");
  assert.equal(governance.valid, null);
  assert.equal(governance.reason, GOVERNANCE_REASON_CODES.EVALUATOR_FAILED);
  assert.equal(governance.diagnostics[0].code, "EVALUATOR_FAILED");
  assert.equal(data.repositories[0].governance.status, "degraded");
  assert.equal(data.governanceHealth.collection.status, "degraded");
  assert.equal(
    data.governanceHealth.collection.causes[0].reason,
    "evaluator-failed"
  );
  assert.equal(data.status, "partial");
});
