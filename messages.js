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
  "portal.nav.governance": "Governance health",
  "portal.nav.graph": "Dependency graph",
  "portal.nav.github": "GitHub ↗",
  "portal.nav.menu": "Menu",
  "portal.locale.selector": "Language",
  "portal.locale.english": "English",
  "portal.locale.japanese": "日本語",
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
  "portal.work.openGovernance": "View governance health",
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
  "work.nav.governance": "Governance health",
  "work.nav.graph": "Dependency graph",
  "work.nav.issueIndex": "Issue index",
  "work.nav.github": "GitHub ↗",
  "work.nav.menu": "Menu",
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
  "work.distribution.governanceLink": "View governance health →",
  "work.footer.sourceOfTruth": "GitHub remains source of truth.",
  "work.footer.graph": "Dependency graph",
  "work.footer.governance": "Governance health",
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
  "work.blockers.unavailable": "Dependency data unavailable",
  "work.blockers.title": "Blocked by #{number} {title}",
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

  "governance.title": "Governance health · yohn-jp",
  "governance.meta.description":
    "Organization-level governance health from projected Inari Issue data",
  "governance.nav.primary": "Primary navigation",
  "governance.nav.home": "yohn-jp developer portal home",
  "governance.nav.products": "Products",
  "governance.nav.system": "System",
  "governance.nav.work": "Work",
  "governance.nav.governance": "Governance health",
  "governance.nav.graph": "Dependency graph",
  "governance.nav.github": "GitHub ↗",
  "governance.nav.menu": "Menu",
  "governance.header.eyebrow": "Organization governance · Inari projection",
  "governance.header.title": "Governance health.",
  "governance.header.lede":
    "A read-only organization view of Issue template compliance. Every count comes from projected Inari governance evidence; unavailable data remains visible as unknown.",
  "governance.snapshot.loading": "Loading governance snapshot…",
  "governance.snapshot.generated": "Generated {date}",
  "governance.snapshot.complete": "Governance snapshot complete",
  "governance.snapshot.partial": "Governance snapshot incomplete",
  "governance.snapshot.failed": "Governance snapshot failed",
  "governance.snapshot.unavailable": "Governance snapshot unavailable",
  "governance.snapshot.detail":
    "{available} of {repositories} repositories have a source snapshot. {unknown} Issues have unknown governance and {unavailable} repositories have unavailable source data.",
  "governance.collection.status.healthy": "Governance collection healthy",
  "governance.collection.status.degraded": "Governance collection degraded",
  "governance.collection.status.unavailable":
    "Governance collection unavailable",
  "governance.collection.detail":
    "{healthy} healthy, {degraded} degraded, and {unavailable} unavailable repositories; {issues} Issues have unavailable governance evidence.",
  "governance.metrics.aria": "Governance compliance totals",
  "governance.metrics.valid": "valid Issues",
  "governance.metrics.invalid": "invalid Issues",
  "governance.metrics.unknown": "unknown Issues",
  "governance.dependencies.aria": "Inari-governed dependency totals",
  "governance.dependencies.blocked": "blocked Issues",
  "governance.dependencies.blocking": "blocking Issues",
  "governance.dependencies.unavailable": "dependency-unavailable Issues",
  "governance.dependencies.unresolvedEdges": "unresolved blocker edges",
  "governance.repositories.eyebrow": "Repository health",
  "governance.repositories.title": "Where compliance stands.",
  "governance.repositories.body":
    "Rates use only Issues with explicit valid or invalid evidence. Unknown and unavailable data is never counted as compliant.",
  "governance.repositories.empty":
    "No repository governance data is available.",
  "governance.repository.valid": "{count} valid",
  "governance.repository.invalid": "{count} invalid",
  "governance.repository.unknown": "{count} unknown",
  "governance.repository.issues": "{count} Issues",
  "governance.repository.rate": "{rate}",
  "governance.repository.rateLabel": "compliance of known evidence",
  "governance.repository.rateUnavailable": "Not calculable",
  "governance.repository.unavailable": "Governance data unavailable",
  "governance.repository.collection.healthy": "Governance collection healthy",
  "governance.repository.collection.degraded": "Governance collection degraded",
  "governance.repository.collection.unavailable":
    "Governance collection unavailable",
  "governance.diagnostics.eyebrow": "Collection diagnostics",
  "governance.diagnostics.title": "Why evidence is unavailable.",
  "governance.diagnostics.empty": "No governance collection diagnostics.",
  "governance.diagnostic.count":
    "{repositories} repositories · {issues} Issues",
  "governance.diagnostic.authentication-unavailable":
    "Authentication unavailable",
  "governance.diagnostic.insufficient-permissions":
    "Insufficient GitHub App permissions",
  "governance.diagnostic.inari-contract-unavailable":
    "Inari contract discovery or read failed",
  "governance.diagnostic.evaluator-failed": "Unexpected evaluator failure",
  "governance.diagnostic.repository-source-unavailable":
    "Repository source unavailable",
  "governance.diagnostic.unknown": "Unknown governance cause",
  "governance.violations.eyebrow": "Violation profile",
  "governance.violations.title": "Common classes and codes.",
  "governance.violations.classification": "Classification",
  "governance.violations.code": "Code",
  "governance.violations.count": "{count}",
  "governance.violations.empty": "No projected violations.",
  "governance.issues.eyebrow": "Drill-down",
  "governance.issues.title": "Issues needing inspection.",
  "governance.issues.invalid": "Invalid",
  "governance.issues.unknown": "Unknown",
  "governance.issues.empty": "No Issues in this state.",
  "governance.issue.title": "#{number} {title}",
  "governance.load.failedTitle": "Governance health failed to load",
  "governance.footer.sourceOfTruth": "GitHub remains source of truth.",
  "governance.footer.work": "Open work",
  "governance.footer.portalHome": "Portal home",
  "governance.footer.issues": "Portal Issues ↗",

  "graph.title": "Dependency graph · yohn-jp",
  "graph.meta.description": "Dependency graph for public yohn-jp Issues",
  "graph.nav.primary": "Primary navigation",
  "graph.nav.home": "yohn-jp developer portal home",
  "graph.nav.products": "Products",
  "graph.nav.system": "System",
  "graph.nav.work": "Work",
  "graph.nav.governance": "Governance health",
  "graph.nav.issueIndex": "Issue index",
  "graph.nav.graph": "Dependency graph",
  "graph.nav.github": "GitHub ↗",
  "graph.nav.menu": "Menu",
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

const JAPANESE_MESSAGES = Object.freeze({
  ...ENGLISH_MESSAGES,
  "common.empty": "—",
  "common.separator": " · ",

  "portal.title": "yohn-jp · 開発者ポータル",
  "portal.meta.description":
    "yohn-jp開発者ポータル：統制されたエージェント開発のための専門ツール",
  "portal.nav.primary": "主要ナビゲーション",
  "portal.nav.home": "yohn-jp開発者ポータルのホーム",
  "portal.nav.products": "プロダクト",
  "portal.nav.system": "システム",
  "portal.nav.work": "Work",
  "portal.nav.governance": "ガバナンスの健全性",
  "portal.nav.graph": "依存関係グラフ",
  "portal.nav.github": "GitHub ↗",
  "portal.nav.menu": "メニュー",
  "portal.locale.selector": "言語",
  "portal.locale.english": "English",
  "portal.locale.japanese": "日本語",
  "portal.hero.eyebrow": "統制されたエージェント開発のためのツール",
  "portal.hero.titleLead": "小さなツール。",
  "portal.hero.titleEmphasis": "明確な権限。",
  "portal.hero.lede":
    "オーケストレーション、Gitの所有権、GitHubガバナンス、意味投影、リポジトリの意味論を、明示的かつ組み合わせ可能に保つプロダクト群。",
  "portal.hero.browseProducts": "プロダクトを見る",
  "portal.hero.seeWork": "公開中のWorkを見る",
  "portal.hero.designPrinciple": "設計原則",
  "portal.hero.note":
    "すべての境界には1つの所有者があります。権限がない場合は、暗黙に代替せずfail closedします。",
  "portal.hero.sourceOfTruth": "GitHubが唯一の正しい情報源です。",
  "portal.principles.title": "ポータルの原則",
  "portal.principles.explicitAuthority.title": "明示的な権限",
  "portal.principles.explicitAuthority.body":
    "Git、GitHub、オーケストレーション、ビュー、意味論を別々の契約として扱います。",
  "portal.principles.machineReadable.title": "機械可読を優先",
  "portal.principles.machineReadable.body":
    "装飾的な表示より先に、安定した識別子と構造化された証拠を扱います。",
  "portal.principles.failClosed.title": "Fail closed",
  "portal.principles.failClosed.body":
    "利用できない証拠は、推測してよい理由ではなくブロッカーです。",
  "portal.products.eyebrow": "プロダクト群",
  "portal.products.title": "6つの専門レイヤー。",
  "portal.products.body":
    "各プロダクトは狭い責務を担います。機能一覧の前に境界を確認してください。",
  "portal.product.explore": "{name}を詳しく見る",
  "portal.product.github": "GitHub",
  "portal.system.eyebrow": "システムマップ",
  "portal.system.title": "権限を曖昧にしない組み合わせ。",
  "portal.system.body":
    "プロダクトは明示的な接続面で協調します。ノードから責務の境界をたどれます。",
  "portal.system.nodes": "プロダクトノード",
  "portal.system.relationships": "宣言された関係",
  "portal.work.eyebrow": "公開中のWork",
  "portal.work.title": "計画は証拠とつながっているときに役立ちます。",
  "portal.work.body":
    "yohn-jpの公開Issueを確認できます。次の層は依存関係と実装のグラフです。",
  "portal.work.openDashboard": "Workダッシュボードを開く",
  "portal.work.openGovernance": "ガバナンスの健全性を見る",
  "portal.footer.identity": "dev.yohn.jp · yohn-jp開発者ポータル",
  "portal.footer.domain": "dev.yohn.jp",
  "portal.footer.source": "ソース ↗",
  "portal.footer.portalHome": "ポータルホーム",
  "portal.product.backToProducts": "← すべてのプロダクト",
  "portal.product.title": "{name} · yohn-jp",
  "portal.product.repository": "リポジトリ ↗",
  "portal.product.documentation": "ドキュメント ↗",
  "portal.product.why": "存在する理由",
  "portal.product.owns": "所有するもの",
  "portal.product.authority": "権限",
  "portal.product.doesNotOwn": "所有しないもの",
  "portal.product.boundary": "境界",
  "portal.product.boundaryLabel": "プロダクトの責務境界",
  "portal.product.coreModel": "コアモデル",
  "portal.product.howItWorks": "{name}の仕組み",
  "portal.product.operationalDetail":
    "運用の詳細はリポジトリのドキュメントで管理します。ここではプロダクトの境界を定義する概念を示します。",
  "portal.product.currentMaturity": "現在の成熟度",
  "portal.product.relationships": "関係",
  "portal.product.fitsSystem": "大きなシステムへの位置づけ",
  "portal.product.publicWork": "公開中のWork",
  "portal.product.followImplementation": "{name}の実装を追う",
  "portal.product.prefilteredWork":
    "公開中のWorkはこのプロダクトのリポジトリに絞り込まれます。GitHubが唯一の正しい情報源です。",
  "portal.product.openWork": "{name}のWorkを開く",

  "work.title": "公開中のWork · yohn-jp",
  "work.meta.description": "yohn-jp公開リポジトリのWork",
  "work.nav.primary": "主要ナビゲーション",
  "work.nav.home": "yohn-jp開発者ポータルのホーム",
  "work.nav.products": "プロダクト",
  "work.nav.system": "システム",
  "work.nav.work": "Work",
  "work.nav.governance": "ガバナンスの健全性",
  "work.nav.graph": "依存関係グラフ",
  "work.nav.issueIndex": "Issue一覧",
  "work.nav.github": "GitHub ↗",
  "work.nav.menu": "メニュー",
  "work.header.eyebrow": "公開中のWork · GitHub投影",
  "work.header.title": "公開中のWork",
  "work.header.lede":
    "読み取り専用の日次ビュー。GitHubが唯一の正しい情報源です。",
  "work.snapshot.aria": "スナップショットの鮮度",
  "work.snapshot.loading": "スナップショットを読み込み中…",
  "work.snapshot.checking": "最新スナップショットを確認中…",
  "work.snapshot.refresh": "今すぐ更新",
  "work.snapshot.refreshing": "更新中…",
  "work.snapshot.generated": "生成日時：{date}",
  "work.metrics.aria": "Workの主要メトリクス",
  "work.metrics.openIssues": "公開Issue",
  "work.metrics.linkedPullRequests": "リンク済みPull Request",
  "work.metrics.repositories": "リポジトリ",
  "work.metrics.sourcesAttention": "要対応のソース",
  "work.metrics.governanceValid": "ガバナンス有効",
  "work.metrics.governanceInvalid": "ガバナンス無効",
  "work.metrics.governanceUnknown": "ガバナンス不明",
  "work.issues.title": "公開Issue",
  "work.issues.filters.aria": "Issueフィルター",
  "work.filters.view": "ビュー",
  "work.filters.governance": "ガバナンス",
  "work.filters.repository": "リポジトリ",
  "work.filters.sort": "並び順",
  "work.filters.search": "検索",
  "work.filters.searchPlaceholder": "タイトル、プロダクト、ラベル、担当者…",
  "work.repositories.all": "すべてのリポジトリ",
  "work.issues.loading": "Issueを読み込み中…",
  "work.distribution.eyebrow": "補助ビュー",
  "work.distribution.title": "リポジトリのWork量",
  "work.distribution.body":
    "リポジトリ件数は生成されたGitHubの証拠に結びついています。カタログ済みリポジトリからプロダクト境界へ移動できます。",
  "work.distribution.graphLink": "ネイティブ依存関係グラフを見る →",
  "work.distribution.governanceLink": "ガバナンスの健全性を見る →",
  "work.footer.sourceOfTruth": "GitHubが唯一の正しい情報源です。",
  "work.footer.graph": "依存関係グラフ",
  "work.footer.governance": "ガバナンスの健全性",
  "work.footer.portalHome": "ポータルホーム",
  "work.footer.issues": "ポータルのIssue ↗",
  "work.status.snapshotComplete":
    "スナップショット完了 · {count}リポジトリを読み込み済み",
  "work.status.snapshot": "スナップショット：{status}",
  "work.status.snapshotDetail":
    "{count}リポジトリ中{successful}件を読み込み済み；{unavailable}件のIssueでPRリンクが利用できないか不完全です。このビューは不完全なものとして扱ってください。",
  "work.status.rateLimit": " レート制限に達しました。",
  "work.status.issuePrefix": "#{issue} ",
  "work.status.error": "{repository} {issue}（{stage}）：{error}{rateLimit}",
  "work.freshness.noValid": "最終確認：{date} · 有効なスナップショットなし。",
  "work.freshness.checking": "最新スナップショットを確認中…",
  "work.freshness.notChecked": "未確認",
  "work.freshness.snapshotAge": "スナップショットの経過：{age}。",
  "work.freshness.refreshFailed":
    "{checked} · {freshness} 更新に失敗しました。最後に有効だったデータを表示しています。",
  "work.freshness.checked": "最終確認：{date}",
  "work.age.unknown": "経過時間不明",
  "work.age.lessThanMinute": "1分未満",
  "work.age.minute.one": "{count}分前",
  "work.age.minute.other": "{count}分前",
  "work.age.hour.one": "{count}時間前",
  "work.age.hour.other": "{count}時間前",
  "work.updated.unknown": "更新時期不明",
  "work.updated.future": "未来に更新",
  "work.updated.justNow": "たった今更新",
  "work.updated.relative": "更新：{relativeTime}",
  "work.updated.lastUpdated": "最終更新：{date}",
  "work.repository.open": "{count}件公開中",
  "work.repository.unavailable": "データ利用不可",
  "work.pr.linkageUnavailable": "PRリンク利用不可",
  "work.pr.noAuthoritative": "権威あるリンク済みPRなし",
  "work.pr.title": "PR #{number} {title}",
  "work.pr.sameRepository": "同一リポジトリ",
  "work.pr.closedWithoutMerge": "マージなしでクローズ",
  "work.blockers.unavailable": "依存関係データ利用不可",
  "work.blockers.title": "#{number} {title} によりブロック中",
  "work.state.inProgress": "進行中",
  "work.state.ready": "準備済み / 未着手",
  "work.state.needsAttention": "要対応",
  "work.metadata.labels": "ラベル{count}件を追加",
  "work.metadata.milestone": "マイルストーン：{title}",
  "work.issue.aria": "Issueの状態とメタデータ",
  "work.issue.count": "{view}：{total}件中{shown}件",
  "work.issue.noMatches": "現在のフィルターに一致するIssueはありません。",
  "work.governance.filter.all": "すべて",
  "work.governance.filter.valid": "有効",
  "work.governance.filter.invalid": "無効",
  "work.governance.filter.unknown": "不明",
  "work.governance.status.valid": "ガバナンス有効",
  "work.governance.status.invalid": "ガバナンス無効",
  "work.governance.status.unknown": "ガバナンス不明",
  "work.governance.violations.one": "違反{count}件",
  "work.governance.violations.other": "違反{count}件",
  "work.governance.violations.unspecified": "特定できない違反",
  "work.governance.violations.noDetail": "構造化された違反の詳細はありません。",
  "work.load.snapshotUnavailable": "スナップショット利用不可",
  "work.load.failedTitle": "Workデータの読み込みに失敗しました",
  "work.load.noSnapshot":
    "{error}。有効なIssueスナップショットはまだありません。",
  "work.refresh.failedTitle": "スナップショットの更新に失敗しました",
  "work.refresh.lastValid":
    "{error}。最後に有効だったスナップショットを表示しています。",
  "work.view.recent": "最近",
  "work.view.attention": "要対応",
  "work.view.inProgress": "進行中",
  "work.view.ready": "準備済み / 未着手",
  "work.view.all": "すべて",
  "work.sort.updated": "更新が新しい順",
  "work.sort.created": "作成が新しい順",
  "work.sort.oldest": "活動が古い順",
  "work.sort.repository": "リポジトリ順",
  "work.sort.unavailable": "（利用不可）",

  "governance.title": "ガバナンスの健全性 · yohn-jp",
  "governance.meta.description":
    "Inariが投影したIssueデータによる組織レベルのガバナンス健全性",
  "governance.nav.primary": "主要ナビゲーション",
  "governance.nav.home": "yohn-jp開発者ポータルのホーム",
  "governance.nav.products": "プロダクト",
  "governance.nav.system": "システム",
  "governance.nav.work": "Work",
  "governance.nav.governance": "ガバナンスの健全性",
  "governance.nav.graph": "依存関係グラフ",
  "governance.nav.github": "GitHub ↗",
  "governance.nav.menu": "メニュー",
  "governance.header.eyebrow": "組織ガバナンス · Inari投影",
  "governance.header.title": "ガバナンスの健全性。",
  "governance.header.lede":
    "Issueフォームの準拠状況を組織単位で読み取るビューです。すべての件数はInariが投影したガバナンスの証拠に基づき、利用できないデータは不明として表示します。",
  "governance.snapshot.loading": "ガバナンススナップショットを読み込み中…",
  "governance.snapshot.generated": "生成日時：{date}",
  "governance.snapshot.complete": "ガバナンススナップショット完了",
  "governance.snapshot.partial": "ガバナンススナップショット不完全",
  "governance.snapshot.failed": "ガバナンススナップショット失敗",
  "governance.snapshot.unavailable": "ガバナンススナップショット利用不可",
  "governance.snapshot.detail":
    "{repositories}リポジトリ中{available}件にソーススナップショットがあります。ガバナンス不明のIssueは{unknown}件、ソースデータ利用不可のリポジトリは{unavailable}件です。",
  "governance.collection.status.healthy": "ガバナンス収集は正常です",
  "governance.collection.status.degraded": "ガバナンス収集は縮退しています",
  "governance.collection.status.unavailable": "ガバナンス収集は利用できません",
  "governance.collection.detail":
    "正常{healthy}件、縮退{degraded}件、利用不可{unavailable}件のリポジトリです。ガバナンス証拠を利用できないIssueは{issues}件です。",
  "governance.metrics.aria": "ガバナンス準拠の合計",
  "governance.metrics.valid": "有効なIssue",
  "governance.metrics.invalid": "無効なIssue",
  "governance.metrics.unknown": "不明なIssue",
  "governance.dependencies.aria": "Inariが管理する依存関係の集計",
  "governance.dependencies.blocked": "ブロックされているIssue",
  "governance.dependencies.blocking": "ブロックしているIssue",
  "governance.dependencies.unavailable": "依存関係データ利用不可のIssue",
  "governance.dependencies.unresolvedEdges": "未解決のブロッカーエッジ",
  "governance.repositories.eyebrow": "リポジトリの健全性",
  "governance.repositories.title": "準拠状況の所在。",
  "governance.repositories.body":
    "率は有効または無効の証拠が明示されたIssueだけで計算します。不明または利用不可のデータを準拠として数えません。",
  "governance.repositories.empty":
    "利用可能なリポジトリのガバナンスデータはありません。",
  "governance.repository.valid": "有効{count}件",
  "governance.repository.invalid": "無効{count}件",
  "governance.repository.unknown": "不明{count}件",
  "governance.repository.issues": "Issue {count}件",
  "governance.repository.rate": "{rate}",
  "governance.repository.rateLabel": "既知の証拠における準拠率",
  "governance.repository.rateUnavailable": "計算不可",
  "governance.repository.unavailable": "ガバナンスデータ利用不可",
  "governance.repository.collection.healthy": "ガバナンス収集は正常",
  "governance.repository.collection.degraded": "ガバナンス収集は縮退",
  "governance.repository.collection.unavailable": "ガバナンス収集は利用不可",
  "governance.diagnostics.eyebrow": "収集診断",
  "governance.diagnostics.title": "証拠を利用できない理由。",
  "governance.diagnostics.empty": "ガバナンス収集の診断はありません。",
  "governance.diagnostic.count":
    "リポジトリ{repositories}件 · Issue {issues}件",
  "governance.diagnostic.authentication-unavailable": "認証利用不可",
  "governance.diagnostic.insufficient-permissions": "GitHub App権限不足",
  "governance.diagnostic.inari-contract-unavailable":
    "Inari契約の発見または読み取り失敗",
  "governance.diagnostic.evaluator-failed": "予期しないevaluator失敗",
  "governance.diagnostic.repository-source-unavailable":
    "リポジトリソース利用不可",
  "governance.diagnostic.unknown": "原因不明のガバナンス問題",
  "governance.violations.eyebrow": "違反プロファイル",
  "governance.violations.title": "共通する分類とコード。",
  "governance.violations.classification": "分類",
  "governance.violations.code": "コード",
  "governance.violations.count": "{count}",
  "governance.violations.empty": "投影された違反はありません。",
  "governance.issues.eyebrow": "ドリルダウン",
  "governance.issues.title": "確認が必要なIssue。",
  "governance.issues.invalid": "無効",
  "governance.issues.unknown": "不明",
  "governance.issues.empty": "この状態のIssueはありません。",
  "governance.issue.title": "#{number} {title}",
  "governance.load.failedTitle": "ガバナンス健全性の読み込みに失敗しました",
  "governance.footer.sourceOfTruth": "GitHubが唯一の正しい情報源です。",
  "governance.footer.work": "公開中のWork",
  "governance.footer.portalHome": "ポータルホーム",
  "governance.footer.issues": "ポータルのIssue ↗",

  "graph.title": "依存関係グラフ · yohn-jp",
  "graph.meta.description": "yohn-jp公開Issueの依存関係グラフ",
  "graph.nav.primary": "主要ナビゲーション",
  "graph.nav.home": "yohn-jp開発者ポータルのホーム",
  "graph.nav.products": "プロダクト",
  "graph.nav.system": "システム",
  "graph.nav.work": "Work",
  "graph.nav.governance": "ガバナンスの健全性",
  "graph.nav.issueIndex": "Issue一覧",
  "graph.nav.graph": "依存関係グラフ",
  "graph.nav.github": "GitHub ↗",
  "graph.nav.menu": "メニュー",
  "graph.hero.eyebrow": "GitHubネイティブな関係",
  "graph.hero.title": "依存関係グラフ。",
  "graph.hero.body":
    "有向辺はブロッカーからブロックされたWorkへ向きます。関係データはGitHub Issueの依存関係から取得し、文章から辺を推測しません。",
  "graph.filters.aria": "グラフフィルター",
  "graph.filters.repository": "リポジトリ",
  "graph.filters.disconnected": "切断されたIssueを表示",
  "graph.blockers.eyebrow": "ボトルネック",
  "graph.blockers.title": "主要ブロッカー",
  "graph.layout.aria": "Issue依存関係グラフ",
  "graph.empty": "現在のフィルターに一致する依存関係辺はありません。",
  "graph.svg.title": "Issue依存関係グラフ",
  "graph.svg.description":
    "有向辺はブロック元からブロック先のIssueを指します。",
  "graph.detail.eyebrow": "Issue詳細",
  "graph.detail.select":
    "ノードを選択して依存関係のコンテキストを確認してください。",
  "graph.footer.sourceOfTruth": "GitHubが唯一の正しい情報源です。",
  "graph.footer.issueIndex": "Issue一覧",
  "graph.footer.portalHome": "ポータルホーム",
  "graph.status.complete": "依存関係スナップショット完了",
  "graph.status.incomplete": "依存関係スナップショット不完全",
  "graph.status.completeDetail":
    "ネイティブ依存関係辺{count}件を読み込み済み。",
  "graph.status.incompleteDetail":
    "既知の辺{count}件を読み込み済み；{unavailable}件のIssueで依存関係データが利用できないか不完全で、依存関係ソースエラーが{errors}件記録されています。",
  "graph.blockers.none": "現在のビューにブロッキング辺はありません。",
  "graph.blockers.count.one": "{count}件をブロック",
  "graph.blockers.count.other": "{count}件をブロック",
  "graph.pr.implementation": "実装",
  "graph.pr.outsideSnapshot":
    "現在の公開Issueスナップショット外の依存ノードのため、PRリンクは利用できません。",
  "graph.pr.unavailable": "PRリンクは利用できないか不完全です。",
  "graph.pr.noAuthoritative": "権威あるリンク済みPRなし",
  "graph.detail.relations.blocker.one": "ブロッカー{count}件",
  "graph.detail.relations.blocker.other": "ブロッカー{count}件",
  "graph.detail.relations.blocked.one": "ブロックされたIssue {count}件",
  "graph.detail.relations.blocked.other": "ブロックされたIssue {count}件",
  "graph.detail.cycle": "サイクル参加ノード",
  "graph.detail.openGithub": "GitHubで開く ↗",
  "graph.node.aria": "{repository} Issue {number}：{title}",
  "graph.node.outsideOpenSet": "公開集合外",
  "graph.node.cycle": "サイクル",
  "graph.node.pr.one": "PR {count}件",
  "graph.node.pr.other": "PR {count}件",
  "graph.count": "ノード{nodes}件 · 辺{edges}件",
  "graph.load.failedTitle": "依存関係グラフの読み込みに失敗しました"
});

export const MESSAGE_CATALOG = Object.freeze({
  en: ENGLISH_MESSAGES,
  ja: JAPANESE_MESSAGES
});

export const MESSAGES = ENGLISH_MESSAGES;
export const SUPPORTED_LOCALES = Object.freeze(["en", "ja"]);

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

export function preserveLocaleQuery(
  root = globalThis.document,
  currentLocation = globalThis.location
) {
  if (!root?.querySelectorAll || !currentLocation?.href) return;
  for (const anchor of root.querySelectorAll("[data-locale-switch]")) {
    const href = anchor.getAttribute("href");
    if (!href) continue;
    const target = new URL(href, currentLocation.href);
    target.search = currentLocation.search;
    target.hash = currentLocation.hash;
    anchor.setAttribute(
      "href",
      `${target.pathname}${target.search}${target.hash}`
    );
  }
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
  output = output.replace(
    /<([A-Za-z][A-Za-z0-9:-]*)(\s[^>]*?)?>/g,
    (tag, name, attributes = "") => {
      let outputAttributes = attributes;
      for (const match of outputAttributes.matchAll(
        /data-message-(aria-label|content|placeholder)="([^"]+)"/g
      )) {
        const [directive, attribute, key] = match;
        const value = escapeHtml(
          resolveMessage(key, {}, { locale: resolvedLocale })
        );
        const attributePattern = new RegExp(
          `(\\s${attribute}\\s*=\\s*["'])[^"']*(["'])`,
          "i"
        );
        if (attributePattern.test(outputAttributes)) {
          outputAttributes = outputAttributes.replace(
            attributePattern,
            `$1${value}$2`
          );
        } else {
          outputAttributes = outputAttributes.replace(
            directive,
            `${attribute}="${value}" ${directive}`
          );
        }
      }
      return `<${name}${outputAttributes}>`;
    }
  );
  output = output.replace(
    /(<([A-Za-z][A-Za-z0-9:-]*)\b[^>]*\sdata-message="([^"]+)"[^>]*>)[\s\S]*?(<\/\2\s*>)/g,
    (_, opening, tag, key, closing) =>
      `${opening}${escapeHtml(resolveMessage(key, {}, { locale: resolvedLocale }))}${closing}`
  );
  return output;
}
