import {
  buildProductRepositoryIndex,
  buildWorkQuery,
  resolveRepositoryFilter,
  resolveSearchFilter
} from "./work-model.js";

const state = {
  dashboard: null,
  productByRepository: new Map(),
  repository: "",
  search: ""
};

const elements = {
  status: document.querySelector("#dataset-status"),
  generatedAt: document.querySelector("#generated-at"),
  metrics: document.querySelector("#metrics"),
  repositorySummary: document.querySelector("#repository-summary"),
  repositoryFilter: document.querySelector("#repository-filter"),
  issueSearch: document.querySelector("#issue-search"),
  issueCount: document.querySelector("#issue-count"),
  issueList: document.querySelector("#issue-list")
};

function text(value) {
  return value === null || value === undefined || value === "" ? "—" : String(value);
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
  return link(`../products/${encodeURIComponent(product.id)}/`, product.name, className);
}

function showStatus(dashboard) {
  const status = dashboard.status;
  elements.status.hidden = false;
  elements.status.className = `status-banner ${status}`;
  elements.status.replaceChildren(
    node("p", "status-title", status === "complete" ? "Snapshot complete" : `Snapshot ${status}`),
    node(
      "p",
      "status-detail",
      status === "complete"
        ? `${dashboard.metrics.issueCount} open issues loaded from ${dashboard.metrics.repositoryCount} repositories.`
        : `${dashboard.metrics.successfulRepositories} of ${dashboard.metrics.repositoryCount} repositories loaded. Treat this view as incomplete.`
    )
  );
  if (dashboard.errors.length > 0) {
    const errors = node("ul", "status-errors");
    for (const error of dashboard.errors) {
      const suffix = error.rateLimited ? " Rate limit reached." : "";
      errors.append(node("li", "", `${error.repository} (${error.stage}): ${error.message}${suffix}`));
    }
    elements.status.append(errors);
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

function renderMetrics(dashboard) {
  const cards = [
    [dashboard.metrics.issueCount, "open issues"],
    [dashboard.metrics.repositoryCount, "repositories"],
    [dashboard.metrics.failedRepositories, "sources needing attention"]
  ];
  elements.metrics.replaceChildren(
    ...cards.map(([value, label]) => {
      const card = node("div", "metric-card");
      card.append(node("span", "metric-value", text(value)), node("span", "metric-label", label));
      return card;
    })
  );
}

function renderRepositorySummary(dashboard) {
  const counts = dashboard.repositories.map((repository) => repository.openIssueCount ?? 0);
  const max = Math.max(...counts, 1);
  elements.repositorySummary.replaceChildren(
    ...dashboard.repositories.map((repository) => {
      const product = productForRepository(repository.fullName);
      const row = node("div", `repo-row${repository.fetchStatus === "ok" ? "" : " failed"}`);
      const identity = node("div", "repo-identity");
      if (product) identity.append(productLink(product, "repo-product"));
      identity.append(link(repository.url, repository.fullName, "repo-github"));
      const bar = node("div", "repo-bar");
      const fill = node("div", "repo-bar-fill");
      fill.style.width = `${Math.max(((repository.openIssueCount ?? 0) / max) * 100, repository.fetchStatus === "ok" ? 0 : 2)}%`;
      bar.append(fill);
      row.append(
        identity,
        bar,
        node("div", "repo-count", repository.fetchStatus === "ok" ? `${repository.openIssueCount} open` : "Data unavailable")
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
    const option = node("option", "", product ? `${product.name} · ${repository.fullName}` : repository.fullName);
    option.value = repository.fullName;
    return option;
  });
  elements.repositoryFilter.replaceChildren(all, ...options);
  elements.repositoryFilter.value = state.repository;
}

function issueMatches(issue) {
  if (state.repository && issue.repository.fullName !== state.repository) return false;
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
    ...issue.labels.map((label) => label.name)
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(query);
}

function renderIssue(issue) {
  const row = node("tr");
  const product = productForRepository(issue.repository.fullName);
  const repositoryCell = node("td");
  const identity = node("div", "issue-repository");
  if (product) identity.append(productLink(product, "issue-product"));
  identity.append(link(issue.repository.url, issue.repository.fullName, "issue-repo"));
  repositoryCell.append(identity);

  const issueCell = node("td");
  issueCell.append(link(issue.url, `#${issue.number} ${issue.title}`, "issue-link"));

  const metadataCell = node("td");
  const metadata = node("div", "issue-meta");
  metadata.append(node("span", "pill state", `${text(issue.state)}${issue.stateReason ? ` · ${issue.stateReason}` : ""}`));
  if (issue.type) metadata.append(node("span", "pill", issue.type));
  for (const label of issue.labels) metadata.append(node("span", "pill", label.name));
  if (issue.milestone) metadata.append(node("span", "pill", `Milestone: ${issue.milestone.title}`));
  if (issue.assignee) metadata.append(node("span", "pill", `@${issue.assignee.login}`));
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
    const empty = node("td", "empty-state", "No issues match current filters.");
    empty.colSpan = 4;
    row.append(empty);
    elements.issueList.replaceChildren(row);
    return;
  }
  elements.issueList.replaceChildren(...issues.map(renderIssue));
}

function syncUrl() {
  const query = buildWorkQuery({ repository: state.repository, search: state.search });
  history.replaceState(null, "", `${location.pathname}${query}${location.hash}`);
}

function showLoadError(error) {
  elements.generatedAt.textContent = "Snapshot unavailable";
  elements.status.hidden = false;
  elements.status.className = "status-banner load-error";
  elements.status.replaceChildren(
    node("p", "status-title", "Portal work data failed to load"),
    node("p", "status-detail", `${error.message}. No issue data is being presented.`)
  );
}

async function jsonResponse(response, path) {
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return response.json();
}

async function loadDashboard() {
  try {
    const [dashboardResponse, catalogResponse] = await Promise.all([
      fetch("./data/dashboard.json", { cache: "no-store" }),
      fetch("../data/products.json", { cache: "no-store" })
    ]);
    const [dashboard, productCatalog] = await Promise.all([
      jsonResponse(dashboardResponse, "./data/dashboard.json"),
      jsonResponse(catalogResponse, "../data/products.json")
    ]);
    state.dashboard = dashboard;
    state.productByRepository = buildProductRepositoryIndex(productCatalog);
    state.repository = resolveRepositoryFilter(location.search, dashboard.repositories);
    state.search = resolveSearchFilter(location.search);
    elements.issueSearch.value = state.search;
    elements.generatedAt.textContent = formatDate(dashboard.generatedAt, "Generated ");
    showStatus(dashboard);
    renderMetrics(dashboard);
    renderRepositorySummary(dashboard);
    renderRepositoryFilter(dashboard);
    renderIssues();
  } catch (error) {
    showLoadError(error);
  }
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

loadDashboard();
