export const GOVERNANCE_HEALTH_SCHEMA_VERSION = 1;
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

function repositoryHealth(repository, issues) {
  const available = repository?.fetchStatus === "ok";
  if (!available) {
    return {
      id: repository?.id ?? `repository:${repositoryKey(repository)}`,
      name: text(repository?.name, repositoryKey(repository)),
      fullName: text(repository?.fullName, "unknown/unknown"),
      url: text(repository?.url),
      fetchStatus: repository?.fetchStatus ?? "unavailable",
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
    ...aggregate,
    issueCount: Number.isInteger(repository?.openIssueCount)
      ? repository.openIssueCount
      : aggregate.total,
    error: null
  };
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
          openIssueCount: repositoryIssues.length
        },
        repositoryIssues
      )
    );
  }

  const overall = totals(countsFor(issues));
  const unavailableRepositories = repositoryTotals.filter(
    (repository) => repository.fetchStatus !== "ok"
  ).length;
  const invalidIssues = issues
    .filter((issue) => governanceState(issue) === "invalid")
    .map((issue) => issueReference(issue, "invalid"));
  const unknownIssues = issues
    .filter((issue) => governanceState(issue) === "unknown")
    .map((issue) => issueReference(issue, "unknown"));

  return {
    schemaVersion: GOVERNANCE_HEALTH_SCHEMA_VERSION,
    snapshot: {
      status: snapshotStatus,
      repositoryCount: repositories.length,
      availableRepositories: repositories.filter(
        (repository) => repository.fetchStatus === "ok"
      ).length,
      unavailableRepositories,
      unknownIssues: unknownIssues.length,
      complete:
        snapshotStatus === "complete" &&
        unavailableRepositories === 0 &&
        unknownIssues.length === 0
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
