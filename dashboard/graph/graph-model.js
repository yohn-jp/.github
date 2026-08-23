export function issueKey(issue) {
  return `${issue.repository.fullName}#${issue.number}`;
}

function graphNode(issue, openDataset = true) {
  return {
    key: issueKey(issue),
    repository: issue.repository.fullName,
    number: issue.number,
    title: issue.title,
    state: issue.state,
    url: issue.url,
    openDataset,
    dependencies: issue.relationships?.dependencies ?? null
  };
}

export function buildDependencyGraph(dashboard) {
  const nodes = new Map();
  const edges = new Map();

  function ensure(reference, openDataset = false) {
    const key = issueKey(reference);
    if (!nodes.has(key)) nodes.set(key, graphNode(reference, openDataset));
    return key;
  }

  for (const issue of dashboard.issues) ensure(issue, true);

  function addEdge(sourceRef, targetRef) {
    const source = ensure(sourceRef, dashboard.issues.some((issue) => issueKey(issue) === issueKey(sourceRef)));
    const target = ensure(targetRef, dashboard.issues.some((issue) => issueKey(issue) === issueKey(targetRef)));
    const key = `${source}->${target}`;
    if (!edges.has(key)) edges.set(key, { key, source, target });
  }

  for (const issue of dashboard.issues) {
    const dependencies = issue.relationships?.dependencies;
    for (const blocker of dependencies?.blockedBy ?? []) addEdge(blocker, issue);
    for (const blocked of dependencies?.blocking ?? []) addEdge(issue, blocked);
  }

  const incoming = new Map([...nodes.keys()].map((key) => [key, 0]));
  const outgoing = new Map([...nodes.keys()].map((key) => [key, 0]));
  for (const edge of edges.values()) {
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    outgoing.set(edge.source, (outgoing.get(edge.source) ?? 0) + 1);
  }
  for (const node of nodes.values()) {
    node.incoming = incoming.get(node.key) ?? 0;
    node.outgoing = outgoing.get(node.key) ?? 0;
    node.connected = node.incoming + node.outgoing > 0;
  }

  return {
    nodes: [...nodes.values()].sort((a, b) => a.repository.localeCompare(b.repository) || a.number - b.number),
    edges: [...edges.values()]
  };
}

export function filterDependencyGraph(graph, repository = "", includeDisconnected = false) {
  const selected = new Set();
  if (repository) {
    for (const node of graph.nodes) if (node.repository === repository) selected.add(node.key);
    for (const edge of graph.edges) {
      if (selected.has(edge.source) || selected.has(edge.target)) {
        selected.add(edge.source);
        selected.add(edge.target);
      }
    }
  } else {
    for (const node of graph.nodes) {
      if (includeDisconnected || node.connected) selected.add(node.key);
    }
  }
  if (includeDisconnected && repository) {
    for (const node of graph.nodes) if (node.repository === repository) selected.add(node.key);
  }
  return {
    nodes: graph.nodes.filter((node) => selected.has(node.key)),
    edges: graph.edges.filter((edge) => selected.has(edge.source) && selected.has(edge.target))
  };
}

export function layoutDependencyGraph(graph) {
  const byKey = new Map(graph.nodes.map((node) => [node.key, { ...node, layer: 0, cycle: false }]));
  const indegree = new Map(graph.nodes.map((node) => [node.key, 0]));
  const outgoing = new Map(graph.nodes.map((node) => [node.key, []]));
  for (const edge of graph.edges) {
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    outgoing.get(edge.source)?.push(edge.target);
  }

  const queue = [...byKey.keys()].filter((key) => indegree.get(key) === 0).sort();
  const visited = new Set();
  while (queue.length) {
    const key = queue.shift();
    visited.add(key);
    const source = byKey.get(key);
    for (const targetKey of outgoing.get(key) ?? []) {
      const target = byKey.get(targetKey);
      target.layer = Math.max(target.layer, source.layer + 1);
      indegree.set(targetKey, indegree.get(targetKey) - 1);
      if (indegree.get(targetKey) === 0) queue.push(targetKey);
    }
    queue.sort();
  }

  const maxAcyclicLayer = Math.max(0, ...[...byKey.values()].filter((node) => visited.has(node.key)).map((node) => node.layer));
  for (const node of byKey.values()) {
    if (!visited.has(node.key)) {
      node.cycle = true;
      node.layer = maxAcyclicLayer + 1;
    }
  }

  const layers = new Map();
  for (const node of byKey.values()) {
    if (!layers.has(node.layer)) layers.set(node.layer, []);
    layers.get(node.layer).push(node);
  }
  for (const nodes of layers.values()) nodes.sort((a, b) => a.repository.localeCompare(b.repository) || a.number - b.number);

  const nodeWidth = 250;
  const nodeHeight = 72;
  const horizontalGap = 78;
  const verticalGap = 28;
  for (const [layer, nodes] of layers) {
    nodes.forEach((node, index) => {
      node.x = 24 + layer * (nodeWidth + horizontalGap);
      node.y = 24 + index * (nodeHeight + verticalGap);
      node.width = nodeWidth;
      node.height = nodeHeight;
    });
  }

  const nodes = [...byKey.values()];
  const positioned = new Map(nodes.map((node) => [node.key, node]));
  const edges = graph.edges.map((edge) => ({
    ...edge,
    sourceNode: positioned.get(edge.source),
    targetNode: positioned.get(edge.target)
  }));
  const width = Math.max(360, ...nodes.map((node) => node.x + node.width + 24));
  const height = Math.max(240, ...nodes.map((node) => node.y + node.height + 24));
  return { nodes, edges, width, height };
}
