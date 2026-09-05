import {
  buildProductRepositoryIndex,
  buildWorkQuery,
  classifyIssue,
  governanceStatus,
  issueMatchesGovernance,
  issueMatchesView,
  resolveRepositoryFilter,
  resolveSearchFilter,
  resolveGovernanceFilter,
  resolveSort,
  resolveView,
  sortIssues,
  supportsCreatedAt,
  WORK_SORTS,
  WORK_GOVERNANCE_FILTERS,
  WORK_VIEWS
} from "./work-model.js";
import {
  formatRelativeTime as formatLocaleRelativeTime,
  formatSnapshotAge as formatLocaleSnapshotAge,
  hydrateMessages,
  localeDate,
  message,
  preserveLocaleQuery
} from "../messages.js";

hydrateMessages(document);
preserveLocaleQuery(document);

const t = (key, values = {}) => message(key, values);

const SNAPSHOT_REFRESH_INTERVAL_MS = 60_000;
const RESULT_FEEDBACK_DURATION_MS = 220;
const FILTER_FEEDBACK_DURATION_MS = 1_800;
const METRIC_FEEDBACK_DURATION_MS = 2_400;
const SNAPSHOT_FEEDBACK_DURATION_MS = 3_000;

const state = {
  dashboard: null,
  productByRepository: new Map(),
  view: "recent",
  governance: "all",
  repository: "",
  search: "",
  sort: "updated",
  initialized: false,
  refreshTimer: null,
  refreshInFlight: null,
  lastCheckedAt: null,
  refreshError: null,
  resultFeedbackTimer: null,
  filterFeedbackTimer: null,
  metricFeedbackTimer: null,
  snapshotFeedbackTimer: null
};

const elements = {
  status: document.querySelector("#dataset-status"),
  generatedAt: document.querySelector("#generated-at"),
  freshness: document.querySelector("#snapshot-freshness"),
  snapshotFeedback: document.querySelector("#snapshot-feedback"),
  refreshButton: document.querySelector("#refresh-dashboard"),
  metrics: document.querySelector("#metrics"),
  repositorySummary: document.querySelector("#repository-summary"),
  viewFilter: document.querySelector("#view-filter"),
  governanceFilter: document.querySelector("#governance-filter"),
  repositoryFilter: document.querySelector("#repository-filter"),
  sortFilter: document.querySelector("#sort-filter"),
  issueSearch: document.querySelector("#issue-search"),
  issueCount: document.querySelector("#issue-count"),
  filterFeedback: document.querySelector("#filter-feedback"),
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

function showSnapshotFeedback(key, values = {}, className = "", duration = 0) {
  if (!elements.snapshotFeedback) return;
  if (state.snapshotFeedbackTimer !== null) {
    window.clearTimeout(state.snapshotFeedbackTimer);
    state.snapshotFeedbackTimer = null;
  }
  elements.snapshotFeedback.className = `snapshot-feedback ${className}`.trim();
  elements.snapshotFeedback.textContent = t(key, values);
  if (duration > 0) {
    state.snapshotFeedbackTimer = window.setTimeout(() => {
      elements.snapshotFeedback.textContent = "";
      elements.snapshotFeedback.className = "snapshot-feedback";
      state.snapshotFeedbackTimer = null;
    }, duration);
  }
}

function showFilterFeedback(shown) {
  if (!elements.filterFeedback) return;
  if (state.filterFeedbackTimer !== null) {
    window.clearTimeout(state.filterFeedbackTimer);
    state.filterFeedbackTimer = null;
  }
  elements.filterFeedback.textContent = t("work.issue.filterFeedback", {
    shown
  });
  elements.filterFeedback.classList.add("is-visible");
  state.filterFeedbackTimer = window.setTimeout(() => {
    elements.filterFeedback.classList.remove("is-visible");
    elements.filterFeedback.textContent = "";
    state.filterFeedbackTimer = null;
  }, FILTER_FEEDBACK_DURATION_MS);
}

function flashResultUpdate() {
  if (!elements.issueList) return;
  if (state.resultFeedbackTimer !== null) {
    window.clearTimeout(state.resultFeedbackTimer);
    state.resultFeedbackTimer = null;
  }
  elements.issueList.classList.remove("is-updating");
  elements.issueList.setAttribute("aria-busy", "true");
  window.requestAnimationFrame(() => {
    elements.issueList.classList.add("is-updating");
    state.resultFeedbackTimer = window.setTimeout(() => {
      elements.issueList.classList.remove("is-updating");
      elements.issueList.setAttribute("aria-busy", "false");
      state.resultFeedbackTimer = null;
    }, RESULT_FEEDBACK_DURATION_MS);
  });
}

function metricDelta(value, previousValue) {
  if (previousValue === null || previousValue === undefined) return null;
  const current = Number(value);
  const previous = Number(previousValue);
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  const delta = current - previous;
  return delta === 0 ? null : delta;
}

function clearMetricFeedback() {
  elements.metrics
    ?.querySelectorAll(".metric-change")
    .forEach((change) => change.remove());
  elements.metrics
    ?.querySelectorAll(".metric-card.is-changed")
    .forEach((card) => card.classList.remove("is-changed"));
  state.metricFeedbackTimer = null;
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
  elements.status.dataset.status = status;
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
  elements.refreshButton.setAttribute("aria-busy", String(active));
  elements.refreshButton.textContent = active
    ? t("work.snapshot.refreshing")
    : t("work.snapshot.refresh");
}

function renderMetrics(dashboard, previousDashboard = null) {
  const cards = [
    [dashboard.metrics.issueCount, "work.metrics.openIssues", "issueCount"],
    [
      dashboard.metrics.linkedPullRequests ?? 0,
      "work.metrics.linkedPullRequests",
      "linkedPullRequests"
    ],
    [
      dashboard.metrics.repositoryCount,
      "work.metrics.repositories",
      "repositoryCount"
    ],
    [
      dashboard.metrics.failedRepositories,
      "work.metrics.sourcesAttention",
      "failedRepositories"
    ],
    [
      dashboard.metrics.governanceValid ?? 0,
      "work.metrics.governanceValid",
      "governanceValid"
    ],
    [
      dashboard.metrics.governanceInvalid ?? 0,
      "work.metrics.governanceInvalid",
      "governanceInvalid"
    ],
    [
      dashboard.metrics.governanceUnknown ?? 0,
      "work.metrics.governanceUnknown",
      "governanceUnknown"
    ]
  ];
  if (state.metricFeedbackTimer !== null) {
    window.clearTimeout(state.metricFeedbackTimer);
    state.metricFeedbackTimer = null;
  }
  elements.metrics.replaceChildren(
    ...cards.map(([value, label, metricKey]) => {
      const delta = metricDelta(value, previousDashboard?.metrics?.[metricKey]);
      const card = node(
        "div",
        `metric-card${delta === null ? "" : " is-changed"}`
      );
      card.append(
        node("span", "metric-value", text(value)),
        node("span", "metric-label", t(label))
      );
      if (delta !== null) {
        const direction = delta > 0 ? "increase" : "decrease";
        const change = node(
          "span",
          `metric-change ${direction}`,
          t(`work.metrics.${direction}d`, { count: Math.abs(delta) })
        );
        const changeDescription = t(`work.metrics.${direction}dAria`, {
          count: Math.abs(delta)
        });
        change.title = changeDescription;
        change.setAttribute("aria-label", changeDescription);
        card.querySelector(".metric-label").append(change);
      }
      return card;
    })
  );
  if (previousDashboard) {
    state.metricFeedbackTimer = window.setTimeout(
      clearMetricFeedback,
      METRIC_FEEDBACK_DURATION_MS
    );
  }
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

function renderGovernanceFilter() {
  if (!elements.governanceFilter) return;
  elements.governanceFilter.replaceChildren(
    ...WORK_GOVERNANCE_FILTERS.map(({ id, messageKey }) => {
      const option = node("option", "", t(messageKey));
      option.value = id;
      return option;
    })
  );
  elements.governanceFilter.value = state.governance;
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
  if (!issueMatchesGovernance(issue, state.governance)) return false;
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

function governanceViolationText(violation) {
  if (!violation || typeof violation !== "object") return text(violation);
  const prefix = [violation.code, violation.path].filter(Boolean).join(" ");
  return (
    [prefix, violation.message].filter(Boolean).join(": ") ||
    t("work.governance.violations.unspecified")
  );
}

function renderGovernance(issue) {
  const status = governanceStatus(issue);
  const container = node("div", "governance-status");
  const badge = node(
    "span",
    `governance-badge ${status}`,
    t(`work.governance.status.${status}`)
  );
  if (issue.governance?.reason) badge.title = issue.governance.reason;
  container.append(badge);

  if (status !== "invalid") return container;
  const violations = Array.isArray(issue.governance?.violations)
    ? issue.governance.violations
    : [];
  const details = document.createElement("details");
  details.className = "governance-violations";
  const summary = document.createElement("summary");
  summary.textContent = t(
    `work.governance.violations.${violations.length === 1 ? "one" : "other"}`,
    { count: violations.length }
  );
  details.append(summary);
  if (violations.length > 0) {
    const list = node("ul", "governance-violation-list");
    for (const violation of violations) {
      list.append(node("li", "", governanceViolationText(violation)));
    }
    details.append(list);
  } else {
    details.append(node("p", "", t("work.governance.violations.noDetail")));
  }
  container.append(details);
  return container;
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

/**
 * Renders only the unresolved Inari-projected blockers for one Issue, or an
 * explicit unavailable notice. A resolved (closed) blocker or a clear
 * projection renders nothing here; needsAttention/reasons already carry the
 * signal for filtering and the metrics page carries the aggregate counts.
 */
function renderBlockers(issue) {
  const blockers = issue.relationships?.blockers;
  if (blockers?.status === "unavailable") {
    const container = node("div", "issue-blockers");
    container.append(
      node("span", "blocker-linkage unknown", t("work.blockers.unavailable"))
    );
    return container;
  }
  const unresolved = (blockers?.blockedBy ?? []).filter(
    (reference) => !reference.resolved
  );
  if (unresolved.length === 0) return null;

  const container = node("div", "issue-blockers");
  for (const reference of unresolved) {
    const item = node("div", "issue-blocker");
    const title = link(
      reference.url,
      t("work.blockers.title", {
        number: reference.number,
        title: reference.title ?? `#${reference.number}`
      }),
      "blocker-title"
    );
    const repository =
      reference.repository.fullName === issue.repository.fullName
        ? t("work.pr.sameRepository")
        : reference.repository.fullName;
    item.append(title, node("span", "blocker-meta", repository));
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
  const blockers = renderBlockers(issue);
  if (blockers) issueMain.append(blockers);

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
  issueSide.append(stateGroup, renderGovernance(issue), metadata);
  row.append(issueMain, issueHeader, issueSide);
  return row;
}

function renderIssues({ announceFilter = false, flashUpdate = false } = {}) {
  const scopedIssues = state.dashboard.issues.filter(
    (issue) =>
      issueMatchesView(issue, state.view) &&
      issueMatchesGovernance(issue, state.governance)
  );
  const issues = sortIssues(scopedIssues.filter(issueMatches), state.sort);
  const view = WORK_VIEWS.find(({ id }) => id === state.view);
  elements.issueCount.textContent = t("work.issue.count", {
    shown: issues.length,
    total: scopedIssues.length,
    view: view ? t(view.messageKey) : t("work.view.all")
  });
  if (issues.length === 0) {
    elements.issueList.replaceChildren(
      node("p", "empty-state", t("work.issue.noMatches"))
    );
  } else {
    elements.issueList.replaceChildren(...issues.map(renderIssue));
  }
  if (announceFilter) showFilterFeedback(issues.length);
  if (flashUpdate) flashResultUpdate();
}

function syncUrl() {
  const query = buildWorkQuery({
    view: state.view,
    governance: state.governance,
    repository: state.repository,
    search: state.search,
    sort: state.sort
  });
  history.replaceState(
    null,
    "",
    `${location.pathname}${query}${location.hash}`
  );
  preserveLocaleQuery(document);
}

function showLoadError(error) {
  state.refreshError = error;
  elements.generatedAt.textContent = t("work.load.snapshotUnavailable");
  elements.status.hidden = false;
  elements.status.className = "status-banner load-error";
  elements.status.dataset.status = "load-error";
  elements.status.replaceChildren(
    node("p", "status-title", t("work.load.failedTitle")),
    node(
      "p",
      "status-detail",
      t("work.load.noSnapshot", { error: error.message })
    )
  );
  showSnapshotFeedback("work.refresh.failedFeedback", {}, "error");
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
  elements.status.dataset.status = "stale";
  elements.status.replaceChildren(
    node("p", "status-title", t("work.refresh.failedTitle")),
    node(
      "p",
      "status-detail",
      t("work.refresh.lastValid", { error: error.message })
    )
  );
  showSnapshotFeedback("work.refresh.failedFeedback", {}, "error");
  renderFreshness();
}

async function jsonResponse(response, path) {
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return response.json();
}

function applyDashboard(dashboard, productCatalog) {
  const previousDashboard = state.dashboard;
  const productIndex = productCatalog
    ? buildProductRepositoryIndex(productCatalog)
    : null;
  state.dashboard = dashboard;
  if (productIndex) state.productByRepository = productIndex;
  if (!state.initialized) {
    state.view = resolveView(location.search);
    state.governance = resolveGovernanceFilter(location.search);
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
  renderMetrics(dashboard, previousDashboard);
  renderRepositorySummary(dashboard);
  renderViewFilter();
  renderGovernanceFilter();
  renderRepositoryFilter(dashboard);
  renderSortFilter(dashboard.issues);
  renderIssues({ flashUpdate: Boolean(previousDashboard) });
  renderFreshness();
}

async function loadDashboard() {
  if (state.refreshInFlight) return state.refreshInFlight;

  state.lastCheckedAt = new Date();
  showSnapshotFeedback("work.snapshot.checking", {}, "checking");
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
      const hadSnapshot = Boolean(state.dashboard);
      const hadError = Boolean(state.refreshError);
      state.lastCheckedAt = new Date();
      state.refreshError = null;
      if (changed) {
        applyDashboard(dashboard, productCatalog);
        showSnapshotFeedback(
          hadSnapshot ? "work.snapshot.updated" : "work.snapshot.loaded",
          { date: formatDate(dashboard.generatedAt) },
          "updated",
          SNAPSHOT_FEEDBACK_DURATION_MS
        );
      } else if (hadError) {
        showStatus(state.dashboard);
        showSnapshotFeedback(
          "work.snapshot.current",
          {},
          "current",
          SNAPSHOT_FEEDBACK_DURATION_MS
        );
        renderFreshness();
      } else {
        showSnapshotFeedback(
          "work.snapshot.current",
          {},
          "current",
          SNAPSHOT_FEEDBACK_DURATION_MS
        );
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
  renderIssues({ announceFilter: true, flashUpdate: true });
});

elements.governanceFilter?.addEventListener("change", (event) => {
  state.governance = event.target.value;
  syncUrl();
  renderIssues({ announceFilter: true, flashUpdate: true });
});

elements.viewFilter?.addEventListener("change", (event) => {
  state.view = event.target.value;
  syncUrl();
  renderIssues({ announceFilter: true, flashUpdate: true });
});

elements.sortFilter?.addEventListener("change", (event) => {
  state.sort = event.target.value;
  syncUrl();
  renderIssues({ announceFilter: true, flashUpdate: true });
});

elements.issueSearch.addEventListener("input", (event) => {
  state.search = event.target.value;
  syncUrl();
  renderIssues({ announceFilter: true, flashUpdate: true });
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
