const GRAPHQL_URL = "https://api.github.com/graphql";

export const PULL_REQUEST_LINKAGE_SOURCE =
  "GitHub GraphQL Issue.closedByPullRequestsReferences";

const LINKED_PULL_REQUESTS_QUERY = `
query IssueLinkedPullRequests($owner: String!, $repo: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      closedByPullRequestsReferences(
        first: 100
        after: $after
        includeClosedPrs: true
        excludeUserLinked: false
      ) {
        nodes {
          number
          title
          url
          state
          merged
          mergedAt
          repository {
            nameWithOwner
            url
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
}`;

function graphQlError(message, response, errors = []) {
  const details = errors
    .map((error) => error?.message)
    .filter(Boolean)
    .join("; ");
  const error = new Error(details ? `${message}: ${details}` : message);
  error.status = response?.status ?? null;
  error.headers = response?.headers ?? null;
  return error;
}

function normalizeState(pullRequest) {
  if (pullRequest.merged === true || pullRequest.state === "MERGED") return "merged";
  if (pullRequest.state === "OPEN") return "open";
  if (pullRequest.state === "CLOSED") return "closed";
  return "unknown";
}

export function normalizeLinkedPullRequest(pullRequest) {
  const fullName = pullRequest?.repository?.nameWithOwner;
  if (!fullName || !Number.isInteger(pullRequest?.number) || !pullRequest?.url) {
    throw new Error("Linked pull request lacks canonical repository/PR identity");
  }
  return {
    repository: {
      fullName,
      url: pullRequest.repository.url ?? `https://github.com/${fullName}`
    },
    number: pullRequest.number,
    title: pullRequest.title ?? `Pull request #${pullRequest.number}`,
    url: pullRequest.url,
    state: normalizeState(pullRequest),
    mergedAt: pullRequest.mergedAt ?? null,
    linkType: "github-authoritative"
  };
}

export async function collectIssuePullRequests({
  owner,
  repo,
  issueNumber,
  fetchImpl = globalThis.fetch,
  token = ""
}) {
  if (!token) {
    return {
      status: "unavailable",
      source: PULL_REQUEST_LINKAGE_SOURCE,
      reason: "authentication-unavailable",
      items: []
    };
  }

  const items = new Map();
  let after = null;
  do {
    const response = await fetchImpl(GRAPHQL_URL, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "yohn-jp-issue-dashboard"
      },
      body: JSON.stringify({
        query: LINKED_PULL_REQUESTS_QUERY,
        variables: { owner, repo, number: issueNumber, after }
      })
    });

    let body;
    try {
      body = await response.json();
    } catch {
      throw graphQlError(
        `GitHub GraphQL returned invalid JSON (HTTP ${response.status})`,
        response
      );
    }
    if (!response.ok) {
      throw graphQlError(
        `GitHub GraphQL returned HTTP ${response.status}`,
        response,
        body?.errors ?? []
      );
    }
    if (Array.isArray(body?.errors) && body.errors.length > 0) {
      throw graphQlError("GitHub GraphQL returned errors", response, body.errors);
    }

    const connection =
      body?.data?.repository?.issue?.closedByPullRequestsReferences;
    if (!connection || !Array.isArray(connection.nodes)) {
      throw graphQlError(
        "GitHub GraphQL omitted linked pull request connection",
        response
      );
    }

    for (const raw of connection.nodes) {
      if (!raw) {
        throw graphQlError(
          "GitHub GraphQL returned null linked pull request node",
          response
        );
      }
      const item = normalizeLinkedPullRequest(raw);
      items.set(`${item.repository.fullName}#${item.number}`, item);
    }

    if (connection.pageInfo?.hasNextPage) {
      if (!connection.pageInfo.endCursor) {
        throw graphQlError(
          "GitHub GraphQL pagination omitted end cursor",
          response
        );
      }
      after = connection.pageInfo.endCursor;
    } else {
      after = null;
    }
  } while (after);

  return {
    status: "complete",
    source: PULL_REQUEST_LINKAGE_SOURCE,
    reason: null,
    items: [...items.values()].sort(
      (left, right) =>
        left.repository.fullName.localeCompare(right.repository.fullName) ||
        left.number - right.number
    )
  };
}
