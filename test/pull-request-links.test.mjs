import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectIssuePullRequests,
  normalizeLinkedPullRequest,
  PULL_REQUEST_LINKAGE_SOURCE
} from "../scripts/github-pr-links.mjs";
import { hydrateDashboardPullRequests } from "../scripts/pull-request-links.mjs";
import { buildDashboard } from "../scripts/build-dashboard.mjs";
import { buildDependencyGraph } from "../dashboard/graph/graph-model.js";

function response(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

function pullRequest({
  repository = "yohn-jp/example",
  number = 1,
  title = "Implement feature",
  state = "OPEN",
  merged = false,
  mergedAt = null
} = {}) {
  return {
    number,
    title,
    url: `https://github.com/${repository}/pull/${number}`,
    state,
    merged,
    mergedAt,
    repository: {
      nameWithOwner: repository,
      url: `https://github.com/${repository}`
    }
  };
}

function issue(number) {
  return {
    repository: {
      fullName: "yohn-jp/example",
      url: "https://github.com/yohn-jp/example"
    },
    number,
    title: `Issue ${number}`,
    url: `https://github.com/yohn-jp/example/issues/${number}`,
    state: "open",
    relationships: {
      dependencies: { status: "unavailable", blockedBy: [], blocking: [] }
    }
  };
}

test("normalizes open, merged, and closed-without-merge PR states", () => {
  assert.equal(normalizeLinkedPullRequest(pullRequest()).state, "open");
  assert.equal(
    normalizeLinkedPullRequest(
      pullRequest({ state: "CLOSED", merged: true, mergedAt: "2026-08-23T00:00:00Z" })
    ).state,
    "merged"
  );
  assert.equal(
    normalizeLinkedPullRequest(pullRequest({ state: "CLOSED", merged: false })).state,
    "closed"
  );
});

test("returns explicit unavailable linkage without authentication", async () => {
  let called = false;
  const result = await collectIssuePullRequests({
    owner: "yohn-jp",
    repo: "example",
    issueNumber: 1,
    token: "",
    fetchImpl: async () => {
      called = true;
      throw new Error("should not fetch");
    }
  });

  assert.equal(called, false);
  assert.equal(result.status, "unavailable");
  assert.equal(result.reason, "authentication-unavailable");
  assert.equal(result.source, PULL_REQUEST_LINKAGE_SOURCE);
  assert.deepEqual(result.items, []);
});

test("collects paginated same- and cross-repository authoritative links", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    assert.equal(url, "https://api.github.com/graphql");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.Authorization, "Bearer test-token");
    const request = JSON.parse(options.body);
    requests.push(request);
    assert.match(request.query, /closedByPullRequestsReferences/);
    assert.match(request.query, /includeClosedPrs:\s*true/);
    assert.match(request.query, /excludeUserLinked:\s*false/);

    if (request.variables.after === null) {
      return response({
        data: {
          repository: {
            issue: {
              closedByPullRequestsReferences: {
                nodes: [
                  pullRequest({ number: 8, title: "Open implementation" }),
                  pullRequest({
                    repository: "yohn-jp/nawabari",
                    number: 91,
                    title: "Cross-repository implementation",
                    state: "CLOSED",
                    merged: true,
                    mergedAt: "2026-08-22T10:00:00Z"
                  })
                ],
                pageInfo: { hasNextPage: true, endCursor: "page-2" }
              }
            }
          }
        }
      });
    }

    assert.equal(request.variables.after, "page-2");
    return response({
      data: {
        repository: {
          issue: {
            closedByPullRequestsReferences: {
              nodes: [
                pullRequest({
                  number: 9,
                  title: "Closed attempt",
                  state: "CLOSED",
                  merged: false
                }),
                pullRequest({ number: 8, title: "Open implementation" })
              ],
              pageInfo: { hasNextPage: false, endCursor: null }
            }
          }
        }
      }
    });
  };

  const result = await collectIssuePullRequests({
    owner: "yohn-jp",
    repo: "example",
    issueNumber: 4,
    fetchImpl,
    token: "test-token"
  });

  assert.equal(requests.length, 2);
  assert.equal(result.status, "complete");
  assert.equal(result.items.length, 3);
  assert.deepEqual(
    result.items.map((item) => [
      item.repository.fullName,
      item.number,
      item.state,
      item.title
    ]),
    [
      ["yohn-jp/example", 8, "open", "Open implementation"],
      ["yohn-jp/example", 9, "closed", "Closed attempt"],
      [
        "yohn-jp/nawabari",
        91,
        "merged",
        "Cross-repository implementation"
      ]
    ]
  );
});

test("GraphQL errors remain explicit and bounded by the hydrate layer", async () => {
  const dashboard = {
    status: "complete",
    source: {},
    metrics: {},
    issues: [issue(1), issue(2)],
    errors: []
  };
  const fetchImpl = async (_url, options) => {
    const request = JSON.parse(options.body);
    if (request.variables.number === 1) {
      return response({
        data: {
          repository: {
            issue: {
              closedByPullRequestsReferences: {
                nodes: [pullRequest({ number: 12, title: "Implementation" })],
                pageInfo: { hasNextPage: false, endCursor: null }
              }
            }
          }
        }
      });
    }
    return response(
      { errors: [{ message: "API rate limit exceeded" }] },
      429,
      { "x-ratelimit-remaining": "0" }
    );
  };

  await hydrateDashboardPullRequests({
    dashboard,
    fetchImpl,
    token: "test-token"
  });

  assert.equal(dashboard.status, "partial");
  assert.equal(dashboard.metrics.linkedPullRequests, 1);
  assert.equal(dashboard.metrics.issuesWithPullRequests, 1);
  assert.equal(dashboard.metrics.pullRequestDataUnavailable, 1);
  assert.equal(dashboard.metrics.pullRequestLinkageErrors, 1);
  assert.equal(dashboard.errors.length, 1);
  assert.equal(dashboard.errors[0].stage, "pull-request-links");
  assert.equal(dashboard.errors[0].rateLimited, true);
  assert.equal(dashboard.issues[0].relationships.pullRequests.status, "complete");
  assert.equal(dashboard.issues[1].relationships.pullRequests.status, "partial");
  assert.equal(
    dashboard.source.relationships.pullRequests,
    PULL_REQUEST_LINKAGE_SOURCE
  );
});

test("graph nodes preserve linked PR detail for selected open issues", () => {
  const sourceIssue = issue(1);
  sourceIssue.relationships.pullRequests = {
    status: "complete",
    source: PULL_REQUEST_LINKAGE_SOURCE,
    reason: null,
    items: [normalizeLinkedPullRequest(pullRequest({ number: 14 }))]
  };
  const graph = buildDependencyGraph({ issues: [sourceIssue] });
  assert.equal(graph.nodes[0].pullRequests.status, "complete");
  assert.equal(graph.nodes[0].pullRequests.items[0].number, 14);
});

test("portal build publishes linked PR data without browser credentials", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "yohn-jp-pr-links-"));
  const outputDirectory = join(temporaryDirectory, "site");
  const configPath = join(temporaryDirectory, "repositories.json");
  await writeFile(
    configPath,
    JSON.stringify({ organization: "yohn-jp", repositories: ["example"] })
  );

  const fetchImpl = async (url, options) => {
    if (url === "https://api.github.com/graphql") {
      assert.equal(options.headers.Authorization, "Bearer build-token");
      return response({
        data: {
          repository: {
            issue: {
              closedByPullRequestsReferences: {
                nodes: [
                  pullRequest({
                    repository: "yohn-jp/nawabari",
                    number: 33,
                    title: "Implement portal issue",
                    state: "CLOSED",
                    merged: true,
                    mergedAt: "2026-08-23T01:00:00Z"
                  })
                ],
                pageInfo: { hasNextPage: false, endCursor: null }
              }
            }
          }
        }
      });
    }

    assert.equal(options.headers.Authorization, "Bearer build-token");
    if (url.endsWith("/repos/yohn-jp/example")) {
      return response({
        id: 1,
        name: "example",
        full_name: "yohn-jp/example",
        html_url: "https://github.com/yohn-jp/example",
        visibility: "public"
      });
    }
    if (url.includes("/repos/yohn-jp/example/issues")) {
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
    const data = await buildDashboard({
      outputDirectory,
      configPath,
      fetchImpl,
      token: "build-token",
      now: () => new Date("2026-08-23T03:00:00Z")
    });
    assert.equal(data.metrics.linkedPullRequests, 1);
    assert.equal(data.metrics.issuesWithPullRequests, 1);
    assert.equal(data.metrics.pullRequestDataUnavailable, 0);
    assert.equal(data.issues[0].relationships.pullRequests.items[0].state, "merged");
    assert.equal(
      data.issues[0].relationships.pullRequests.items[0].repository.fullName,
      "yohn-jp/nawabari"
    );

    const published = JSON.parse(
      await readFile(
        join(outputDirectory, "work", "data", "dashboard.json"),
        "utf8"
      )
    );
    assert.equal(published.metrics.linkedPullRequests, 1);

    for (const path of [
      join(outputDirectory, "work", "app.js"),
      join(outputDirectory, "work", "graph", "graph.js")
    ]) {
      const browserAsset = await readFile(path, "utf8");
      assert.doesNotMatch(
        browserAsset,
        /api\.github\.com\/graphql|Authorization|GITHUB_TOKEN|GH_TOKEN/
      );
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
