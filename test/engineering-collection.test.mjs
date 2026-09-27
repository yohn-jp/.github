import test from "node:test";
import assert from "node:assert/strict";
import {
  collectEngineeringMetrics,
  validateEngineeringMetrics
} from "../scripts/engineering-metrics.mjs";

const revision = "a".repeat(40);
const generatedAt = "2026-09-26T00:00:00.000Z";
const catalog = {
  products: [
    { id: "fixture", repository: "https://github.com/yohn-jp/fixture" }
  ]
};
const rules = {
  fixture: {
    revision: "main",
    sourceIncludePaths: ["src"],
    testIncludePaths: ["test"],
    excludePaths: [],
    testFileSuffixes: [".test.", ".spec."],
    verification: { branch: "main", maxAgeDays: 30 }
  }
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

const tree = [
  { type: "blob", path: "src/main.ts", sha: "1".repeat(40) },
  { type: "blob", path: "src/main.test.ts", sha: "2".repeat(40) },
  { type: "blob", path: "test/fixture.spec.ts", sha: "3".repeat(40) },
  { type: "blob", path: "dist/generated.js", sha: "4".repeat(40) },
  { type: "blob", path: "src/vendor/dependency.ts", sha: "5".repeat(40) },
  { type: "blob", path: "pnpm-lock.yaml", sha: "6".repeat(40) }
];

function fixtureFetch({
  run = {},
  actionsStatus = 200,
  blobFailure = false,
  treeEntries = tree,
  treeTruncated = false,
  jobsResponse = { total_count: 0, jobs: [] },
  sourceContent = "const x = 1;\n\nreturn x;\n"
} = {}) {
  return async (url) => {
    if (url.endsWith("/contents/package.json")) {
      return json({
        type: "file",
        encoding: "base64",
        content: Buffer.from(JSON.stringify({ version: "1.0.0" })).toString(
          "base64"
        ),
        html_url: "https://github.com/yohn-jp/fixture/blob/main/package.json"
      });
    }
    if (url.includes("/git/ref/heads/main"))
      return json({ object: { sha: revision } });
    if (url.includes("/git/trees/"))
      return json({ tree: treeEntries, truncated: treeTruncated });
    if (
      url.includes("/git/blobs/") &&
      blobFailure &&
      url.endsWith("3".repeat(40))
    ) {
      return json({ message: "blob unavailable" }, 503);
    }
    if (url.includes("/git/blobs/")) {
      const content = url.endsWith("1".repeat(40))
        ? sourceContent
        : "test('x', () => {});\n";
      return json({
        encoding: "base64",
        content: Buffer.from(content).toString("base64")
      });
    }
    if (url.includes("/actions/runs/") && url.includes("/jobs"))
      return json(jobsResponse);
    if (url.includes("/actions/runs"))
      return json({ workflow_runs: [run] }, actionsStatus);
    throw new Error(`unexpected fixture URL: ${url}`);
  };
}

const dashboard = {
  generatedAt,
  repositories: [
    {
      fullName: "yohn-jp/fixture",
      url: "https://github.com/yohn-jp/fixture",
      fetchStatus: "ok",
      openIssueCount: 0
    }
  ]
};

test("repository rules exclude generated/vendor content and bind measurements to a commit", async () => {
  const document = await collectEngineeringMetrics({
    catalog,
    dashboard,
    engineeringRules: rules,
    fetchImpl: fixtureFetch({
      run: {
        id: 42,
        name: "CI",
        head_branch: "main",
        head_sha: revision,
        status: "completed",
        conclusion: "success",
        created_at: generatedAt,
        run_started_at: generatedAt,
        completed_at: "2026-09-26T00:00:02.000Z",
        html_url: "https://github.com/yohn-jp/fixture/actions/runs/42"
      }
    })
  });
  validateEngineeringMetrics(document, catalog);
  const entry = document.products[0].metrics;
  assert.equal(entry.sourceFiles.value, 1);
  assert.equal(entry.testFiles.value, 2);
  assert.equal(entry.sourceLoc.value, 2);
  assert.equal(entry.testLoc.value, 2);
  assert.equal(entry.sourceLoc.revision, revision);
  assert.equal(
    entry.sourceLoc.method,
    "nonempty-physical-lines-including-comments-v1"
  );
  assert.equal(document.products[0].census.status, "complete");
  assert.deepEqual(document.products[0].census.included.source, [
    "src/main.ts"
  ]);
  assert.deepEqual(document.products[0].census.included.test, [
    "src/main.test.ts",
    "test/fixture.spec.ts"
  ]);
  assert.deepEqual(
    document.products[0].census.excluded.map((file) => file.reason),
    ["generated build output", "vendored dependency source"]
  );
  assert.equal(entry.verificationStatus.value, "success");
  assert.equal(
    entry.verificationStatus.runUrl,
    "https://github.com/yohn-jp/fixture/actions/runs/42"
  );
  assert.equal(entry.verificationDuration.value, 2000);
  entry.sourceLoc.revision = null;
  assert.throws(
    () => validateEngineeringMetrics(document, catalog),
    /lacks revision provenance/
  );
});

test("Actions absence, stale evidence, failed runs, and content partials stay explicit", async () => {
  const base = {
    id: 43,
    name: "CI",
    head_branch: "main",
    head_sha: revision,
    status: "completed",
    conclusion: "failure",
    created_at: "2026-01-01T00:00:00.000Z",
    run_started_at: "2026-01-01T00:00:00.000Z",
    completed_at: "2026-01-01T00:00:01.000Z",
    html_url: "https://github.com/yohn-jp/fixture/actions/runs/43"
  };
  const stale = await collectEngineeringMetrics({
    catalog,
    dashboard,
    engineeringRules: rules,
    fetchImpl: fixtureFetch({ run: base, blobFailure: true })
  });
  assert.equal(stale.products[0].metrics.verificationStatus.status, "stale");
  assert.equal(stale.products[0].metrics.verificationStatus.value, "failure");
  assert.equal(stale.products[0].metrics.sourceLoc.status, "available");
  assert.equal(stale.products[0].metrics.testLoc.status, "partial");

  const absent = await collectEngineeringMetrics({
    catalog,
    dashboard,
    engineeringRules: rules,
    fetchImpl: async (url) => {
      if (url.includes("/actions/runs")) return json({ workflow_runs: [] });
      return fixtureFetch()(url);
    }
  });
  assert.equal(
    absent.products[0].metrics.verificationStatus.status,
    "unavailable"
  );
  assert.equal(absent.products[0].metrics.verificationStatus.value, null);

  const failed = await collectEngineeringMetrics({
    catalog,
    dashboard,
    engineeringRules: rules,
    fetchImpl: fixtureFetch({ actionsStatus: 403 })
  });
  assert.equal(failed.products[0].metrics.verificationStatus.status, "failed");
  assert.equal(
    failed.products[0].metrics.verificationDuration.status,
    "failed"
  );
});

test("pending and cancelled Actions runs keep status separate from measured duration", async () => {
  const pendingRun = {
    id: 44,
    name: "CI",
    head_branch: "main",
    head_sha: revision,
    status: "in_progress",
    conclusion: null,
    created_at: generatedAt,
    run_started_at: generatedAt,
    updated_at: "2026-09-26T00:00:02.000Z",
    html_url: "https://github.com/yohn-jp/fixture/actions/runs/44"
  };
  const pending = await collectEngineeringMetrics({
    catalog,
    dashboard,
    engineeringRules: rules,
    fetchImpl: fixtureFetch({ run: pendingRun })
  });
  assert.equal(
    pending.products[0].metrics.verificationStatus.value,
    "in_progress"
  );
  assert.equal(
    pending.products[0].metrics.verificationDuration.status,
    "unavailable"
  );

  const cancelled = await collectEngineeringMetrics({
    catalog,
    dashboard,
    engineeringRules: rules,
    fetchImpl: fixtureFetch({
      run: {
        ...pendingRun,
        status: "completed",
        conclusion: "cancelled",
        completed_at: "2026-09-26T00:00:03.000Z"
      }
    })
  });
  assert.equal(
    cancelled.products[0].metrics.verificationStatus.value,
    "cancelled"
  );
  assert.equal(cancelled.products[0].metrics.verificationDuration.value, 3000);
});

test("census records missing roots, exclusions, unclassified files, comments, and partial trees", async () => {
  const candidateTree = [
    ...tree,
    { type: "blob", path: "outside/extra.ts", sha: "7".repeat(40) },
    { type: "blob", path: "src/__fixtures__/sample.ts", sha: "8".repeat(40) },
    { type: "blob", path: "eslint.config.mjs", sha: "9".repeat(40) }
  ];
  const result = await collectEngineeringMetrics({
    catalog,
    dashboard,
    engineeringRules: {
      fixture: {
        ...rules.fixture,
        sourceIncludePaths: ["src", "missing-source"],
        testIncludePaths: ["test", "missing-test"]
      }
    },
    fetchImpl: fixtureFetch({
      treeEntries: candidateTree,
      treeTruncated: true,
      sourceContent: "// count comments too\nconst x = 1;\n\nreturn x;\n"
    })
  });
  const product = result.products[0];
  assert.equal(product.census.status, "partial");
  assert.deepEqual(product.census.missingRoots, []);
  assert.deepEqual(product.census.unknownRoots, [
    "missing-source",
    "missing-test"
  ]);
  assert.deepEqual(product.census.unclassified, ["outside/extra.ts"]);
  assert.ok(
    product.census.excluded.some(
      (file) =>
        file.path === "src/__fixtures__/sample.ts" &&
        file.reason === "fixture source"
    )
  );
  assert.ok(
    product.census.excluded.some(
      (file) =>
        file.path === "eslint.config.mjs" &&
        file.reason === "repository lint configuration outside product source"
    )
  );
  assert.equal(product.metrics.sourceLoc.value, 3);
  assert.equal(product.metrics.sourceLoc.status, "partial");
  assert.equal(product.metrics.testLoc.status, "partial");
  assert.equal(
    product.metrics.sourceLoc.method,
    "nonempty-physical-lines-including-comments-v1"
  );
  assert.deepEqual(
    [...product.census.included.source, ...product.census.included.test].filter(
      (path) => product.census.unclassified.includes(path)
    ),
    []
  );
  const reordered = await collectEngineeringMetrics({
    catalog,
    dashboard,
    engineeringRules: {
      fixture: {
        ...rules.fixture,
        sourceIncludePaths: ["src", "missing-source"],
        testIncludePaths: ["test", "missing-test"]
      }
    },
    fetchImpl: fixtureFetch({
      treeEntries: [...candidateTree].reverse(),
      treeTruncated: true,
      sourceContent: "// count comments too\nconst x = 1;\n\nreturn x;\n"
    })
  });
  assert.deepEqual(reordered.products[0].census, product.census);
});

test("suffix-discovered tests within source roots do not require test-directory roots", async () => {
  const document = await collectEngineeringMetrics({
    catalog,
    dashboard,
    engineeringRules: {
      fixture: { ...rules.fixture, testIncludePaths: [] }
    },
    fetchImpl: fixtureFetch({
      treeEntries: tree.filter((entry) => !entry.path.startsWith("test/"))
    })
  });
  const census = document.products[0].census;
  assert.equal(census.status, "complete");
  assert.deepEqual(census.testRoots, []);
  assert.deepEqual(census.included.test, ["src/main.test.ts"]);
});

test("workflow, concurrent job, and step durations keep their evidence kinds and rerun identity", async () => {
  const laterUpdatedRun = {
    id: 46,
    run_attempt: 2,
    name: "CI",
    head_branch: "main",
    head_sha: revision,
    status: "completed",
    conclusion: "success",
    created_at: "2026-09-26T00:00:00.000Z",
    run_started_at: "2026-09-26T00:00:05.000Z",
    completed_at: "2026-09-26T00:00:17.000Z",
    updated_at: "2026-09-26T00:30:00.000Z",
    html_url: "https://github.com/yohn-jp/fixture/actions/runs/46"
  };
  const latestJobs = {
    total_count: 3,
    jobs: [
      {
        id: 1,
        run_id: 46,
        run_attempt: 1,
        name: "old rerun attempt",
        created_at: "2026-09-26T00:00:00.000Z",
        started_at: "2026-09-26T00:00:01.000Z",
        completed_at: "2026-09-26T00:00:02.000Z",
        steps: []
      },
      {
        id: 2,
        run_id: 46,
        run_attempt: 2,
        name: "parallel job A",
        created_at: "2026-09-26T00:00:04.000Z",
        started_at: "2026-09-26T00:00:07.000Z",
        completed_at: "2026-09-26T00:00:17.000Z",
        html_url: "https://github.com/yohn-jp/fixture/actions/runs/46/job/2",
        steps: [
          {
            number: 1,
            name: "Test",
            started_at: "2026-09-26T00:00:08.000Z",
            completed_at: "2026-09-26T00:00:13.000Z"
          }
        ]
      },
      {
        id: 3,
        run_id: 46,
        run_attempt: 2,
        name: "parallel job B",
        created_at: "2026-09-26T00:00:04.000Z",
        started_at: "2026-09-26T00:00:06.000Z",
        completed_at: "2026-09-26T00:00:14.000Z",
        steps: []
      }
    ]
  };
  const requested = [];
  const document = await collectEngineeringMetrics({
    catalog,
    dashboard,
    engineeringRules: rules,
    fetchImpl: async (url, options) => {
      requested.push(url);
      return fixtureFetch({
        run: laterUpdatedRun,
        jobsResponse: latestJobs
      })(url, options);
    }
  });
  const entry = document.products[0].metrics.verificationDuration;
  assert.equal(entry.value, 12000);
  assert.equal(entry.method, "run-start-to-completed-at");
  assert.equal(entry.durationEvidence.workflow.kind, "workflow_critical_path");
  assert.equal(entry.durationEvidence.workflow.valueMs, 12000);
  assert.equal(
    entry.durationEvidence.workflow.completedAt,
    laterUpdatedRun.completed_at
  );
  assert.equal(entry.durationEvidence.workflowQueueWait.valueMs, 5000);
  assert.deepEqual(
    entry.durationEvidence.jobs.map((job) => job.name),
    ["parallel job A", "parallel job B"]
  );
  assert.deepEqual(
    entry.durationEvidence.jobs.map((job) => job.wall.valueMs),
    [10000, 8000]
  );
  assert.equal(entry.durationEvidence.jobs[0].wait.valueMs, 3000);
  assert.equal(entry.durationEvidence.jobs[0].steps[0].kind, "step_wall_time");
  assert.equal(entry.durationEvidence.jobs[0].steps[0].valueMs, 5000);
  assert.equal(
    entry.durationEvidence.jobs[0].steps[0].source,
    "https://github.com/yohn-jp/fixture/actions/runs/46/job/2"
  );
  assert.equal(entry.durationEvidence.jobs[0].steps[0].revision, revision);
  assert.equal(entry.durationEvidence.jobs[0].runAttempt, 2);
  assert.equal(entry.durationEvidence.testCommand.status, "unavailable");
  assert.equal(document.summary.verificationDuration.status, "unavailable");
  assert.ok(requested.some((url) => url.includes("filter=latest")));
});

test("updated_at cannot substitute for an unavailable completion timestamp", async () => {
  const run = {
    id: 47,
    run_attempt: 1,
    name: "CI",
    head_branch: "main",
    head_sha: revision,
    status: "completed",
    conclusion: "success",
    created_at: generatedAt,
    run_started_at: generatedAt,
    completed_at: null,
    updated_at: "2026-09-26T00:30:00.000Z",
    html_url: "https://github.com/yohn-jp/fixture/actions/runs/47"
  };
  const document = await collectEngineeringMetrics({
    catalog,
    dashboard,
    engineeringRules: rules,
    fetchImpl: fixtureFetch({ run })
  });
  const entry = document.products[0].metrics.verificationDuration;
  assert.equal(entry.status, "unavailable");
  assert.equal(entry.value, null);
  assert.equal(entry.durationEvidence.workflow.status, "unavailable");
});

test("App token batches revision-bound content through GraphQL", async () => {
  let queries = 0;
  const rest = fixtureFetch({
    run: {
      id: 45,
      name: "CI",
      head_branch: "main",
      head_sha: revision,
      status: "completed",
      conclusion: "success",
      created_at: generatedAt,
      run_started_at: generatedAt,
      completed_at: "2026-09-26T00:00:02.000Z"
    }
  });
  const document = await collectEngineeringMetrics({
    catalog,
    dashboard,
    engineeringRules: rules,
    token: "fixture-token",
    fetchImpl: async (url, options) => {
      if (url.endsWith("/graphql")) {
        assert.equal(options.method, "POST");
        const payload = JSON.parse(options.body);
        assert.match(payload.query, /object\(oid:/);
        assert.match(payload.query, /\}\}\}$/);
        assert.equal(payload.variables.owner, "yohn-jp");
        queries += 1;
        return json({
          data: {
            repository: Object.fromEntries(
              [...payload.query.matchAll(/f(\d+):object/g)].map((match) => [
                `f${match[1]}`,
                { text: "const measured = true;\n", isTruncated: false }
              ])
            )
          }
        });
      }
      return rest(url);
    }
  });
  assert.equal(queries, 2);
  assert.equal(document.products[0].metrics.sourceLoc.status, "available");
  assert.equal(document.products[0].metrics.testLoc.value, 2);
});
