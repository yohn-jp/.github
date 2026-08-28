import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDashboard } from "../scripts/build-dashboard.mjs";
import {
  collectDashboardData,
  normalizeIssue,
  normalizeRepository,
  parseLinkHeader
} from "../scripts/dashboard-data.mjs";
import { dashboardConfigFromRegistry } from "../scripts/portal-registry.mjs";

function response(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

test("normalizes repository and issue metadata while keeping extensible relationships", () => {
  const repository = normalizeRepository({
    id: 10,
    name: "example",
    full_name: "yohn-jp/example",
    html_url: "https://github.com/yohn-jp/example",
    visibility: "public"
  });
  const issue = normalizeIssue(
    {
      id: 20,
      number: 4,
      title: "Dashboard issue",
      html_url: "https://github.com/yohn-jp/example/issues/4",
      state: "open",
      state_reason: "reopened",
      created_at: "2026-08-20T01:02:03Z",
      labels: [{ name: "enhancement", color: "a2eeef" }],
      type: { name: "Feature" },
      milestone: {
        title: "v1",
        html_url: "https://github.com/yohn-jp/example/milestone/1"
      },
      assignee: { login: "yohnark", html_url: "https://github.com/yohnark" },
      assignees: [],
      updated_at: "2026-08-23T01:02:03Z"
    },
    repository
  );

  assert.equal(issue.repository.fullName, "yohn-jp/example");
  assert.equal(issue.number, 4);
  assert.equal(issue.stateReason, "reopened");
  assert.equal(issue.createdAt, "2026-08-20T01:02:03Z");
  assert.deepEqual(issue.labels, [{ name: "enhancement", color: "a2eeef" }]);
  assert.equal(issue.type, "Feature");
  assert.equal(issue.milestone.title, "v1");
  assert.equal(issue.assignee.login, "yohnark");
  assert.deepEqual(issue.relationships, {});
});

test("parses pagination links", () => {
  assert.deepEqual(
    parseLinkHeader(
      '<https://api.github.com/page=2>; rel="next", <https://api.github.com/page=4>; rel="last"'
    ),
    {
      next: "https://api.github.com/page=2",
      last: "https://api.github.com/page=4"
    }
  );
});

test("projects Inari governance as valid, invalid, or unavailable per open Issue", async () => {
  const config = { organization: "yohn-jp", repositories: ["example"] };
  const repository = {
    id: 1,
    name: "example",
    full_name: "yohn-jp/example",
    html_url: "https://github.com/yohn-jp/example",
    visibility: "public"
  };
  const issues = [1, 2, 3].map((number) => ({
    id: number,
    number,
    title: `Issue ${number}`,
    html_url: `https://github.com/yohn-jp/example/issues/${number}`,
    state: "open",
    labels: [],
    assignees: [],
    updated_at: "2026-08-23T00:00:00Z"
  }));
  const fetchImpl = async (url) => {
    if (url.endsWith("/repos/yohn-jp/example")) return response(repository);
    if (url.includes("/repos/yohn-jp/example/issues")) return response(issues);
    throw new Error(`Unexpected URL: ${url}`);
  };
  const governanceImpl = async ({ issue }) => {
    if (issue.number === 1) {
      return {
        authority: "Inari",
        status: "valid",
        valid: true,
        classification: "valid",
        template: {
          id: "feature",
          name: "Feature",
          path: ".github/ISSUE_TEMPLATE/feature.yml",
          source: "issue_form"
        },
        violations: [],
        revision: "sha256:tree-1",
        reason: null
      };
    }
    if (issue.number === 2) {
      return {
        authority: "Inari",
        status: "invalid",
        valid: false,
        classification: "semantic",
        template: {
          id: "feature",
          name: "Feature",
          path: ".github/ISSUE_TEMPLATE/feature.yml",
          source: "issue_form"
        },
        violations: [{ code: "FIELD_MISSING", path: "$.problem" }],
        revision: "sha256:tree-1",
        reason: null
      };
    }
    return {
      authority: "Inari",
      status: "unavailable",
      valid: null,
      classification: "unknown",
      template: null,
      violations: [],
      revision: null,
      reason: "authentication-unavailable"
    };
  };

  const data = await collectDashboardData({
    config,
    fetchImpl,
    token: "portal-token",
    governanceImpl,
    now: () => new Date("2026-08-23T02:00:00Z")
  });

  assert.equal(data.schemaVersion, 4);
  assert.equal(data.status, "complete");
  assert.equal(data.metrics.governanceDataUnavailable, 1);
  assert.equal(data.metrics.governanceValid, 1);
  assert.equal(data.metrics.governanceInvalid, 1);
  assert.equal(data.metrics.governanceUnknown, 1);
  assert.deepEqual(data.metrics.governanceCompliance, {
    valid: 1,
    invalid: 1,
    unknown: 1
  });
  assert.deepEqual(
    data.issues.map(({ governance }) => governance.status).sort(),
    ["invalid", "unavailable", "valid"]
  );
  assert.equal(
    data.issues.find((issue) => issue.number === 1).governance.revision,
    "sha256:tree-1"
  );
  assert.equal(
    data.issues.find((issue) => issue.number === 2).governance.valid,
    false
  );
  assert.equal(
    data.issues.find((issue) => issue.number === 3).governance.valid,
    null
  );
});

test("fails closed when governance projection is unavailable", async () => {
  const config = { organization: "yohn-jp", repositories: ["example"] };
  const repository = {
    id: 1,
    name: "example",
    full_name: "yohn-jp/example",
    html_url: "https://github.com/yohn-jp/example",
    visibility: "public"
  };
  const rawIssue = {
    id: 1,
    number: 1,
    title: "Issue",
    html_url: "https://github.com/yohn-jp/example/issues/1",
    state: "open",
    labels: [],
    assignees: [],
    updated_at: "2026-08-23T00:00:00Z"
  };
  const fetchImpl = async (url) => {
    if (url.endsWith("/repos/yohn-jp/example")) return response(repository);
    if (url.includes("/repos/yohn-jp/example/issues"))
      return response([rawIssue]);
    throw new Error(`Unexpected URL: ${url}`);
  };

  const data = await collectDashboardData({
    config,
    fetchImpl,
    token: "portal-token",
    governanceImpl: async () => {
      throw new Error("governance source unavailable");
    }
  });

  assert.equal(data.issues[0].governance.status, "unavailable");
  assert.equal(data.issues[0].governance.valid, null);
  assert.equal(data.metrics.governanceUnknown, 1);
  assert.equal(data.metrics.governanceValid, 0);
  assert.equal(data.status, "partial");
});

test("marks rate-limited repositories partial and excludes pull requests", async () => {
  const config = {
    organization: "yohn-jp",
    repositories: ["healthy", "limited"]
  };
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/repos/yohn-jp/healthy")) {
      return response({
        id: 1,
        name: "healthy",
        full_name: "yohn-jp/healthy",
        html_url: url,
        visibility: "public"
      });
    }
    if (url.includes("/repos/yohn-jp/healthy/issues")) {
      return response([
        {
          id: 11,
          number: 1,
          title: "Issue",
          html_url: `${url}/1`,
          state: "open",
          labels: [],
          assignees: [],
          updated_at: "2026-08-23T00:00:00Z"
        },
        {
          id: 12,
          number: 2,
          title: "Pull request",
          html_url: `${url}/2`,
          state: "open",
          pull_request: { url: "https://api.github.com/pulls/2" },
          labels: [],
          assignees: [],
          updated_at: "2026-08-23T00:00:00Z"
        }
      ]);
    }
    if (url.endsWith("/repos/yohn-jp/limited")) {
      return response({
        id: 2,
        name: "limited",
        full_name: "yohn-jp/limited",
        html_url: url,
        visibility: "public"
      });
    }
    if (url.includes("/repos/yohn-jp/limited/issues")) {
      return response({ message: "API rate limit exceeded" }, 429, {
        "x-ratelimit-remaining": "0"
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const data = await collectDashboardData({
    config,
    fetchImpl,
    now: () => new Date("2026-08-23T02:00:00Z")
  });

  assert.equal(data.status, "partial");
  assert.equal(data.metrics.issueCount, 1);
  assert.equal(data.metrics.successfulRepositories, 1);
  assert.equal(data.metrics.failedRepositories, 1);
  assert.equal(data.issues[0].title, "Issue");
  assert.equal(data.errors[0].rateLimited, true);
  assert.equal(data.repositories[1].openIssueCount, null);
  assert.ok(calls.every(({ options }) => !options.headers.Authorization));
});

test("browser assets contain no GitHub API credential path", async () => {
  for (const path of [
    "portal/index.html",
    "portal/styles.css",
    "dashboard/app.js"
  ]) {
    const asset = await readFile(path, "utf8");
    assert.doesNotMatch(
      asset,
      /api\.github\.com|Authorization|GITHUB_TOKEN|GH_TOKEN/
    );
  }
});

test("build publishes portal root, CNAME, and dashboard under work", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "yohn-jp-portal-"));
  const outputDirectory = join(temporaryDirectory, "site");
  const registryPath = join(temporaryDirectory, "registry.json");
  const registry = JSON.parse(await readFile("portal/registry.json", "utf8"));
  registry.collectionRepositories = ["example"];
  await writeFile(registryPath, JSON.stringify(registry));

  const fetchImpl = async (url, options) => {
    assert.equal(options.headers.Authorization, "Bearer build-token");
    const repositoryMatch = url.match(/\/repos\/yohn-jp\/([^/]+)$/);
    if (repositoryMatch) {
      const name = repositoryMatch[1];
      return response({
        id: name,
        name,
        full_name: `yohn-jp/${name}`,
        html_url: `https://github.com/yohn-jp/${name}`,
        visibility: "public"
      });
    }
    if (url.includes("/issues")) {
      const repository = url.match(/\/repos\/yohn-jp\/([^/]+)\/issues/)?.[1];
      if (repository !== "example") return response([]);
      return response([
        {
          id: 11,
          number: 1,
          title: "Portal issue",
          html_url: "https://github.com/yohn-jp/example/issues/1",
          state: "open",
          labels: [],
          assignees: [],
          updated_at: "2026-08-23T00:00:00Z"
        }
      ]);
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  try {
    await buildDashboard({
      outputDirectory,
      registryPath,
      fetchImpl,
      token: "build-token",
      governanceImpl: async () => ({
        authority: "Inari",
        status: "unavailable",
        valid: null,
        classification: "unknown",
        template: null,
        violations: [],
        revision: null,
        reason: "test-fixture"
      }),
      now: () => new Date("2026-08-23T03:00:00Z")
    });

    const rootIndex = await readFile(
      join(outputDirectory, "index.html"),
      "utf8"
    );
    const cname = await readFile(join(outputDirectory, "CNAME"), "utf8");
    const workIndex = await readFile(
      join(outputDirectory, "work", "index.html"),
      "utf8"
    );
    const workApp = await readFile(
      join(outputDirectory, "work", "app.js"),
      "utf8"
    );
    const governanceIndex = await readFile(
      join(outputDirectory, "work", "governance", "index.html"),
      "utf8"
    );
    const governanceApp = await readFile(
      join(outputDirectory, "work", "governance", "governance.js"),
      "utf8"
    );
    const data = JSON.parse(
      await readFile(
        join(outputDirectory, "work", "data", "dashboard.json"),
        "utf8"
      )
    );

    assert.equal(cname.trim(), "dev.yohn.jp");
    assert.match(rootIndex, /https:\/\/dev\.yohn\.jp\//);
    assert.match(rootIndex, /href="\.\/work\/"/);
    for (const product of [
      "Mottainai",
      "Nawabari",
      "Inari",
      "Suzukuri",
      "Wabachi"
    ]) {
      assert.match(rootIndex, new RegExp(product));
    }
    assert.match(workIndex, /href="\.\.\/"/);
    assert.match(workApp, /fetch\("\.\/data\/dashboard\.json"/);
    assert.match(governanceIndex, /Governance health/);
    assert.match(governanceApp, /fetch\("\.\.\/data\/dashboard\.json"/);
    assert.match(governanceApp, /health\.overall/);
    assert.equal(data.metrics.issueCount, 1);
    assert.equal(data.schemaVersion, 4);
    assert.deepEqual(data.governanceHealth.overall, {
      valid: 0,
      invalid: 0,
      unknown: 1,
      total: 1,
      known: 0,
      complianceRate: null
    });
    assert.equal(data.issues[0].title, "Portal issue");
    assert.deepEqual(
      data.source.repositories,
      dashboardConfigFromRegistry(registry).repositories.map(
        (repository) => `${registry.organization}/${repository}`
      )
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
