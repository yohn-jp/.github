const state = {
  dashboard: null,
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

function showStatus(dashboard) {
  const status = dashboard.status;
  elements.status.hidden = false;
  elements.status.className = `status-banner ${status}`;

  const title = node(
    "p",
    "status-title",
    status === "complete" ? "Snapshot complete" : `Snapshot ${status}`
  );
  const detail = node(
    "p",
    "status-detail",
    status === "complete"
      ? `${dashboard.metrics.issueCount} open issues loaded from ${dashboard.metrics.repositoryCount} repositories.`
      : `${dashboard.metrics.successfulRepositories} of ${dashboard.metrics.repositoryCount} repositories loaded. Treat this view as incomplete.`
  );
  elements.status.replaceChildren(title, detail);

  if (dashboard.errors.length > 0) {
    const errors = node("ul", "status-errors");
    for (const error of dashboard.errors) {
      const suffix = error.rateLimited ? " Rate limit reached." : "";
      errors.append(
        node(
          "li",
          "",
          `${error.repository} (${error.stage}): ${error.message}.${suffix}`
        )
      );
    }
    elements.status.append(errors);
  }
}

function formatGeneratedAt(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return `Generated: ${text(value)}`;
  return `Generated ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date)}`;
}

function renderMetrics(dashboard) {
  const cards = [
    [dashboard.metrics.issueCount, "open issues"],
    [dashboard.metrics.repositoryCount, "configured repositories"],
    [dashboard.metrics.failedRepositories, "repositories needing attention"]
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
      const row = node(
        "div",
        `repo-row${repository.fetchStatus === "ok" ? "" : " failed"}`
      );
      const name = node("div", "repo-name");
      name.append(link(repository.url, repository.fullName));
      const bar = node("div", "repo-bar");
      const fill = node("div", "repo-bar-fill");
      fill.style.width = `${Math.max(((repository.openIssueCount ?? 0) / max) * 100, repository.fetchStatus === "ok" ? 0 : 2)}%`;
      bar.append(fill);
      const count = node(
        "div",
        "repo-count",
        repository.fetchStatus === "ok"
          ? `${repository.openIssueCount} open`
          : "Data unavailable"
      );
      row.append(name, bar, count);
      return row;
    })
  );
}

function renderRepositoryFilter(dashboard) {
  const options = dashboard.repositories.map((repository) => {
    const option = node("option", "", repository.fullName);
    option.value = repository.fullName;
    return option;
  });
  elements.repositoryFilter.append(...options);
}

function issueMatches(issue) {
  if (state.repository && issue.repository.fullName !== state.repository)
    return false;
  const query = state.search.trim().toLowerCase();
  if (!query) return true;
  const searchable = [
    issue.title,
    issue.repository.fullName,
    issue.type,
    issue.milestone?.title,
    issue.assignee?.login,
    ...issue.labels.map((label) => label.name)
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return searchable.includes(query);
}

function renderIssue(issue) {
  const row = node("tr");
  const repositoryCell = node("td");
  repositoryCell.append(
    link(issue.repository.url, issue.repository.fullName, "issue-repo")
  );

  const issueCell = node("td");
  const issueLink = link(
    issue.url,
    `#${issue.number} ${issue.title}`,
    "issue-link"
  );
  issueCell.append(issueLink);

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
  for (const label of issue.labels)
    metadata.append(node("span", "pill", label.name));
  if (issue.milestone)
    metadata.append(
      node("span", "pill", `Milestone: ${issue.milestone.title}`)
    );
  if (issue.assignee)
    metadata.append(node("span", "pill", `@${issue.assignee.login}`));
  metadataCell.append(metadata);

  const updatedCell = node("td");
  const updated = node(
    "time",
    "updated",
    formatGeneratedAt(issue.updatedAt).replace(/^Generated /, "")
  );
  updated.dateTime = issue.updatedAt;
  updatedCell.append(updated);
  row.append(repositoryCell, issueCell, metadataCell, updatedCell);
  return row;
}

function renderIssues() {
  const issues = state.dashboard.issues.filter(issueMatches);
  elements.issueCount.textContent = `${issues.length} of ${state.dashboard.issues.length} issues`;
  if (issues.length === 0) {
    elements.issueList.replaceChildren(node("tr", "", ""));
    const empty = elements.issueList.firstElementChild;
    empty.append(
      node("td", "empty-state", "No issues match the current filters.")
    );
    empty.firstElementChild.colSpan = 4;
    return;
  }
  elements.issueList.replaceChildren(...issues.map(renderIssue));
}

function showLoadError(error) {
  elements.generatedAt.textContent = "Snapshot unavailable";
  elements.status.hidden = false;
  elements.status.className = "status-banner load-error";
  elements.status.replaceChildren(
    node("p", "status-title", "Snapshot failed to load"),
    node(
      "p",
      "status-detail",
      `${error.message}. No issue data is being presented.`
    )
  );
}

async function loadDashboard() {
  try {
    const response = await fetch("./data/dashboard.json", {
      cache: "no-store"
    });
    if (!response.ok)
      throw new Error(`Dashboard data returned HTTP ${response.status}`);
    state.dashboard = await response.json();
    elements.generatedAt.textContent = formatGeneratedAt(
      state.dashboard.generatedAt
    );
    showStatus(state.dashboard);
    renderMetrics(state.dashboard);
    renderRepositorySummary(state.dashboard);
    renderRepositoryFilter(state.dashboard);
    renderIssues();
  } catch (error) {
    showLoadError(error);
  }
}

elements.repositoryFilter.addEventListener("change", (event) => {
  state.repository = event.target.value;
  renderIssues();
});
elements.issueSearch.addEventListener("input", (event) => {
  state.search = event.target.value;
  renderIssues();
});

loadDashboard();
