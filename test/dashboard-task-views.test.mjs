import test from "node:test";
import assert from "node:assert/strict";
import {
  blockerState,
  buildWorkQuery,
  classifyIssue,
  governanceStatus,
  issueMatchesGovernance,
  issueMatchesView,
  resolveGovernanceFilter,
  resolveSort,
  resolveView,
  sortIssues
} from "../dashboard/work-model.js";

function issue(
  number,
  {
    updatedAt = `2026-08-${String(number).padStart(2, "0")}T00:00:00Z`,
    createdAt = updatedAt,
    repository = "yohn-jp/example",
    linkage = { status: "complete", items: [] },
    dependencies = { status: "complete", blockedBy: [], blocking: [] },
    blockers = {
      status: "available",
      blockedBy: [],
      blocking: [],
      blocked: false,
      blockingActive: false
    },
    stateReason = null
  } = {}
) {
  return {
    id: `${repository}#${number}`,
    number,
    repository: { fullName: repository },
    updatedAt,
    createdAt,
    stateReason,
    relationships: { pullRequests: linkage, dependencies, blockers }
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
  const activeWithHistory = issue(4, {
    linkage: {
      status: "complete",
      items: [{ state: "closed" }, { state: "open" }, { state: "merged" }]
    }
  });
  const readyWithAttention = issue(5, {
    blockers: {
      status: "available",
      blockedBy: [
        {
          repository: { fullName: "yohn-jp/other" },
          number: 8,
          resolved: false
        }
      ],
      blocking: [],
      blocked: true,
      blockingActive: false
    }
  });

  assert.equal(classifyIssue(inProgress).inProgress, true);
  assert.equal(classifyIssue(inProgress).ready, false);
  assert.equal(classifyIssue(ready).ready, true);
  assert.equal(classifyIssue(unavailable).needsAttention, true);
  assert.equal(classifyIssue(unavailable).ready, false);
  assert.equal(classifyIssue(activeWithHistory).inProgress, true);
  assert.equal(classifyIssue(activeWithHistory).needsAttention, true);
  assert.equal(classifyIssue(readyWithAttention).ready, true);
  assert.equal(classifyIssue(readyWithAttention).needsAttention, true);
  assert.equal(
    classifyIssue(readyWithAttention).reasons.includes("blocked-by-dependency"),
    true
  );
  assert.equal(issueMatchesView(inProgress, "in-progress"), true);
  assert.equal(issueMatchesView(activeWithHistory, "in-progress"), true);
  assert.equal(issueMatchesView(activeWithHistory, "attention"), true);
  assert.equal(issueMatchesView(ready, "ready"), true);
  assert.equal(issueMatchesView(unavailable, "attention"), true);
});

test("marks clearly evidenced attention states without priority scoring", () => {
  const closedPr = issue(1, {
    linkage: { status: "complete", items: [{ state: "closed" }] }
  });
  const blocked = issue(2, {
    blockers: {
      status: "available",
      blockedBy: [
        {
          repository: { fullName: "yohn-jp/other" },
          number: 8,
          resolved: false
        }
      ],
      blocking: [],
      blocked: true,
      blockingActive: false
    }
  });
  const reopened = issue(3, { stateReason: "reopened" });

  for (const candidate of [closedPr, blocked, reopened]) {
    assert.equal(classifyIssue(candidate).needsAttention, true);
    assert.equal(issueMatchesView(candidate, "attention"), true);
  }
  assert.equal(
    classifyIssue(blocked).reasons.includes("blocked-by-dependency"),
    true
  );
});

test("sorts every supported order deterministically regardless of source order", () => {
  const issues = [
    issue(2, {
      updatedAt: "2026-08-02T00:00:00Z",
      createdAt: "2026-08-01T00:00:00Z",
      repository: "yohn-jp/z"
    }),
    issue(1, {
      updatedAt: "2026-08-03T00:00:00Z",
      createdAt: "2026-08-02T00:00:00Z",
      repository: "yohn-jp/a"
    }),
    issue(3, {
      updatedAt: "2026-08-01T00:00:00Z",
      createdAt: "2026-08-03T00:00:00Z",
      repository: "yohn-jp/a"
    })
  ];

  assert.deepEqual(
    sortIssues(issues, "updated").map((item) => item.number),
    [1, 2, 3]
  );
  assert.deepEqual(
    sortIssues(issues, "created").map((item) => item.number),
    [3, 1, 2]
  );
  assert.deepEqual(
    sortIssues(issues, "oldest").map((item) => item.number),
    [3, 2, 1]
  );
  assert.deepEqual(
    sortIssues(issues, "repository").map((item) => item.id),
    ["yohn-jp/a#1", "yohn-jp/a#3", "yohn-jp/z#2"]
  );
  assert.deepEqual(
    issues.map((item) => item.number),
    [2, 1, 3]
  );
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

test("projects Inari-governed blocker relationships onto the work classification", () => {
  const sameRepoBlocked = issue(1, {
    blockers: {
      status: "available",
      blockedBy: [
        {
          repository: { fullName: "yohn-jp/example" },
          number: 2,
          resolved: false
        }
      ],
      blocking: [],
      blocked: true,
      blockingActive: false
    }
  });
  const crossRepoBlocked = issue(2, {
    blockers: {
      status: "available",
      blockedBy: [
        {
          repository: { fullName: "yohn-jp/nawabari" },
          number: 9,
          resolved: false
        }
      ],
      blocking: [],
      blocked: true,
      blockingActive: false
    }
  });
  const resolvedBlocker = issue(3, {
    blockers: {
      status: "available",
      blockedBy: [
        {
          repository: { fullName: "yohn-jp/example" },
          number: 4,
          resolved: true
        }
      ],
      blocking: [],
      blocked: false,
      blockingActive: false
    }
  });
  const blockingOthers = issue(5, {
    blockers: {
      status: "available",
      blockedBy: [],
      blocking: [
        {
          repository: { fullName: "yohn-jp/example" },
          number: 6,
          resolved: false
        }
      ],
      blocked: false,
      blockingActive: true
    }
  });
  const projectionUnavailable = issue(7, {
    blockers: { status: "unavailable", blockedBy: [], blocking: [] }
  });

  assert.equal(blockerState(sameRepoBlocked), "blocked");
  assert.equal(blockerState(crossRepoBlocked), "blocked");
  assert.equal(blockerState(resolvedBlocker), "clear");
  assert.equal(blockerState(blockingOthers), "blocking");
  assert.equal(blockerState(projectionUnavailable), "unavailable");
  assert.equal(blockerState(issue(8)), "clear");
  assert.equal(blockerState({}), "not-evaluated");

  assert.equal(
    classifyIssue(sameRepoBlocked).reasons.includes("blocked-by-dependency"),
    true
  );
  assert.equal(
    classifyIssue(crossRepoBlocked).reasons.includes("blocked-by-dependency"),
    true
  );
  assert.equal(
    classifyIssue(resolvedBlocker).reasons.includes("blocked-by-dependency"),
    false
  );
  assert.equal(
    classifyIssue(blockingOthers).reasons.includes("blocking-dependent-work"),
    true
  );
  assert.equal(classifyIssue(projectionUnavailable).needsAttention, true);
  assert.equal(
    classifyIssue(projectionUnavailable).reasons.includes(
      "dependency-projection-unavailable"
    ),
    true
  );
  assert.equal(
    classifyIssue(projectionUnavailable).reasons.includes(
      "blocked-by-dependency"
    ),
    false
  );

  const blockedAndBlocking = issue(9, {
    blockers: {
      status: "available",
      blockedBy: [
        {
          repository: { fullName: "yohn-jp/example" },
          number: 10,
          resolved: false
        }
      ],
      blocking: [
        {
          repository: { fullName: "yohn-jp/example" },
          number: 11,
          resolved: false
        }
      ],
      blocked: true,
      blockingActive: true
    }
  });
  const bothReasons = classifyIssue(blockedAndBlocking).reasons;
  assert.equal(bothReasons.includes("blocked-by-dependency"), true);
  assert.equal(bothReasons.includes("blocking-dependent-work"), true);
});

test("keeps governance as an explicit fail-closed three-state filter", () => {
  const valid = issue(1, { linkage: { status: "complete", items: [] } });
  valid.governance = { status: "valid", valid: true, violations: [] };
  const invalid = issue(2);
  invalid.governance = {
    status: "invalid",
    valid: false,
    violations: [{ code: "FIELD_MISSING", path: "$.problem" }]
  };
  const unavailable = issue(3);
  unavailable.governance = {
    status: "unavailable",
    valid: null,
    reason: "authentication-unavailable"
  };

  assert.equal(governanceStatus(valid), "valid");
  assert.equal(governanceStatus(invalid), "invalid");
  assert.equal(governanceStatus(unavailable), "unknown");
  assert.equal(governanceStatus(issue(4)), "unknown");
  assert.equal(
    governanceStatus({ governance: { status: "unavailable", valid: false } }),
    "unknown"
  );
  assert.equal(
    classifyIssue(invalid).reasons.includes("governance-invalid"),
    true
  );
  assert.equal(
    classifyIssue(unavailable).reasons.includes("governance-unavailable"),
    true
  );
  assert.equal(issueMatchesGovernance(valid, "valid"), true);
  assert.equal(issueMatchesGovernance(invalid, "valid"), false);
  assert.equal(issueMatchesGovernance(unavailable, "unknown"), true);

  const query = buildWorkQuery({
    view: "attention",
    governance: "invalid",
    repository: "yohn-jp/example",
    search: "contract",
    sort: "oldest"
  });
  assert.equal(
    query,
    "?view=attention&repository=yohn-jp%2Fexample&q=contract&sort=oldest&governance=invalid"
  );
  assert.equal(resolveGovernanceFilter(query), "invalid");
  assert.equal(resolveGovernanceFilter("?governance=bad"), "all");
});
