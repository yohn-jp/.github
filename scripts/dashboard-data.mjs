import {
  collectIssueGovernance,
  createGovernanceDiagnostic,
  createIssueGovernanceReader,
  GOVERNANCE_COLLECTION_STATES,
  GOVERNANCE_REASON_CODES,
  governanceFailureReason,
  preflightIssueGovernance,
  unavailableGovernance
} from "./inari-governance.mjs";
import { aggregateGovernanceHealth } from "./governance-health.mjs";

const API_ROOT = "https://api.github.com";
const API_VERSION = "2022-11-28";

export const DASHBOARD_SCHEMA_VERSION = 5;

function getHeader(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === "function") return headers.get(name);
  const target = name.toLowerCase();
  const key = Object.keys(headers).find(
    (candidate) => candidate.toLowerCase() === target
  );
  return key ? headers[key] : null;
}

function createHttpError(message, status, headers) {
  const error = new Error(message);
  error.status = status;
  error.headers = headers;
  return error;
}

function isRateLimited(error) {
  const message = String(error?.message ?? "").toLowerCase();
  return (
    error?.status === 403 ||
    error?.status === 429 ||
    message.includes("rate limit")
  );
}

function configuredRepository(entry, organization) {
  const value = typeof entry === "string" ? { name: entry } : entry;
  if (!value || typeof value !== "object")
    throw new Error("Each configured repository must be a name or object");
  const fullName = value.fullName ?? `${organization}/${value.name ?? ""}`;
  const [owner, name] = fullName.split("/");
  if (
    !owner ||
    !name ||
    owner !== organization ||
    fullName.split("/").length !== 2
  ) {
    throw new Error(
      `Configured repository must belong to ${organization}: ${fullName}`
    );
  }
  return { owner, name, fullName };
}

function validateConfig(config) {
  if (!config || typeof config !== "object")
    throw new Error("Dashboard config must be an object");
  if (typeof config.organization !== "string" || !config.organization) {
    throw new Error("Dashboard config requires a non-empty organization");
  }
  if (!Array.isArray(config.repositories) || config.repositories.length === 0) {
    throw new Error("Dashboard config requires at least one repository");
  }
  return config.repositories.map((entry) =>
    configuredRepository(entry, config.organization)
  );
}

function repositoryUrl(fullName) {
  return `https://github.com/${fullName}`;
}

export function normalizeRepository(repository, configuredFullName = "") {
  const fullName = repository.full_name ?? configuredFullName;
  const fallbackName = fullName.split("/").at(-1) ?? fullName;
  return {
    id: repository.id ?? `repository:${fullName}`,
    name: repository.name ?? fallbackName,
    fullName,
    url: repository.html_url ?? repositoryUrl(fullName),
    visibility:
      repository.visibility ?? (repository.private ? "private" : "public"),
    openIssueCount: null,
    fetchStatus: "pending",
    error: null
  };
}

function normalizeUser(user) {
  if (!user) return null;
  return {
    login: user.login,
    url: user.html_url ?? `https://github.com/${user.login}`,
    avatarUrl: user.avatar_url ?? null
  };
}

function normalizeMilestone(milestone) {
  if (!milestone) return null;
  return { title: milestone.title, url: milestone.html_url ?? null };
}

function normalizeType(issue) {
  const type = issue.type ?? issue.issue_type;
  if (!type) return null;
  if (typeof type === "string") return type;
  return type.name ?? type.title ?? null;
}

function normalizeLabel(label) {
  if (typeof label === "string") return { name: label, color: null };
  return { name: label.name, color: label.color ?? null };
}

export function normalizeIssue(issue, repository) {
  const assignees = Array.isArray(issue.assignees)
    ? issue.assignees.map(normalizeUser).filter(Boolean)
    : [];
  const assignee = normalizeUser(issue.assignee) ?? assignees[0] ?? null;
  return {
    id: issue.id,
    repository: {
      id: repository.id,
      name: repository.name,
      fullName: repository.fullName,
      url: repository.url
    },
    number: issue.number,
    title: issue.title,
    url: issue.html_url,
    state: issue.state,
    stateReason: issue.state_reason ?? null,
    createdAt: issue.created_at ?? null,
    labels: Array.isArray(issue.labels) ? issue.labels.map(normalizeLabel) : [],
    type: normalizeType(issue),
    milestone: normalizeMilestone(issue.milestone),
    assignee,
    assignees,
    updatedAt: issue.updated_at,
    relationships: {}
  };
}

function dependencyRepositoryFullName(issue) {
  if (issue.repository_url) {
    try {
      const parts = new URL(issue.repository_url).pathname
        .split("/")
        .filter(Boolean);
      if (parts[0] === "repos" && parts.length >= 3)
        return `${parts[1]}/${parts[2]}`;
    } catch {}
  }
  if (issue.html_url) {
    try {
      const parts = new URL(issue.html_url).pathname.split("/").filter(Boolean);
      if (parts.length >= 4 && parts[2] === "issues")
        return `${parts[0]}/${parts[1]}`;
    } catch {}
  }
  return null;
}

export function normalizeIssueReference(issue) {
  const fullName = dependencyRepositoryFullName(issue);
  if (!fullName || !Number.isInteger(issue.number)) {
    throw new Error(
      "Dependency response lacks canonical repository/issue identity"
    );
  }
  return {
    id: issue.id ?? `issue:${fullName}#${issue.number}`,
    repository: { fullName, url: repositoryUrl(fullName) },
    number: issue.number,
    title: issue.title ?? `Issue #${issue.number}`,
    state: issue.state ?? "unknown",
    stateReason: issue.state_reason ?? null,
    url: issue.html_url ?? `${repositoryUrl(fullName)}/issues/${issue.number}`
  };
}

export function parseLinkHeader(value) {
  const links = {};
  if (!value) return links;
  for (const part of value.split(",")) {
    const match = part.trim().match(/^<([^>]+)>;\s*rel="([^"]+)"/);
    if (match) links[match[2]] = match[1];
  }
  return links;
}

async function fetchJson(url, { fetchImpl, token }) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": API_VERSION,
    "User-Agent": "yohn-jp-issue-dashboard"
  };
  if (typeof token === "string" && token.trim() !== "") {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetchImpl(url, { headers });
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw createHttpError(
        `GitHub API returned invalid JSON (HTTP ${response.status})`,
        response.status,
        response.headers
      );
    }
  }
  if (!response.ok) {
    throw createHttpError(
      body?.message ?? `GitHub API returned HTTP ${response.status}`,
      response.status,
      response.headers
    );
  }
  return { body, headers: response.headers };
}

async function fetchAll(url, options) {
  const values = [];
  let nextUrl = url;
  while (nextUrl) {
    const result = await fetchJson(nextUrl, options);
    if (!Array.isArray(result.body))
      throw new Error("GitHub API returned a non-array response");
    values.push(...result.body);
    nextUrl = parseLinkHeader(getHeader(result.headers, "link")).next ?? null;
  }
  return values;
}

function errorRecord(repository, stage, error) {
  const remaining = getHeader(error?.headers, "x-ratelimit-remaining");
  return {
    repository: repository.fullName,
    stage,
    status: error?.status ?? null,
    rateLimited: isRateLimited(error),
    rateLimitRemaining: remaining === null ? null : Number(remaining),
    message: String(error?.message ?? error)
  };
}

function fallbackRepository(configured) {
  return {
    id: `repository:${configured.fullName}`,
    name: configured.name,
    fullName: configured.fullName,
    url: repositoryUrl(configured.fullName),
    visibility: "unknown",
    openIssueCount: null,
    fetchStatus: "error",
    error: null
  };
}

function repositoryGovernance(preflight, diagnostics = []) {
  const preflightDiagnostics = Array.isArray(preflight?.diagnostics)
    ? preflight.diagnostics
    : [];
  const combined = [...preflightDiagnostics, ...diagnostics];
  const status =
    preflight?.status === "unavailable"
      ? "unavailable"
      : combined.length > 0 || preflight?.status === "degraded"
        ? "degraded"
        : "healthy";
  const uniqueDiagnostics = [];
  const seen = new Set();
  for (const diagnostic of combined) {
    if (!diagnostic || typeof diagnostic !== "object") continue;
    const key = JSON.stringify([
      diagnostic.reason,
      diagnostic.stage,
      diagnostic.message,
      diagnostic.path,
      diagnostic.issue
    ]);
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueDiagnostics.push(diagnostic);
  }
  return {
    status,
    availability: status,
    available: status !== "unavailable",
    reason: uniqueDiagnostics[0]?.reason ?? null,
    diagnostics: uniqueDiagnostics,
    revision: preflight?.revision ?? null,
    contractCount: preflight?.contractCount ?? 0
  };
}

function unavailableRepositoryGovernance(repository, error, token = "") {
  const reason =
    typeof token === "string" &&
    token.trim() !== "" &&
    governanceFailureReason(error) ===
      GOVERNANCE_REASON_CODES.INSUFFICIENT_PERMISSIONS
      ? GOVERNANCE_REASON_CODES.INSUFFICIENT_PERMISSIONS
      : GOVERNANCE_REASON_CODES.REPOSITORY_SOURCE_UNAVAILABLE;
  const diagnostic = createGovernanceDiagnostic({
    reason,
    stage: "repository",
    repository: repository.fullName,
    message: error?.message
      ? `Repository source collection failed: ${String(error.message).slice(0, 400)}`
      : undefined,
    error
  });
  return repositoryGovernance({
    status: "unavailable",
    diagnostics: [diagnostic]
  });
}

function healthyGovernancePreflight(repository) {
  return {
    authority: "Inari",
    status: "healthy",
    availability: "healthy",
    available: true,
    reason: null,
    diagnostics: [],
    revision: null,
    contractCount: null,
    repository: repository.fullName,
    reader: null
  };
}

function normalizeGovernancePreflight(result, repository) {
  const status =
    result?.status ?? (result?.available === false ? "unavailable" : "healthy");
  if (!GOVERNANCE_COLLECTION_STATES.includes(status)) {
    return {
      ...healthyGovernancePreflight(repository),
      status: "unavailable",
      availability: "unavailable",
      available: false,
      reason: GOVERNANCE_REASON_CODES.INARI_CONTRACT_UNAVAILABLE,
      diagnostics: [
        createGovernanceDiagnostic({
          reason: GOVERNANCE_REASON_CODES.INARI_CONTRACT_UNAVAILABLE,
          stage: "preflight",
          repository: repository.fullName,
          message: "Governance preflight returned an invalid collection state."
        })
      ],
      reader: null
    };
  }
  const diagnostics = Array.isArray(result?.diagnostics)
    ? result.diagnostics.filter(
        (diagnostic) => diagnostic && typeof diagnostic === "object"
      )
    : [];
  const resolvedDiagnostics =
    status !== "healthy" && diagnostics.length === 0
      ? [
          createGovernanceDiagnostic({
            reason:
              result?.reason ??
              GOVERNANCE_REASON_CODES.INARI_CONTRACT_UNAVAILABLE,
            stage: "preflight",
            repository: repository.fullName
          })
        ]
      : diagnostics;
  return {
    ...result,
    authority: result?.authority ?? "Inari",
    status,
    availability: status,
    available: status !== "unavailable",
    reason: result?.reason ?? resolvedDiagnostics[0]?.reason ?? null,
    diagnostics: resolvedDiagnostics,
    revision: result?.revision ?? null,
    contractCount: result?.contractCount ?? 0,
    repository: result?.repository ?? repository.fullName,
    reader: typeof result?.reader === "function" ? result.reader : null
  };
}

function governanceErrorRecord(repository, issue, diagnostic) {
  const status = Number.isInteger(diagnostic?.status)
    ? diagnostic.status
    : null;
  return {
    repository: repository.fullName,
    ...(Number.isSafeInteger(issue?.number) ? { issue: issue.number } : {}),
    stage: diagnostic?.stage ?? "governance",
    code: diagnostic?.code ?? "GOVERNANCE_UNAVAILABLE",
    reason: diagnostic?.reason ?? null,
    status,
    rateLimited: status === 429,
    rateLimitRemaining: null,
    message: String(
      diagnostic?.message ?? "Governance evidence is unavailable."
    ).slice(0, 500)
  };
}

function projectionDiagnostics(governance) {
  if (!Array.isArray(governance?.diagnostics)) return [];
  return governance.diagnostics.filter(
    (diagnostic) => diagnostic && typeof diagnostic === "object"
  );
}

function normalizeGovernanceProjection(governance, repository, issue) {
  if (!governance || typeof governance !== "object") {
    return unavailableGovernance(GOVERNANCE_REASON_CODES.EVALUATOR_FAILED, {
      stage: "evaluation",
      repository: repository.fullName,
      issue: issue.number,
      message: "The governance evaluator returned no projection."
    });
  }
  if (governance.status === "unavailable") {
    const diagnostics = projectionDiagnostics(governance);
    return {
      ...governance,
      valid: null,
      reason:
        typeof governance.reason === "string" && governance.reason !== ""
          ? governance.reason
          : GOVERNANCE_REASON_CODES.EVALUATOR_FAILED,
      diagnostics:
        diagnostics.length > 0
          ? diagnostics
          : [
              createGovernanceDiagnostic({
                reason:
                  governance.reason ?? GOVERNANCE_REASON_CODES.EVALUATOR_FAILED,
                stage: "evaluation",
                repository: repository.fullName,
                issue: issue.number,
                message:
                  "The governance evaluator returned unavailable evidence."
              })
            ]
    };
  }
  if (governance.status !== "valid" && governance.status !== "invalid") {
    return unavailableGovernance(GOVERNANCE_REASON_CODES.EVALUATOR_FAILED, {
      stage: "evaluation",
      repository: repository.fullName,
      issue: issue.number,
      message: `The governance evaluator returned unsupported status ${String(
        governance.status
      )}.`
    });
  }
  return {
    ...governance,
    diagnostics: projectionDiagnostics(governance)
  };
}

async function resolveGovernancePreflight({
  repository,
  rawIssues,
  fetchImpl,
  token,
  governanceImpl,
  governancePreflight,
  governancePreflightImpl
}) {
  const customPreflight =
    governancePreflight ??
    governancePreflightImpl ??
    (typeof governanceImpl?.preflight === "function"
      ? governanceImpl.preflight
      : null);
  if (typeof customPreflight === "function") {
    try {
      return normalizeGovernancePreflight(
        await customPreflight({
          repository,
          rawIssues,
          fetchImpl,
          token
        }),
        repository
      );
    } catch (error) {
      return normalizeGovernancePreflight(
        {
          status: "unavailable",
          diagnostics: [
            createGovernanceDiagnostic({
              reason: GOVERNANCE_REASON_CODES.INARI_CONTRACT_UNAVAILABLE,
              stage: "preflight",
              repository: repository.fullName,
              error
            })
          ]
        },
        repository
      );
    }
  }

  return normalizeGovernancePreflight(
    await preflightIssueGovernance({
      repository,
      rawIssues,
      fetchImpl,
      token
    }),
    repository
  );
}

function endpointFor(configured, suffix = "") {
  return `${API_ROOT}/repos/${configured.owner}/${configured.name}${suffix}`;
}

function dependencyCounts(rawIssue) {
  const summary = rawIssue.issue_dependencies_summary;
  if (!summary || typeof summary !== "object") return null;
  return {
    blockedBy: Number(summary.blocked_by ?? summary.total_blocked_by ?? 0),
    blocking: Number(summary.blocking ?? summary.total_blocking ?? 0)
  };
}

function sortReferences(references) {
  references.sort(
    (left, right) =>
      left.repository.fullName.localeCompare(right.repository.fullName) ||
      left.number - right.number
  );
  return references;
}

function governanceBucket(issue) {
  const governance = issue?.governance;
  if (governance?.status === "valid" && governance.valid === true) {
    return "valid";
  }
  if (
    governance?.status === "invalid" ||
    (!governance?.status && governance?.valid === false)
  ) {
    return "invalid";
  }
  return "unknown";
}

async function hydrateDependencies({
  rawIssue,
  issue,
  configured,
  fetchImpl,
  token,
  errors
}) {
  const counts = dependencyCounts(rawIssue);
  const dependencies = {
    status: counts ? "complete" : "unavailable",
    blockedBy: [],
    blocking: []
  };
  issue.relationships.dependencies = dependencies;
  if (!counts) return;

  for (const [field, endpointName] of [
    ["blockedBy", "blocked_by"],
    ["blocking", "blocking"]
  ]) {
    if (counts[field] <= 0) continue;
    try {
      const values = await fetchAll(
        endpointFor(
          configured,
          `/issues/${rawIssue.number}/dependencies/${endpointName}?per_page=100`
        ),
        { fetchImpl, token }
      );
      dependencies[field] = sortReferences(values.map(normalizeIssueReference));
    } catch (error) {
      dependencies.status = "partial";
      errors.push(
        errorRecord(configured, `dependencies:${endpointName}`, error)
      );
    }
  }
}

export async function collectDashboardData({
  config,
  fetchImpl = globalThis.fetch,
  token = "",
  now = () => new Date(),
  governanceImpl = collectIssueGovernance,
  governancePreflight,
  governancePreflightImpl
}) {
  if (typeof fetchImpl !== "function")
    throw new Error("A fetch implementation is required");
  const configuredRepositories = validateConfig(config);
  const repositories = [];
  const issues = [];
  const errors = [];
  const governanceErrors = [];

  for (const configured of configuredRepositories) {
    let repository;
    try {
      const result = await fetchJson(endpointFor(configured), {
        fetchImpl,
        token
      });
      repository = normalizeRepository(result.body, configured.fullName);
      if (repository.visibility !== "public") {
        throw createHttpError(
          `Configured repository is not public (${repository.visibility})`,
          403,
          result.headers
        );
      }
    } catch (error) {
      repository = fallbackRepository(configured);
      const record = errorRecord(configured, "repository", error);
      repository.error = record;
      repository.governance = unavailableRepositoryGovernance(
        repository,
        error,
        token
      );
      repositories.push(repository);
      errors.push(record);
      continue;
    }

    try {
      const rawIssues = (
        await fetchAll(
          endpointFor(configured, "/issues?state=open&per_page=100"),
          { fetchImpl, token }
        )
      ).filter((issue) => !issue.pull_request);
      const normalizedIssues = rawIssues.map((rawIssue) =>
        normalizeIssue(rawIssue, repository)
      );
      const governanceReader = token
        ? createIssueGovernanceReader({
            repository,
            fetchImpl,
            token,
            rawIssues
          })
        : undefined;
      const preflight = await resolveGovernancePreflight({
        repository,
        rawIssues,
        fetchImpl,
        token,
        governanceImpl,
        governancePreflight,
        governancePreflightImpl
      });
      if (preflight.diagnostics.length > 0) {
        governanceErrors.push(
          ...preflight.diagnostics.map((diagnostic) =>
            governanceErrorRecord(repository, null, diagnostic)
          )
        );
      }
      const issueGovernanceDiagnostics = [];
      for (let index = 0; index < rawIssues.length; index += 1) {
        await hydrateDependencies({
          rawIssue: rawIssues[index],
          issue: normalizedIssues[index],
          configured,
          fetchImpl,
          token,
          errors
        });
        let governance;
        if (preflight.status === "unavailable") {
          governance = unavailableGovernance(
            preflight.reason ??
              GOVERNANCE_REASON_CODES.INARI_CONTRACT_UNAVAILABLE,
            {
              stage: "preflight",
              repository: repository.fullName,
              issue: normalizedIssues[index].number,
              diagnostics: preflight.diagnostics
            }
          );
        } else {
          try {
            governance = await governanceImpl({
              issue: normalizedIssues[index],
              repository,
              rawIssues,
              fetchImpl,
              token,
              reader: preflight.reader ?? governanceReader,
              preflight
            });
          } catch (error) {
            governance = unavailableGovernance(
              GOVERNANCE_REASON_CODES.EVALUATOR_FAILED,
              {
                stage: "evaluation",
                repository: repository.fullName,
                issue: normalizedIssues[index].number,
                error
              }
            );
          }
        }
        normalizedIssues[index].governance = normalizeGovernanceProjection(
          governance,
          repository,
          normalizedIssues[index]
        );
        if (preflight.status !== "unavailable") {
          const diagnostics = projectionDiagnostics(
            normalizedIssues[index].governance
          );
          issueGovernanceDiagnostics.push(...diagnostics);
          if (normalizedIssues[index].governance.status === "unavailable") {
            governanceErrors.push(
              ...diagnostics.map((diagnostic) =>
                governanceErrorRecord(
                  repository,
                  normalizedIssues[index],
                  diagnostic
                )
              )
            );
          }
        }
      }
      repository.governance = repositoryGovernance(
        preflight,
        issueGovernanceDiagnostics
      );
      repository.openIssueCount = normalizedIssues.length;
      repository.fetchStatus = "ok";
      repositories.push(repository);
      issues.push(...normalizedIssues);
    } catch (error) {
      const record = errorRecord(configured, "issues", error);
      repository.fetchStatus = "error";
      repository.error = record;
      repository.governance = unavailableRepositoryGovernance(
        repository,
        error,
        token
      );
      repositories.push(repository);
      errors.push(record);
    }
  }

  issues.sort((left, right) => {
    const updatedOrder = String(right.updatedAt).localeCompare(
      String(left.updatedAt)
    );
    return (
      updatedOrder ||
      left.repository.fullName.localeCompare(right.repository.fullName) ||
      right.number - left.number
    );
  });

  const successfulRepositories = repositories.filter(
    (repository) => repository.fetchStatus === "ok"
  ).length;
  const failedRepositories = repositories.length - successfulRepositories;
  const dependencyEdges = new Set();
  let dependencyDataUnavailable = 0;
  const governanceCounts = { valid: 0, invalid: 0, unknown: 0 };
  for (const issue of issues) {
    const dependencies = issue.relationships.dependencies;
    if (
      dependencies?.status === "unavailable" ||
      dependencies?.status === "partial"
    )
      dependencyDataUnavailable += 1;
    governanceCounts[governanceBucket(issue)] += 1;
    for (const blocker of dependencies?.blockedBy ?? []) {
      dependencyEdges.add(
        `${blocker.repository.fullName}#${blocker.number}->${issue.repository.fullName}#${issue.number}`
      );
    }
    for (const blocked of dependencies?.blocking ?? []) {
      dependencyEdges.add(
        `${issue.repository.fullName}#${issue.number}->${blocked.repository.fullName}#${blocked.number}`
      );
    }
  }
  const sourceStatus =
    errors.length === 0
      ? "complete"
      : failedRepositories === repositories.length
        ? "failed"
        : "partial";
  const governanceHealth = aggregateGovernanceHealth({
    issues,
    repositories,
    snapshotStatus: sourceStatus
  });
  const status =
    sourceStatus === "failed"
      ? "failed"
      : sourceStatus === "partial" ||
          governanceHealth.collection.status !== "healthy"
        ? "partial"
        : "complete";
  const allErrors = [...errors, ...governanceErrors];

  return {
    schemaVersion: DASHBOARD_SCHEMA_VERSION,
    generatedAt: now().toISOString(),
    status,
    source: {
      provider: "GitHub REST API",
      organization: config.organization,
      repositories: configuredRepositories.map(({ fullName }) => fullName)
    },
    metrics: {
      repositoryCount: repositories.length,
      issueCount: issues.length,
      successfulRepositories,
      failedRepositories,
      dependencyEdges: dependencyEdges.size,
      dependencyDataUnavailable,
      governanceDataUnavailable: governanceCounts.unknown,
      governanceValid: governanceCounts.valid,
      governanceInvalid: governanceCounts.invalid,
      governanceUnknown: governanceCounts.unknown,
      governanceCompliance: governanceCounts,
      governanceCollectionStatus: governanceHealth.collection.status,
      governanceRepositoriesHealthy:
        governanceHealth.collection.healthyRepositories,
      governanceRepositoriesDegraded:
        governanceHealth.collection.degradedRepositories,
      governanceRepositoriesUnavailable:
        governanceHealth.collection.unavailableRepositories,
      governanceUnavailableCauses: governanceHealth.collection.causes.length
    },
    repositories,
    issues,
    governanceHealth,
    errors: allErrors
  };
}
