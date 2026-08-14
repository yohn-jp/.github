# Reusable TypeScript CLI CI

`.github/workflows/typescript-cli-ci.yml` is the shared CI contract for
`yohn-jp` TypeScript CLI repositories: format, lint, typecheck, test,
Actions/Issue-Form governance validation, build, and packed-package
validation, behind one stable `verify` required status.

## Consuming it from another repository

```yaml
# .github/workflows/ci.yml in a consumer repository
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  ci:
    uses: yohn-jp/.github/.github/workflows/typescript-cli-ci.yml@<pinned-commit-sha>
    with:
      working-directory: .          # optional, default "."
      node-version: "22"            # optional, default "22"
      committed-dist: false         # optional, default false
      release-docs-fast-path: false # optional, default false
      conformance-script: ""        # optional, default "" (disabled)
```

Then add a branch Ruleset requirement on the `verify` check (the job name
is stable; see below).

## Required package.json scripts

The workflow assumes the target package defines these scripts (run via
`pnpm run <script>` / `pnpm test`, so any implementation is acceptable as
long as the script name and exit-code contract match):

| Script | Used by |
| --- | --- |
| `format:check` | `format` job |
| `lint` | `lint` job |
| `typecheck` | `typecheck` job |
| `test` | `test` job |
| `build` | `build` job (must write to `dist/`) |
| `<conformance-script>` (name of your choosing) | `conformance` job, only if `conformance-script` input is set |

## Capabilities (explicit inputs, never repo-name branching)

- **`committed-dist`** — when `true`, an additional `committed-dist-check`
  job rebuilds and diffs against the committed `dist/`, failing if they
  differ. Use for repositories that commit build output (e.g. so the
  package works via `npx github:org/repo` without a build step).
- **`release-docs-fast-path`** — when `true`, pull requests whose entire
  changed-file set matches `docs-path-patterns` (default: `docs/**`,
  `**/*.md`, `CHANGELOG.md`) skip format/lint/typecheck/test/build/package
  validation and run only governance validation. Push events always run
  the full pipeline — there is no base commit to diff a push against, so
  the fast path never applies there. The docs-only match itself is
  implemented in `scripts/is-docs-only-change.mjs` (unit tested in
  `test/is-docs-only-change.test.mjs`), not duplicated inline in YAML.
- **`conformance-script`** — set to a package.json script name to add an
  explicit conformance-validation job (e.g. checking CLI output against a
  documented contract). Empty (default) skips the job entirely rather than
  running a no-op, so `needs.conformance.result` is `skipped`, which the
  `verify` job treats as passing.
- **`run-governance`** — disables the nested governance job if a consumer
  already runs `metadata-validation.yml` separately. Defaults to `true`.

None of these are detected from the repository name or path; every
behavioral difference between consumers must be one of these inputs.

## CI efficiency: why jobs aren't merged

`format`, `lint`, `typecheck`, `test`, and `build` remain separate parallel
jobs — each still does its own checkout and install — rather than being
merged into one sequential job. Merging would remove real failure
isolation (a lint failure would mask whether tests also fail) and would
serialize work that current runners parallelize for free. The actual
repeated cost this avoids is dependency *download* time, not setup steps:
every job installs through `.github/actions/setup-node-pnpm`, which uses
`actions/setup-node`'s built-in pnpm cache keyed on the lockfile hash, so
`pnpm install --frozen-lockfile` in the 2nd through Nth job of a run is a
cache hit rather than a network fetch. This keeps isolation and
parallelism while cutting the actual wasted work.

## The stable `verify` required status

The workflow's last job is always named `verify` (job id `verify`). It
depends on every other job, runs with `if: always()`, and fails if any
dependency's result is neither `success` nor `skipped`. Point a Repository
Ruleset's required-status-check at `verify` (not at `format`, `lint`, or
any other internal job name): internal job topology can grow, shrink, or
be renamed in a future revision of this workflow without breaking Ruleset
enforcement, because `verify` never changes shape from the outside.

`skipped` counts as passing so that intentionally-disabled or
fast-pathed jobs (e.g. `conformance` with no `conformance-script`, or the
whole pipeline under `release-docs-fast-path`) don't block merges — only
an actual failure does.

## Versioning and rollout safety for consumers

Always reference this workflow (and the composite actions/other reusable
workflows it in turn uses) by full 40-character commit SHA:

```yaml
uses: yohn-jp/.github/.github/workflows/typescript-cli-ci.yml@8f2c1e...
```

Never pin to a branch (`@main`) or a floating tag. A defect introduced
here must not instantly break every consumer — bumping the pinned SHA in
each consumer repository, reviewed like any other dependency update, is
the deliberate and only supported update path. This repository's own
`scripts/validate-action-pins.mjs` (see #2 /
`docs/github-metadata-inheritance.md`) enforces the same rule on every
`uses:` in this repository's own workflows, including the ones this
document describes.

## How this workflow is itself validated

`.github/workflows/self-test-typescript-cli-ci.yml` calls
`typescript-cli-ci.yml` against the fixture package in
`test/fixtures/ts-cli` with `committed-dist: true` and
`conformance-script: "conformance:contract"` set, so both capabilities run
in CI on every change here, not just the default path.
