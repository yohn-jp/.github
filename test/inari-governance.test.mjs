import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { compileLocalGovernedContract } from "gh-inari/governance";
import { renderIssueArtifact } from "gh-inari/artifact";
import {
  collectIssueGovernance,
  GOVERNANCE_REASON_CODES,
  preflightIssueGovernance
} from "../scripts/inari-governance.mjs";

const repository = { fullName: "yohn-jp/example" };

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

test("governance preflight fails closed without authentication and does not fetch", async () => {
  let calls = 0;
  const result = await preflightIssueGovernance({
    repository,
    token: "",
    fetchImpl: async () => {
      calls += 1;
      throw new Error("anonymous governance fetch must not run");
    }
  });

  assert.equal(calls, 0);
  assert.equal(result.status, "unavailable");
  assert.equal(
    result.reason,
    GOVERNANCE_REASON_CODES.AUTHENTICATION_UNAVAILABLE
  );
  assert.equal(result.diagnostics[0].code, "AUTHENTICATION_UNAVAILABLE");
  assert.equal(result.diagnostics[0].stage, "preflight");
});

test("governance preflight distinguishes insufficient permissions", async () => {
  const result = await preflightIssueGovernance({
    repository,
    token: "installation-token",
    fetchImpl: async (url) => {
      if (url.endsWith("/repos/yohn-jp/example")) {
        return response({ id: 10, default_branch: "main" });
      }
      return response(
        { message: "Resource not accessible by integration" },
        403
      );
    }
  });

  assert.equal(result.status, "unavailable");
  assert.equal(result.reason, GOVERNANCE_REASON_CODES.INSUFFICIENT_PERMISSIONS);
  assert.equal(result.diagnostics[0].code, "INSUFFICIENT_PERMISSIONS");
  assert.equal(result.diagnostics[0].status, 403);
});

test("governance preflight treats a missing 404 source as an Inari contract failure", async () => {
  const result = await preflightIssueGovernance({
    repository,
    token: "installation-token",
    fetchImpl: async (url) => {
      if (url.endsWith("/repos/yohn-jp/example")) {
        return response({ id: 10, default_branch: "main" });
      }
      return response({ message: "Not Found" }, 404);
    }
  });

  assert.equal(result.status, "unavailable");
  assert.equal(
    result.reason,
    GOVERNANCE_REASON_CODES.INARI_CONTRACT_UNAVAILABLE
  );
  assert.equal(result.diagnostics[0].code, "INARI_CONTRACT_UNAVAILABLE");
  assert.equal(result.diagnostics[0].status, 404);
});

test("governance preflight recognizes explicit permission evidence in a 404", async () => {
  const result = await preflightIssueGovernance({
    repository,
    token: "installation-token",
    fetchImpl: async (url) => {
      if (url.endsWith("/repos/yohn-jp/example")) {
        return response({ id: 10, default_branch: "main" });
      }
      return response(
        { message: "Resource not accessible by integration" },
        404
      );
    }
  });

  assert.equal(result.status, "unavailable");
  assert.equal(result.reason, GOVERNANCE_REASON_CODES.INSUFFICIENT_PERMISSIONS);
  assert.equal(result.diagnostics[0].code, "INSUFFICIENT_PERMISSIONS");
  assert.equal(result.diagnostics[0].status, 404);
});

test("governance preflight classifies contract blob permission failures", async () => {
  const result = await preflightIssueGovernance({
    repository,
    token: "installation-token",
    fetchImpl: async (url) => {
      if (url.endsWith("/repos/yohn-jp/example")) {
        return response({ id: 10, default_branch: "main" });
      }
      if (url.includes("/git/trees/main")) {
        return response({
          sha: "tree-sha",
          truncated: false,
          tree: [
            {
              path: ".github/ISSUE_TEMPLATE/feature.yml",
              type: "blob",
              sha: "template"
            }
          ]
        });
      }
      if (url.endsWith("/git/blobs/template")) {
        return response(
          { message: "Resource not accessible by integration" },
          403
        );
      }
      throw new Error(`unexpected URL: ${url}`);
    }
  });

  assert.equal(result.status, "unavailable");
  assert.equal(result.reason, GOVERNANCE_REASON_CODES.INSUFFICIENT_PERMISSIONS);
  assert.equal(result.diagnostics[0].code, "INSUFFICIENT_PERMISSIONS");
  assert.equal(result.diagnostics[0].status, 403);
});

test("governance preflight reports Inari contract discovery failure separately", async () => {
  const result = await preflightIssueGovernance({
    repository,
    token: "installation-token",
    fetchImpl: async (url) => {
      if (url.endsWith("/repos/yohn-jp/example")) {
        return response({ id: 10, default_branch: "main" });
      }
      if (url.includes("/git/trees/main")) {
        return response({ sha: "tree-sha", truncated: false, tree: [] });
      }
      throw new Error(`unexpected URL: ${url}`);
    }
  });

  assert.equal(result.status, "unavailable");
  assert.equal(
    result.reason,
    GOVERNANCE_REASON_CODES.INARI_CONTRACT_UNAVAILABLE
  );
  assert.equal(result.diagnostics[0].code, "INARI_CONTRACT_UNAVAILABLE");
  assert.equal(result.diagnostics[0].stage, "preflight");
});

test("authenticated governance preflight discovers an Inari contract", async () => {
  const [semantic, native] = await Promise.all([
    readFile(".github/inari/issues/feature.json", "utf8"),
    readFile(".github/ISSUE_TEMPLATE/feature.yml", "utf8")
  ]);
  const sources = new Map([
    ["semantic", semantic],
    ["native", native]
  ]);
  const result = await preflightIssueGovernance({
    repository,
    token: "installation-token",
    fetchImpl: async (url) => {
      if (url.endsWith("/repos/yohn-jp/example")) {
        return response({ id: 10, default_branch: "main" });
      }
      if (url.includes("/git/trees/main")) {
        return response({
          sha: "tree-sha",
          truncated: false,
          tree: [
            {
              path: ".github/inari/issues/feature.json",
              type: "blob",
              sha: "semantic"
            },
            {
              path: ".github/ISSUE_TEMPLATE/feature.yml",
              type: "blob",
              sha: "native"
            }
          ]
        });
      }
      const source = url.match(/git\/blobs\/(semantic|native)$/)?.[1];
      if (source) {
        return response({
          sha: source,
          encoding: "base64",
          content: Buffer.from(sources.get(source)).toString("base64")
        });
      }
      throw new Error(`unexpected URL: ${url}`);
    }
  });

  assert.equal(result.status, "healthy");
  assert.equal(result.available, true);
  assert.equal(result.contractCount, 1);
  assert.equal(result.revision, "tree-sha");
  assert.deepEqual(result.diagnostics, []);
  assert.equal(typeof result.reader, "function");
});

test("Issue read permission failures stay unavailable and fail closed", async () => {
  const result = await collectIssueGovernance({
    issue: { number: 7 },
    repository,
    token: "installation-token",
    reader: async () => {
      const error = new Error("HTTP 403: permission denied");
      error.status = 403;
      throw error;
    }
  });

  assert.equal(result.status, "unavailable");
  assert.equal(result.valid, null);
  assert.equal(result.reason, GOVERNANCE_REASON_CODES.INSUFFICIENT_PERMISSIONS);
  assert.equal(result.diagnostics[0].code, "INSUFFICIENT_PERMISSIONS");
});

async function featureTemplateFetch(rawIssues) {
  const [semantic, native] = await Promise.all([
    readFile(".github/inari/issues/feature.json", "utf8"),
    readFile(".github/ISSUE_TEMPLATE/feature.yml", "utf8")
  ]);
  const sources = new Map([
    ["semantic", semantic],
    ["native", native]
  ]);
  const issues = new Map(rawIssues.map((issue) => [issue.number, issue]));
  return async (url) => {
    if (url.endsWith("/repos/yohn-jp/example")) {
      return response({ id: 10, default_branch: "main" });
    }
    if (url.includes("/git/trees/main")) {
      return response({
        sha: "tree-sha",
        truncated: false,
        tree: [
          {
            path: ".github/inari/issues/feature.json",
            type: "blob",
            sha: "semantic"
          },
          {
            path: ".github/ISSUE_TEMPLATE/feature.yml",
            type: "blob",
            sha: "native"
          }
        ]
      });
    }
    const source = url.match(/git\/blobs\/(semantic|native)$/)?.[1];
    if (source) {
      return response({
        sha: source,
        encoding: "base64",
        content: Buffer.from(sources.get(source)).toString("base64")
      });
    }
    const issueMatch = url.match(/\/issues\/(\d+)$/);
    if (issueMatch && issues.has(Number(issueMatch[1]))) {
      return response(issues.get(Number(issueMatch[1])));
    }
    throw new Error(`unexpected URL: ${url}`);
  };
}

test("a real Inari render/parse round trip projects the declared dependency marker", async () => {
  const contract = await compileLocalGovernedContract(
    "issue",
    process.cwd(),
    "feature"
  );
  const body = renderIssueArtifact(contract, {
    fields: {
      problem: "Users cannot see blocker state.",
      capability: "Project blockers into Portal.",
      contract: "Portal consumes the Inari dependency projection.",
      acceptance: "- [ ] done",
      non_goals: "None."
    },
    metadata: { title: "feat: blockers", labels: ["enhancement"] },
    dependencies: {
      blockedBy: [
        {
          repositoryHost: "github.com",
          repositoryId: "999",
          repository: "yohn-jp/other",
          number: 42
        }
      ],
      blocks: []
    }
  });
  const rawIssue = {
    id: 1,
    number: 7,
    title: "feat: blockers",
    html_url: "https://github.com/yohn-jp/example/issues/7",
    state: "open",
    body,
    labels: [],
    assignees: [],
    updated_at: "2026-08-23T00:00:00Z"
  };

  const fetchImpl = await featureTemplateFetch([rawIssue]);
  const preflight = await preflightIssueGovernance({
    repository,
    token: "installation-token",
    rawIssues: [rawIssue],
    fetchImpl
  });
  assert.equal(preflight.status, "healthy");

  const governance = await collectIssueGovernance({
    issue: { number: 7 },
    repository,
    rawIssues: [rawIssue],
    fetchImpl,
    token: "installation-token",
    reader: preflight.reader
  });

  assert.equal(governance.status, "valid");
  assert.deepEqual(governance.dependencies.blocks, []);
  assert.equal(governance.dependencies.blockedBy.length, 1);
  assert.deepEqual(governance.dependencies.blockedBy[0], {
    repositoryHost: "github.com",
    repositoryId: "999",
    repository: "yohn-jp/other",
    number: 42
  });
});

test("an artifact that fails canonical validation never projects dependencies", async () => {
  const contract = await compileLocalGovernedContract(
    "issue",
    process.cwd(),
    "feature"
  );
  const body = renderIssueArtifact(contract, {
    fields: {
      problem: "Users cannot see blocker state.",
      capability: "Project blockers into Portal.",
      contract: "Portal consumes the Inari dependency projection.",
      acceptance: "- [ ] done",
      non_goals: "None."
    },
    metadata: { title: "feat: blockers", labels: ["enhancement"] },
    dependencies: {
      blockedBy: [
        {
          repositoryHost: "github.com",
          repositoryId: "999",
          repository: "yohn-jp/other",
          number: 42
        }
      ],
      blocks: []
    }
  });
  // Corrupt a required section so the artifact fails canonical validation
  // even though the trailing dependency marker is still well-formed.
  const invalidBody = body.replace("### Problem", "### Not a real section");
  const rawIssue = {
    id: 1,
    number: 7,
    title: "feat: blockers",
    html_url: "https://github.com/yohn-jp/example/issues/7",
    state: "open",
    body: invalidBody,
    labels: [],
    assignees: [],
    updated_at: "2026-08-23T00:00:00Z"
  };

  const fetchImpl = await featureTemplateFetch([rawIssue]);
  const preflight = await preflightIssueGovernance({
    repository,
    token: "installation-token",
    rawIssues: [rawIssue],
    fetchImpl
  });
  assert.equal(preflight.status, "healthy");

  const governance = await collectIssueGovernance({
    issue: { number: 7 },
    repository,
    rawIssues: [rawIssue],
    fetchImpl,
    token: "installation-token",
    reader: preflight.reader
  });

  assert.equal(governance.status, "invalid");
  assert.equal(governance.dependencies, null);
});
