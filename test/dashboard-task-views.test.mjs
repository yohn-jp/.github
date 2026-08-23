import test from "node:test";
import assert from "node:assert/strict";
import {
  buildWorkQuery,
  classifyIssue,
  issueMatchesView,
  resolveSort,
  resolveView,
  sortIssues
} from "../dashboard/work-model.js";

function issue(number, {
  updatedAt = `2026-08-${String(number).padStart(2, "0")}T00:00:00Z`,
  createdAt = updatedAt,
  repository = "yohn-jp/example",
  linkage = { status: "complete", items: [] },
  dependencies = { status: "complete", blockedBy: [], blocking: [] },
  stateReason = null
} = {}) {
  return {
    id: `${repository}#${number}`,
    number,
    repository: { fullName: repository },
    updatedAt,
    createdAt,
    stateReason,
    relationships: { pullRequests: linkage, dependencies }
  };
}

test("classifies only complete authoritative linkage as in-progress or ready", () => {
  const inProgress = issue(1, {
    linkage: { status: "complete", items: [{ state: "open" }] }
  });
  const ready = issue(2);
  const unavailable = issue(3, {
    linkage: { status: "partial", items: [] }
  });

  assert.equal(classifyIssue(inProgress).inProgress, true);
  assert.equal(classifyIssue(inProgress).ready, false);
  assert.equal(classifyIssue(ready).ready, true);
  assert.equal(classifyIssue(unavailable).needsAttention, true);
  assert.equal(classifyIssue(unavailable).ready, false);
  assert.equal(issueMatchesView(inProgress, "in-progress"), true);
  assert.equal(issueMatchesView(ready, "ready"), true);
  assert.equal(issueMatchesView(unavailable, "attention"), true);
});

test("marks clearly evidenced attention states without priority scoring", () => {
  const closedPr = issue(1, {
    linkage: { status: "complete", items: [{ state: "closed" }] }
  });
  const blocked = issue(2, {
    dependencies: {
      status: "complete",
      blockedBy: [{ repository: { fullName: "yohn-jp/other" }, number: 8 }],
      blocking: []
    }
  });
  const reopened = issue(3, { stateReason: "reopened" });

  for (const candidate of [closedPr, blocked, reopened]) {
    assert.equal(classifyIssue(candidate).needsAttention, true);
    assert.equal(issueMatchesView(candidate, "attention"), true);
  }
});

test("sorts every supported order deterministically regardless of source order", () => {
  const issues = [
    issue(2, { updatedAt: "2026-08-02T00:00:00Z", createdAt: "2026-08-01T00:00:00Z", repository: "yohn-jp/z" }),
    issue(1, { updatedAt: "2026-08-03T00:00:00Z", createdAt: "2026-08-02T00:00:00Z", repository: "yohn-jp/a" }),
    issue(3, { updatedAt: "2026-08-01T00:00:00Z", createdAt: "2026-08-03T00:00:00Z", repository: "yohn-jp/a" })
  ];

  assert.deepEqual(sortIssues(issues, "updated").map((item) => item.number), [1, 2, 3]);
  assert.deepEqual(sortIssues(issues, "created").map((item) => item.number), [3, 1, 2]);
  assert.deepEqual(sortIssues(issues, "oldest").map((item) => item.number), [3, 2, 1]);
  assert.deepEqual(sortIssues(issues, "repository").map((item) => item.id), [
    "yohn-jp/a#1",
    "yohn-jp/a#3",
    "yohn-jp/z#2"
  ]);
  assert.deepEqual(issues.map((item) => item.number), [2, 1, 3]);
});

test("keeps view, repository, search, and sort in a shareable URL", () => {
  const query = buildWorkQuery({
    view: "in-progress",
    repository: "yohn-jp/nawabari",
    search: "claim mode",
    sort: "oldest"
  });
  assert.equal(
    query,
    "?view=in-progress&repository=yohn-jp%2Fnawabari&q=claim+mode&sort=oldest"
  );
  assert.equal(resolveView(query), "in-progress");
  assert.equal(resolveSort(query, [issue(1)]), "oldest");
  assert.equal(resolveView("?view=unknown"), "recent");
  assert.equal(resolveSort("?sort=unknown", [issue(1)]), "updated");
  assert.equal(resolveSort("?sort=created", []), "updated");
});
