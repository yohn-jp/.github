export function repositoryFullNameFromUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "github.com") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  return parts.length === 2 ? `${parts[0]}/${parts[1]}` : null;
}

export const WORK_VIEWS = Object.freeze([
  { id: "recent", messageKey: "work.view.recent" },
  { id: "attention", messageKey: "work.view.attention" },
  { id: "in-progress", messageKey: "work.view.inProgress" },
  { id: "ready", messageKey: "work.view.ready" },
  { id: "all", messageKey: "work.view.all" }
]);

export const WORK_SORTS = Object.freeze([
  { id: "updated", messageKey: "work.sort.updated" },
  { id: "created", messageKey: "work.sort.created" },
  { id: "oldest", messageKey: "work.sort.oldest" },
  { id: "repository", messageKey: "work.sort.repository" }
]);

export const WORK_GOVERNANCE_FILTERS = Object.freeze([
  { id: "all", messageKey: "work.governance.filter.all" },
  { id: "valid", messageKey: "work.governance.filter.valid" },
  { id: "invalid", messageKey: "work.governance.filter.invalid" },
  { id: "unknown", messageKey: "work.governance.filter.unknown" }
]);

const WORK_VIEW_IDS = new Set(WORK_VIEWS.map(({ id }) => id));
const WORK_SORT_IDS = new Set(WORK_SORTS.map(({ id }) => id));
const WORK_GOVERNANCE_FILTER_IDS = new Set(
  WORK_GOVERNANCE_FILTERS.map(({ id }) => id)
);

function timestamp(value) {
  if (!value) return null;
  const parsed = new Date(value).valueOf();
  return Number.isNaN(parsed) ? null : parsed;
}

function pullRequestLinkage(issue) {
  const linkage = issue?.relationships?.pullRequests;
  const hasItems = Array.isArray(linkage?.items);
  const items = hasItems ? linkage.items : [];
  return {
    status: hasItems ? (linkage?.status ?? "unavailable") : "unavailable",
    items
  };
}

/**
 * Maps the Inari-projected blocker relationship (see dashboard-data.mjs
 * `relationships.blockers`) to the public three-state UI contract. Inari is
 * the dependency semantic authority; this reads only its normalized
 * projection and never infers blockers from GitHub-native dependency
 * metadata or Issue prose. Missing entirely (a fixture that predates this
 * projection) is distinct from a present-but-unavailable projection: only
 * the latter is fail-closed "unavailable".
 */
export function blockerState(issue) {
  const blockers = issue?.relationships?.blockers;
  if (blockers === undefined) return "not-evaluated";
  if (blockers.status !== "available") return "unavailable";
  if (blockers.blocked) return "blocked";
  if (blockers.blockingActive) return "blocking";
  return "clear";
}

/**
 * Maps projected governance data to the public three-state UI contract.
 * Only an explicit valid projection is compliant; missing or unavailable
 * evidence is deliberately treated as unknown.
 */
export function governanceStatus(issue) {
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

/**
 * Classifies an issue using only fields projected from GitHub.
 * `inProgress` and `ready` deliberately require complete PR linkage; an
 * unavailable relationship cannot be treated as evidence that no PR exists.
 */
export function classifyIssue(issue) {
  const linkage = pullRequestLinkage(issue);
  const complete = linkage.status === "complete";
  const openPullRequest = linkage.items.some(
    (pullRequest) => String(pullRequest?.state ?? "").toLowerCase() === "open"
  );
  const reasons = [];

  if (governanceStatus(issue) === "invalid") {
    reasons.push("governance-invalid");
  } else if (governanceStatus(issue) === "unknown") {
    reasons.push("governance-unavailable");
  }

  if (!complete) reasons.push("pull-request-linkage-unavailable");
  for (const pullRequest of linkage.items) {
    const state = String(pullRequest?.state ?? "").toLowerCase();
    if (state === "closed") {
      reasons.push("closed-linked-pull-request");
    } else if (state === "merged") {
      reasons.push("merged-linked-pull-request");
    } else if (state !== "open") {
      reasons.push("unknown-linked-pull-request-state");
    }
  }
  if (issue?.stateReason === "reopened") reasons.push("reopened-issue");

  // Read the two blocker flags independently: an Issue can simultaneously
  // be blocked by one Issue and block another, and both reasons must
  // survive together rather than collapsing into blockerState()'s single
  // summary enum.
  const blockers = issue?.relationships?.blockers;
  if (blockers !== undefined && blockers.status !== "available") {
    reasons.push("dependency-projection-unavailable");
  } else if (blockers !== undefined) {
    if (blockers.blocked) reasons.push("blocked-by-dependency");
    if (blockers.blockingActive) reasons.push("blocking-dependent-work");
  }

  return {
    needsAttention: reasons.length > 0,
    inProgress: complete && openPullRequest,
    ready: complete && linkage.items.length === 0,
    reasons: [...new Set(reasons)]
  };
}

export function issueMatchesView(issue, view = "recent") {
  if (view === "all" || view === "recent") return true;
  const classification = classifyIssue(issue);
  if (view === "attention") return classification.needsAttention;
  if (view === "in-progress") return classification.inProgress;
  if (view === "ready") return classification.ready;
  return true;
}

export function issueMatchesGovernance(issue, filter = "all") {
  if (filter === "all") return true;
  return governanceStatus(issue) === filter;
}

export function supportsCreatedAt(issues = []) {
  return issues.some((issue) => timestamp(issue?.createdAt) !== null);
}

function compareNullableDate(left, right, direction) {
  const leftTime = timestamp(left);
  const rightTime = timestamp(right);
  if (leftTime === null && rightTime === null) return 0;
  if (leftTime === null) return 1;
  if (rightTime === null) return -1;
  return (leftTime - rightTime) * direction;
}

function compareIssueIdentity(left, right) {
  return (
    String(left?.repository?.fullName ?? "").localeCompare(
      String(right?.repository?.fullName ?? "")
    ) ||
    Number(left?.number ?? 0) - Number(right?.number ?? 0) ||
    String(left?.id ?? "").localeCompare(String(right?.id ?? ""))
  );
}

function activityValue(issue) {
  return issue?.updatedAt ?? issue?.createdAt;
}

/** Returns a new array sorted independently of source array order. */
export function sortIssues(issues = [], sort = "updated") {
  const selected = WORK_SORT_IDS.has(sort) ? sort : "updated";
  return [...issues].sort((left, right) => {
    if (selected === "repository") {
      return (
        compareIssueIdentity(left, right) ||
        compareNullableDate(right?.updatedAt, left?.updatedAt, 1) ||
        Number(right?.number ?? 0) - Number(left?.number ?? 0)
      );
    }
    if (selected === "created") {
      return (
        compareNullableDate(left?.createdAt, right?.createdAt, -1) ||
        compareNullableDate(left?.updatedAt, right?.updatedAt, -1) ||
        compareIssueIdentity(left, right)
      );
    }
    if (selected === "oldest") {
      return (
        compareNullableDate(activityValue(left), activityValue(right), 1) ||
        compareNullableDate(left?.createdAt, right?.createdAt, 1) ||
        compareIssueIdentity(left, right)
      );
    }
    return (
      compareNullableDate(left?.updatedAt, right?.updatedAt, -1) ||
      compareIssueIdentity(left, right)
    );
  });
}

export function buildProductRepositoryIndex(catalog) {
  const index = new Map();
  for (const product of catalog?.products ?? []) {
    const fullName = repositoryFullNameFromUrl(product.repository);
    if (!fullName) continue;
    if (index.has(fullName)) {
      throw new Error(`Duplicate catalog repository mapping: ${fullName}`);
    }
    index.set(fullName, product);
  }
  return index;
}

export function resolveRepositoryFilter(search, repositories) {
  const configured = new Set(
    repositories.map((repository) => repository.fullName)
  );
  const requested = new URLSearchParams(search).get("repository") ?? "";
  return configured.has(requested) ? requested : "";
}

export function resolveSearchFilter(search) {
  return new URLSearchParams(search).get("q") ?? "";
}

export function resolveView(search) {
  const requested = new URLSearchParams(search).get("view") ?? "";
  return WORK_VIEW_IDS.has(requested) ? requested : "recent";
}

export function resolveGovernanceFilter(search) {
  const requested = new URLSearchParams(search).get("governance") ?? "";
  return WORK_GOVERNANCE_FILTER_IDS.has(requested) ? requested : "all";
}

export function resolveSort(search, issues = []) {
  const requested = new URLSearchParams(search).get("sort") ?? "";
  if (!WORK_SORT_IDS.has(requested)) return "updated";
  if (requested === "created" && !supportsCreatedAt(issues)) return "updated";
  return requested;
}

export function buildWorkQuery({
  view = "recent",
  repository = "",
  search = "",
  sort = "updated",
  governance = "all"
} = {}) {
  const params = new URLSearchParams();
  if (WORK_VIEW_IDS.has(view) && view !== "recent") params.set("view", view);
  if (repository) params.set("repository", repository);
  if (search.trim()) params.set("q", search.trim());
  if (WORK_SORT_IDS.has(sort) && sort !== "updated") params.set("sort", sort);
  if (WORK_GOVERNANCE_FILTER_IDS.has(governance) && governance !== "all") {
    params.set("governance", governance);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}
