import { Buffer } from "node:buffer";

export const ENGINEERING_METRICS_SCHEMA_VERSION = 1;
export const ENGINEERING_METRIC_STATES = Object.freeze([
  "available",
  "unavailable",
  "unsupported",
  "stale",
  "partial",
  "failed"
]);
export const ENGINEERING_METRIC_FIELDS = Object.freeze([
  "sourceLoc",
  "testLoc",
  "sourceFiles",
  "testFiles",
  "testCount",
  "testPass",
  "testSkip",
  "coverageLines",
  "coverageBranches",
  "coverageFunctions",
  "verificationStatus",
  "verificationDuration",
  "packageVersion",
  "openIssues"
]);
const SUMMARY_FIELDS = Object.freeze([
  "productCount",
  "openIssues",
  "packageVersions",
  "sourceLoc",
  "testLoc",
  "coverageLines",
  "verificationDuration"
]);

const ABSENT = "No authoritative producer artifact is available.";

function metric(
  status,
  value = null,
  { source = null, observedAt = null, scope = null, reason = null } = {}
) {
  if (!ENGINEERING_METRIC_STATES.includes(status))
    throw new Error(`Unknown engineering metric state: ${status}`);
  if (status === "available" && (value === null || !source || !observedAt)) {
    throw new Error(
      "Available engineering metrics require value, source, and observedAt"
    );
  }
  if (status !== "available" && !reason)
    throw new Error(`Engineering metric ${status} requires a reason`);
  return { status, value, source, observedAt, scope, reason };
}

function unavailable(scope = null) {
  return metric("unavailable", null, { scope, reason: ABSENT });
}

export function unavailableEngineeringMetrics(catalog) {
  return {
    schemaVersion: ENGINEERING_METRICS_SCHEMA_VERSION,
    generatedAt: "unavailable",
    source: "unavailable",
    products: catalog.products.map((product) => ({
      id: product.id,
      repository: new URL(product.repository).pathname.slice(1),
      metrics: Object.fromEntries(
        ENGINEERING_METRIC_FIELDS.map((key) => [key, unavailable()])
      )
    })),
    summary: Object.fromEntries(
      SUMMARY_FIELDS.map((key) => [key, unavailable()])
    )
  };
}

function failed(reason, scope = null) {
  return metric("failed", null, { scope, reason });
}

function packageContentsEndpoint(fullName) {
  return `https://api.github.com/repos/${fullName}/contents/package.json`;
}

async function packageVersion(repository, { fetchImpl, token, generatedAt }) {
  const endpoint = packageContentsEndpoint(repository.fullName);
  try {
    const response = await fetchImpl(endpoint, {
      headers: {
        Accept: "application/vnd.github+json",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    });
    if (response.status === 404)
      return metric("unsupported", null, {
        reason: "No root package.json is published by this repository.",
        scope: "root package.json"
      });
    if (!response.ok)
      return failed(
        `GitHub package collection returned HTTP ${response.status}.`,
        "root package.json"
      );
    const body = await response.json();
    if (
      body.type !== "file" ||
      body.encoding !== "base64" ||
      typeof body.content !== "string"
    ) {
      return failed(
        "GitHub returned an unsupported package representation.",
        "root package.json"
      );
    }
    const packageJson = JSON.parse(
      Buffer.from(body.content, "base64").toString("utf8")
    );
    if (
      typeof packageJson.version !== "string" ||
      !packageJson.version.trim()
    ) {
      return metric("unsupported", null, {
        reason: "Root package.json has no version.",
        scope: "root package.json"
      });
    }
    return metric("available", packageJson.version, {
      source: body.html_url ?? repository.url,
      observedAt: generatedAt,
      scope: `${repository.fullName}/package.json${body.sha ? ` @ ${body.sha}` : ""}`
    });
  } catch (error) {
    return failed(
      `Package collection failed: ${error.message}`,
      "root package.json"
    );
  }
}

function workMetric(repository, generatedAt) {
  if (
    repository?.fetchStatus === "ok" &&
    Number.isInteger(repository.openIssueCount)
  ) {
    return metric("available", repository.openIssueCount, {
      source: `${repository.url}/issues`,
      observedAt: generatedAt,
      scope: "open GitHub Issues, excluding pull requests"
    });
  }
  return failed(
    "GitHub Issue collection for this repository did not complete.",
    "open GitHub Issues"
  );
}

function sumMetrics(products, key, generatedAt, scope) {
  const fields = products.map((product) => product.metrics[key]);
  const measured = fields.filter((field) => field.status === "available");
  if (!measured.length) {
    return fields.every((field) => field.status === "failed")
      ? failed("Every repository Issue collection failed.", scope)
      : unavailable(scope);
  }
  const sum = measured.reduce((total, field) => total + field.value, 0);
  const context = {
    source: "GitHub REST API · repository Issue collection",
    observedAt: generatedAt,
    scope: `${measured.length}/${products.length} products · ${scope}`
  };
  return measured.length === fields.length
    ? metric("available", sum, context)
    : metric("partial", sum, {
        ...context,
        reason: "Some repository Issue collections did not complete."
      });
}

export async function collectEngineeringMetrics({
  catalog,
  dashboard,
  fetchImpl = globalThis.fetch,
  token = ""
}) {
  const generatedAt = dashboard.generatedAt;
  const repositories = new Map(
    dashboard.repositories.map((repository) => [
      repository.fullName.toLowerCase(),
      repository
    ])
  );
  const products = await Promise.all(
    catalog.products.map(async (product) => {
      const fullName = new URL(product.repository).pathname.slice(1);
      const repository = repositories.get(fullName.toLowerCase());
      const metrics = {
        sourceLoc: unavailable(
          "source files, excluding generated and vendored code"
        ),
        testLoc: unavailable(
          "test files, excluding generated and vendored code"
        ),
        sourceFiles: unavailable("source files"),
        testFiles: unavailable("test files"),
        testCount: unavailable("test suite"),
        testPass: unavailable("test suite"),
        testSkip: unavailable("test suite"),
        coverageLines: unavailable("coverage lines · producer scope required"),
        coverageBranches: unavailable(
          "coverage branches · producer scope required"
        ),
        coverageFunctions: unavailable(
          "coverage functions · producer scope required"
        ),
        verificationStatus: unavailable("consumer verification run"),
        verificationDuration: unavailable("consumer verification run"),
        packageVersion: await packageVersion(
          { fullName, url: product.repository },
          { fetchImpl, token, generatedAt }
        ),
        openIssues: workMetric(repository, generatedAt)
      };
      return { id: product.id, repository: fullName, metrics };
    })
  );
  const packageVersions = products.map(
    (product) => product.metrics.packageVersion
  );
  const measuredPackages = packageVersions.filter(
    (entry) => entry.status === "available"
  );
  const summary = {
    productCount: metric("available", products.length, {
      source: "portal/registry.json",
      observedAt: generatedAt,
      scope: "registered products"
    }),
    openIssues: sumMetrics(products, "openIssues", generatedAt, "open Issues"),
    packageVersions:
      measuredPackages.length === 0
        ? packageVersions.every((entry) => entry.status === "failed")
          ? failed(
              "Every package collection failed.",
              "root package.json across registered products"
            )
          : unavailable("root package.json across registered products")
        : metric(
            packageVersions.every((entry) => entry.status === "available")
              ? "available"
              : "partial",
            measuredPackages.length,
            {
              source: "GitHub REST API · root package.json",
              observedAt: generatedAt,
              scope: `${products.length} registered products`,
              reason: packageVersions.every(
                (entry) => entry.status === "available"
              )
                ? null
                : "Some package versions are unavailable or failed collection."
            }
          ),
    sourceLoc: unavailable("all registered products · source files"),
    testLoc: unavailable("all registered products · test files"),
    coverageLines: unavailable(
      "all registered products · producer scope required"
    ),
    verificationDuration: unavailable(
      "all registered products · consumer verification runs"
    )
  };
  return {
    schemaVersion: ENGINEERING_METRICS_SCHEMA_VERSION,
    generatedAt,
    source: "GitHub REST API and portal product registry",
    products,
    summary
  };
}

export function validateEngineeringMetrics(document, catalog) {
  if (
    document?.schemaVersion !== ENGINEERING_METRICS_SCHEMA_VERSION ||
    !Array.isArray(document.products)
  ) {
    throw new Error(
      `Engineering metrics schemaVersion must be ${ENGINEERING_METRICS_SCHEMA_VERSION}`
    );
  }
  if (!document.generatedAt || !document.source || !document.summary) {
    throw new Error(
      "Engineering metrics require snapshot provenance and summary"
    );
  }
  const expected = catalog.products.map((product) => product.id);
  if (
    JSON.stringify(document.products.map((product) => product.id)) !==
    JSON.stringify(expected)
  ) {
    throw new Error(
      "Engineering metrics products must match the catalog order"
    );
  }
  for (const product of document.products) {
    if (
      JSON.stringify(Object.keys(product.metrics ?? {})) !==
      JSON.stringify(ENGINEERING_METRIC_FIELDS)
    ) {
      throw new Error(
        `Engineering metric fields are incomplete for ${product.id}`
      );
    }
  }
  if (
    JSON.stringify(Object.keys(document.summary)) !==
    JSON.stringify(SUMMARY_FIELDS)
  ) {
    throw new Error("Engineering summary fields are incomplete");
  }
  for (const entry of [
    ...document.products.flatMap((product) => Object.values(product.metrics)),
    ...Object.values(document.summary ?? {})
  ]) {
    if (!ENGINEERING_METRIC_STATES.includes(entry?.status))
      throw new Error("Engineering metric has invalid status");
    if (
      ["unavailable", "unsupported", "failed"].includes(entry.status) &&
      entry.value !== null
    ) {
      throw new Error("Unavailable engineering metric must have a null value");
    }
    if (
      entry.status === "available" &&
      (entry.value === null || !entry.source || !entry.observedAt)
    )
      throw new Error("Available engineering metric lacks provenance");
    if (entry.status !== "available" && !entry.reason)
      throw new Error("Missing engineering metric reason");
  }
  return document;
}
