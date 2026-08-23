import {
  collectIssuePullRequests,
  PULL_REQUEST_LINKAGE_SOURCE
} from "./github-pr-links.mjs";

function isRateLimited(error) {
  const message = String(error?.message ?? "").toLowerCase();
  return (
    error?.status === 429 ||
    (error?.status === 403 && message.includes("rate limit")) ||
    message.includes("rate limit")
  );
}

function header(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === "function") return headers.get(name);
  const key = Object.keys(headers).find(
    (candidate) => candidate.toLowerCase() === name.toLowerCase()
  );
  return key ? headers[key] : null;
}

function linkError(issue, error) {
  const remaining = header(error?.headers, "x-ratelimit-remaining");
  return {
    repository: issue.repository.fullName,
    issue: issue.number,
    stage: "pull-request-links",
    status: error?.status ?? null,
    rateLimited: isRateLimited(error),
    rateLimitRemaining: remaining === null ? null : Number(remaining),
    message: String(error?.message ?? error).slice(0, 500)
  };
}

function unavailableRelationship(reason) {
  return {
    status: "unavailable",
    source: PULL_REQUEST_LINKAGE_SOURCE,
    reason,
    items: []
  };
}

export async function hydrateDashboardPullRequests({
  dashboard,
  fetchImpl = globalThis.fetch,
  token = ""
}) {
  const uniquePullRequests = new Set();
  let issuesWithPullRequests = 0;
  let pullRequestDataUnavailable = 0;
  let linkageErrors = 0;

  dashboard.source.relationships = {
    ...(dashboard.source.relationships ?? {}),
    pullRequests: PULL_REQUEST_LINKAGE_SOURCE
  };

  if (!token) {
    for (const issue of dashboard.issues) {
      issue.relationships.pullRequests = unavailableRelationship(
        "authentication-unavailable"
      );
    }
    pullRequestDataUnavailable = dashboard.issues.length;
  } else {
    for (const issue of dashboard.issues) {
      const [owner, repo] = issue.repository.fullName.split("/");
      try {
        const linkage = await collectIssuePullRequests({
          owner,
          repo,
          issueNumber: issue.number,
          fetchImpl,
          token
        });
        issue.relationships.pullRequests = linkage;
        if (linkage.status !== "complete") pullRequestDataUnavailable += 1;
        if (linkage.items.length > 0) issuesWithPullRequests += 1;
        for (const pullRequest of linkage.items) {
          uniquePullRequests.add(
            `${pullRequest.repository.fullName}#${pullRequest.number}`
          );
        }
      } catch (error) {
        issue.relationships.pullRequests = {
          status: "partial",
          source: PULL_REQUEST_LINKAGE_SOURCE,
          reason: "collection-failed",
          items: []
        };
        pullRequestDataUnavailable += 1;
        linkageErrors += 1;
        dashboard.errors.push(linkError(issue, error));
      }
    }
  }

  dashboard.metrics.linkedPullRequests = uniquePullRequests.size;
  dashboard.metrics.issuesWithPullRequests = issuesWithPullRequests;
  dashboard.metrics.pullRequestDataUnavailable = pullRequestDataUnavailable;
  dashboard.metrics.pullRequestLinkageErrors = linkageErrors;

  if (pullRequestDataUnavailable > 0 && dashboard.status === "complete") {
    dashboard.status = "partial";
  }
  return dashboard;
}
