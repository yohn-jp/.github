import {
  GOVERNANCE_REASON_CODES,
  GOVERNANCE_COLLECTION_STATES
} from "./inari-governance.mjs";

export const GOVERNANCE_HEALTH_SCHEMA_VERSION = 2;
export const GOVERNANCE_STATES = Object.freeze(["valid", "invalid", "unknown"]);

function text(value, fallback = "") {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : fallback;
}

export function governanceState(issue) {
  const governance = issue?.governance;
  if (governance?.status === "valid" && governance.valid === true) {
    return "valid";
  }
  if (
    governance?.status === "invalid" ||
    (!governance?.status && governance.valid === false)
  ) {
    return "invalid";
  }
  return "unknown";
}

function emptyCounts() {
  return { valid: 0, invalid: 0, unknown: 0 };
}

function countsFor(issues) {
  const counts = emptyCounts();
  for (const issue of issues) counts[governanceState(issue)] += 1;
  return counts;
}

function totals(counts) {
  const total = counts.valid + counts.invalid + counts.unknown;
  const known = counts.valid + counts.invalid;
  return {
    ...counts,
    total,
    known,
    complianceRate: known > 0 ? counts.valid / known : null
  };
}

function repositoryKey(repository) {
  return text(repository?.fullName).toLowerCase();
}

function diagnosticCode(reason) {
  switch (reason) {
    case GOVERNANCE_REASON_CODES.AUTHENTICATION_UNAVAILABLE:
      return "AUTHENTICATION_UNAVAILABLE";
    case GOVERNANCE_REASON_CODES.INSUFFICIENT_PERMISSIONS:
      return "INSUFFICIENT_PERMISSIONS";
    case GOVERNANCE_REASON_CODES.INARI_CONTRACT_UNAVAILABLE:
      return "INARI_CONTRACT_UNAVAILABLE";
    case GOVERNANCE_REASON_CODES.EVALUATOR_FAILED:
      return "EVALUATOR_FAILED";
    case GOVERNANCE_REASON_CODES.REPOSITORY_SOURCE_UNAVAILABLE:
      return "REPOSITORY_SOURCE_UNAVAILABLE";
    default:
      return "GOVERNANCE_UNAVAILABLE";
  }
}

function diagnosticMessage(reason) {
  switch (reason) {
    case GOVERNANCE_REASON_CODES.AUTHENTICATION_UNAVAILABLE:
      return "Portal collection authentication is unavailable.";
    case GOVERNANCE_REASON_CODES.INSUFFICIENT_PERMISSIONS:
      return "The portal collection credential lacks the required read permissions.";
    case GOVERNANCE_REASON_CODES.INARI_CONTRACT_UNAVAILABLE:
      return "Inari governance contract discovery or read failed.";
    case GOVERNANCE_REASON_CODES.EVALUATOR_FAILED:
      return "The Issue governance evaluator failed unexpectedly.";
    case GOVERNANCE_REASON_CODES.REPOSITORY_SOURCE_UNAVAILABLE:
      return "Repository source data is unavailable.";
    default:
      return "Governance evidence is unavailable for an unspecified reason.";
  }
}

function normalizeDiagnostic(diagnostic, fallbackReason, fallbackStage) {
  const reason = text(diagnostic?.reason, fallbackReason);
  return {
    code: text(diagnostic?.code, diagnosticCode(reason)),
    reason,
    stage: text(diagnostic?.stage, fallbackStage),
    message: text(diagnostic?.message, diagnosticMessage(reason)),
    ...(Number.isInteger(diagnostic?.status)
      ? { status: diagnostic.status }
      : {}),
    ...(text(diagnostic?.path)
      ? { path: text(diagnostic.path).slice(0, 240) }
      : {}),
    ...(text(diagnostic?.operation)
      ? { operation: text(diagnostic.operation).slice(0, 240) }
      : {})
  };
}

function diagnosticsFor(value, fallbackReason, fallbackStage) {
  const source = value?.governance ?? value;
  const diagnostics = Array.isArray(source?.diagnostics)
    ? source.diagnostics
        .filter((diagnostic) => diagnostic && typeof diagnostic === "object")
        .map((diagnostic) =>
          normalizeDiagnostic(diagnostic, fallbackReason, fallbackStage)
        )
    : [];
  if (diagnostics.length > 0) return diagnostics;
  const reason = text(source?.reason, fallbackReason);
  if (!reason) return [];
  return [normalizeDiagnostic({ reason }, reason, fallbackStage)];
}

function issueReference(issue, status) {
  const repository = issue?.repository ?? {};
  const fullName = text(repository.fullName, "unknown/unknown");
  const repositoryUrl = text(repository.url, `https://github.com/${fullName}`);
  const number = Number.isInteger(issue?.number) ? issue.number : null;
  return {
    id: issue?.id ?? `issue:${fullName}#${number ?? "unknown"}`,
    repository: {
      id: repository.id ?? `repository:${fullName}`,
      name: text(repository.name, fullName.split("/").at(-1) ?? fullName),
      fullName,
      url: repositoryUrl
    },
    number,
    title: text(issue?.title, number === null ? "Issue" : `Issue #${number}`),
    url: text(
      issue?.url,
      number === null ? null : `${repositoryUrl}/issues/${number}`
    ),
    status,
    classification: text(issue?.governance?.classification, "unknown"),
    reason: issue?.governance?.reason ?? null,
    diagnostics: diagnosticsFor(
      issue,
      text(issue?.governance?.reason, "unknown"),
      "evaluation"
    ),
    violations: Array.isArray(issue?.governance?.violations)
      ? issue.governance.violations
      : []
  };
}

function sortedAggregates(values, keyName) {
  return [...values.entries()]
    .map(([key, count]) => ({ [keyName]: key, count }))
    .sort(
      (left, right) =>
        right.count - left.count || left[keyName].localeCompare(right[keyName])
    );
}

function aggregateViolations(issues) {
  const classifications = new Map();
  const codes = new Map();
  for (const issue of issues) {
    if (governanceState(issue) !== "invalid") continue;
    const classification = text(issue.governance?.classification, "unknown");
    classifications.set(
      classification,
      (classifications.get(classification) ?? 0) + 1
    );
    const violations = Array.isArray(issue.governance?.violations)
      ? issue.governance.violations
      : [];
    for (const violation of violations) {
      const code = text(violation?.code, "unknown");
      codes.set(code, (codes.get(code) ?? 0) + 1);
    }
  }
  return {
    classifications: sortedAggregates(classifications, "classification"),
    codes: sortedAggregates(codes, "code")
  };
}

function repositoryGovernance(repository) {
  const sourceAvailable = repository?.fetchStatus === "ok";
  const configuredStatus = repository?.governance?.status;
  const status = GOVERNANCE_COLLECTION_STATES.includes(configuredStatus)
    ? configuredStatus
    : sourceAvailable
      ? "healthy"
      : "unavailable";
  const diagnostics = diagnosticsFor(
    repository,
    sourceAvailable
      ? status === "unavailable"
        ? GOVERNANCE_REASON_CODES.INARI_CONTRACT_UNAVAILABLE
        : ""
      : GOVERNANCE_REASON_CODES.REPOSITORY_SOURCE_UNAVAILABLE,
    sourceAvailable ? "preflight" : "repository"
  );
  return {
    status,
    availability: status,
    available: status !== "unavailable",
    reason: diagnostics[0]?.reason ?? null,
    diagnostics,
    revision: repository?.governance?.revision ?? null,
    contractCount: repository?.governance?.contractCount ?? 0
  };
}

function repositoryHealth(repository, issues) {
  const available = repository?.fetchStatus === "ok";
  const governance = repositoryGovernance(repository);
  if (!available) {
    return {
      id: repository?.id ?? `repository:${repositoryKey(repository)}`,
      name: text(repository?.name, repositoryKey(repository)),
      fullName: text(repository?.fullName, "unknown/unknown"),
      url: text(repository?.url),
      fetchStatus: repository?.fetchStatus ?? "unavailable",
      governance,
      valid: null,
      invalid: null,
      unknown: null,
      total: null,
      known: null,
      complianceRate: null,
      issueCount: null,
      error: repository?.error ?? null
    };
  }

  const aggregate = totals(countsFor(issues));
  return {
    id: repository?.id ?? `repository:${repositoryKey(repository)}`,
    name: text(repository?.name, repositoryKey(repository)),
    fullName: text(repository?.fullName, "unknown/unknown"),
    url: text(repository?.url),
    fetchStatus: "ok",
    governance,
    ...aggregate,
    issueCount: Number.isInteger(repository?.openIssueCount)
      ? repository.openIssueCount
      : aggregate.total,
    error: null
  };
}

function addUnavailableCause(causes, diagnostic, kind) {
  const reason = text(diagnostic?.reason, "unknown");
  let cause = causes.get(reason);
  if (!cause) {
    cause = {
      reason,
      code: text(diagnostic?.code, diagnosticCode(reason)),
      issueCount: 0,
      repositoryCount: 0,
      count: 0,
      messages: []
    };
    causes.set(reason, cause);
  }
  if (kind === "issue") cause.issueCount += 1;
  if (kind === "repository") cause.repositoryCount += 1;
  cause.count = cause.issueCount + cause.repositoryCount;
  const message = text(diagnostic?.message, diagnosticMessage(reason));
  if (
    message &&
    !cause.messages.includes(message) &&
    cause.messages.length < 3
  ) {
    cause.messages.push(message);
  }
}

function unavailableCauses(issues, repositoryTotals) {
  const causes = new Map();
  for (const repository of repositoryTotals) {
    const repositoryReasons = new Set();
    for (const diagnostic of repository.governance?.diagnostics ?? []) {
      if (repository.governance.status !== "healthy") {
        const reason = text(diagnostic?.reason, "unknown");
        if (repositoryReasons.has(reason)) continue;
        repositoryReasons.add(reason);
        addUnavailableCause(causes, diagnostic, "repository");
      }
    }
  }
  for (const issue of issues) {
    if (governanceState(issue) !== "unknown") continue;
    const issueReasons = new Set();
    const diagnostics = diagnosticsFor(
      issue,
      text(issue?.governance?.reason, "unknown"),
      "evaluation"
    );
    for (const diagnostic of diagnostics) {
      const reason = text(diagnostic?.reason, "unknown");
      if (issueReasons.has(reason)) continue;
      issueReasons.add(reason);
      addUnavailableCause(causes, diagnostic, "issue");
    }
  }
  return [...causes.values()].sort(
    (left, right) =>
      right.count - left.count || left.reason.localeCompare(right.reason)
  );
}

function collectionStatus(repositoryTotals, unknownIssues) {
  const counts = {
    healthy: repositoryTotals.filter(
      (repository) => repository.governance.status === "healthy"
    ).length,
    degraded: repositoryTotals.filter(
      (repository) => repository.governance.status === "degraded"
    ).length,
    unavailable: repositoryTotals.filter(
      (repository) => repository.governance.status === "unavailable"
    ).length
  };
  if (
    repositoryTotals.length === 0 ||
    counts.unavailable === repositoryTotals.length
  ) {
    return { status: "unavailable", ...counts };
  }
  if (counts.unavailable > 0 || counts.degraded > 0 || unknownIssues > 0) {
    return { status: "degraded", ...counts };
  }
  return { status: "healthy", ...counts };
}

/**
 * Builds the organization-level governance projection from already projected
 * Issue governance records. It never treats an absent source as an empty
 * source, and it excludes unknown evidence from the compliance denominator.
 */
export function aggregateGovernanceHealth({
  issues = [],
  repositories = [],
  snapshotStatus = "unknown"
} = {}) {
  if (!Array.isArray(issues))
    throw new Error("Governance issues must be an array");
  if (!Array.isArray(repositories)) {
    throw new Error("Governance repositories must be an array");
  }

  const byRepository = new Map();
  for (const issue of issues) {
    const key = repositoryKey(issue?.repository);
    if (!byRepository.has(key)) byRepository.set(key, []);
    byRepository.get(key).push(issue);
  }

  const repositoryHealthByKey = new Set();
  const repositoryTotals = repositories.map((repository) => {
    const key = repositoryKey(repository);
    repositoryHealthByKey.add(key);
    return repositoryHealth(repository, byRepository.get(key) ?? []);
  });

  // Preserve projected issues even if a caller supplies a repository list that
  // is incomplete; these are known data, not an inferred repository result.
  for (const [key, repositoryIssues] of byRepository) {
    if (repositoryHealthByKey.has(key)) continue;
    const first = repositoryIssues[0]?.repository ?? {};
    repositoryTotals.push(
      repositoryHealth(
        {
          id: first.id,
          name: first.name,
          fullName: first.fullName,
          url: first.url,
          fetchStatus: "ok",
          openIssueCount: repositoryIssues.length,
          governance: { status: "healthy", diagnostics: [] }
        },
        repositoryIssues
      )
    );
  }

  const overall = totals(countsFor(issues));
  const invalidIssues = issues
    .filter((issue) => governanceState(issue) === "invalid")
    .map((issue) => issueReference(issue, "invalid"));
  const unknownIssues = issues
    .filter((issue) => governanceState(issue) === "unknown")
    .map((issue) => issueReference(issue, "unknown"));
  const collection = collectionStatus(repositoryTotals, unknownIssues.length);
  const causes = unavailableCauses(issues, repositoryTotals);
  const sourceUnavailableRepositories = repositoryTotals.filter(
    (repository) => repository.fetchStatus !== "ok"
  ).length;

  return {
    schemaVersion: GOVERNANCE_HEALTH_SCHEMA_VERSION,
    snapshot: {
      status: snapshotStatus,
      governanceStatus: collection.status,
      repositoryCount: repositories.length,
      availableRepositories: repositories.filter(
        (repository) => repository.fetchStatus === "ok"
      ).length,
      sourceUnavailableRepositories,
      unavailableRepositories: collection.unavailable,
      degradedRepositories: collection.degraded,
      healthyRepositories: collection.healthy,
      unknownIssues: unknownIssues.length,
      complete: snapshotStatus === "complete" && collection.status === "healthy"
    },
    collection: {
      status: collection.status,
      healthyRepositories: collection.healthy,
      degradedRepositories: collection.degraded,
      unavailableRepositories: collection.unavailable,
      unavailableIssues: unknownIssues.length,
      causes
    },
    overall,
    repositories: repositoryTotals,
    violations: aggregateViolations(issues),
    issues: {
      invalid: invalidIssues,
      unknown: unknownIssues
    }
  };
}

export const buildGovernanceHealth = aggregateGovernanceHealth;
