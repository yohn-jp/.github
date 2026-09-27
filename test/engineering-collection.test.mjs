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
  blobFailure = false
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
    if (url.includes("/git/trees/")) return json({ tree, truncated: false });
    if (
      url.includes("/git/blobs/") &&
      blobFailure &&
      url.endsWith("3".repeat(40))
    ) {
      return json({ message: "blob unavailable" }, 503);
    }
    if (url.includes("/git/blobs/")) {
      const content = url.endsWith("1".repeat(40))
        ? "const x = 1;\n\nreturn x;\n"
        : "test('x', () => {});\n";
      return json({
        encoding: "base64",
        content: Buffer.from(content).toString("base64")
      });
    }
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

test("repository rules exclude generated/vendor/lock content and bind measurements to a commit", async () => {
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
