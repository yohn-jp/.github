import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  collectDashboardData,
  normalizeIssueReference
} from "../scripts/dashboard-data.mjs";
import {
  buildDependencyGraph,
  filterDependencyGraph,
  layoutDependencyGraph
} from "../dashboard/graph/graph-model.js";

function response(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

function rawIssue(number, summary = { blocked_by: 0, blocking: 0 }) {
  return {
    id: number,
    repository_url: "https://api.github.com/repos/yohn-jp/alpha",
    number,
    title: `Issue ${number}`,
    html_url: `https://github.com/yohn-jp/alpha/issues/${number}`,
    state: "open",
    labels: [],
    assignees: [],
    updated_at: "2026-08-23T00:00:00Z",
    issue_dependencies_summary: summary
  };
}

test("collects native dependency edges without inferring from prose", async () => {
  const first = rawIssue(1, { blocked_by: 0, blocking: 1 });
  const second = rawIssue(2, { blocked_by: 1, blocking: 0 });
  const fetchImpl = async (url) => {
    if (url.endsWith("/repos/yohn-jp/alpha")) {
      return response({ id: 10, name: "alpha", full_name: "yohn-jp/alpha", html_url: "https://github.com/yohn-jp/alpha", visibility: "public" });
    }
    if (url.includes("/issues?state=open")) return response([first, second]);
    if (url.includes("/issues/1/dependencies/blocking")) return response([second]);
    if (url.includes("/issues/2/dependencies/blocked_by")) return response([first]);
    throw new Error(`Unexpected URL: ${url}`);
  };
  const data = await collectDashboardData({
    config: { organization: "yohn-jp", repositories: ["alpha"] },
    fetchImpl,
    now: () => new Date("2026-08-23T00:00:00Z")
  });
  assert.equal(data.status, "partial");
  assert.equal(data.metrics.dependencyEdges, 1);
  assert.equal(data.metrics.dependencyDataUnavailable, 0);
  const issue1 = data.issues.find((issue) => issue.number === 1);
  const issue2 = data.issues.find((issue) => issue.number === 2);
  assert.equal(issue1.relationships.dependencies.blocking[0].number, 2);
  assert.equal(issue2.relationships.dependencies.blockedBy[0].number, 1);

  const graph = buildDependencyGraph(data);
  assert.equal(graph.edges.length, 1);
  const layout = layoutDependencyGraph(graph);
  assert.ok(layout.nodes.find((node) => node.number === 1).layer < layout.nodes.find((node) => node.number === 2).layer);
});

test("dependency endpoint failure is explicit and does not drop issue data", async () => {
  const issue = rawIssue(1, { blocked_by: 1, blocking: 0 });
  const fetchImpl = async (url) => {
    if (url.endsWith("/repos/yohn-jp/alpha")) return response({ id: 10, name: "alpha", full_name: "yohn-jp/alpha", visibility: "public" });
    if (url.includes("/issues?state=open")) return response([issue]);
    if (url.includes("/dependencies/blocked_by")) return response({ message: "API rate limit exceeded" }, 429, { "x-ratelimit-remaining": "0" });
    throw new Error(`Unexpected URL: ${url}`);
  };
  const data = await collectDashboardData({
    config: { organization: "yohn-jp", repositories: ["alpha"] },
    fetchImpl
  });
  assert.equal(data.status, "partial");
  assert.equal(data.metrics.issueCount, 1);
  assert.equal(data.repositories[0].fetchStatus, "ok");
  assert.equal(data.issues[0].relationships.dependencies.status, "partial");
  assert.equal(data.metrics.dependencyDataUnavailable, 1);
  assert.equal(data.errors[0].stage, "dependencies:blocked_by");
  assert.equal(data.errors[0].rateLimited, true);
});

test("normalizes cross-repository dependency references", () => {
  const reference = normalizeIssueReference({
    id: 99,
    repository_url: "https://api.github.com/repos/yohn-jp/nawabari",
    number: 42,
    title: "Cross repo blocker",
    state: "closed",
    html_url: "https://github.com/yohn-jp/nawabari/issues/42"
  });
  assert.equal(reference.repository.fullName, "yohn-jp/nawabari");
  assert.equal(reference.number, 42);
  assert.equal(reference.state, "closed");
});

test("graph layout keeps cycles explicit and disconnected nodes optional", () => {
  const makeIssue = (number, dependencies) => ({
    repository: { fullName: "yohn-jp/alpha" },
    number,
    title: `Issue ${number}`,
    state: "open",
    url: `https://github.com/yohn-jp/alpha/issues/${number}`,
    relationships: { dependencies }
  });
  const ref = (number) => ({ repository: { fullName: "yohn-jp/alpha" }, number, title: `Issue ${number}`, state: "open", url: `https://github.com/yohn-jp/alpha/issues/${number}` });
  const dashboard = {
    issues: [
      makeIssue(1, { status: "complete", blockedBy: [ref(2)], blocking: [ref(2)] }),
      makeIssue(2, { status: "complete", blockedBy: [ref(1)], blocking: [ref(1)] }),
      makeIssue(3, { status: "complete", blockedBy: [], blocking: [] })
    ]
  };
  const graph = buildDependencyGraph(dashboard);
  const connected = filterDependencyGraph(graph, "", false);
  assert.equal(connected.nodes.length, 2);
  const all = filterDependencyGraph(graph, "", true);
  assert.equal(all.nodes.length, 3);
  const layout = layoutDependencyGraph(connected);
  assert.ok(layout.nodes.every((node) => node.cycle));
});

test("graph interactions keep motion finite and selection accessible", async () => {
  const [graphScript, graphStyles, motionRuntime] = await Promise.all([
    readFile("dashboard/graph/graph.js", "utf8"),
    readFile("dashboard/graph/graph.css", "utf8"),
    readFile("portal/motion.js", "utf8")
  ]);

  assert.match(graphScript, /aria-pressed/);
  assert.match(graphScript, /selectNode/);
  assert.match(graphScript, /portalMotion\?\.revealGraph/);
  assert.match(graphStyles, /graph-motion-edges-revealed/);
  assert.match(graphStyles, /graph-motion-nodes-revealed/);
  assert.match(graphStyles, /prefers-reduced-motion/);
  assert.doesNotMatch(
    graphStyles,
    /animation(?:-duration|-name|-iteration-count)?\s*:/
  );
  assert.match(motionRuntime, /revealGraph/);
  assert.match(motionRuntime, /GRAPH_EDGE_DELAY_MS/);
  assert.match(motionRuntime, /GRAPH_NODE_DELAY_MS/);
});
