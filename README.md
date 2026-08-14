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
