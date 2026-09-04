import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateGovernanceHealth,
  governanceState
} from "../scripts/governance-health.mjs";

function issue(repository, number, governance) {
  return {
    id: `${repository}-${number}`,
    repository: {
      id: repository,
      name: repository,
      fullName: `yohn-jp/${repository}`,
      url: `https://github.com/yohn-jp/${repository}`
    },
    number,
    title: `Issue ${number}`,
    url: `https://github.com/yohn-jp/${repository}/issues/${number}`,
    governance
  };
}

test("aggregates projected governance into three-state organization health", () => {
  const issues = [
    issue("alpha", 1, {
      status: "valid",
      valid: true,
      classification: "valid",
      violations: []
    }),
    issue("alpha", 2, {
      status: "invalid",
      valid: false,
      classification: "semantic",
      violations: [{ code: "FIELD_MISSING" }, { code: "FIELD_MISSING" }]
    }),
    issue("alpha", 3, {
      status: "unavailable",
      valid: null,
      classification: "unknown",
      violations: []
    })
  ];
  const health = aggregateGovernanceHealth({
    issues,
    repositories: [
      {
        id: "alpha-id",
        name: "alpha",
        fullName: "yohn-jp/alpha",
        url: "https://github.com/yohn-jp/alpha",
        fetchStatus: "ok",
        openIssueCount: 3
      },
      {
        id: "beta-id",
        name: "beta",
        fullName: "yohn-jp/beta",
        url: "https://github.com/yohn-jp/beta",
        fetchStatus: "error",
        error: { message: "source unavailable" }
      }
    ],
    snapshotStatus: "partial"
  });

  assert.equal(governanceState(issues[0]), "valid");
  assert.equal(governanceState(issues[1]), "invalid");
  assert.equal(governanceState(issues[2]), "unknown");
  assert.deepEqual(health.overall, {
    valid: 1,
    invalid: 1,
    unknown: 1,
    total: 3,
    known: 2,
    complianceRate: 0.5
  });
  assert.deepEqual(health.repositories[0], {
    id: "alpha-id",
    name: "alpha",
    fullName: "yohn-jp/alpha",
    url: "https://github.com/yohn-jp/alpha",
    fetchStatus: "ok",
    governance: {
      status: "healthy",
      availability: "healthy",
      available: true,
      reason: null,
      diagnostics: [],
      revision: null,
      contractCount: 0
    },
    valid: 1,
    invalid: 1,
    unknown: 1,
    total: 3,
    known: 2,
    complianceRate: 0.5,
    issueCount: 3,
    error: null
  });
  assert.equal(health.repositories[1].valid, null);
  assert.equal(health.repositories[1].complianceRate, null);
  assert.equal(health.snapshot.complete, false);
  assert.equal(health.snapshot.unavailableRepositories, 1);
  assert.deepEqual(health.violations.classifications, [
    { classification: "semantic", count: 1 }
  ]);
  assert.deepEqual(health.violations.codes, [
    { code: "FIELD_MISSING", count: 2 }
  ]);
  assert.equal(health.issues.invalid[0].url, issues[1].url);
  assert.equal(health.issues.unknown[0].url, issues[2].url);
});

test("aggregates blocked/blocking/unavailable Issue counts and unresolved edges", () => {
  const blocked = issue("alpha", 1, { status: "valid", valid: true });
  blocked.state = "open";
  blocked.relationships = {
    blockers: {
      status: "available",
      blocked: true,
      blockingActive: false,
      blockedBy: [
        {
          key: "github.com:beta-id#9",
          repository: { fullName: "yohn-jp/beta" },
          number: 9,
          resolved: false
        }
      ],
      blocking: []
    }
  };

  const blocking = issue("alpha", 2, { status: "valid", valid: true });
  blocking.state = "open";
  blocking.relationships = {
    blockers: {
      status: "available",
      blocked: false,
      blockingActive: true,
      blockedBy: [],
      blocking: [
        {
          key: "github.com:alpha-id#1",
          repository: { fullName: "yohn-jp/alpha" },
          number: 1,
          resolved: false
        }
      ]
    }
  };

  const unavailable = issue("alpha", 3, {
    status: "unavailable",
    valid: null,
    reason: "authentication-unavailable",
    diagnostics: [
      {
        code: "AUTHENTICATION_UNAVAILABLE",
        reason: "authentication-unavailable",
        stage: "preflight",
        message: "unavailable"
      }
    ]
  });
  unavailable.relationships = {
    blockers: { status: "unavailable", blockedBy: [], blocking: [] }
  };

  const health = aggregateGovernanceHealth({
    issues: [blocked, blocking, unavailable],
    repositories: [
      {
        id: "alpha-id",
        name: "alpha",
        fullName: "yohn-jp/alpha",
        url: "https://github.com/yohn-jp/alpha",
        fetchStatus: "ok",
        openIssueCount: 3
      }
    ],
    snapshotStatus: "complete"
  });

  assert.equal(health.dependencies.blockedIssues, 1);
  assert.equal(health.dependencies.blockingIssues, 1);
  assert.equal(health.dependencies.unavailableIssues, 1);
  // Two distinct declared edges (beta#9 -> alpha#1, alpha#2 -> alpha#1);
  // reciprocal-declaration dedup is covered at the collection layer in
  // inari-dependencies.test.mjs.
  assert.equal(health.dependencies.unresolvedEdgeCount, 2);
  assert.ok(Array.isArray(health.dependencies.causes));
});

test("does not calculate compliance for empty or unknown-only evidence", () => {
  const health = aggregateGovernanceHealth({
    issues: [
      issue("empty", 1, {
        status: "unavailable",
        valid: null,
        violations: []
      })
    ],
    repositories: [
      {
        name: "empty",
        fullName: "yohn-jp/empty",
        url: "https://github.com/yohn-jp/empty",
        fetchStatus: "ok",
        openIssueCount: 1
      }
    ],
    snapshotStatus: "complete"
  });

  assert.equal(health.overall.complianceRate, null);
  assert.equal(health.repositories[0].complianceRate, null);
  assert.equal(health.overall.unknown, 1);
  assert.equal(health.snapshot.complete, false);
});
