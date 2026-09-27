import test from "node:test";
import assert from "node:assert/strict";
import {
  collectEngineeringMetrics,
  validateEngineeringMetrics
} from "../scripts/engineering-metrics.mjs";

const catalog = {
  products: [
    { id: "one", repository: "https://github.com/yohn-jp/one" },
    { id: "two", repository: "https://github.com/yohn-jp/two" }
  ]
};
const generatedAt = "2026-09-26T00:00:00.000Z";

function dashboard(secondStatus = "ok") {
  return {
    generatedAt,
    repositories: [
      {
        fullName: "yohn-jp/one",
        url: "https://github.com/yohn-jp/one",
        fetchStatus: "ok",
        openIssueCount: 0
      },
      {
        fullName: "yohn-jp/two",
        url: "https://github.com/yohn-jp/two",
        fetchStatus: secondStatus,
        openIssueCount: secondStatus === "ok" ? 3 : null
      }
    ]
  };
}

function packageResponse(version, repository) {
  return new Response(
    JSON.stringify({
      type: "file",
      encoding: "base64",
      content: Buffer.from(JSON.stringify({ version })).toString("base64"),
      html_url: `https://github.com/yohn-jp/${repository}/blob/main/package.json`,
      sha: "a".repeat(40)
    }),
    { status: 200 }
  );
}

test("Engineering projects measured package and work facts with provenance, while absent evidence remains null", async () => {
  const document = await collectEngineeringMetrics({
    catalog,
    dashboard: dashboard(),
    fetchImpl: async (url) =>
      packageResponse(
        url.includes("/one/") ? "1.2.3" : "2.0.0",
        url.includes("/one/") ? "one" : "two"
      )
  });
  validateEngineeringMetrics(document, catalog);
  assert.equal(document.schemaVersion, 1);
  assert.equal(document.products[0].metrics.openIssues.value, 0);
  assert.equal(document.products[0].metrics.openIssues.status, "available");
  assert.equal(document.products[0].metrics.packageVersion.value, "1.2.3");
  assert.match(
    document.products[0].metrics.packageVersion.source,
    /blob\/main\/package.json/
  );
  assert.equal(document.products[0].metrics.sourceLoc.value, null);
  assert.equal(
    document.products[0].metrics.coverageLines.status,
    "unavailable"
  );
  assert.equal(document.summary.openIssues.value, 3);
});

test("Engineering keeps failed collection and partial totals distinct from measured zero", async () => {
  const document = await collectEngineeringMetrics({
    catalog,
    dashboard: dashboard("error"),
    fetchImpl: async (url) =>
      url.includes("/one/")
        ? packageResponse("1.2.3", "one")
        : new Response("{}", { status: 503 })
  });
  assert.equal(document.products[1].metrics.packageVersion.status, "failed");
  assert.equal(document.products[1].metrics.packageVersion.value, null);
  assert.equal(document.products[1].metrics.openIssues.status, "failed");
  assert.equal(document.summary.openIssues.status, "partial");
  assert.equal(document.summary.openIssues.value, 0);
  assert.equal(document.summary.openIssues.scope, "1/2 products · open Issues");
  assert.equal(document.summary.packageVersions.status, "partial");
  assert.equal(document.summary.packageVersions.value, 1);
});

test("Engineering rejects a measured value without provenance", async () => {
  const document = await collectEngineeringMetrics({
    catalog,
    dashboard: dashboard(),
    fetchImpl: async () => new Response("{}", { status: 404 })
  });
  document.products[0].metrics.openIssues.source = null;
  assert.throws(
    () => validateEngineeringMetrics(document, catalog),
    /lacks provenance/
  );
  assert.equal(document.summary.packageVersions.value, null);
});
