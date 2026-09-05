import {
  buildDependencyGraph,
  filterDependencyGraph,
  layoutDependencyGraph
} from "./graph-model.js";
import { buildProductRepositoryIndex } from "../work-model.js";
import {
  hydrateMessages,
  message,
  preserveLocaleQuery
} from "../../messages.js";

hydrateMessages(document);
preserveLocaleQuery(document);

const t = (key, values = {}) => message(key, values);

const SVG_NS = "http://www.w3.org/2000/svg";
const state = {
  dashboard: null,
  graph: null,
  products: new Map(),
  repository: "",
  includeDisconnected: false,
  selectedNodeKey: "",
  visibleGraph: null,
  initialRevealStarted: false
};

const elements = {
  status: document.querySelector("#graph-status"),
  repository: document.querySelector("#graph-repository"),
  disconnected: document.querySelector("#show-disconnected"),
  count: document.querySelector("#graph-count"),
  blockers: document.querySelector("#major-blockers"),
  empty: document.querySelector("#graph-empty"),
  svg: document.querySelector("#dependency-graph"),
  detail: document.querySelector("#node-detail")
};

function htmlNode(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

function svgNode(tag, attributes = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) {
    node.setAttribute(name, String(value));
  }
  return node;
}

function productFor(repository) {
  return state.products.get(repository) ?? null;
}

function displayRepository(repository) {
  return productFor(repository)?.name ?? repository;
}

function isDependencyError(error) {
  const stage = String(error?.stage ?? "");
  return (
    stage === "repository" ||
    stage === "issues" ||
    stage.startsWith("dependencies:")
  );
}

function showStatus() {
  const unavailable = state.dashboard.metrics.dependencyDataUnavailable ?? 0;
  const dependencyErrors = (state.dashboard.errors ?? []).filter(
    isDependencyError
  ).length;
  const complete = unavailable === 0 && dependencyErrors === 0;
  elements.status.hidden = false;
  elements.status.className = `status-banner ${complete ? "complete" : "partial"}`;
  elements.status.replaceChildren(
    htmlNode(
      "p",
      "status-title",
      complete ? t("graph.status.complete") : t("graph.status.incomplete")
    ),
    htmlNode(
      "p",
      "status-detail",
      complete
        ? t("graph.status.completeDetail", { count: state.graph.edges.length })
        : t("graph.status.incompleteDetail", {
            count: state.graph.edges.length,
            unavailable,
            errors: dependencyErrors
          })
    )
  );
}

function renderRepositoryFilter() {
  const all = htmlNode("option", "", t("work.repositories.all"));
  all.value = "";
  const options = state.dashboard.repositories.map((repository) => {
    const product = productFor(repository.fullName);
    const option = htmlNode(
      "option",
      "",
      product
        ? `${product.name}${t("common.separator")}${repository.fullName}`
        : repository.fullName
    );
    option.value = repository.fullName;
    return option;
  });
  elements.repository.replaceChildren(all, ...options);
}

function renderBlockers(graph) {
  const blockers = graph.nodes
    .filter((node) => node.outgoing > 0)
    .sort((a, b) => b.outgoing - a.outgoing || a.key.localeCompare(b.key))
    .slice(0, 6);
  if (blockers.length === 0) {
    elements.blockers.replaceChildren(
      htmlNode("li", "", t("graph.blockers.none"))
    );
    return;
  }
  elements.blockers.replaceChildren(
    ...blockers.map((blocker, index) => {
      const item = htmlNode("li");
      item.append(
        htmlNode("span", "blocker-rank", String(index + 1).padStart(2, "0")),
        Object.assign(
          htmlNode(
            "a",
            "blocker-link",
            `${displayRepository(blocker.repository)}${t("common.separator")}#${blocker.number} ${blocker.title}`
          ),
          { href: blocker.url }
        ),
        htmlNode(
          "span",
          "blocker-count",
          t(
            `graph.blockers.count.${blocker.outgoing === 1 ? "one" : "other"}`,
            { count: blocker.outgoing }
          )
        )
      );
      return item;
    })
  );
}

function graphContext(node) {
  const incoming = state.graph.edges
    .filter((edge) => edge.target === node.key)
    .map((edge) =>
      state.graph.nodes.find((candidate) => candidate.key === edge.source)
    )
    .filter(Boolean);
  const outgoing = state.graph.edges
    .filter((edge) => edge.source === node.key)
    .map((edge) =>
      state.graph.nodes.find((candidate) => candidate.key === edge.target)
    )
    .filter(Boolean);
  return { incoming, outgoing };
}

function renderDetailPrompt() {
  elements.detail.replaceChildren(
    htmlNode("p", "eyebrow", t("graph.detail.eyebrow")),
    htmlNode("p", "", t("graph.detail.select"))
  );
}

function pullRequestStatus(pullRequest) {
  return pullRequest.state === "closed"
    ? t("work.pr.closedWithoutMerge")
    : pullRequest.state;
}

function renderPullRequests(node) {
  const section = htmlNode("div", "node-prs");
  section.append(htmlNode("p", "node-prs-label", t("graph.pr.implementation")));

  if (!node.openDataset) {
    section.append(
      htmlNode("p", "node-prs-empty", t("graph.pr.outsideSnapshot"))
    );
    return section;
  }

  const linkage = node.pullRequests;
  if (!linkage || linkage.status !== "complete") {
    section.append(htmlNode("p", "node-prs-empty", t("graph.pr.unavailable")));
    return section;
  }
  if (linkage.items.length === 0) {
    section.append(
      htmlNode("p", "node-prs-empty", t("graph.pr.noAuthoritative"))
    );
    return section;
  }

  for (const pullRequest of linkage.items) {
    const item = htmlNode("div", `node-pr ${pullRequest.state}`);
    const anchor = htmlNode(
      "a",
      "node-pr-title",
      t("work.pr.title", {
        number: pullRequest.number,
        title: pullRequest.title
      })
    );
    anchor.href = pullRequest.url;
    anchor.rel = "noreferrer";
    item.append(
      anchor,
      htmlNode(
        "span",
        "node-pr-meta",
        `${pullRequest.repository.fullName}${t("common.separator")}${pullRequestStatus(pullRequest)}`
      )
    );
    section.append(item);
  }
  return section;
}

function renderDetail(node) {
  const { incoming, outgoing } = graphContext(node);
  const title = htmlNode("h3", "", `#${node.number} ${node.title}`);
  const repository = htmlNode(
    "p",
    "node-detail-meta",
    `${displayRepository(node.repository)}${t("common.separator")}${node.repository}${t("common.separator")}${node.state}`
  );
  const blockerCount = t(
    `graph.detail.relations.blocker.${incoming.length === 1 ? "one" : "other"}`,
    { count: incoming.length }
  );
  const blockedCount = t(
    `graph.detail.relations.blocked.${outgoing.length === 1 ? "one" : "other"}`,
    { count: outgoing.length }
  );
  const relationParts = [blockerCount, blockedCount];
  if (node.cycle) relationParts.push(t("graph.detail.cycle"));
  const relation = htmlNode("p", "", relationParts.join(t("common.separator")));
  const open = htmlNode("a", "", t("graph.detail.openGithub"));
  open.href = node.url;
  open.rel = "noreferrer";
  elements.detail.replaceChildren(
    htmlNode("p", "eyebrow", t("graph.detail.eyebrow")),
    title,
    repository,
    relation,
    renderPullRequests(node),
    open
  );
}

function updateSelectionState() {
  const selectedKey = state.selectedNodeKey;
  const relatedKeys = new Set(selectedKey ? [selectedKey] : []);
  if (selectedKey) {
    for (const edge of state.visibleGraph?.edges ?? []) {
      if (edge.source === selectedKey) relatedKeys.add(edge.target);
      if (edge.target === selectedKey) relatedKeys.add(edge.source);
    }
  }

  elements.svg.querySelectorAll(".graph-node").forEach((node) => {
    const isSelected = node.dataset.nodeKey === selectedKey;
    const isRelated = !selectedKey || relatedKeys.has(node.dataset.nodeKey);
    node.classList.toggle("selected", isSelected);
    node.classList.toggle("is-related", Boolean(selectedKey && isRelated));
    node.classList.toggle("is-dimmed", Boolean(selectedKey && !isRelated));
    node.setAttribute("aria-pressed", String(isSelected));
  });

  elements.svg.querySelectorAll(".graph-edge").forEach((edge) => {
    const isRelated =
      !selectedKey ||
      edge.dataset.source === selectedKey ||
      edge.dataset.target === selectedKey;
    edge.classList.toggle("is-related", Boolean(selectedKey && isRelated));
    edge.classList.toggle("is-dimmed", Boolean(selectedKey && !isRelated));
  });
}

function selectNode(node) {
  state.selectedNodeKey = node.key;
  renderDetail(node);
  elements.detail.classList.add("graph-motion-detail-revealed");
  updateSelectionState();
}

function appendMarker(svg) {
  const defs = svgNode("defs");
  const marker = svgNode("marker", {
    id: "graph-arrow",
    viewBox: "0 0 10 10",
    refX: 9,
    refY: 5,
    markerWidth: 6,
    markerHeight: 6,
    orient: "auto-start-reverse"
  });
  marker.append(
    svgNode("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "#8f959f" })
  );
  defs.append(marker);
  svg.append(defs);
}

function renderSvg(layout) {
  elements.svg.replaceChildren();
  appendMarker(elements.svg);
  elements.svg.setAttribute("viewBox", `0 0 ${layout.width} ${layout.height}`);
  elements.svg.setAttribute("width", layout.width);
  elements.svg.setAttribute("height", layout.height);

  for (const edge of layout.edges) {
    const source = edge.sourceNode;
    const target = edge.targetNode;
    const x1 = source.x + source.width;
    const y1 = source.y + source.height / 2;
    const x2 = target.x;
    const y2 = target.y + target.height / 2;
    const bend = Math.max(42, Math.abs(x2 - x1) * 0.45);
    const path = svgNode("path", {
      d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`,
      class: `graph-edge${source.repository !== target.repository ? " cross-repository" : ""}`,
      "data-source": source.key,
      "data-target": target.key,
      "marker-end": "url(#graph-arrow)"
    });
    elements.svg.append(path);
  }

  for (const node of layout.nodes) {
    const group = svgNode("g", {
      class: `graph-node${node.incoming > 0 ? " blocked" : ""}${node.cycle ? " cycle" : ""}${node.openDataset ? "" : " external"}`,
      transform: `translate(${node.x} ${node.y})`,
      tabindex: 0,
      role: "button",
      "aria-pressed": node.key === state.selectedNodeKey,
      "data-node-key": node.key,
      "aria-label": t("graph.node.aria", {
        repository: node.repository,
        number: node.number,
        title: node.title
      })
    });
    group.append(
      svgNode("rect", { width: node.width, height: node.height, rx: 11 })
    );
    const repo = svgNode("text", {
      x: 14,
      y: 19,
      class: "graph-node-repo"
    });
    repo.textContent = `${displayRepository(node.repository)}${t("common.separator")}#${node.number}`;
    const title = svgNode("text", {
      x: 14,
      y: 41,
      class: "graph-node-title"
    });
    title.textContent =
      node.title.length > 34 ? `${node.title.slice(0, 33)}…` : node.title;
    const status = svgNode("text", {
      x: 14,
      y: 60,
      class: "graph-node-state"
    });
    const pullRequestCount =
      node.pullRequests?.status === "complete"
        ? node.pullRequests.items.length
        : null;
    const statusParts = [node.state];
    if (!node.openDataset) statusParts.push(t("graph.node.outsideOpenSet"));
    if (node.cycle) statusParts.push(t("graph.node.cycle"));
    if (pullRequestCount) {
      statusParts.push(
        t(`graph.node.pr.${pullRequestCount === 1 ? "one" : "other"}`, {
          count: pullRequestCount
        })
      );
    }
    status.textContent = statusParts.join(t("common.separator"));
    group.append(repo, title, status);
    group.addEventListener("click", () => selectNode(node));
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectNode(node);
      }
    });
    elements.svg.append(group);
  }

  updateSelectionState();
}

function renderGraph() {
  const filtered = filterDependencyGraph(
    state.graph,
    state.repository,
    state.includeDisconnected
  );
  state.visibleGraph = filtered;
  const selectedNode = filtered.nodes.find(
    (node) => node.key === state.selectedNodeKey
  );
  if (state.selectedNodeKey && !selectedNode) {
    state.selectedNodeKey = "";
    renderDetailPrompt();
  } else if (selectedNode) {
    renderDetail(selectedNode);
  }
  const layout = layoutDependencyGraph(filtered);
  elements.count.textContent = t("graph.count", {
    nodes: filtered.nodes.length,
    edges: filtered.edges.length
  });
  elements.empty.hidden = filtered.nodes.length > 0;
  elements.svg.hidden = filtered.nodes.length === 0;
  renderBlockers(filtered);
  if (filtered.nodes.length > 0) {
    renderSvg(layout);
    if (!state.initialRevealStarted) {
      state.initialRevealStarted = true;
      window.portalMotion?.revealGraph?.({
        svg: elements.svg,
        detail: elements.detail
      });
    }
  }
}

async function json(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return response.json();
}

async function load() {
  try {
    const [dashboard, catalog] = await Promise.all([
      json("../data/dashboard.json"),
      json("../../data/products.json")
    ]);
    state.dashboard = dashboard;
    state.products = buildProductRepositoryIndex(catalog);
    state.graph = buildDependencyGraph(dashboard);
    renderRepositoryFilter();
    showStatus();
    renderGraph();
  } catch (error) {
    elements.status.hidden = false;
    elements.status.className = "status-banner load-error";
    elements.status.replaceChildren(
      htmlNode("p", "status-title", t("graph.load.failedTitle")),
      htmlNode("p", "status-detail", error.message)
    );
  }
}

elements.repository.addEventListener("change", (event) => {
  state.repository = event.target.value;
  renderGraph();
});

elements.disconnected.addEventListener("change", (event) => {
  state.includeDisconnected = event.target.checked;
  renderGraph();
});

load();
