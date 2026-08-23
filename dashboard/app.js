import {
  buildProductRepositoryIndex,
  buildWorkQuery,
  resolveRepositoryFilter,
  resolveSearchFilter
} from "./work-model.js";

const SNAPSHOT_REFRESH_INTERVAL_MS = 60_000;

const state = {
  dashboard: null,
  productByRepository: new Map(),
  repository: "",
  search: "",
  initialized: false,
  refreshTimer: null,
  refreshInFlight: null,
  lastCheckedAt: null,
  refreshError: null
};

const elements = {
  status: document.querySelector("#dataset-status"),
  generatedAt: document.querySelector("#generated-at"),
  freshness: document.querySelector("#snapshot-freshness"),
  refreshButton: document.querySelector("#refresh-dashboard"),
  metrics: document.querySelector("#metrics"),
  repositorySummary: document.querySelector("#repository-summary"),
  repositoryFilter: document.querySelector("#repository-filter"),
  issueSearch: document.querySelector("#issue-search"),
  issueCount: document.querySelector("#issue-count"),
  issueList: document.querySelector("#issue-list")
};

function text(value) {
  return value === null || value === undefined || value === ""
    ? "—"
    : String(value);
}

function node(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = content;
  return element;
}

function link(url, label, className) {
  const anchor = node("a", className, label);
  anchor.href = url;
  anchor.rel = "noreferrer";
  return anchor;
}

function productForRepository(fullName) {
  return state.productByRepository.get(fullName) ?? null;
}

function productLink(product, className = "product-route") {
  return link(
    `../products/${encodeURIComponent(product.id)}/`,
    product.name,
    className
  );
}

function showStatus(dashboard) {
  const status = dashboard.status;
  const unavailableLinks = dashboard.metrics.pullRequestDataUnavailable ?? 0;
  const errors = dashboard.errors ?? [];
  elements.status.hidden = false;
  elements.status.className = `status-banner ${status}`;
  const detail =
    status === "complete"
      ? `${dashboard.metrics.issueCount} open issues and ${dashboard.metrics.linkedPullRequests ?? 0} authoritative linked pull requests loaded from ${dashboard.metrics.repositoryCount} repositories.`
      : `${dashboard.metrics.successfulRepositories} of ${dashboard.metrics.repositoryCount} repositories loaded; ${unavailableLinks} issues have unavailable or partial PR linkage. Treat this view as incomplete.`;
  elements.status.replaceChildren(
    node(
      "p",
      "status-title",
      status === "complete" ? "Snapshot complete" : `Snapshot ${status}`
    ),
    node("p", "status-detail", detail)
  );
  if (errors.length > 0) {
    const errorList = node("ul", "status-errors");
    for (const error of errors) {
      const suffix = error.rateLimited ? " Rate limit reached." : "";
      const issue = error.issue ? `#${error.issue} ` : "";
      errorList.append(
        node(
          "li",
          "",
          `${error.repository} ${issue}(${error.stage}): ${error.message}${suffix}`
        )
      );
    }
    elements.status.append(errorList);
  }
}

function formatDate(value, prefix = "") {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return `${prefix}${text(value)}`;
  return `${prefix}${new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date)}`;
}

function formatSnapshotAge(value) {
  const timestamp = new Date(value).valueOf();
  if (Number.isNaN(timestamp)) return "unknown age";
  const ageSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (ageSeconds < 60) return "less than a minute old";
  const ageMinutes = Math.floor(ageSeconds / 60);
  if (ageMinutes < 60)
    return `${ageMinutes} minute${ageMinutes === 1 ? "" : "s"} old`;
  const ageHours = Math.floor(ageMinutes / 60);
  return `${ageHours} hour${ageHours === 1 ? "" : "s"} old`;
}

function renderFreshness() {
  if (!elements.freshness) return;
  if (!state.dashboard) {
    elements.freshness.textContent = state.lastCheckedAt
      ? `Last checked ${formatDate(state.lastCheckedAt)} · No valid snapshot loaded.`
      : "Checking for the latest snapshot…";
    return;
  }
  const checked = state.lastCheckedAt
    ? `Last checked ${formatDate(state.lastCheckedAt)}`
    : "Not checked yet";
  const freshness = `Snapshot is ${formatSnapshotAge(state.dashboard.generatedAt)}.`;
  elements.freshness.textContent = state.refreshError
    ? `${checked} · ${freshness} Refresh failed; showing the last valid data.`
    : `${checked} · ${freshness}`;
}

function updateRefreshControl() {
  if (!elements.refreshButton) return;
  const active = Boolean(state.refreshInFlight);
  elements.refreshButton.disabled = active;
  elements.refreshButton.textContent = active ? "Refreshing…" : "Refresh now";
}

function renderMetrics(dashboard) {
  const cards = [
    [dashboard.metrics.issueCount, "open issues"],
    [dashboard.metrics.linkedPullRequests ?? 0, "linked pull requests"],
    [dashboard.metrics.repositoryCount, "repositories"],
    [dashboard.metrics.failedRepositories, "sources needing attention"]
  ];
  elements.metrics.replaceChildren(
    ...cards.map(([value, label]) => {
      const card = node("div", "metric-card");
      card.append(
        node("span", "metric-value", text(value)),
        node("span", "metric-label", label)
      );
      return card;
    })
  );
}

function renderRepositorySummary(dashboard) {
  const counts = dashboard.repositories.map(
    (repository) => repository.openIssueCount ?? 0
  );
  const max = Math.max(...counts, 1);
  elements.repositorySummary.replaceChildren(
    ...dashboard.repositories.map((repository) => {
      const product = productForRepository(repository.fullName);
      const row = node(
        "div",
        `repo-row${repository.fetchStatus === "ok" ? "" : " failed"}`
      );
      const identity = node("div", "repo-identity");
      if (product) identity.append(productLink(product, "repo-product"));
      identity.append(
        link(repository.url, repository.fullName, "repo-github")
      );
      const bar = node("div", "repo-bar");
      const fill = node("div", "repo-bar-fill");
      fill.style.width = `${Math.max(
        ((repository.openIssueCount ?? 0) / max) * 100,
        repository.fetchStatus === "ok" ? 0 : 2
      )}%`;
      bar.append(fill);
      row.append(
        identity,
        bar,
        node(
          "div",
          "repo-count",
          repository.fetchStatus === "ok"
            ? `${repository.openIssueCount} open`
            : "Data unavailable"
        )
      );
      return row;
    })
  );
}

function renderRepositoryFilter(dashboard) {
  const all = node("option", "", "All repositories");
  all.value = "";
  const options = dashboard.repositories.map((repository) => {
    const product = productForRepository(repository.fullName);
    const option = node(
      "option",
      "",
      product
        ? `${product.name} · ${repository.fullName}`
        : repository.fullName
    );
    option.value = repository.fullName;
    return option;
  });
  elements.repositoryFilter.replaceChildren(all, ...options);
  elements.repositoryFilter.value = state.repository;
}

function pullRequestsForIssue(issue) {
  return issue.relationships?.pullRequests?.items ?? [];
}

function issueMatches(issue) {
  if (state.repository && issue.repository.fullName !== state.repository) {
    return false;
  }
  const query = state.search.trim().toLowerCase();
  if (!query) return true;
  const product = productForRepository(issue.repository.fullName);
  return [
    issue.title,
    issue.repository.fullName,
    product?.name,
    product?.role,
    issue.type,
    issue.milestone?.title,
    issue.assignee?.login,
    ...issue.labels.map((label) => label.name),
    ...pullRequestsForIssue(issue).flatMap((pullRequest) => [
      pullRequest.title,
      pullRequest.repository.fullName,
      `PR ${pullRequest.number}`,
      pullRequest.state
    ])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(query);
}

function renderPullRequests(issue) {
  const container = node("div", "issue-prs");
  const linkage = issue.relationships?.pullRequests;
  if (!linkage || linkage.status !== "complete") {
    container.append(
      node("span", "pr-linkage unknown", "PR linkage unavailable")
    );
    return container;
  }
  if (linkage.items.length === 0) {
    container.append(
      node("span", "pr-linkage unlinked", "No authoritative linked PR")
    );
    return container;
  }

  for (const pullRequest of linkage.items) {
    const item = node("div", `issue-pr ${pullRequest.state}`);
    const title = link(
      pullRequest.url,
      `PR #${pullRequest.number} ${pullRequest.title}`,
      "pr-title"
    );
    const repository =
      pullRequest.repository.fullName === issue.repository.fullName
        ? "same repository"
        : pullRequest.repository.fullName;
    const status =
      pullRequest.state === "closed"
        ? "closed without merge"
        : pullRequest.state;
    item.append(
      title,
      node("span", "pr-meta", `${repository} · ${status}`)
    );
    container.append(item);
  }
  return container;
}

function renderIssue(issue) {
  const row = node("tr");
  const product = productForRepository(issue.repository.fullName);
  const repositoryCell = node("td");
  const identity = node("div", "issue-repository");
  if (product) identity.append(productLink(product, "issue-product"));
  identity.append(
    link(issue.repository.url, issue.repository.fullName, "issue-repo")
  );
  repositoryCell.append(identity);

  const issueCell = node("td");
  issueCell.append(
    link(issue.url, `#${issue.number} ${issue.title}`, "issue-link"),
    renderPullRequests(issue)
  );

  const metadataCell = node("td");
  const metadata = node("div", "issue-meta");
  metadata.append(
    node(
      "span",
      "pill state",
      `${text(issue.state)}${issue.stateReason ? ` · ${issue.stateReason}` : ""}`
    )
  );
  if (issue.type) metadata.append(node("span", "pill", issue.type));
  for (const label of issue.labels) {
    metadata.append(node("span", "pill", label.name));
  }
  if (issue.milestone) {
    metadata.append(
      node("span", "pill", `Milestone: ${issue.milestone.title}`)
    );
  }
  if (issue.assignee) {
    metadata.append(node("span", "pill", `@${issue.assignee.login}`));
  }
  metadataCell.append(metadata);

  const updatedCell = node("td");
  const updated = node("time", "updated", formatDate(issue.updatedAt));
  updated.dateTime = issue.updatedAt;
  updatedCell.append(updated);
  row.append(repositoryCell, issueCell, metadataCell, updatedCell);
  return row;
}

function renderIssues() {
  const issues = state.dashboard.issues.filter(issueMatches);
  elements.issueCount.textContent = `${issues.length} of ${state.dashboard.issues.length} issues`;
  if (issues.length === 0) {
    const row = node("tr");
    const empty = node(
      "td",
      "empty-state",
      "No issues match current filters."
    );
    empty.colSpan = 4;
    row.append(empty);
    elements.issueList.replaceChildren(row);
    return;
  }
  elements.issueList.replaceChildren(...issues.map(renderIssue));
}

function syncUrl() {
  const query = buildWorkQuery({
    repository: state.repository,
    search: state.search
  });
  history.replaceState(
    null,
    "",
    `${location.pathname}${query}${location.hash}`
  );
}

function showLoadError(error) {
  state.refreshError = error;
  elements.generatedAt.textContent = "Snapshot unavailable";
  elements.status.hidden = false;
  elements.status.className = "status-banner load-error";
  elements.status.replaceChildren(
    node("p", "status-title", "Portal work data failed to load"),
    node(
      "p",
      "status-detail",
      `${error.message}. No valid issue snapshot is available yet.`
    )
  );
  renderFreshness();
}

function showRefreshError(error) {
  state.refreshError = error;
  if (!state.dashboard) {
    showLoadError(error);
    return;
  }
  elements.status.hidden = false;
  elements.status.className = "status-banner stale";
  elements.status.replaceChildren(
    node("p", "status-title", "Snapshot refresh failed"),
    node(
      "p",
      "status-detail",
      `${error.message}. The last valid snapshot remains visible.`
    )
  );
  renderFreshness();
}

async function jsonResponse(response, path) {
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return response.json();
}

function applyDashboard(dashboard, productCatalog) {
  const productIndex = productCatalog
    ? buildProductRepositoryIndex(productCatalog)
    : null;
  state.dashboard = dashboard;
  if (productIndex) state.productByRepository = productIndex;
  if (!state.initialized) {
    state.repository = resolveRepositoryFilter(
      location.search,
      dashboard.repositories
    );
    state.search = resolveSearchFilter(location.search);
    state.initialized = true;
  }
  elements.issueSearch.value = state.search;
  elements.generatedAt.textContent = formatDate(
    dashboard.generatedAt,
    "Generated "
  );
  showStatus(dashboard);
  renderMetrics(dashboard);
  renderRepositorySummary(dashboard);
  renderRepositoryFilter(dashboard);
  renderIssues();
  renderFreshness();
}

async function loadDashboard() {
  if (state.refreshInFlight) return state.refreshInFlight;

  state.lastCheckedAt = new Date();
  renderFreshness();
  updateRefreshControl();
  const refresh = (async () => {
    try {
      const dashboardResponse = await fetch("./data/dashboard.json", {
        cache: "no-store"
      });
      const dashboard = await jsonResponse(
        dashboardResponse,
        "./data/dashboard.json"
      );
      let productCatalog = null;
      if (!state.dashboard) {
        const catalogResponse = await fetch("../data/products.json", {
          cache: "no-store"
        });
        productCatalog = await jsonResponse(
          catalogResponse,
          "../data/products.json"
        );
      }

      const changed =
        !state.dashboard ||
        dashboard.generatedAt !== state.dashboard.generatedAt;
      const hadError = Boolean(state.refreshError);
      state.lastCheckedAt = new Date();
      state.refreshError = null;
      if (changed) {
        applyDashboard(dashboard, productCatalog);
      } else if (hadError) {
        showStatus(state.dashboard);
        renderFreshness();
      } else {
        renderFreshness();
      }
    } catch (error) {
      state.lastCheckedAt = new Date();
      showRefreshError(error);
    } finally {
      state.refreshInFlight = null;
      updateRefreshControl();
      renderFreshness();
    }
  })();
  state.refreshInFlight = refresh;
  updateRefreshControl();
  return refresh;
}

function stopPolling() {
  if (state.refreshTimer === null) return;
  clearInterval(state.refreshTimer);
  state.refreshTimer = null;
}

function startPolling() {
  stopPolling();
  if (document.visibilityState !== "visible") return;
  state.refreshTimer = setInterval(() => {
    void loadDashboard();
  }, SNAPSHOT_REFRESH_INTERVAL_MS);
}

elements.repositoryFilter.addEventListener("change", (event) => {
  state.repository = event.target.value;
  syncUrl();
  renderIssues();
});

elements.issueSearch.addEventListener("input", (event) => {
  state.search = event.target.value;
  syncUrl();
  renderIssues();
});

elements.refreshButton?.addEventListener("click", () => {
  void loadDashboard();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    void loadDashboard();
    startPolling();
  } else {
    stopPolling();
  }
});

void loadDashboard();
startPolling();
