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
    uses: yohn-jp/.github/.github/workflows/typescript-cli-ci.yml@main
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

`skipped` counts as passing so that intentionally-disabled or fast-pathed
jobs (e.g. `conformance` with no `conformance-script`, or the expensive
validation jobs under `release-docs-fast-path`) don't block merges — only an
actual failure does. Actions governance still runs on the fast path.

## Versioning and rollout safety for consumers

Reference this organization-owned reusable workflow by `@main`:

```yaml
uses: yohn-jp/.github/.github/workflows/typescript-cli-ci.yml@main
```

Third-party actions remain pinned to full 40-character commit SHAs; the
provider's own workflow/action files enforce that rule. The shared reusable
workflow callers intentionally use `@main` so the organization authority is
updated centrally. The metadata validator rejects both a SHA-pinned
`yohn-jp/.github` reusable workflow and any moving ref on a third-party Action.

## Keeping the wrapper file and governance script in sync

A consumer repository's `.github/workflows/ci.yml` (etc.) and its
Action-pin governance script are hand-copied once at bootstrap and, absent
this mechanism, silently drift from the organization's canonical version —
see Issue #36 for the incident that motivated this.

A repository can opt in to having some of these files kept in sync by
adding entries to its block in `yohn-jp/.github`'s `.github/sync.yml`,
pointing at the canonical source under `templates/workflows/` and
`scripts/validate-action-pins.mjs`:

```yaml
yohn-jp/<your-repo>:
  - source: templates/workflows/codeql.yml
    dest: .github/workflows/codeql.yml
  - source: templates/workflows/governance.yml
    dest: .github/workflows/governance.yml
  - source: templates/workflows/issue-governance.yml
    dest: .github/workflows/issue-governance.yml
  - source: templates/workflows/publish.yml
    dest: .github/workflows/publish.yml
  - source: scripts/validate-action-pins.mjs
    dest: scripts/validate-action-pins.mjs
```

This pushes directly to your default branch with no PR/review gate
(`SKIP_PR: true`, same as Issue/PR template sync) the moment any of these
files change in `yohn-jp/.github`. Before opting in:

- Verify your existing wrapper's `with:` values match the canonical
  file's (the canonical files omit any input that already equals the
  reusable workflow's own default) — opting in overwrites repo-specific
  `with:` customization on the next sync.
- If you invoke the Action-pin validator under a different script/file
  name (e.g. `scripts/validate-actions.mjs` via a `governance:actions`
  package.json script), update that wiring to point at
  `scripts/validate-action-pins.mjs` and remove the old file — syncing
  the canonical file in alone does not rename or rewire an existing
  invocation.
- If your own validator has repository-specific checks beyond Action-pin
  validation, confirm the canonical script already covers them (or
  propose the addition upstream) before deleting your copy; a silent
  swap can drop a check without either the sync workflow or your CI
  reporting it as a regression.

**`ci.yml` is not yet syncable.** Its `committed-dist` (and, for
non-default working directories, `working-directory`) input is a real
per-repository divergence with no safe canonical default — syncing it
verbatim would clobber that customization. It stays hand-maintained per
consumer until per-target templating or an org-wide policy resolves that.

## How this workflow is itself validated

`.github/workflows/self-test-typescript-cli-ci.yml` calls
`typescript-cli-ci.yml` against the fixture package in
`test/fixtures/ts-cli` with `committed-dist: true` and
`conformance-script: "conformance:contract"` set, so both capabilities run
in CI on every change here, not just the default path.
