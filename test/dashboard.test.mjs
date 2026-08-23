import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  collectDashboardData,
  normalizeIssue,
  normalizeRepository,
  parseLinkHeader
} from "../scripts/dashboard-data.mjs";

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
  const app = await readFile("dashboard/app.js", "utf8");
  assert.doesNotMatch(
    app,
    /api\.github\.com|Authorization|GITHUB_TOKEN|GH_TOKEN/
  );
});
