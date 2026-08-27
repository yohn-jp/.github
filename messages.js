const ENGLISH_MESSAGES = Object.freeze({
  "common.empty": "—",
  "common.separator": " · ",

  "portal.title": "yohn-jp · Developer portal",
  "portal.meta.description":
    "yohn-jp developer portal: focused tools for governed agentic software development",
  "portal.nav.primary": "Primary navigation",
  "portal.nav.home": "yohn-jp developer portal home",
  "portal.nav.products": "Products",
  "portal.nav.system": "System",
  "portal.nav.work": "Work",
  "portal.nav.github": "GitHub ↗",
  "portal.hero.eyebrow": "Tools for governed agentic development",
  "portal.hero.titleLead": "Small tools.",
  "portal.hero.titleEmphasis": "Clear authority.",
  "portal.hero.lede":
    "A product family for coding agents where orchestration, Git ownership, GitHub governance, semantic projection, and repository semantics stay explicit and composable.",
  "portal.hero.browseProducts": "Browse products",
  "portal.hero.seeWork": "See open work",
  "portal.hero.designPrinciple": "Design principle",
  "portal.hero.note":
    "Every boundary has one owner. Missing authority fails closed instead of silently falling back.",
  "portal.hero.sourceOfTruth": "GitHub remains source of truth.",
  "portal.principles.title": "Portal principles",
  "portal.principles.explicitAuthority.title": "Explicit authority",
  "portal.principles.explicitAuthority.body":
    "Git, GitHub, orchestration, views, and semantics are separate contracts.",
  "portal.principles.machineReadable.title": "Machine-readable first",
  "portal.principles.machineReadable.body":
    "Stable identities and structured evidence before decorative presentation.",
  "portal.principles.failClosed.title": "Fail closed",
  "portal.principles.failClosed.body":
    "Unavailable proof is a blocker, not permission to guess.",
  "portal.products.eyebrow": "Product family",
  "portal.products.title": "Six focused layers.",
  "portal.products.body":
    "Each product owns a narrow responsibility. Explore the boundary before the feature list.",
  "portal.product.explore": "Explore {name}",
  "portal.product.github": "GitHub",
  "portal.system.eyebrow": "System map",
  "portal.system.title": "Composition without authority blur.",
  "portal.system.body":
    "Products cooperate through explicit seams. Follow any node to its responsibility boundary.",
  "portal.system.nodes": "Product nodes",
  "portal.system.relationships": "Declared relationships",
  "portal.work.eyebrow": "Live public work",
  "portal.work.title": "Plans are useful when they stay connected to evidence.",
  "portal.work.body":
    "Browse open Issues across yohn-jp. Dependency and implementation graphs are the next layer.",
  "portal.work.openDashboard": "Open work dashboard",
  "portal.footer.identity": "dev.yohn.jp · yohn-jp developer portal",
  "portal.footer.domain": "dev.yohn.jp",
  "portal.footer.source": "Source ↗",
  "portal.footer.portalHome": "Portal home",
  "portal.product.backToProducts": "← All products",
  "portal.product.title": "{name} · yohn-jp",
  "portal.product.repository": "Repository ↗",
  "portal.product.documentation": "Documentation ↗",
  "portal.product.why": "Why it exists",
  "portal.product.owns": "Owns",
  "portal.product.authority": "Authority",
  "portal.product.doesNotOwn": "Does not own",
  "portal.product.boundary": "Boundary",
  "portal.product.boundaryLabel": "Product responsibility boundary",
  "portal.product.coreModel": "Core model",
  "portal.product.howItWorks": "How {name} works",
  "portal.product.operationalDetail":
    "Operational detail stays in repository documentation. These are the concepts that define the product boundary.",
  "portal.product.currentMaturity": "Current maturity",
  "portal.product.relationships": "Relationships",
  "portal.product.fitsSystem": "Fits into a larger system",
  "portal.product.publicWork": "Public work",
  "portal.product.followImplementation": "Follow {name} implementation",
  "portal.product.prefilteredWork":
    "Open work is pre-filtered to this product repository. GitHub remains source of truth.",
  "portal.product.openWork": "Open {name} work",

  "work.title": "Open work · yohn-jp",
  "work.meta.description": "Open work across public yohn-jp repositories",
  "work.nav.primary": "Primary navigation",
  "work.nav.home": "yohn-jp developer portal home",
  "work.nav.products": "Products",
  "work.nav.system": "System",
  "work.nav.work": "Work",
  "work.nav.graph": "Dependency graph",
  "work.nav.issueIndex": "Issue index",
  "work.nav.github": "GitHub ↗",
  "work.header.eyebrow": "Public work · GitHub projection",
  "work.header.title": "Open work",
  "work.header.lede":
    "Read-only daily view. GitHub remains the source of truth.",
  "work.snapshot.aria": "Snapshot freshness",
  "work.snapshot.loading": "Loading snapshot…",
  "work.snapshot.checking": "Checking for the latest snapshot…",
  "work.snapshot.refresh": "Refresh now",
  "work.snapshot.refreshing": "Refreshing…",
  "work.snapshot.generated": "Generated {date}",
  "work.metrics.aria": "Essential work metrics",
  "work.metrics.openIssues": "open issues",
  "work.metrics.linkedPullRequests": "linked pull requests",
  "work.metrics.repositories": "repositories",
  "work.metrics.sourcesAttention": "sources needing attention",
  "work.metrics.governanceValid": "governance valid",
  "work.metrics.governanceInvalid": "governance invalid",
  "work.metrics.governanceUnknown": "governance unknown",
  "work.issues.title": "Open issues",
  "work.issues.filters.aria": "Issue filters",
  "work.filters.view": "View",
  "work.filters.governance": "Governance",
  "work.filters.repository": "Repository",
  "work.filters.sort": "Sort",
  "work.filters.search": "Search",
  "work.filters.searchPlaceholder": "Title, product, label, assignee…",
  "work.repositories.all": "All repositories",
  "work.issues.loading": "Loading issues…",
  "work.distribution.eyebrow": "Secondary view",
  "work.distribution.title": "Repository workload",
  "work.distribution.body":
    "Repository counts stay tied to generated GitHub evidence. Cataloged repositories link back to their product boundary.",
  "work.distribution.graphLink": "View native dependency graph →",
  "work.footer.sourceOfTruth": "GitHub remains source of truth.",
  "work.footer.graph": "Dependency graph",
  "work.footer.portalHome": "Portal home",
  "work.footer.issues": "Portal issues ↗",
  "work.status.snapshotComplete":
    "Snapshot complete · {count} repositories loaded",
  "work.status.snapshot": "Snapshot {status}",
  "work.status.snapshotDetail":
    "{successful} of {count} repositories loaded; {unavailable} issues have unavailable or partial PR linkage. Treat this view as incomplete.",
  "work.status.rateLimit": " Rate limit reached.",
  "work.status.issuePrefix": "#{issue} ",
  "work.status.error": "{repository} {issue}({stage}): {error}{rateLimit}",
  "work.freshness.noValid": "Last checked {date} · No valid snapshot loaded.",
  "work.freshness.checking": "Checking for the latest snapshot…",
  "work.freshness.notChecked": "Not checked yet",
  "work.freshness.snapshotAge": "Snapshot is {age}.",
  "work.freshness.refreshFailed":
    "{checked} · {freshness} Refresh failed; showing the last valid data.",
  "work.freshness.checked": "Last checked {date}",
  "work.age.unknown": "unknown age",
  "work.age.lessThanMinute": "less than a minute old",
  "work.age.minute.one": "{count} minute old",
  "work.age.minute.other": "{count} minutes old",
  "work.age.hour.one": "{count} hour old",
  "work.age.hour.other": "{count} hours old",
  "work.updated.unknown": "Update age unknown",
  "work.updated.future": "Updated in the future",
  "work.updated.justNow": "Updated just now",
  "work.updated.relative": "Updated {relativeTime}",
  "work.updated.lastUpdated": "Last updated {date}",
  "work.repository.open": "{count} open",
  "work.repository.unavailable": "Data unavailable",
  "work.pr.linkageUnavailable": "PR linkage unavailable",
  "work.pr.noAuthoritative": "No authoritative linked PR",
  "work.pr.title": "PR #{number} {title}",
  "work.pr.sameRepository": "same repository",
  "work.pr.closedWithoutMerge": "closed without merge",
  "work.state.inProgress": "In progress",
  "work.state.ready": "Ready / unstarted",
  "work.state.needsAttention": "Needs attention",
  "work.metadata.labels": "+{count} labels",
  "work.metadata.milestone": "Milestone: {title}",
  "work.issue.aria": "Issue status and metadata",
  "work.issue.count": "{shown} of {total} issues in {view}",
  "work.issue.noMatches": "No issues match current filters.",
  "work.governance.filter.all": "All",
  "work.governance.filter.valid": "Valid",
  "work.governance.filter.invalid": "Invalid",
  "work.governance.filter.unknown": "Unknown",
  "work.governance.status.valid": "Governance valid",
  "work.governance.status.invalid": "Governance invalid",
  "work.governance.status.unknown": "Governance unknown",
  "work.governance.violations.one": "{count} violation",
  "work.governance.violations.other": "{count} violations",
  "work.governance.violations.unspecified": "Unspecified violation",
  "work.governance.violations.noDetail":
    "No structured violation detail available.",
  "work.load.snapshotUnavailable": "Snapshot unavailable",
  "work.load.failedTitle": "Portal work data failed to load",
  "work.load.noSnapshot": "{error}. No valid issue snapshot is available yet.",
  "work.refresh.failedTitle": "Snapshot refresh failed",
  "work.refresh.lastValid": "{error}. The last valid snapshot remains visible.",
  "work.view.recent": "Recent",
  "work.view.attention": "Needs attention",
  "work.view.inProgress": "In progress",
  "work.view.ready": "Ready / unstarted",
  "work.view.all": "All",
  "work.sort.updated": "Recently updated",
  "work.sort.created": "Newly created",
  "work.sort.oldest": "Oldest activity",
  "work.sort.repository": "Repository",
  "work.sort.unavailable": " (unavailable)",

  "graph.title": "Dependency graph · yohn-jp",
  "graph.meta.description": "Dependency graph for public yohn-jp Issues",
  "graph.nav.primary": "Primary navigation",
  "graph.nav.home": "yohn-jp developer portal home",
  "graph.nav.products": "Products",
  "graph.nav.issueIndex": "Issue index",
  "graph.nav.graph": "Dependency graph",
  "graph.hero.eyebrow": "GitHub-native relationships",
  "graph.hero.title": "Dependency graph.",
  "graph.hero.body":
    "Directed edges run from blocker to blocked work. Relationship data comes from GitHub Issue dependencies; no edge is inferred from prose.",
  "graph.filters.aria": "Graph filters",
  "graph.filters.repository": "Repository",
  "graph.filters.disconnected": "Show disconnected issues",
  "graph.blockers.eyebrow": "Bottlenecks",
  "graph.blockers.title": "Major blockers",
  "graph.layout.aria": "Issue dependency graph",
  "graph.empty": "No dependency edges match current filters.",
  "graph.svg.title": "Issue dependency graph",
  "graph.svg.description":
    "Directed edges point from blocking issues to issues they block.",
  "graph.detail.eyebrow": "Issue detail",
  "graph.detail.select": "Select a node to inspect its dependency context.",
  "graph.footer.sourceOfTruth": "GitHub remains source of truth.",
  "graph.footer.issueIndex": "Issue index",
  "graph.footer.portalHome": "Portal home",
  "graph.status.complete": "Dependency snapshot complete",
  "graph.status.incomplete": "Dependency snapshot incomplete",
  "graph.status.completeDetail": "{count} native dependency edges loaded.",
  "graph.status.incompleteDetail":
    "{count} known edges loaded; {unavailable} issues have unavailable or partial dependency data and {errors} dependency-source errors were recorded.",
  "graph.blockers.none": "No blocking edges in current view.",
  "graph.blockers.count.one": "{count} blocked",
  "graph.blockers.count.other": "{count} blocked",
  "graph.pr.implementation": "Implementation",
  "graph.pr.outsideSnapshot":
    "PR linkage unavailable for dependency node outside current open-issue snapshot.",
  "graph.pr.unavailable": "PR linkage unavailable or partial.",
  "graph.pr.noAuthoritative": "No authoritative linked PR.",
  "graph.detail.relations.blocker.one": "{count} blocker",
  "graph.detail.relations.blocker.other": "{count} blockers",
  "graph.detail.relations.blocked.one": "{count} blocked issue",
  "graph.detail.relations.blocked.other": "{count} blocked issues",
  "graph.detail.cycle": "cycle participant",
  "graph.detail.openGithub": "Open on GitHub ↗",
  "graph.node.aria": "{repository} issue {number}: {title}",
  "graph.node.outsideOpenSet": "outside open set",
  "graph.node.cycle": "cycle",
  "graph.node.pr.one": "{count} PR",
  "graph.node.pr.other": "{count} PRs",
  "graph.count": "{nodes} nodes · {edges} edges",
  "graph.load.failedTitle": "Dependency graph failed to load"
});

export const MESSAGE_CATALOG = Object.freeze({
  en: ENGLISH_MESSAGES
});

export const MESSAGES = ENGLISH_MESSAGES;

const DEFAULT_LOCALE = "en";

export function normalizeLocale(locale) {
  if (typeof locale !== "string" || locale.trim() === "") {
    return DEFAULT_LOCALE;
  }
  try {
    return Intl.getCanonicalLocales(locale.trim())[0] ?? DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

export function resolveRuntimeLocale(root = globalThis.document) {
  const documentElement = root?.documentElement;
  const lang =
    typeof documentElement?.lang === "string" && documentElement.lang.trim()
      ? documentElement.lang
      : documentElement?.getAttribute?.("lang");
  return normalizeLocale(lang);
}

function defaultLocale(root = globalThis.document) {
  return resolveRuntimeLocale(root);
}

function localeCandidates(locale) {
  const normalized = normalizeLocale(locale);
  const baseLanguage = normalized.split("-")[0];
  return baseLanguage === normalized
    ? [normalized]
    : [normalized, baseLanguage];
}

function messagesFor(catalog, locale) {
  for (const candidate of localeCandidates(locale)) {
    if (catalog?.[candidate] && typeof catalog[candidate] === "object") {
      return catalog[candidate];
    }
  }
  if (catalog?.en && typeof catalog.en === "object") return catalog.en;
  return catalog;
}

function interpolate(template, key, values) {
  return String(template).replaceAll(
    /\{([A-Za-z][A-Za-z0-9_]*)\}/g,
    (_, name) => {
      if (!Object.hasOwn(values, name)) {
        throw new Error(`Missing value "${name}" for message key "${key}"`);
      }
      return String(values[name]);
    }
  );
}

export function resolveMessage(
  key,
  values = {},
  { locale = defaultLocale(), catalog = MESSAGE_CATALOG } = {}
) {
  const messages = messagesFor(catalog, locale);
  if (!messages || !Object.hasOwn(messages, key)) {
    throw new Error(`Missing message key: ${key}`);
  }
  return interpolate(messages[key], key, values);
}

export function message(key, values = {}, locale = defaultLocale()) {
  return resolveMessage(key, values, { locale });
}

export function localeDate(value, locale = defaultLocale()) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return null;
  return new Intl.DateTimeFormat(normalizeLocale(locale), {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function relativeUnit(seconds) {
  if (seconds < 60) return null;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return { amount: minutes, unit: "minute" };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { amount: hours, unit: "hour" };
  const days = Math.floor(hours / 24);
  if (days < 7) return { amount: days, unit: "day" };
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return { amount: weeks, unit: "week" };
  const months = Math.floor(days / 30);
  if (months < 12) return { amount: months, unit: "month" };
  return { amount: Math.floor(days / 365), unit: "year" };
}

export function formatRelativeTime(value, locale = defaultLocale()) {
  const resolvedLocale = normalizeLocale(locale);
  const timestamp = new Date(value).valueOf();
  if (Number.isNaN(timestamp))
    return message("work.updated.unknown", {}, resolvedLocale);
  const difference = Date.now() - timestamp;
  if (difference < 0) return message("work.updated.future", {}, resolvedLocale);
  const seconds = Math.floor(difference / 1000);
  if (seconds < 60) return message("work.updated.justNow", {}, resolvedLocale);
  const relative = relativeUnit(seconds);
  const relativeTime = new Intl.RelativeTimeFormat(resolvedLocale, {
    numeric: "always",
    style: "narrow"
  }).format(-relative.amount, relative.unit);
  return message("work.updated.relative", { relativeTime }, resolvedLocale);
}

export function formatSnapshotAge(value, locale = defaultLocale()) {
  const resolvedLocale = normalizeLocale(locale);
  const timestamp = new Date(value).valueOf();
  if (Number.isNaN(timestamp)) {
    return message("work.age.unknown", {}, resolvedLocale);
  }
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) {
    return message("work.age.lessThanMinute", {}, resolvedLocale);
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    const plural = new Intl.PluralRules(resolvedLocale).select(minutes);
    return message(
      `work.age.minute.${plural}`,
      {
        count: new Intl.NumberFormat(resolvedLocale).format(minutes)
      },
      resolvedLocale
    );
  }
  const hours = Math.floor(minutes / 60);
  const plural = new Intl.PluralRules(resolvedLocale).select(hours);
  return message(
    `work.age.hour.${plural}`,
    {
      count: new Intl.NumberFormat(resolvedLocale).format(hours)
    },
    resolvedLocale
  );
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function messageError(root, element, error) {
  element.textContent = `⚠ ${error.message}`;
  const body = root.body ?? root.querySelector?.("body");
  if (body) {
    const failure = body.ownerDocument.createElement("pre");
    failure.className = "message-resolution-error";
    failure.textContent = `⚠ ${error.message}`;
    body.prepend(failure);
  }
}

export function hydrateMessages(root, locale = defaultLocale()) {
  const contentElements = root.querySelectorAll("[data-message]");
  for (const element of contentElements) {
    try {
      element.textContent = resolveMessage(
        element.dataset.message,
        {},
        { locale }
      );
    } catch (error) {
      messageError(root, element, error);
      throw error;
    }
  }

  const attributeElements = root.querySelectorAll(
    "[data-message-aria-label], [data-message-content], [data-message-placeholder]"
  );
  for (const element of attributeElements) {
    for (const attribute of ["aria-label", "content", "placeholder"]) {
      const datasetName = `message${attribute[0].toUpperCase()}${attribute.slice(1)}`;
      const key = element.dataset[datasetName];
      if (!key) continue;
      try {
        element.setAttribute(attribute, resolveMessage(key, {}, { locale }));
      } catch (error) {
        messageError(root, element, error);
        throw error;
      }
    }
  }
}

export function resolveHtmlLocale(html, locale) {
  if (locale !== undefined && locale !== null) return normalizeLocale(locale);
  const match = String(html).match(
    /<html\b[^>]*\blang\s*=\s*["']([^"']+)["']/i
  );
  return normalizeLocale(match?.[1]);
}

export function resolveHtmlMessages(html, locale) {
  const source = String(html);
  const resolvedLocale = resolveHtmlLocale(source, locale);
  let output = source;
  output = output.replace(
    /(<html\b[^>]*\blang\s*=\s*["'])[^"']*(["'])/i,
    `$1${escapeHtml(resolvedLocale)}$2`
  );
  output = output.replaceAll(
    /data-message-(aria-label|content|placeholder)="([^"]+)"/g,
    (match, attribute, key) =>
      `${attribute}="${escapeHtml(resolveMessage(key, {}, { locale: resolvedLocale }))}" ${match}`
  );
  output = output.replace(
    /(<([A-Za-z][A-Za-z0-9:-]*)\b[^>]*\sdata-message="([^"]+)"[^>]*>)[\s\S]*?(<\/\2>)/g,
    (_, opening, tag, key, closing) =>
      `${opening}${escapeHtml(resolveMessage(key, {}, { locale: resolvedLocale }))}${closing}`
  );
  return output;
}
