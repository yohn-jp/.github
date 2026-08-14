# .github

Organization-wide GitHub metadata defaults, reusable workflows, and
repository metadata validation for the `yohn-jp` organization.

See [`docs/github-metadata-inheritance.md`](docs/github-metadata-inheritance.md)
for what is inherited by other repositories, what is not, and how to
override a default intentionally.

## Metadata validation

```sh
pnpm install
pnpm run validate   # Issue Form structure + Action SHA pinning
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
