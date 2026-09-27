import { Buffer } from "node:buffer";

export const ENGINEERING_METRICS_SCHEMA_VERSION = 1;
export const ENGINEERING_RULES_SCHEMA_VERSION = 1;
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
const DEFAULT_EXTENSIONS = Object.freeze([
  ".cjs",
  ".go",
  ".js",
  ".jsx",
  ".mjs",
  ".py",
  ".rs",
  ".ts",
  ".tsx"
]);
const API_ROOT = "https://api.github.com";
const API_VERSION = "2022-11-28";
const BLOB_BATCH_SIZE = 40;
const MAX_CONTENT_FILES = 1000;

function metric(
  status,
  value = null,
  {
    source = null,
    observedAt = null,
    scope = null,
    reason = null,
    revision = null,
    evidenceAt = null,
    runUrl = null,
    runId = null,
    revisions = null,
    runUrls = null
  } = {}
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
  return {
    status,
    value,
    source,
    observedAt,
    scope,
    reason,
    revision,
    evidenceAt,
    runUrl,
    runId,
    revisions,
    runUrls
  };
}

function unavailable(scope = null, reason = ABSENT) {
  return metric("unavailable", null, { scope, reason });
}

function failed(reason, scope = null) {
  return metric("failed", null, { scope, reason });
}

function unsupported(reason, scope = null) {
  return metric("unsupported", null, { scope, reason });
}

function requestHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": API_VERSION,
    "User-Agent": "yohn-jp-portal-engineering",
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
}

async function fetchJson(fetchImpl, url, token) {
  const response = await fetchImpl(url, { headers: requestHeaders(token) });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const error = new Error(
      body?.message ?? `GitHub API returned HTTP ${response.status}`
    );
    error.status = response.status;
    throw error;
  }
  return body;
}

function repositoryName(product) {
  return new URL(product.repository).pathname.slice(1);
}

function packageContentsEndpoint(fullName) {
  return `${API_ROOT}/repos/${fullName}/contents/package.json`;
}

async function packageVersion(repository, { fetchImpl, token, generatedAt }) {
  const endpoint = packageContentsEndpoint(repository.fullName);
  try {
    const response = await fetchImpl(endpoint, {
      headers: requestHeaders(token)
    });
    if (response.status === 404)
      return unsupported(
        "No root package.json is published by this repository.",
        "root package.json"
      );
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
      return unsupported(
        "Root package.json has no version.",
        "root package.json"
      );
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

function normalizePathList(value, path) {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error(`${path} must be a non-empty array`);
  return value.map((entry, index) => {
    if (typeof entry !== "string" || !entry || entry.startsWith("/"))
      throw new Error(`${path}[${index}] must be a relative path`);
    if (
      entry
        .split("/")
        .some((segment) => !segment || segment === "." || segment === "..")
    )
      throw new Error(
        `${path}[${index}] must contain only repository path segments`
      );
    return entry.replace(/\/$/, "");
  });
}

function normalizeExtensions(value, path) {
  if (value === undefined) return [...DEFAULT_EXTENSIONS];
  if (!Array.isArray(value) || value.length === 0)
    throw new Error(`${path} must be a non-empty array`);
  return value.map((entry, index) => {
    if (typeof entry !== "string" || !/^\.[a-z0-9]+$/i.test(entry))
      throw new Error(`${path}[${index}] must be a file extension`);
    return entry.toLowerCase();
  });
}

function normalizeProductRule(rule, productId) {
  if (!rule || typeof rule !== "object" || Array.isArray(rule))
    throw new Error(`engineering.products.${productId} must be an object`);
  const sourceIncludePaths = normalizePathList(
    rule.sourceIncludePaths,
    `engineering.products.${productId}.sourceIncludePaths`
  );
  const testIncludePaths = normalizePathList(
    rule.testIncludePaths,
    `engineering.products.${productId}.testIncludePaths`
  );
  const excludePaths = rule.excludePaths
    ? rule.excludePaths.length === 0
      ? []
      : normalizePathList(
          rule.excludePaths,
          `engineering.products.${productId}.excludePaths`
        )
    : [];
  if (rule.revision !== undefined && rule.revision !== "main")
    throw new Error(`engineering.products.${productId}.revision must be main`);
  if (
    rule.testFileSuffixes !== undefined &&
    (!Array.isArray(rule.testFileSuffixes) ||
      rule.testFileSuffixes.some(
        (suffix) => typeof suffix !== "string" || !suffix.trim()
      ))
  )
    throw new Error(
      `engineering.products.${productId}.testFileSuffixes is invalid`
    );
  if (
    rule.verification?.branch !== undefined &&
    rule.verification.branch !== "main"
  )
    throw new Error(
      `engineering.products.${productId}.verification.branch must be main`
    );
  if (
    rule.verification?.maxAgeDays !== undefined &&
    (!Number.isInteger(rule.verification.maxAgeDays) ||
      rule.verification.maxAgeDays <= 0)
  )
    throw new Error(
      `engineering.products.${productId}.verification.maxAgeDays is invalid`
    );
  if (
    rule.verification?.workflowNames !== undefined &&
    (!Array.isArray(rule.verification.workflowNames) ||
      rule.verification.workflowNames.length === 0 ||
      rule.verification.workflowNames.some(
        (name) => typeof name !== "string" || !name.trim()
      ))
  )
    throw new Error(
      `engineering.products.${productId}.verification.workflowNames is invalid`
    );
  return {
    revision: rule.revision ?? "main",
    sourceIncludePaths,
    testIncludePaths,
    excludePaths,
    testFileSuffixes: rule.testFileSuffixes ?? [".test.", ".spec."],
    extensions: normalizeExtensions(
      rule.extensions,
      `engineering.products.${productId}.extensions`
    ),
    verification: {
      branch: rule.verification?.branch ?? "main",
      maxAgeDays: rule.verification?.maxAgeDays ?? 30,
      workflowNames:
        Array.isArray(rule.verification?.workflowNames) &&
        rule.verification.workflowNames.length > 0
          ? [
              ...new Set(
                rule.verification.workflowNames.map((entry) =>
                  entry.toLowerCase()
                )
              )
            ]
          : ["ci"]
    }
  };
}

export function validateEngineeringRules(rules, catalog) {
  if (!rules) return null;
  if (rules.schemaVersion !== ENGINEERING_RULES_SCHEMA_VERSION)
    throw new Error(
      `Engineering rules schemaVersion must be ${ENGINEERING_RULES_SCHEMA_VERSION}`
    );
  if (!rules.products || typeof rules.products !== "object")
    throw new Error("Engineering rules require products");
  const expected = new Set(catalog.products.map((product) => product.id));
  const actual = Object.keys(rules.products);
  if (actual.length !== expected.size || actual.some((id) => !expected.has(id)))
    throw new Error(
      "Engineering rules must cover exactly the registered products"
    );
  return Object.fromEntries(
    actual.map((id) => [id, normalizeProductRule(rules.products[id], id)])
  );
}

export function engineeringRulesFromRegistry(registry, catalog) {
  return validateEngineeringRules(registry?.engineering, catalog);
}

function pathMatchesPrefix(path, prefix) {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function isExcluded(path, rules) {
  const segments = path.split("/");
  const excludedDirectory = segments.some((segment) =>
    [
      ".git",
      ".next",
      ".turbo",
      "__fixtures__",
      "__generated__",
      "build",
      "coverage",
      "dist",
      "examples",
      "fixtures",
      "generated",
      "node_modules",
      "out",
      "target",
      "test-fixtures",
      "vendor"
    ].includes(segment)
  );
  if (excludedDirectory) return true;
  const basename = path.split("/").at(-1);
  if (
    /^(?:package-lock|pnpm-lock|yarn\.lock|bun\.lock)/i.test(basename) ||
    /(?:\.gen\.|\.generated\.|-generated\.)/i.test(basename)
  )
    return true;
  return rules.excludePaths.some((prefix) => pathMatchesPrefix(path, prefix));
}

function hasExtension(path, extensions) {
  return extensions.some((extension) => path.toLowerCase().endsWith(extension));
}

function isTestPath(path, rules) {
  const basename = path.split("/").at(-1);
  return (
    rules.testIncludePaths.some((prefix) => pathMatchesPrefix(path, prefix)) ||
    path
      .split("/")
      .some((segment) => ["test", "tests", "__tests__"].includes(segment)) ||
    rules.testFileSuffixes.some((suffix) => basename.includes(suffix))
  );
}

function classifyTree(tree, rules) {
  const files = tree
    .filter((entry) => entry?.type === "blob" && typeof entry.path === "string")
    .filter((entry) => hasExtension(entry.path, rules.extensions))
    .filter((entry) => !isExcluded(entry.path, rules));
  const source = [];
  const tests = [];
  for (const file of files) {
    const sourceMatch = rules.sourceIncludePaths.some((prefix) =>
      pathMatchesPrefix(file.path, prefix)
    );
    const testMatch = rules.testIncludePaths.some((prefix) =>
      pathMatchesPrefix(file.path, prefix)
    );
    if (testMatch || (sourceMatch && isTestPath(file.path, rules)))
      tests.push(file);
    else if (sourceMatch) source.push(file);
  }
  return { source, tests };
}

function countLines(text) {
  return text
    .split(/\r?\n/)
    .reduce((count, line) => count + (line.trim() ? 1 : 0), 0);
}

function treeSource(fullName, revision) {
  return `https://github.com/${fullName}/tree/${revision}`;
}

async function collectRevisionAndTree({ fullName, branch, fetchImpl, token }) {
  const ref = await fetchJson(
    fetchImpl,
    `${API_ROOT}/repos/${fullName}/git/ref/heads/${encodeURIComponent(branch)}`,
    token
  );
  const revision = ref?.object?.sha;
  if (typeof revision !== "string" || !/^[0-9a-f]{40}$/i.test(revision))
    throw new Error("GitHub returned no commit SHA for the configured branch");
  const tree = await fetchJson(
    fetchImpl,
    `${API_ROOT}/repos/${fullName}/git/trees/${revision}?recursive=1`,
    token
  );
  if (!Array.isArray(tree?.tree))
    throw new Error("GitHub returned no repository tree");
  return { revision, tree: tree.tree, truncated: tree.truncated === true };
}

async function collectFileContents({
  fullName,
  revision,
  files,
  fetchImpl,
  token,
  generatedAt,
  kind,
  truncated
}) {
  if (files.length === 0)
    return unsupported(
      `No ${kind} files matched the configured repository paths.`,
      `${kind} files`
    );
  let lines = 0;
  let succeeded = 0;
  const failedPaths = [];
  const selected = [...files]
    .sort((left, right) => left.path.localeCompare(right.path))
    .slice(0, MAX_CONTENT_FILES);
  if (token) {
    const [owner, repository] = fullName.split("/");
    for (let offset = 0; offset < selected.length; offset += BLOB_BATCH_SIZE) {
      const batch = selected.slice(offset, offset + BLOB_BATCH_SIZE);
      if (batch.some((file) => !/^[0-9a-f]{40}$/i.test(file.sha))) {
        failedPaths.push(...batch.map((file) => file.path));
        continue;
      }
      const query = `query($owner:String!,$repository:String!){repository(owner:$owner,name:$repository){${batch.map((file, index) => `f${index}:object(oid:"${file.sha}"){... on Blob{text isTruncated}}`).join(" ")}}}`;
      try {
        const response = await fetchImpl(`${API_ROOT}/graphql`, {
          method: "POST",
          headers: requestHeaders(token),
          body: JSON.stringify({ query, variables: { owner, repository } })
        });
        if (!response.ok)
          throw new Error(`GraphQL returned HTTP ${response.status}`);
        const body = await response.json();
        if (!body?.data?.repository)
          throw new Error("GraphQL returned no repository blobs");
        for (const [index, file] of batch.entries()) {
          const blob = body.data.repository[`f${index}`];
          if (typeof blob?.text !== "string" || blob.isTruncated !== false) {
            failedPaths.push(file.path);
            continue;
          }
          lines += countLines(blob.text);
          succeeded += 1;
        }
      } catch {
        failedPaths.push(...batch.map((file) => file.path));
      }
    }
  } else {
    for (const file of selected) {
      try {
        const body = await fetchJson(
          fetchImpl,
          `${API_ROOT}/repos/${fullName}/git/blobs/${file.sha}`,
          token
        );
        if (body?.encoding !== "base64" || typeof body.content !== "string")
          throw new Error("GitHub returned an unsupported blob representation");
        lines += countLines(
          Buffer.from(body.content, "base64").toString("utf8")
        );
        succeeded += 1;
      } catch {
        failedPaths.push(file.path);
      }
    }
  }
  if (succeeded === 0)
    return failed(
      `Unable to read any configured ${kind} files.`,
      `${kind} files`
    );
  const limited = selected.length < files.length;
  const incomplete = truncated || limited || failedPaths.length > 0;
  return metric(incomplete ? "partial" : "available", lines, {
    source: treeSource(fullName, revision),
    observedAt: generatedAt,
    scope: `${succeeded}/${files.length} ${kind} files · non-empty physical lines · configured paths`,
    reason: incomplete
      ? [
          failedPaths.length && `Unable to read ${failedPaths.length} files`,
          limited && `Content read limited to ${MAX_CONTENT_FILES} files`,
          truncated && "Repository tree was truncated"
        ]
          .filter(Boolean)
          .join("; ") + "."
      : null,
    revision
  });
}

async function collectFileCount({
  fullName,
  revision,
  files,
  generatedAt,
  kind,
  truncated
}) {
  if (files.length === 0)
    return unsupported(
      `No ${kind} files matched the configured repository paths.`,
      `${kind} files`
    );
  return metric(truncated ? "partial" : "available", files.length, {
    source: treeSource(fullName, revision),
    observedAt: generatedAt,
    scope: `${files.length} ${kind} files · configured paths`,
    reason: truncated ? "Repository tree was truncated." : null,
    revision
  });
}

async function collectRepositoryCode({
  fullName,
  rules,
  fetchImpl,
  token,
  generatedAt
}) {
  if (!rules) {
    return {
      sourceLoc: unavailable(
        "source files, excluding generated and vendored code"
      ),
      testLoc: unavailable("test files, excluding generated and vendored code"),
      sourceFiles: unavailable("source files"),
      testFiles: unavailable("test files")
    };
  }
  try {
    const { revision, tree, truncated } = await collectRevisionAndTree({
      fullName,
      branch: rules.revision,
      fetchImpl,
      token
    });
    const classified = classifyTree(tree, rules);
    const [sourceLoc, testLoc, sourceFiles, testFiles] = await Promise.all([
      collectFileContents({
        fullName,
        revision,
        files: classified.source,
        fetchImpl,
        token,
        generatedAt,
        kind: "source",
        truncated
      }),
      collectFileContents({
        fullName,
        revision,
        files: classified.tests,
        fetchImpl,
        token,
        generatedAt,
        kind: "test",
        truncated
      }),
      collectFileCount({
        fullName,
        revision,
        files: classified.source,
        generatedAt,
        kind: "source",
        truncated
      }),
      collectFileCount({
        fullName,
        revision,
        files: classified.tests,
        generatedAt,
        kind: "test",
        truncated
      })
    ]);
    return { sourceLoc, testLoc, sourceFiles, testFiles };
  } catch (error) {
    const reason = `Repository content collection failed: ${error.message}`;
    return {
      sourceLoc: failed(reason, "source files"),
      testLoc: failed(reason, "test files"),
      sourceFiles: failed(reason, "source files"),
      testFiles: failed(reason, "test files")
    };
  }
}

function runTimestamp(run) {
  return run.completed_at ?? run.updated_at ?? run.created_at ?? null;
}

function runDuration(run) {
  if (run.status !== "completed") return null;
  if (Number.isFinite(run.run_duration_ms)) return run.run_duration_ms;
  const start = Date.parse(run.run_started_at ?? "");
  const end = Date.parse(run.completed_at ?? run.updated_at ?? "");
  if (Number.isFinite(start) && Number.isFinite(end) && end >= start)
    return end - start;
  return null;
}

async function collectVerification({
  fullName,
  rules,
  fetchImpl,
  token,
  generatedAt
}) {
  const scope = `GitHub Actions · ${rules?.verification?.branch ?? "main"} branch`;
  if (!rules)
    return {
      verificationStatus: unavailable("consumer verification run"),
      verificationDuration: unavailable("consumer verification run")
    };
  const branch = rules.verification.branch;
  try {
    const body = await fetchJson(
      fetchImpl,
      `${API_ROOT}/repos/${fullName}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=100`,
      token
    );
    if (!Array.isArray(body?.workflow_runs))
      throw new Error("GitHub returned no Actions run list");
    const runs = body.workflow_runs
      .filter(
        (run) =>
          run?.head_branch === branch &&
          /^[0-9a-f]{40}$/i.test(run?.head_sha ?? "") &&
          typeof run?.id !== "undefined" &&
          rules.verification.workflowNames.includes(
            String(run?.name ?? "").toLowerCase()
          )
      )
      .sort(
        (left, right) =>
          Date.parse(right.created_at ?? "") - Date.parse(left.created_at ?? "")
      );
    if (runs.length === 0)
      return {
        verificationStatus: unavailable(
          scope,
          "No GitHub Actions run was observed for the configured branch."
        ),
        verificationDuration: unavailable(scope)
      };
    const run = runs[0];
    const evidenceAt = runTimestamp(run);
    if (!evidenceAt || !Number.isFinite(Date.parse(evidenceAt)))
      throw new Error("Latest Actions run has no valid observation time");
    const ageDays = evidenceAt
      ? (Date.parse(generatedAt) - Date.parse(evidenceAt)) / 86400000
      : Number.POSITIVE_INFINITY;
    const stale = ageDays > rules.verification.maxAgeDays;
    const runUrl =
      run.html_url ?? `https://github.com/${fullName}/actions/runs/${run.id}`;
    const statusValue = run.conclusion ?? run.status ?? "unknown";
    const statusReason = stale
      ? `Latest run is ${Math.max(0, Math.floor(ageDays))} days old; freshness limit is ${rules.verification.maxAgeDays} days.`
      : null;
    const verificationStatus = metric(
      stale ? "stale" : "available",
      statusValue,
      {
        source: runUrl,
        observedAt: generatedAt,
        evidenceAt,
        runUrl,
        runId: run.id,
        revision: run.head_sha,
        scope: `${scope} · ${run.name ?? "workflow"}`,
        reason: statusReason
      }
    );
    const duration = runDuration(run);
    const verificationDuration =
      duration === null
        ? unavailable(
            scope,
            "The latest Actions run has no authoritative duration yet."
          )
        : metric(stale ? "stale" : "available", duration, {
            source: runUrl,
            observedAt: generatedAt,
            evidenceAt,
            runUrl,
            runId: run.id,
            revision: run.head_sha,
            scope: `${scope} · milliseconds`,
            reason: statusReason
          });
    return { verificationStatus, verificationDuration };
  } catch (error) {
    const reason = `GitHub Actions collection failed: ${error.message}`;
    return {
      verificationStatus: failed(reason, scope),
      verificationDuration: failed(reason, scope)
    };
  }
}

function aggregateNumericMetrics(products, key, generatedAt, scope) {
  const fields = products.map((product) => product.metrics[key]);
  const measuredProducts = products.filter(
    (product) =>
      product.metrics[key].status === "available" ||
      product.metrics[key].status === "partial"
  );
  const measured = measuredProducts.map((product) => product.metrics[key]);
  if (measured.length === 0) {
    const states = new Set(fields.map((field) => field.status));
    if (states.size === 1 && states.has("failed"))
      return failed(`Every ${scope} collection failed.`, scope);
    if (states.has("stale"))
      return metric("stale", null, {
        scope,
        reason: `All ${scope} evidence is stale.`
      });
    if (states.size === 1 && states.has("unsupported"))
      return unsupported(`No ${scope} evidence is supported.`, scope);
    return unavailable(scope);
  }
  const value = measured.reduce((total, field) => total + field.value, 0);
  const complete =
    measured.length === fields.length &&
    measured.every((field) => field.status === "available");
  return metric(complete ? "available" : "partial", value, {
    source:
      key === "verificationDuration"
        ? "GitHub Actions workflow runs"
        : "GitHub repository content",
    observedAt: generatedAt,
    scope: `${measured.length}/${products.length} products · sum of ${scope}`,
    reason: complete
      ? null
      : `Some ${scope} evidence is unavailable, stale, or partial.`,
    revision: "mixed",
    revisions: Object.fromEntries(
      measuredProducts.map((product) => [
        product.repository,
        product.metrics[key].revision
      ])
    ),
    runUrls: Object.fromEntries(
      measuredProducts
        .filter((product) => product.metrics[key].runUrl)
        .map((product) => [product.repository, product.metrics[key].runUrl])
    )
  });
}

function sumIssueMetrics(products, generatedAt) {
  const fields = products.map((product) => product.metrics.openIssues);
  const measured = fields.filter((field) => field.status === "available");
  if (!measured.length) {
    return fields.every((field) => field.status === "failed")
      ? failed("Every repository Issue collection failed.", "open Issues")
      : unavailable("open Issues");
  }
  const sum = measured.reduce((total, field) => total + field.value, 0);
  const context = {
    source: "GitHub REST API · repository Issue collection",
    observedAt: generatedAt,
    scope: `${measured.length}/${products.length} products · open Issues`
  };
  return measured.length === fields.length
    ? metric("available", sum, context)
    : metric("partial", sum, {
        ...context,
        reason: "Some repository Issue collections did not complete."
      });
}

export function unavailableEngineeringMetrics(catalog) {
  return {
    schemaVersion: ENGINEERING_METRICS_SCHEMA_VERSION,
    generatedAt: "unavailable",
    source: "unavailable",
    products: catalog.products.map((product) => ({
      id: product.id,
      repository: repositoryName(product),
      metrics: Object.fromEntries(
        ENGINEERING_METRIC_FIELDS.map((key) => [key, unavailable()])
      )
    })),
    summary: Object.fromEntries(
      SUMMARY_FIELDS.map((key) => [key, unavailable()])
    )
  };
}

export async function collectEngineeringMetrics({
  catalog,
  dashboard,
  engineeringRules = null,
  fetchImpl = globalThis.fetch,
  token = ""
}) {
  const generatedAt = dashboard.generatedAt;
  const rulesByProduct =
    engineeringRules && !engineeringRules.schemaVersion
      ? validateEngineeringRules(
          {
            schemaVersion: ENGINEERING_RULES_SCHEMA_VERSION,
            products: engineeringRules
          },
          catalog
        )
      : validateEngineeringRules(engineeringRules, catalog);
  const repositories = new Map(
    dashboard.repositories.map((repository) => [
      repository.fullName.toLowerCase(),
      repository
    ])
  );
  const products = await Promise.all(
    catalog.products.map(async (product) => {
      const fullName = repositoryName(product);
      const repository = repositories.get(fullName.toLowerCase());
      const rules = rulesByProduct?.[product.id] ?? null;
      const [code, verification, packageMetric] = await Promise.all([
        collectRepositoryCode({
          fullName,
          rules,
          fetchImpl,
          token,
          generatedAt
        }),
        collectVerification({
          fullName,
          rules,
          fetchImpl,
          token,
          generatedAt
        }),
        packageVersion(
          { fullName, url: product.repository },
          { fetchImpl, token, generatedAt }
        )
      ]);
      const metrics = {
        ...code,
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
        ...verification,
        packageVersion: packageMetric,
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
    openIssues: sumIssueMetrics(products, generatedAt),
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
    sourceLoc: aggregateNumericMetrics(
      products,
      "sourceLoc",
      generatedAt,
      "source LOC"
    ),
    testLoc: aggregateNumericMetrics(
      products,
      "testLoc",
      generatedAt,
      "test LOC"
    ),
    coverageLines: unavailable(
      "all registered products · producer scope required"
    ),
    verificationDuration: aggregateNumericMetrics(
      products,
      "verificationDuration",
      generatedAt,
      "verification duration"
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
  if (!document.generatedAt || !document.source || !document.summary)
    throw new Error(
      "Engineering metrics require snapshot provenance and summary"
    );
  const expected = catalog.products.map((product) => product.id);
  if (
    JSON.stringify(document.products.map((product) => product.id)) !==
    JSON.stringify(expected)
  )
    throw new Error(
      "Engineering metrics products must match the catalog order"
    );
  for (const product of document.products) {
    if (
      JSON.stringify(Object.keys(product.metrics ?? {})) !==
      JSON.stringify(ENGINEERING_METRIC_FIELDS)
    )
      throw new Error(
        `Engineering metric fields are incomplete for ${product.id}`
      );
  }
  if (
    JSON.stringify(Object.keys(document.summary)) !==
    JSON.stringify(SUMMARY_FIELDS)
  )
    throw new Error("Engineering summary fields are incomplete");
  for (const entry of [
    ...document.products.flatMap((product) => Object.values(product.metrics)),
    ...Object.values(document.summary ?? {})
  ]) {
    if (!ENGINEERING_METRIC_STATES.includes(entry?.status))
      throw new Error("Engineering metric has invalid status");
    if (
      ["unavailable", "unsupported", "failed"].includes(entry.status) &&
      entry.value !== null
    )
      throw new Error("Unavailable engineering metric must have a null value");
    if (
      entry.status === "available" &&
      (entry.value === null || !entry.source || !entry.observedAt)
    )
      throw new Error("Available engineering metric lacks provenance");
    if (entry.status !== "available" && !entry.reason)
      throw new Error("Missing engineering metric reason");
  }
  for (const product of document.products) {
    for (const key of ["sourceLoc", "testLoc", "sourceFiles", "testFiles"]) {
      const entry = product.metrics[key];
      if (["available", "partial"].includes(entry.status)) {
        if (!entry.scope || !/^[0-9a-f]{40}$/i.test(entry.revision ?? ""))
          throw new Error(`${product.id}.${key} lacks revision provenance`);
      }
    }
    for (const key of ["verificationStatus", "verificationDuration"]) {
      const entry = product.metrics[key];
      if (["available", "stale"].includes(entry.status)) {
        if (
          !entry.scope ||
          !entry.evidenceAt ||
          !entry.runUrl ||
          !entry.runId ||
          !/^[0-9a-f]{40}$/i.test(entry.revision ?? "")
        )
          throw new Error(`${product.id}.${key} lacks Actions provenance`);
      }
    }
  }
  return document;
}
