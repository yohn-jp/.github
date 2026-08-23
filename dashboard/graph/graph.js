import {
  buildDependencyGraph,
  filterDependencyGraph,
  layoutDependencyGraph
} from "./graph-model.js";
import { buildProductRepositoryIndex } from "../work-model.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const state = {
  dashboard: null,
  graph: null,
  products: new Map(),
  repository: "",
  includeDisconnected: false
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
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
}

function productFor(repository) {
  return state.products.get(repository) ?? null;
}

function displayRepository(repository) {
  return productFor(repository)?.name ?? repository;
}

function showStatus() {
  const unavailable = state.dashboard.metrics.dependencyDataUnavailable ?? 0;
  const complete = state.dashboard.status === "complete" && unavailable === 0;
  elements.status.hidden = false;
  elements.status.className = `status-banner ${complete ? "complete" : "partial"}`;
  elements.status.replaceChildren(
    htmlNode("p", "status-title", complete ? "Dependency snapshot complete" : "Dependency snapshot incomplete"),
    htmlNode(
      "p",
      "status-detail",
      complete
        ? `${state.graph.edges.length} native dependency edges loaded.`
        : `${state.graph.edges.length} known edges loaded; ${unavailable} issues have unavailable or partial dependency data.`
    )
  );
}

function renderRepositoryFilter() {
  const all = htmlNode("option", "", "All repositories");
  all.value = "";
  const options = state.dashboard.repositories.map((repository) => {
    const product = productFor(repository.fullName);
    const option = htmlNode(
      "option",
      "",
      product ? `${product.name} · ${repository.fullName}` : repository.fullName
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
    elements.blockers.replaceChildren(htmlNode("li", "", "No blocking edges in current view."));
    return;
  }
  elements.blockers.replaceChildren(
    ...blockers.map((blocker, index) => {
      const item = htmlNode("li");
      item.append(
        htmlNode("span", "blocker-rank", String(index + 1).padStart(2, "0")),
        Object.assign(htmlNode("a", "blocker-link", `${displayRepository(blocker.repository)} #${blocker.number} · ${blocker.title}`), {
          href: blocker.url
        }),
        htmlNode("span", "blocker-count", `${blocker.outgoing} blocked`)
      );
      return item;
    })
  );
}

function graphContext(node) {
  const incoming = state.graph.edges
    .filter((edge) => edge.target === node.key)
    .map((edge) => state.graph.nodes.find((candidate) => candidate.key === edge.source))
    .filter(Boolean);
  const outgoing = state.graph.edges
    .filter((edge) => edge.source === node.key)
    .map((edge) => state.graph.nodes.find((candidate) => candidate.key === edge.target))
    .filter(Boolean);
  return { incoming, outgoing };
}

function renderDetail(node) {
  const { incoming, outgoing } = graphContext(node);
  const title = htmlNode("h3", "", `#${node.number} ${node.title}`);
  const repository = htmlNode("p", "node-detail-meta", `${displayRepository(node.repository)} · ${node.repository} · ${node.state}`);
  const relation = htmlNode(
    "p",
    "",
    `${incoming.length} blocker${incoming.length === 1 ? "" : "s"} · ${outgoing.length} blocked issue${outgoing.length === 1 ? "" : "s"}${node.cycle ? " · cycle participant" : ""}`
  );
  const open = htmlNode("a", "", "Open on GitHub ↗");
  open.href = node.url;
  open.rel = "noreferrer";
  elements.detail.replaceChildren(
    htmlNode("p", "eyebrow", "Issue detail"),
    title,
    repository,
    relation,
    open
  );
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
  marker.append(svgNode("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "#8f959f" }));
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
      "aria-label": `${node.repository} issue ${node.number}: ${node.title}`
    });
    group.append(svgNode("rect", { width: node.width, height: node.height, rx: 11 }));
    const repo = svgNode("text", { x: 14, y: 19, class: "graph-node-repo" });
    repo.textContent = `${displayRepository(node.repository)} · #${node.number}`;
    const title = svgNode("text", { x: 14, y: 41, class: "graph-node-title" });
    title.textContent = node.title.length > 34 ? `${node.title.slice(0, 33)}…` : node.title;
    const status = svgNode("text", { x: 14, y: 60, class: "graph-node-state" });
    status.textContent = `${node.state}${node.openDataset ? "" : " · outside open set"}${node.cycle ? " · cycle" : ""}`;
    group.append(repo, title, status);
    group.addEventListener("click", () => renderDetail(node));
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        renderDetail(node);
      }
    });
    elements.svg.append(group);
  }
}

function renderGraph() {
  const filtered = filterDependencyGraph(
    state.graph,
    state.repository,
    state.includeDisconnected
  );
  const layout = layoutDependencyGraph(filtered);
  elements.count.textContent = `${filtered.nodes.length} nodes · ${filtered.edges.length} edges`;
  elements.empty.hidden = filtered.nodes.length > 0;
  elements.svg.hidden = filtered.nodes.length === 0;
  renderBlockers(filtered);
  if (filtered.nodes.length > 0) renderSvg(layout);
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
      htmlNode("p", "status-title", "Dependency graph failed to load"),
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
