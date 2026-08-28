import {
  hydrateMessages,
  localeDate,
  message,
  preserveLocaleQuery
} from "../../messages.js";

hydrateMessages(document);
preserveLocaleQuery(document);

const t = (key, values = {}) => message(key, values);

const elements = {
  generatedAt: document.querySelector("#generated-at"),
  status: document.querySelector("#dataset-status"),
  metrics: document.querySelector("#governance-metrics"),
  repositories: document.querySelector("#repository-health"),
  violations: document.querySelector("#violation-summary"),
  invalidIssues: document.querySelector("#invalid-issues"),
  unknownIssues: document.querySelector("#unknown-issues")
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

function rate(value) {
  return value === null || value === undefined
    ? t("governance.repository.rateUnavailable")
    : t("governance.repository.rate", {
        rate: `${Math.round(Number(value) * 100)}%`
      });
}

function showStatus(dashboard, health) {
  const snapshot = health?.snapshot;
  const unavailableRepositories = snapshot?.unavailableRepositories ?? 0;
  const unknownIssues =
    snapshot?.unknownIssues ?? health?.overall?.unknown ?? 0;
  const complete = Boolean(snapshot?.complete);
  const status =
    dashboard.status === "failed"
      ? "failed"
      : complete
        ? "complete"
        : "partial";
  elements.status.className = `governance-status-banner ${status}`;
  elements.status.replaceChildren(
    node("p", "governance-status-title", t(`governance.snapshot.${status}`)),
    node(
      "p",
      "governance-status-detail",
      t("governance.snapshot.detail", {
        available: snapshot?.availableRepositories ?? 0,
        repositories:
          snapshot?.repositoryCount ?? dashboard.metrics.repositoryCount,
        unavailable: unavailableRepositories,
        unknown: unknownIssues
      })
    )
  );
  elements.generatedAt.textContent = dashboard.generatedAt
    ? t("governance.snapshot.generated", {
        date: localeDate(dashboard.generatedAt)
      })
    : t("governance.snapshot.loading");
}

function renderMetrics(overall) {
  const cards = [
    [overall.valid, "governance.metrics.valid", "valid"],
    [overall.invalid, "governance.metrics.invalid", "invalid"],
    [overall.unknown, "governance.metrics.unknown", "unknown"]
  ];
  elements.metrics.replaceChildren(
    ...cards.map(([value, key, status]) => {
      const card = node("div", `governance-metric ${status}`);
      card.append(
        node("span", "governance-metric-value", text(value)),
        node("span", "governance-metric-label", t(key))
      );
      return card;
    })
  );
}

function renderRepository(repository) {
  const unavailable = repository.fetchStatus !== "ok";
  const row = node(
    "article",
    `governance-repository${unavailable ? " unavailable" : ""}`
  );
  const name = node("div", "governance-repository-name");
  name.append(link(repository.url, repository.fullName));
  row.append(name);
  if (unavailable) {
    row.append(
      node(
        "span",
        "governance-repository-meta",
        t("governance.repository.unavailable")
      )
    );
    row.append(
      node(
        "span",
        "governance-repository-meta",
        text(repository.error?.message)
      )
    );
    row.append(node("span", "governance-rate", rate(null)));
    return row;
  }

  const counts = node("div", "governance-repository-counts");
  counts.append(
    node(
      "span",
      "governance-count-valid",
      t("governance.repository.valid", { count: repository.valid })
    ),
    node(
      "span",
      "governance-count-invalid",
      t("governance.repository.invalid", { count: repository.invalid })
    ),
    node(
      "span",
      "governance-count-unknown",
      t("governance.repository.unknown", { count: repository.unknown })
    )
  );
  row.append(
    counts,
    node(
      "span",
      "governance-repository-meta",
      t("governance.repository.issues", { count: repository.issueCount })
    ),
    (() => {
      const rateNode = node("span", "governance-rate");
      rateNode.append(node("strong", "", rate(repository.complianceRate)));
      rateNode.append(node("span", "", t("governance.repository.rateLabel")));
      return rateNode;
    })()
  );
  return row;
}

function renderRepositories(repositories) {
  if (!Array.isArray(repositories) || repositories.length === 0) {
    elements.repositories.replaceChildren(
      node("p", "governance-empty", t("governance.repositories.empty"))
    );
    return;
  }
  elements.repositories.replaceChildren(...repositories.map(renderRepository));
}

function renderViolationGroup(kind, value, count) {
  const row = node("div", "violation-group");
  const heading = node("div", "violation-group-heading");
  heading.append(
    node("span", "", value),
    node("strong", "", t("governance.violations.count", { count }))
  );
  row.append(
    node("span", "violation-group-label", t(`governance.violations.${kind}`)),
    heading
  );
  return row;
}

function renderViolations(violations) {
  const rows = [
    ...(violations?.classifications ?? []).map((entry) =>
      renderViolationGroup("classification", entry.classification, entry.count)
    ),
    ...(violations?.codes ?? []).map((entry) =>
      renderViolationGroup("code", entry.code, entry.count)
    )
  ];
  elements.violations.replaceChildren(
    ...(rows.length > 0
      ? rows
      : [node("p", "governance-empty", t("governance.violations.empty"))])
  );
}

function renderIssueList(container, issues, emptyKey) {
  if (!Array.isArray(issues) || issues.length === 0) {
    container.replaceChildren(node("p", "governance-empty", t(emptyKey)));
    return;
  }
  container.replaceChildren(
    ...issues.map((issue) => {
      const item = node("article", "governance-issue");
      item.append(
        link(
          issue.url,
          t("governance.issue.title", {
            number: issue.number,
            title: issue.title
          })
        ),
        node(
          "span",
          "governance-issue-meta",
          `${issue.repository.fullName}${t("common.separator")}${text(issue.reason)}`
        )
      );
      return item;
    })
  );
}

function renderDashboard(dashboard) {
  const health = dashboard.governanceHealth;
  if (!health || !health.overall) {
    throw new Error("Governance health projection is unavailable");
  }
  showStatus(dashboard, health);
  renderMetrics(health.overall);
  renderRepositories(health.repositories);
  renderViolations(health.violations);
  renderIssueList(
    elements.invalidIssues,
    health.issues?.invalid,
    "governance.issues.empty"
  );
  renderIssueList(
    elements.unknownIssues,
    health.issues?.unknown,
    "governance.issues.empty"
  );
}

async function loadDashboard() {
  const response = await fetch("../data/dashboard.json", { cache: "no-store" });
  if (!response.ok)
    throw new Error(`../data/dashboard.json returned HTTP ${response.status}`);
  renderDashboard(await response.json());
}

try {
  await loadDashboard();
} catch (error) {
  elements.status.className = "governance-status-banner load-error";
  elements.status.replaceChildren(
    node("p", "governance-status-title", t("governance.load.failedTitle")),
    node("p", "governance-status-detail", error.message)
  );
  elements.generatedAt.textContent = t("governance.snapshot.unavailable");
}
