import {
  buildProductRepositoryIndex,
  buildWorkQuery,
  classifyIssue,
  issueMatchesView,
  resolveRepositoryFilter,
  resolveSearchFilter,
  resolveSort,
  resolveView,
  sortIssues,
  supportsCreatedAt,
  WORK_SORTS,
  WORK_VIEWS
} from "./work-model.js";
import {
  formatRelativeTime as formatLocaleRelativeTime,
  formatSnapshotAge as formatLocaleSnapshotAge,
  hydrateMessages,
  localeDate,
  message
} from "../messages.js";

hydrateMessages(document);

const t = (key, values = {}) => message(key, values);

const SNAPSHOT_REFRESH_INTERVAL_MS = 60_000;

const state = {
  dashboard: null,
  productByRepository: new Map(),
  view: "recent",
  repository: "",
  search: "",
  sort: "updated",
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
  viewFilter: document.querySelector("#view-filter"),
  repositoryFilter: document.querySelector("#repository-filter"),
  sortFilter: document.querySelector("#sort-filter"),
  issueSearch: document.querySelector("#issue-search"),
  issueCount: document.querySelector("#issue-count"),
  issueList: document.querySelector("#issue-list")
};

function text(value) {
  return value === null || value === undefined || value === ""
    ? t("common.empty")
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
  if (status === "complete") {
    elements.status.className = "status-inline complete";
    elements.status.replaceChildren(
      node(
        "p",
        "status-detail",
        t("work.status.snapshotComplete", {
          count: dashboard.metrics.repositoryCount
        })
      )
    );
    return;
  }

  elements.status.className = `status-banner ${status}`;
  const detail = t("work.status.snapshotDetail", {
    successful: dashboard.metrics.successfulRepositories,
    count: dashboard.metrics.repositoryCount,
    unavailable: unavailableLinks
  });
  elements.status.replaceChildren(
    node("p", "status-title", t("work.status.snapshot", { status })),
    node("p", "status-detail", detail)
  );
  if (errors.length > 0) {
    const errorList = node("ul", "status-errors");
    for (const error of errors) {
      const rateLimit = error.rateLimited ? t("work.status.rateLimit") : "";
      const issue = error.issue
        ? t("work.status.issuePrefix", { issue: error.issue })
        : "";
      errorList.append(
        node(
          "li",
          "",
          t("work.status.error", {
            repository: error.repository,
            issue,
            stage: error.stage,
            error: error.message,
            rateLimit
          })
        )
      );
    }
    elements.status.append(errorList);
  }
}

function formatDate(value, prefix = "") {
  const formatted = localeDate(value);
  return `${prefix}${formatted ?? text(value)}`;
}

function formatSnapshotAge(value) {
  return formatLocaleSnapshotAge(value);
}

function formatRelativeAge(value) {
  return formatLocaleRelativeTime(value);
}

function renderFreshness() {
  if (!elements.freshness) return;
  if (!state.dashboard) {
    elements.freshness.textContent = state.lastCheckedAt
      ? t("work.freshness.noValid", { date: formatDate(state.lastCheckedAt) })
      : t("work.freshness.checking");
    return;
  }
  const checked = state.lastCheckedAt
    ? t("work.freshness.checked", { date: formatDate(state.lastCheckedAt) })
    : t("work.freshness.notChecked");
  const freshness = t("work.freshness.snapshotAge", {
    age: formatSnapshotAge(state.dashboard.generatedAt)
  });
  elements.freshness.textContent = state.refreshError
    ? t("work.freshness.refreshFailed", { checked, freshness })
    : `${checked}${t("common.separator")}${freshness}`;
}

function updateRefreshControl() {
  if (!elements.refreshButton) return;
  const active = Boolean(state.refreshInFlight);
  elements.refreshButton.disabled = active;
  elements.refreshButton.textContent = active
    ? t("work.snapshot.refreshing")
    : t("work.snapshot.refresh");
}

function renderMetrics(dashboard) {
  const cards = [
    [dashboard.metrics.issueCount, "work.metrics.openIssues"],
    [
      dashboard.metrics.linkedPullRequests ?? 0,
      "work.metrics.linkedPullRequests"
    ],
    [dashboard.metrics.repositoryCount, "work.metrics.repositories"],
    [dashboard.metrics.failedRepositories, "work.metrics.sourcesAttention"]
  ];
  elements.metrics.replaceChildren(
    ...cards.map(([value, label]) => {
      const card = node("div", "metric-card");
      card.append(
        node("span", "metric-value", text(value)),
        node("span", "metric-label", t(label))
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
      identity.append(link(repository.url, repository.fullName, "repo-github"));
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
            ? t("work.repository.open", { count: repository.openIssueCount })
            : t("work.repository.unavailable")
        )
      );
      return row;
    })
  );
}

function renderRepositoryFilter(dashboard) {
  const all = node("option", "", t("work.repositories.all"));
  all.value = "";
  const options = dashboard.repositories.map((repository) => {
    const product = productForRepository(repository.fullName);
    const option = node(
      "option",
      "",
      product
        ? `${product.name}${t("common.separator")}${repository.fullName}`
        : repository.fullName
    );
    option.value = repository.fullName;
    return option;
  });
  elements.repositoryFilter.replaceChildren(all, ...options);
  elements.repositoryFilter.value = state.repository;
}

function renderViewFilter() {
  if (!elements.viewFilter) return;
  elements.viewFilter.replaceChildren(
    ...WORK_VIEWS.map(({ id, messageKey }) => {
      const option = node("option", "", t(messageKey));
      option.value = id;
      return option;
    })
  );
  elements.viewFilter.value = state.view;
}

function renderSortFilter(issues) {
  if (!elements.sortFilter) return;
  const createdSupported = supportsCreatedAt(issues);
  elements.sortFilter.replaceChildren(
    ...WORK_SORTS.map(({ id, messageKey }) => {
      const option = node("option", "", t(messageKey));
      option.value = id;
      if (id === "created" && !createdSupported) {
        option.disabled = true;
        option.textContent += t("work.sort.unavailable");
      }
      return option;
    })
  );
  if (state.sort === "created" && !createdSupported) state.sort = "updated";
  elements.sortFilter.value = state.sort;
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
      node("span", "pr-linkage unknown", t("work.pr.linkageUnavailable"))
    );
    return container;
  }
  if (linkage.items.length === 0) {
    container.append(
      node("span", "pr-linkage unlinked", t("work.pr.noAuthoritative"))
    );
    return container;
  }

  for (const pullRequest of linkage.items) {
    const item = node("div", `issue-pr ${pullRequest.state}`);
    const title = link(
      pullRequest.url,
      t("work.pr.title", {
        number: pullRequest.number,
        title: pullRequest.title
      }),
      "pr-title"
    );
    const repository =
      pullRequest.repository.fullName === issue.repository.fullName
        ? t("work.pr.sameRepository")
        : pullRequest.repository.fullName;
    const status =
      pullRequest.state === "closed"
        ? t("work.pr.closedWithoutMerge")
        : pullRequest.state;
    item.append(
      title,
      node("span", "pr-meta", `${repository}${t("common.separator")}${status}`)
    );
    container.append(item);
  }
  return container;
}

function renderIssue(issue) {
  const row = node("article", "issue-row");
  row.setAttribute("role", "listitem");
  const product = productForRepository(issue.repository.fullName);
  const identity = node("div", "issue-repository");
  if (product) identity.append(productLink(product, "issue-product"));
  identity.append(
    link(issue.repository.url, issue.repository.fullName, "issue-repo")
  );
  const title = node("h3", "issue-title");
  title.append(
    link(issue.url, `#${issue.number} ${issue.title}`, "issue-link")
  );
  const issueMain = node("div", "issue-main");
  issueMain.append(title, renderPullRequests(issue));

  const classification = classifyIssue(issue);
  const primaryState = classification.inProgress
    ? { className: "progress", label: t("work.state.inProgress") }
    : classification.ready
      ? { className: "ready", label: t("work.state.ready") }
      : {
          className: "state",
          label: `${text(issue.state)}${issue.stateReason ? `${t("common.separator")}${issue.stateReason}` : ""}`
        };
  const state = node(
    "span",
    `work-state ${primaryState.className}`,
    primaryState.label
  );
  const stateGroup = node("div", "work-state-group");
  stateGroup.append(state);
  if (classification.needsAttention) {
    stateGroup.append(
      node("span", "attention-signal", t("work.state.needsAttention"))
    );
  }

  const metadata = node("div", "issue-meta");
  if (issue.type) metadata.append(node("span", "metadata-item", issue.type));
  for (const label of issue.labels.slice(0, 3)) {
    metadata.append(node("span", "metadata-item", label.name));
  }
  if (issue.labels.length > 3) {
    metadata.append(
      node(
        "span",
        "metadata-item",
        t("work.metadata.labels", { count: issue.labels.length - 3 })
      )
    );
  }
  if (issue.milestone) {
    metadata.append(
      node(
        "span",
        "metadata-item",
        t("work.metadata.milestone", { title: issue.milestone.title })
      )
    );
  }
  if (issue.assignee) {
    metadata.append(node("span", "metadata-item", `@${issue.assignee.login}`));
  }
  const updated = node("time", "updated", formatRelativeAge(issue.updatedAt));
  updated.dateTime = issue.updatedAt;
  updated.title = formatDate(issue.updatedAt);
  updated.setAttribute(
    "aria-label",
    t("work.updated.lastUpdated", { date: formatDate(issue.updatedAt) })
  );

  const issueHeader = node("header", "issue-row-header");
  const age = node("div", "issue-row-age");
  age.append(updated);
  issueHeader.append(identity, age);
  const issueSide = node("aside", "issue-side");
  issueSide.setAttribute("aria-label", t("work.issue.aria"));
  issueSide.append(stateGroup, metadata);
  row.append(issueMain, issueHeader, issueSide);
  return row;
}

function renderIssues() {
  const viewIssues = state.dashboard.issues.filter((issue) =>
    issueMatchesView(issue, state.view)
  );
  const issues = sortIssues(viewIssues.filter(issueMatches), state.sort);
  const view = WORK_VIEWS.find(({ id }) => id === state.view);
  elements.issueCount.textContent = t("work.issue.count", {
    shown: issues.length,
    total: viewIssues.length,
    view: view ? t(view.messageKey) : t("work.view.all")
  });
  if (issues.length === 0) {
    elements.issueList.replaceChildren(
      node("p", "empty-state", t("work.issue.noMatches"))
    );
    return;
  }
  elements.issueList.replaceChildren(...issues.map(renderIssue));
}

function syncUrl() {
  const query = buildWorkQuery({
    view: state.view,
    repository: state.repository,
    search: state.search,
    sort: state.sort
  });
  history.replaceState(
    null,
    "",
    `${location.pathname}${query}${location.hash}`
  );
}

function showLoadError(error) {
  state.refreshError = error;
  elements.generatedAt.textContent = t("work.load.snapshotUnavailable");
  elements.status.hidden = false;
  elements.status.className = "status-banner load-error";
  elements.status.replaceChildren(
    node("p", "status-title", t("work.load.failedTitle")),
    node(
      "p",
      "status-detail",
      t("work.load.noSnapshot", { error: error.message })
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
    node("p", "status-title", t("work.refresh.failedTitle")),
    node(
      "p",
      "status-detail",
      t("work.refresh.lastValid", { error: error.message })
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
    state.view = resolveView(location.search);
    state.repository = resolveRepositoryFilter(
      location.search,
      dashboard.repositories
    );
    state.search = resolveSearchFilter(location.search);
    state.sort = resolveSort(location.search, dashboard.issues);
    state.initialized = true;
  }
  elements.issueSearch.value = state.search;
  elements.generatedAt.textContent = t("work.snapshot.generated", {
    date: formatDate(dashboard.generatedAt)
  });
  showStatus(dashboard);
  renderMetrics(dashboard);
  renderRepositorySummary(dashboard);
  renderViewFilter();
  renderRepositoryFilter(dashboard);
  renderSortFilter(dashboard.issues);
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

elements.viewFilter?.addEventListener("change", (event) => {
  state.view = event.target.value;
  syncUrl();
  renderIssues();
});

elements.sortFilter?.addEventListener("change", (event) => {
  state.sort = event.target.value;
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
