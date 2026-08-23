# Portal work relationship projection

`dev.yohn.jp/work/` is a read-only projection of GitHub work state.

## Authorities

- Repository and open Issue metadata: GitHub REST API.
- Issue dependency edges: GitHub-native Issue dependency REST endpoints.
- Issue to PR implementation linkage: GitHub GraphQL `Issue.closedByPullRequestsReferences` with closed PRs included.

The portal does not infer dependency or implementation relationships from Issue/PR titles or arbitrary Markdown.

## Pull request linkage states

Each open Issue carries a `relationships.pullRequests` record with explicit collection status and authoritative linked PRs when available. PR state is normalized as:

- `open`: PR remains open.
- `merged`: PR merged; `mergedAt` is retained when GitHub supplies it.
- `closed`: PR closed without merge.
- `unknown`: GitHub returned a state outside the supported normalization.

Linked PR identity always preserves repository, PR number, canonical URL, title, and state. Cross-repository links are not collapsed into the Issue repository.

`unavailable` and `partial` relationship status mean the portal could not prove the complete linkage set. They are never rendered as authoritative absence.

## Authentication boundary

The Pages build uses the GitHub Actions token server-side while generating the static JSON snapshot. Browser assets receive only generated projection data and never receive the token or call the GitHub GraphQL API directly.
