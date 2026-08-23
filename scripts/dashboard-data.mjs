const API_ROOT = "https://api.github.com";
const API_VERSION = "2022-11-28";

export const DASHBOARD_SCHEMA_VERSION = 2;

function getHeader(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === "function") return headers.get(name);
  const target = name.toLowerCase();
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === target);
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
  return error?.status === 403 || error?.status === 429 || message.includes("rate limit");
}

function configuredRepository(entry, organization) {
  const value = typeof entry === "string" ? { name: entry } : entry;
  if (!value || typeof value !== "object") throw new Error("Each configured repository must be a name or object");
  const fullName = value.fullName ?? `${organization}/${value.name ?? ""}`;
  const [owner, name] = fullName.split("/");
  if (!owner || !name || owner !== organization || fullName.split("/").length !== 2) {
    throw new Error(`Configured repository must belong to ${organization}: ${fullName}`);
  }
  return { owner, name, fullName };
}

function validateConfig(config) {
  if (!config || typeof config !== "object") throw new Error("Dashboard config must be an object");
  if (typeof config.organization !== "string" || !config.organization) {
    throw new Error("Dashboard config requires a non-empty organization");
  }
  if (!Array.isArray(config.repositories) || config.repositories.length === 0) {
    throw new Error("Dashboard config requires at least one repository");
  }
  return config.repositories.map((entry) => configuredRepository(entry, config.organization));
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
    visibility: repository.visibility ?? (repository.private ? "private" : "public"),
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
  const assignees = Array.isArray(issue.assignees) ? issue.assignees.map(normalizeUser).filter(Boolean) : [];
  const assignee = normalizeUser(issue.assignee) ?? assignees[0] ?? null;
  return {
    id: issue.id,
    repository: { id: repository.id, name: repository.name, fullName: repository.fullName, url: repository.url },
    number: issue.number,
    title: issue.title,
    url: issue.html_url,
    state: issue.state,
    stateReason: issue.state_reason ?? null,
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
      const parts = new URL(issue.repository_url).pathname.split("/").filter(Boolean);
      if (parts[0] === "repos" && parts.length >= 3) return `${parts[1]}/${parts[2]}`;
    } catch {}
  }
  if (issue.html_url) {
    try {
      const parts = new URL(issue.html_url).pathname.split("/").filter(Boolean);
      if (parts.length >= 4 && parts[2] === "issues") return `${parts[0]}/${parts[1]}`;
    } catch {}
  }
  return null;
}

export function normalizeIssueReference(issue) {
  const fullName = dependencyRepositoryFullName(issue);
  if (!fullName || !Number.isInteger(issue.number)) {
    throw new Error("Dependency response lacks canonical repository/issue identity");
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
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetchImpl(url, { headers });
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw createHttpError(`GitHub API returned invalid JSON (HTTP ${response.status})`, response.status, response.headers);
    }
  }
  if (!response.ok) {
    throw createHttpError(body?.message ?? `GitHub API returned HTTP ${response.status}`, response.status, response.headers);
  }
  return { body, headers: response.headers };
}

async function fetchAll(url, options) {
  const values = [];
  let nextUrl = url;
  while (nextUrl) {
    const result = await fetchJson(nextUrl, options);
    if (!Array.isArray(result.body)) throw new Error("GitHub API returned a non-array response");
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
  references.sort((left, right) =>
    left.repository.fullName.localeCompare(right.repository.fullName) || left.number - right.number
  );
  return references;
}

async function hydrateDependencies({ rawIssue, issue, configured, fetchImpl, token, errors }) {
  const counts = dependencyCounts(rawIssue);
  const dependencies = {
    status: counts ? "complete" : "unavailable",
    blockedBy: [],
    blocking: []
  };
  issue.relationships.dependencies = dependencies;
  if (!counts) return;

  for (const [field, endpointName] of [["blockedBy", "blocked_by"], ["blocking", "blocking"]]) {
    if (counts[field] <= 0) continue;
    try {
      const values = await fetchAll(
        endpointFor(configured, `/issues/${rawIssue.number}/dependencies/${endpointName}?per_page=100`),
        { fetchImpl, token }
      );
      dependencies[field] = sortReferences(values.map(normalizeIssueReference));
    } catch (error) {
      dependencies.status = "partial";
      errors.push(errorRecord(configured, `dependencies:${endpointName}`, error));
    }
  }
}

export async function collectDashboardData({
  config,
  fetchImpl = globalThis.fetch,
  token = "",
  now = () => new Date()
}) {
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required");
  const configuredRepositories = validateConfig(config);
  const repositories = [];
  const issues = [];
  const errors = [];

  for (const configured of configuredRepositories) {
    let repository;
    try {
      const result = await fetchJson(endpointFor(configured), { fetchImpl, token });
      repository = normalizeRepository(result.body, configured.fullName);
      if (repository.visibility !== "public") {
        throw createHttpError(`Configured repository is not public (${repository.visibility})`, 403, result.headers);
      }
    } catch (error) {
      repository = fallbackRepository(configured);
      const record = errorRecord(configured, "repository", error);
      repository.error = record;
      repositories.push(repository);
      errors.push(record);
      continue;
    }

    try {
      const rawIssues = (await fetchAll(endpointFor(configured, "/issues?state=open&per_page=100"), { fetchImpl, token }))
        .filter((issue) => !issue.pull_request);
      const normalizedIssues = rawIssues.map((rawIssue) => normalizeIssue(rawIssue, repository));
      for (let index = 0; index < rawIssues.length; index += 1) {
        await hydrateDependencies({
          rawIssue: rawIssues[index],
          issue: normalizedIssues[index],
          configured,
          fetchImpl,
          token,
          errors
        });
      }
      repository.openIssueCount = normalizedIssues.length;
      repository.fetchStatus = "ok";
      repositories.push(repository);
      issues.push(...normalizedIssues);
    } catch (error) {
      const record = errorRecord(configured, "issues", error);
      repository.fetchStatus = "error";
      repository.error = record;
      repositories.push(repository);
      errors.push(record);
    }
  }

  issues.sort((left, right) => {
    const updatedOrder = String(right.updatedAt).localeCompare(String(left.updatedAt));
    return updatedOrder || left.repository.fullName.localeCompare(right.repository.fullName) || right.number - left.number;
  });

  const successfulRepositories = repositories.filter((repository) => repository.fetchStatus === "ok").length;
  const failedRepositories = repositories.length - successfulRepositories;
  const dependencyEdges = new Set();
  let dependencyDataUnavailable = 0;
  for (const issue of issues) {
    const dependencies = issue.relationships.dependencies;
    if (dependencies?.status === "unavailable" || dependencies?.status === "partial") dependencyDataUnavailable += 1;
    for (const blocker of dependencies?.blockedBy ?? []) {
      dependencyEdges.add(`${blocker.repository.fullName}#${blocker.number}->${issue.repository.fullName}#${issue.number}`);
    }
    for (const blocked of dependencies?.blocking ?? []) {
      dependencyEdges.add(`${issue.repository.fullName}#${issue.number}->${blocked.repository.fullName}#${blocked.number}`);
    }
  }
  const status = errors.length === 0 ? "complete" : failedRepositories === repositories.length ? "failed" : "partial";

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
      dependencyDataUnavailable
    },
    repositories,
    issues,
    errors
  };
}
