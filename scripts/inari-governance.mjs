import {
  GitHubAdapter,
  compileRepositoryGovernedContracts,
  readGovernedExistingArtifact,
  projectExistingArtifact
} from "gh-inari";

const API_ROOT = "https://api.github.com";
const API_VERSION = "2022-11-28";
export const INARI_GOVERNANCE_AUTHORITY = "Inari";

export const GOVERNANCE_REASON_CODES = Object.freeze({
  AUTHENTICATION_UNAVAILABLE: "authentication-unavailable",
  INSUFFICIENT_PERMISSIONS: "insufficient-permissions",
  INARI_CONTRACT_UNAVAILABLE: "inari-contract-unavailable",
  EVALUATOR_FAILED: "evaluator-failed",
  REPOSITORY_SOURCE_UNAVAILABLE: "repository-source-unavailable"
});

export const GOVERNANCE_DIAGNOSTIC_CODES = Object.freeze({
  AUTHENTICATION_UNAVAILABLE: "AUTHENTICATION_UNAVAILABLE",
  INSUFFICIENT_PERMISSIONS: "INSUFFICIENT_PERMISSIONS",
  INARI_CONTRACT_UNAVAILABLE: "INARI_CONTRACT_UNAVAILABLE",
  EVALUATOR_FAILED: "EVALUATOR_FAILED",
  REPOSITORY_SOURCE_UNAVAILABLE: "REPOSITORY_SOURCE_UNAVAILABLE",
  UNKNOWN: "GOVERNANCE_UNAVAILABLE"
});

export const GOVERNANCE_COLLECTION_STATES = Object.freeze([
  "healthy",
  "degraded",
  "unavailable"
]);

const diagnosticCodeByReason = new Map([
  [
    GOVERNANCE_REASON_CODES.AUTHENTICATION_UNAVAILABLE,
    GOVERNANCE_DIAGNOSTIC_CODES.AUTHENTICATION_UNAVAILABLE
  ],
  [
    GOVERNANCE_REASON_CODES.INSUFFICIENT_PERMISSIONS,
    GOVERNANCE_DIAGNOSTIC_CODES.INSUFFICIENT_PERMISSIONS
  ],
  [
    GOVERNANCE_REASON_CODES.INARI_CONTRACT_UNAVAILABLE,
    GOVERNANCE_DIAGNOSTIC_CODES.INARI_CONTRACT_UNAVAILABLE
  ],
  [
    GOVERNANCE_REASON_CODES.EVALUATOR_FAILED,
    GOVERNANCE_DIAGNOSTIC_CODES.EVALUATOR_FAILED
  ],
  [
    GOVERNANCE_REASON_CODES.REPOSITORY_SOURCE_UNAVAILABLE,
    GOVERNANCE_DIAGNOSTIC_CODES.REPOSITORY_SOURCE_UNAVAILABLE
  ]
]);

function issueKey(repository, number) {
  return `${repository.fullName}#${number}`;
}

function hasToken(token) {
  return typeof token === "string" && token.trim() !== "";
}

function errorMessage(error) {
  return String(error?.message ?? error)
    .replace(/Bearer\s+[^\s)]+/giu, "Bearer [redacted]")
    .slice(0, 500);
}

function errorChain(error) {
  const chain = [];
  let current = error;
  for (let index = 0; current && index < 8; index += 1) {
    chain.push(current);
    current = current.cause;
  }
  return chain;
}

function errorStatus(error) {
  for (const candidate of errorChain(error)) {
    if (Number.isInteger(candidate?.status)) return candidate.status;
    if (Number.isInteger(candidate?.details?.status)) {
      return candidate.details.status;
    }
    const text = [
      candidate?.message,
      candidate?.details?.stderr,
      candidate?.details?.response
    ]
      .filter(Boolean)
      .join(" ");
    const match = text.match(/\bHTTP\s+(\d{3})\b/iu);
    if (match) return Number(match[1]);
  }
  return null;
}

function isRateLimitedError(error) {
  return errorChain(error).some((candidate) =>
    /rate\s*limit|secondary rate/iu.test(
      [candidate?.message, candidate?.details?.stderr].filter(Boolean).join(" ")
    )
  );
}

function isPermissionError(error) {
  const status = errorStatus(error);
  const explicitPermissionEvidence = errorChain(error).some((candidate) =>
    /bad credentials|insufficient.*permission|permission.*denied|requires authentication|resource not accessible by integration/iu.test(
      [candidate?.message, candidate?.details?.stderr].filter(Boolean).join(" ")
    )
  );
  if (status === 401) return true;
  if (status === 403) return !isRateLimitedError(error);
  if (status === 404) return explicitPermissionEvidence;
  return explicitPermissionEvidence;
}

export function governanceFailureReason(error) {
  return isPermissionError(error)
    ? GOVERNANCE_REASON_CODES.INSUFFICIENT_PERMISSIONS
    : GOVERNANCE_REASON_CODES.INARI_CONTRACT_UNAVAILABLE;
}

function defaultDiagnosticMessage(reason) {
  switch (reason) {
    case GOVERNANCE_REASON_CODES.AUTHENTICATION_UNAVAILABLE:
      return "Portal collection token is unavailable; authenticated Inari repository access is required.";
    case GOVERNANCE_REASON_CODES.INSUFFICIENT_PERMISSIONS:
      return "The portal collection token cannot read the repository governance source or Issue.";
    case GOVERNANCE_REASON_CODES.INARI_CONTRACT_UNAVAILABLE:
      return "Inari governance contract discovery or read failed.";
    case GOVERNANCE_REASON_CODES.EVALUATOR_FAILED:
      return "The Issue governance evaluator failed unexpectedly.";
    case GOVERNANCE_REASON_CODES.REPOSITORY_SOURCE_UNAVAILABLE:
      return "The repository source could not be collected.";
    default:
      return "Governance evidence is unavailable for an unspecified reason.";
  }
}

function diagnosticCode(reason) {
  return (
    diagnosticCodeByReason.get(reason) ?? GOVERNANCE_DIAGNOSTIC_CODES.UNKNOWN
  );
}

export function createGovernanceDiagnostic({
  reason,
  stage = "evaluation",
  repository,
  issue,
  message,
  error,
  details = {}
} = {}) {
  const resolvedReason =
    typeof reason === "string" && reason.trim() !== ""
      ? reason.trim()
      : GOVERNANCE_REASON_CODES.INARI_CONTRACT_UNAVAILABLE;
  const diagnostic = {
    code: diagnosticCode(resolvedReason),
    reason: resolvedReason,
    stage,
    message: String(message ?? defaultDiagnosticMessage(resolvedReason)).slice(
      0,
      500
    )
  };
  if (typeof repository === "string" && repository.trim() !== "") {
    diagnostic.repository = repository.trim();
  }
  if (Number.isSafeInteger(issue) && issue > 0) diagnostic.issue = issue;
  const status = errorStatus(error);
  if (status !== null) diagnostic.status = status;
  if (error && message === undefined) {
    diagnostic.message = `${diagnostic.message} ${errorMessage(error)}`.slice(
      0,
      500
    );
  }
  for (const key of ["path", "operation", "template"]) {
    if (typeof details?.[key] === "string" && details[key].trim() !== "") {
      diagnostic[key] = details[key].trim().slice(0, 240);
    }
  }
  return diagnostic;
}

export function unavailableGovernance(reason, options = {}) {
  const diagnostics = Array.isArray(options.diagnostics)
    ? options.diagnostics.filter(
        (diagnostic) => diagnostic && typeof diagnostic === "object"
      )
    : [];
  const resolvedDiagnostics =
    diagnostics.length > 0
      ? diagnostics
      : [
          createGovernanceDiagnostic({
            reason,
            stage: options.stage ?? "evaluation",
            repository: options.repository,
            issue: options.issue,
            message: options.message,
            error: options.error,
            details: options.details
          })
        ];
  return {
    authority: INARI_GOVERNANCE_AUTHORITY,
    status: "unavailable",
    valid: null,
    classification: "unknown",
    template: null,
    violations: [],
    dependencies: null,
    revision: null,
    reason,
    diagnostics: resolvedDiagnostics
  };
}

function projectGovernance(read) {
  const projection = projectExistingArtifact(read.result);
  const violations = projection.violations ?? projection.diagnostics ?? [];
  return {
    authority: INARI_GOVERNANCE_AUTHORITY,
    status: projection.valid ? "valid" : "invalid",
    valid: projection.valid,
    classification: projection.classification,
    template: read.contract?.templateIdentity ?? null,
    violations,
    // Dependencies are only ever projected for a valid canonical artifact
    // (see gh-inari `projectExistingArtifact`); an invalid artifact never
    // exposes parsed dependency declarations, so this stays null there.
    dependencies: projection.dependencies ?? null,
    revision:
      read.contract?.provenance?.treeSha ?? read.governanceRevision ?? null,
    reason: null,
    diagnostics: []
  };
}

/**
 * Bounded `gh api --jq <path>` shim. Inari's repository identity resolution
 * (0.9.0+) reads a single scalar field (currently only `.id`) from a REST
 * response; this deliberately supports nothing beyond dotted field access.
 */
function applyJqExpression(body, expression) {
  if (typeof expression !== "string" || expression.trim() === "") return body;
  let value;
  try {
    value = JSON.parse(body);
  } catch {
    return body;
  }
  for (const key of expression.trim().replace(/^\./, "").split(".")) {
    if (key === "") continue;
    if (value === null || typeof value !== "object") {
      value = undefined;
      break;
    }
    value = value[key];
  }
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

class FetchGithubTransport {
  constructor({ fetchImpl, token, issues }) {
    this.fetchImpl = fetchImpl;
    this.token = token;
    this.issues = issues;
    this.cache = new Map();
    this.failures = [];
  }

  async run(args) {
    if (args[0] === "--version") {
      return {
        exitCode: 0,
        stdout: "gh version inari-transport\n",
        stderr: ""
      };
    }
    if (args[0] === "auth" && args[1] === "status") {
      return hasToken(this.token)
        ? { exitCode: 0, stdout: "Logged in\n", stderr: "" }
        : { exitCode: 1, stdout: "", stderr: "not logged in" };
    }
    if (args[0] !== "api" || typeof args[1] !== "string") {
      return { exitCode: 1, stdout: "", stderr: "unsupported gh invocation" };
    }

    const endpoint = args[1];
    const methodIndex = args.indexOf("--method");
    const method = methodIndex === -1 ? "GET" : args[methodIndex + 1];
    const hostnameIndex = args.indexOf("--hostname");
    const hostname =
      hostnameIndex === -1 ? "github.com" : args[hostnameIndex + 1];
    const jqIndex = args.indexOf("--jq");
    const jqExpression = jqIndex === -1 ? null : args[jqIndex + 1];
    const baseUrl =
      hostname === "github.com" ? API_ROOT : `https://${hostname}/api/v3`;
    const url = `${baseUrl}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
    const cacheKey = `${method}:${url}:${jqExpression ?? ""}`;
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey);

    const issueMatch = endpoint.match(/^repos\/([^/]+\/[^/]+)\/issues\/(\d+)$/);
    if (method === "GET" && issueMatch) {
      const rawIssue = this.issues.get(
        issueKey({ fullName: issueMatch[1] }, Number(issueMatch[2]))
      );
      if (rawIssue !== undefined) {
        const result = {
          exitCode: 0,
          stdout: JSON.stringify(rawIssue),
          stderr: ""
        };
        this.cache.set(cacheKey, result);
        return result;
      }
    }

    const headers = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": API_VERSION,
      "User-Agent": "yohn-jp-issue-dashboard"
    };
    if (hasToken(this.token)) headers.Authorization = `Bearer ${this.token}`;
    const response = await this.fetchImpl(url, { headers });
    const body = await response.text();
    const result = response.ok
      ? {
          exitCode: 0,
          stdout: applyJqExpression(body, jqExpression),
          stderr: ""
        }
      : {
          exitCode: 1,
          stdout: "",
          stderr:
            `[HTTP ${response.status}] ${body || "GitHub API request failed"}`.slice(
              0,
              2000
            )
        };
    if (!response.ok) {
      this.failures.push({
        status: response.status,
        message: String(body || "GitHub API request failed").slice(0, 2000)
      });
    }
    if (response.ok && endpoint.includes("/git/trees/")) {
      try {
        this.governanceRevision = JSON.parse(body)?.sha ?? null;
      } catch {
        this.governanceRevision = null;
      }
    }
    this.cache.set(cacheKey, result);
    return result;
  }
}

function createGovernanceAdapter({
  repository,
  fetchImpl,
  token,
  rawIssues = []
}) {
  const issues = new Map(
    rawIssues.map((issue) => [issueKey(repository, issue.number), issue])
  );
  const transport = new FetchGithubTransport({ fetchImpl, token, issues });
  const adapter = new GitHubAdapter({
    repository: repository.fullName,
    transport
  });
  return { adapter, transport };
}

export function createIssueGovernanceReader({
  repository,
  fetchImpl = globalThis.fetch,
  token = "",
  rawIssues = [],
  adapter
}) {
  const state = adapter
    ? { adapter, transport: adapter.transport }
    : createGovernanceAdapter({ repository, fetchImpl, token, rawIssues });
  return async (number) => ({
    ...(await readGovernedExistingArtifact(state.adapter, "issue", number)),
    governanceRevision: state.transport?.governanceRevision ?? null
  });
}

function preflightResult({
  status,
  repository,
  diagnostics = [],
  revision = null,
  contractCount = 0,
  reader = null
}) {
  return {
    authority: INARI_GOVERNANCE_AUTHORITY,
    status,
    availability: status,
    available: status !== "unavailable",
    reason: diagnostics[0]?.reason ?? null,
    diagnostics,
    revision,
    contractCount,
    repository: repository.fullName,
    reader
  };
}

/**
 * Establishes the repository-level Inari capability before any Issue is
 * evaluated. The returned reader reuses the same bounded transport so the
 * contract source is cached while Issue bodies are projected.
 */
export async function preflightIssueGovernance({
  repository,
  fetchImpl = globalThis.fetch,
  token = "",
  rawIssues = []
}) {
  if (!hasToken(token)) {
    return preflightResult({
      status: "unavailable",
      repository,
      diagnostics: [
        createGovernanceDiagnostic({
          reason: GOVERNANCE_REASON_CODES.AUTHENTICATION_UNAVAILABLE,
          stage: "preflight",
          repository: repository.fullName
        })
      ]
    });
  }

  const { adapter, transport } = createGovernanceAdapter({
    repository,
    fetchImpl,
    token,
    rawIssues
  });
  try {
    const outcomes = await compileRepositoryGovernedContracts(adapter, "issue");
    const compiled = outcomes.filter(
      (outcome) => outcome.status === "compiled"
    );
    const failedReason = transport.failures.some(isPermissionError)
      ? GOVERNANCE_REASON_CODES.INSUFFICIENT_PERMISSIONS
      : GOVERNANCE_REASON_CODES.INARI_CONTRACT_UNAVAILABLE;
    const permissionFailure = transport.failures.find(isPermissionError);
    const diagnostics = outcomes
      .filter((outcome) => outcome.status === "failed")
      .map((outcome) =>
        createGovernanceDiagnostic({
          reason: failedReason,
          stage: "contract-discovery",
          repository: repository.fullName,
          message: `Inari could not compile ${outcome.path}: ${outcome.message}`,
          error: permissionFailure,
          details: { path: outcome.path }
        })
      );
    if (compiled.length === 0) {
      if (diagnostics.length === 0) {
        diagnostics.push(
          createGovernanceDiagnostic({
            reason: GOVERNANCE_REASON_CODES.INARI_CONTRACT_UNAVAILABLE,
            stage: "contract-discovery",
            repository: repository.fullName,
            message:
              "Inari discovered no usable repository-native Issue governance contract."
          })
        );
      }
      return preflightResult({
        status: "unavailable",
        repository,
        diagnostics,
        reader: null
      });
    }

    const revisions = [
      ...new Set(
        compiled
          .map((outcome) => outcome.contract?.provenance?.treeSha)
          .filter((revision) => typeof revision === "string")
      )
    ];
    return preflightResult({
      status: diagnostics.length > 0 ? "degraded" : "healthy",
      repository,
      diagnostics,
      revision: revisions[0] ?? null,
      contractCount: compiled.length,
      reader: createIssueGovernanceReader({
        repository,
        token,
        rawIssues,
        adapter
      })
    });
  } catch (error) {
    const reason = governanceFailureReason(error);
    return preflightResult({
      status: "unavailable",
      repository,
      diagnostics: [
        createGovernanceDiagnostic({
          reason,
          stage: "preflight",
          repository: repository.fullName,
          error
        })
      ]
    });
  }
}

export async function collectIssueGovernance({
  issue,
  repository,
  rawIssues = [],
  fetchImpl = globalThis.fetch,
  token = "",
  reader
}) {
  if (!hasToken(token)) {
    return unavailableGovernance(
      GOVERNANCE_REASON_CODES.AUTHENTICATION_UNAVAILABLE,
      {
        stage: "preflight",
        repository: repository.fullName,
        issue: issue.number
      }
    );
  }
  try {
    const read = await (
      reader ??
      createIssueGovernanceReader({ repository, fetchImpl, token, rawIssues })
    )(issue.number);
    return projectGovernance(read);
  } catch (error) {
    const reason = governanceFailureReason(error);
    return unavailableGovernance(reason, {
      stage: "issue-read",
      repository: repository.fullName,
      issue: issue.number,
      error
    });
  }
}
