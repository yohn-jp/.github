# .github

Organization-wide GitHub metadata defaults, reusable workflows, and
repository metadata validation for the `yohn-jp` organization.

See [`docs/github-metadata-inheritance.md`](docs/github-metadata-inheritance.md)
for what is inherited by other repositories, what is not, and how to
override a default intentionally.

## Metadata validation

```sh
pnpm install
pnpm run validate   # Issue Form structure + Action reference policy + canonical Inari JSON formatting
pnpm test           # unit tests, including the flow-mapping regression fixture
```

The same checks run in CI via
[`.github/workflows/metadata-validation.yml`](.github/workflows/metadata-validation.yml),
which other repositories can also call as a reusable workflow.

## Reusable TypeScript CLI CI

See [`docs/typescript-cli-ci.md`](docs/typescript-cli-ci.md) for the
`.github/workflows/typescript-cli-ci.yml` contract, its capability inputs
(`committed-dist`, `release-docs-fast-path`, `conformance-script`), and the
stable `verify` required-status gate consumer Rulesets should point at.

## Organization quality CI

See [`docs/quality-ci.md`](docs/quality-ci.md) for the provider/consumer
boundary, explicit lane interfaces, least-privilege permissions, and stable
`quality` aggregate status for the independently composed quality lanes.

## Reusable CodeQL

See [`docs/codeql.md`](docs/codeql.md) for the
`.github/workflows/codeql.yml` contract: JavaScript/TypeScript and GitHub
Actions analysis, least-privilege permissions, and the `config-file` input
for repository-specific CodeQL configuration without duplicating the
workflow.

## PR and Issue governance

See [`docs/governance.md`](docs/governance.md) for
`.github/workflows/pr-governance.yml` and
`.github/workflows/issue-governance.yml`. Both delegate Issue/PR content
contract validation to the published `yohn-jp/gh-inari` CLI (pinned to an
exact version) rather than redefining that authority here; this repository
only owns branch-name validation and the GitHub-side labeling/commenting
plumbing.

## Reusable npm publishing

See [`docs/npm-publish.md`](docs/npm-publish.md) for
`.github/workflows/npm-publish.yml`: release-tag/version verification,
packed-tarball smoke testing across a Node-version matrix, and idempotent
publishing via npm Trusted Publishing (OIDC) — no long-lived npm token.

## Developer portal and public work dashboard

`portal/` defines the static landing page for `https://dev.yohn.jp/`, including
the product responsibility map and concise product boundaries. The read-only
cross-repository dashboard remains defined in `dashboard/`, with source
repository collection derived from the portal registry.

[`portal/registry.json`](portal/registry.json) is the versioned canonical source
for product identity, repository mappings, collection scope, role, concise
summary/status, responsibility boundaries, and typed cross-product
relationships. `scripts/portal-registry.mjs` validates it and derives both the
product catalog and dashboard repository configuration. `scripts/product-catalog.mjs`
validates the catalog projection
and the Pages build fails on malformed, duplicate, self-referential, or unknown
relationship data. Repository READMEs and docs remain authoritative for actual
CLI/API/release behavior; the portal catalog is a curated navigation and
responsibility projection, not a replacement documentation authority.

The work read model keeps GitHub authoritative. Open Issue/repository metadata
and native Issue dependency edges are collected from GitHub REST APIs. Issue to
implementing/linked PR relationships come from GitHub GraphQL
`Issue.closedByPullRequestsReferences` with closed PRs included, so open,
merged, and closed-without-merge implementation states remain distinguishable.
No dependency or implementation relationship is inferred from title or
free-form Markdown. Missing or failed relationship reads remain explicit as
unavailable/partial data.

`pnpm run dashboard:build` generates the disposable `site/` Pages artifact:
portal assets at the root, validated product data under `site/data/`, the issue
dashboard under `site/work/`, the native dependency graph under
`site/work/graph/`, and generated work data under `site/work/data/`.
`portal/CNAME` is copied to the artifact root so the intended `dev.yohn.jp`
custom domain remains explicit in repository source and published output.
Repository Pages settings and DNS remain external configuration.

[`dashboard-pages.yml`](.github/workflows/dashboard-pages.yml) builds and
deploys the portal on relevant changes, on a schedule, or by manual dispatch.
Organization-wide authenticated collection uses an optional short-lived GitHub
App installation token exposed only as `PORTAL_GITHUB_TOKEN` during the build;
the repository-scoped workflow `GITHUB_TOKEN` is not treated as cross-repository
authority. Without App credentials, public REST collection remains available
without authentication while GraphQL PR linkage is explicitly unavailable.
Browser assets receive no GitHub credential. See
[`docs/portal-auth.md`](docs/portal-auth.md) and
[`docs/portal-work-links.md`](docs/portal-work-links.md).

Configure GitHub Pages with **GitHub Actions** as the source and set the
repository custom domain to `dev.yohn.jp`. DNS should point that subdomain at
the GitHub Pages host for the organization.
