import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("dependency graph completeness ignores pull-request-only errors", async () => {
  const source = await readFile("dashboard/graph/graph.js", "utf8");
  const showStatus = source.slice(
    source.indexOf("function isDependencyError"),
    source.indexOf("function renderRepositoryFilter")
  );

  assert.match(showStatus, /stage\.startsWith\("dependencies:"\)/);
  assert.match(showStatus, /stage === "repository"/);
  assert.match(showStatus, /stage === "issues"/);
  assert.doesNotMatch(showStatus, /dashboard\.status/);
  assert.doesNotMatch(showStatus, /pull-request-links/);
});

test("work and graph UI distinguish linked PR states without GitHub credentials", async () => {
  const [work, graph, styles] = await Promise.all([
    readFile("dashboard/app.js", "utf8"),
    readFile("dashboard/graph/graph.js", "utf8"),
    readFile("dashboard/work.css", "utf8")
  ]);

  for (const source of [work, graph]) {
    assert.match(source, /closed without merge/);
    assert.match(source, /pullRequests/);
    assert.doesNotMatch(
      source,
      /api\.github\.com\/graphql|Authorization|GITHUB_TOKEN|GH_TOKEN/
    );
  }

  assert.match(styles, /\.issue-pr\.open/);
  assert.match(styles, /\.issue-pr\.merged/);
  assert.match(styles, /\.issue-pr\.closed/);
});
