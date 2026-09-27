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
      working-directory: . # optional, default "."
      node-version: "24" # optional, default "24"
      committed-dist: false # optional, default false
      release-docs-fast-path: false # optional, default false
      conformance-script: "" # optional, default "" (disabled)
      package-preparation-command: "" # optional, default ""
```

Then add a branch Ruleset requirement on the `verify` check (the job name
is stable; see below).

## Required package.json scripts

The workflow assumes the target package defines these scripts (run via
`pnpm run <script>` / `pnpm test`, so any implementation is acceptable as
long as the script name and exit-code contract match):

| Script                                         | Used by                                                      |
| ---------------------------------------------- | ------------------------------------------------------------ |
| `format:check`                                 | `format` job                                                 |
| `lint`                                         | `lint` job                                                   |
| `typecheck`                                    | `typecheck` job                                              |
| `test`                                         | `test` job                                                   |
| `build`                                        | `build` job (must write to `dist/`)                          |
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
- **`package-preparation-command`** — when set, runs this consumer-owned
  command instead of the provider's separate build and pack commands. It must
  create exactly one valid package tarball. The default is empty and preserves
  the existing caller behavior.

None of these are detected from the repository name or path; every
behavioral difference between consumers must be one of these inputs.

## Proof ownership and artifact composition

The provider owns ordinary shared quality checks and the stable `verify`
result. Consumers own product-specific package contracts and system
conformance. A caller may compose those proofs beside the reusable workflow;
they remain separate jobs and keep their own required status.

| Proof                                                           | Owner                      | Composition                                                                       |
| --------------------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------- |
| Format, lint, typecheck, unit tests, build, metadata governance | Shared provider            | `typescript-cli-ci.yml`; included in `verify` except documented skips             |
| Product or installed-consumer contract                          | Consumer                   | Use the prepared package artifact output when the consumer test accepts a tarball |
| Kernel, runtime, or system behavior                             | Consumer                   | Call a purpose-built reusable system workflow as a separate job                   |
| Package preparation and installed-package smoke test            | Shared provider by default | Prepare once, publish a revision-bound artifact, then validate those exact bytes  |

`package-preparation-command` is an optional `workflow_call` input. Leaving it
empty preserves existing callers: the provider runs `pnpm run build` followed
by `pnpm pack`. Setting it delegates the complete preparation command to the
consumer, for example `pnpm pack` when the consumer's `prepack` lifecycle hook
owns its build. The command runs in the checked-out consumer revision with
dependencies already installed. It must produce exactly one `.tgz` containing
`dist/`. Lifecycle scripts remain enabled; the provider does not add a second
build or pack command in this mode.

The provider checks out `github.sha`, validates the tarball contents, records
the source SHA and archive SHA-256, and uploads the result as
`typescript-cli-package-<github.sha>`. The `package-validate` job downloads
that artifact from the same workflow run, verifies the source SHA and digest,
then installs and smoke-tests the same tarball bytes. A missing artifact,
revision mismatch, changed bytes, invalid contents, or failed install fails
`package-validate` and therefore fails `verify`. The workflow exposes
`package-artifact-name` as an output so a consumer-owned conformance job can
download the exact package with
`needs.ci.outputs.package-artifact-name`. The ordinary `dist` artifact used by
`committed-dist-check` is also named with `github.sha`.

Example caller composition:

```yaml
jobs:
  ci:
    uses: yohn-jp/.github/.github/workflows/typescript-cli-ci.yml@main
    with:
      package-preparation-command: pnpm pack

  product-conformance:
    needs: ci
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          ref: ${{ github.sha }}
          persist-credentials: false
      - uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1
        with:
          name: ${{ needs.ci.outputs.package-artifact-name }}
          path: ${{ runner.temp }}/package-artifact
      - env:
          PACKAGE_TARBALL: ${{ runner.temp }}/package-artifact/package.tgz
        run: node scripts/check-installed-package.mjs

  linux-system-e2e:
    uses: yohn-jp/.github/.github/workflows/linux-system-e2e.yml@main
    with:
      command: pnpm run test:system
```

This is a provider interface example, not a completed migration of any
consumer. `conformance-script` remains available for source-level conformance
checks. A consumer that wants its product check to reuse the prepared tarball
can move that check to a caller job and download the workflow output.

The package artifact is scoped to one workflow run, has a name containing the
evaluated source SHA, and carries a checksum checked after download. It is not
a trusted cross-run cache. This change adds no cache writes. Runtime cache
misses still follow the setup action's existing acquisition and install paths;
cache correctness is not a prerequisite for a successful check.

## CI measurements and job grouping

The measurements below use completed consumer runs against the current shared
provider before this change. Job wait is the GitHub Actions job `created_at`
to `started_at` interval. Workflow elapsed time is run creation to the last
reported completion; it is a wall-clock path measure, not the sum of parallel
job durations.

| Run                                                                               | Command and setup observations                                                                                                                              | Maximum job wait | Workflow elapsed |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------: | ---------------: |
| [gh-inari PR run](https://github.com/yohn-jp/gh-inari/actions/runs/36305386365)   | `format:check` 19s, `lint` 12s, `typecheck` 11s, `build` 16s, `pnpm test` 121s; per-job runtime setup 17–23s; separate `pnpm run verify` body 211s          |               4s |             231s |
| [Nawabari PR run](https://github.com/yohn-jp/nawabari/actions/runs/36306360202)   | Shared test body 107s; format/lint/typecheck/build bodies 8–11s; per-job runtime setup 8–12s; separate Linux/system and product checks remain consumer jobs |              48s |             172s |
| [Suzukuri push run](https://github.com/yohn-jp/suzukuri/actions/runs/35831393947) | `build` body 3s, `test:package` conformance body 9s, package validation body 3s; `test:package` and `prepack` each invoke the consumer build                |               4s |              66s |

The first two runs show both setup and wait can be material, while the
longest command bodies and consumer-owned checks control the end-to-end path.
The audit samples in Issue #293 also recorded a 61s start wait for a 3s
Shikitari test body and a 109s wait for a 27s Wabachi body. Those samples do
not establish a universal queue bottleneck.

The provider previously ran build in one job, then ran `pnpm pack` in another.
For a package with a build-owning `prepack`, that pack can run the build again;
a consumer `test:package` command can add another build. The new artifact path
prepares the archive once, validates its exact uploaded bytes in a separate
job, and exposes the artifact for a later consumer-owned package check. For a
build-owning `prepack`, setting `package-preparation-command: pnpm pack`
delegates preparation to that lifecycle without a second provider build.
Consumer checks only stop repeating preparation after their migration uses
the output artifact; this provider change does not claim those migrations.

The measurements do not justify a compact fast-check group yet. Setup is
visible (8–23s in these samples), but independent command bodies also run in
parallel, queue wait varies by workflow, and full test/system work dominates
several critical paths. Grouping fast checks would serialize proofs without
evidence that it shortens the end-to-end path. The provider keeps the existing
parallel jobs and their failure visibility.

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

This does not apply to a consumer invoking this reusable
`typescript-cli-ci.yml` workflow with `run-governance` at its default
(`true`): its nested governance job already runs
`.github/workflows/metadata-validation.yml`, which checks out this
repository's exact revision and runs the provider-owned
`scripts/validate-action-pins.mjs` directly against the consumer checkout.
Such a consumer needs no synchronized local copy of the validator; the
sync entry below is for a repository that invokes the Action-pin validator
on its own, outside that reusable-workflow path.

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

For the separate same-repository Prettier stacked-PR autofix, compatible
consumer rollout, fork exclusion, and GitHub App setup, see
[Prettier stacked-PR autofix](prettier-autofix.md). The `format:check` job
above remains unchanged and authoritative.
