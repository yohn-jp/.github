# Portal work relationship projection

`dev.yohn.jp/work/` is a read-only projection of GitHub work state.

## Authorities

- Repository and open Issue metadata: GitHub REST API.
- Issue blocker/blocking relationships: the Inari-governed dependency
  projection (see [Blocker projection](#blocker-projection) below). GitHub's
  native Issue dependency REST endpoints remain visible only as observed
  state; they are never the source of blocked/blocking classification.
- Issue to PR implementation linkage: GitHub GraphQL `Issue.closedByPullRequestsReferences` with closed PRs included.

The portal does not infer dependency or implementation relationships from Issue/PR titles or arbitrary Markdown.

## Blocker projection

Inari remains the semantic authority for Issue dependencies. Its governed
Issue projection (the same evidence used for `governance.valid`) carries a
`dependencies` object — `blockedBy`/`blocks`, each entry a
`{ repositoryHost, repositoryId, repository, number }` identity — only when
the Issue's canonical body validates. The portal never parses dependency
declarations out of Issue prose or the reserved Inari body marker itself; it
only reads the value Inari already validated and projected.

Each Issue carries a `relationships.blockers` record:

- `status`: `"available"` when Inari projected a dependency value for this
  Issue, `"unavailable"` otherwise. Dependencies are only ever exposed for
  valid Inari governance, so an Issue with invalid or unavailable governance
  also has an unavailable blocker projection — this is the same fail-closed
  evidence gap, not a second failure model. Unavailable is never read as
  "not blocked".
- `blockedBy` / `blocking`: every declared reference, hydrated with the
  repository, Issue number, title/state when the portal could read the
  referenced Issue, and a navigable GitHub URL. A reference the portal could
  not resolve or fetch keeps `resolved: false` (fail closed) rather than
  being dropped.
- `blocked`: `true` when at least one `blockedBy` reference is not resolved
  (its Issue is not `closed`).
- `blockingActive`: `true` when this Issue is itself open and at least one
  `blocking` reference is not resolved.

Cross-repository blocker references are preserved as-is; the blocking
Issue's repository is never collapsed into the blocked Issue's repository.
A blocker becomes resolved the moment GitHub reports its Issue `closed` —
Portal never keeps an Issue blocked on a closed blocker.

`Needs attention` includes `blocked-by-dependency` (unresolved `blockedBy`),
`blocking-dependent-work` (this Issue itself blocks unresolved work), and
`dependency-projection-unavailable`, alongside the existing governance
reasons. The generated `governanceHealth.dependencies` projection exposes
`blockedIssues`, `blockingIssues`, `unavailableIssues`, and
`unresolvedEdgeCount` — the last deduplicated by directed edge identity so a
relationship declared from both the blocked and the blocking Issue is never
counted twice.

## Pull request linkage states

Each open Issue carries a `relationships.pullRequests` record with explicit collection status and authoritative linked PRs when available. PR state is normalized as:

- `open`: PR remains open.
- `merged`: PR merged; `mergedAt` is retained when GitHub supplies it.
- `closed`: PR closed without merge.
- `unknown`: GitHub returned a state outside the supported normalization.

Linked PR identity always preserves repository, PR number, canonical URL, title, and state. Cross-repository links are not collapsed into the Issue repository.

`unavailable` and `partial` relationship status mean the portal could not prove the complete linkage set. They are never rendered as authoritative absence.

## Authentication boundary

The workflow's built-in `GITHUB_TOKEN` belongs to the `.github` repository and is not treated as organization-wide read authority. The preferred complete path is a short-lived installation token from a dedicated read-only GitHub App installed on the repositories derived from `portal/registry.json`. The workflow exposes that token only to the build process as `PORTAL_GITHUB_TOKEN`.

If the App is not configured, REST requests for public repository/Issue/dependency data run unauthenticated. GitHub GraphQL requires authentication, so Issue→PR linkage is then reported as unavailable and the snapshot remains explicitly incomplete rather than inferring links.

Browser assets receive only generated projection data and never receive the App private key, installation token, repository `GITHUB_TOKEN`, or a direct GitHub GraphQL credential path. See [portal authentication](portal-auth.md) for setup and permission scope.
