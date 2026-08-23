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
repositories configured in
[`dashboard/repositories.json`](dashboard/repositories.json).

[`portal/products.json`](portal/products.json) is the versioned source for
product metadata repeated across the portal: stable product identity, role,
repository, concise summary/status, responsibility boundaries, and typed
cross-product relationships. `scripts/product-catalog.mjs` validates this file
and the Pages build fails on malformed, duplicate, self-referential, or unknown
relationship data. Repository READMEs and docs remain authoritative for actual
CLI/API/release behavior; the portal catalog is a curated navigation and
responsibility projection, not a replacement documentation authority.

`pnpm run dashboard:build` generates the disposable `site/` Pages artifact:
portal assets at the root, validated product data under `site/data/`, the issue
dashboard under `site/work/`, and generated issue data under
`site/work/data/`. `portal/CNAME` is copied to the artifact root so the intended
`dev.yohn.jp` custom domain remains explicit in repository source and published
output. Repository Pages settings and DNS remain external configuration.

[`dashboard-pages.yml`](.github/workflows/dashboard-pages.yml) builds and
deploys the portal on relevant changes, on a schedule, or by manual dispatch.
The build uses the Actions token only while collecting public GitHub REST data;
browser assets receive no GitHub credential. Partial and failed source requests
remain visible in the work dashboard rather than being presented as complete.

Configure GitHub Pages with **GitHub Actions** as the source and set the
repository custom domain to `dev.yohn.jp`. DNS should point that subdomain at
the GitHub Pages host for the organization.
