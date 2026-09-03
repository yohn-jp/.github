# Organization quality CI contract

This repository owns the provider contract for organization-wide quality CI.
The contract is intentionally separate from repository-specific test
semantics. The machine-readable boundary is
[`.github/quality-ci-contract.yml`](../.github/quality-ci-contract.yml); this
document explains how providers and consumers use it.

## Responsibility boundary

| Provider (`yohn-jp/.github`)                                                        | Consumer repository                                                                |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Reusable workflow names, `workflow_call` schemas, and orchestration                 | Thin caller wrapper and opt-in selection                                           |
| Shared tool versions, action pinning, runner defaults, and deterministic invocation | Commands, config paths, and package-manager scripts                                |
| Lane job plumbing, report/artifact naming, and failure propagation                  | Thresholds, baselines, allowlists, and repository-specific exceptions              |
| Least-privilege permissions and the aggregate status contract                       | Coverage instrumentation, properties/generators, mutation catalog, and replay data |
| Organization policy checks and diagnostics                                          | Integration, runtime, end-to-end, and domain-specific tests                        |

The provider runs commands in the consumer checkout. It must not copy
consumer tests, mutants, properties, coverage paths, or runtime fixtures into
this repository. A consumer-specific exception is configuration supplied to a
workflow input, not a repository-name branch in provider YAML.

## Static-quality lane

The static-quality lane is opt-in. A consumer adds a thin caller and supplies
its package root and a consumer-owned configuration; no repository name is
inspected by the provider.

```yaml
jobs:
  static-quality:
    uses: yohn-jp/.github/.github/workflows/static-quality.yml@main
    with:
      working-directory: .
      execution-mode: pr
      config-file: .github/static-quality.yml
      baseline-file: .github/static-quality-baseline.yml
```

The configuration is YAML with `schema-version: 1` and must declare explicit
`entry-points`, `include` globs, `exclude` globs, `exceptions` lists
(`files`, `exports`, and `dependencies`), and the maintainability limits
`complexity`, `function-size`, `nesting-depth`, and `parameters`. The optional
`file-size` limit is available when appropriate:

```yaml
schema-version: 1
entry-points: [src/index.ts]
include: ["src/**/*.{js,jsx,mjs,cjs,ts,tsx}"]
exclude: [dist/**, coverage/**, generated/**, vendor/**]
exceptions:
  files: []
  exports: []
  dependencies: []
maintainability:
  rules:
    complexity: 10
    function-size: 80
    nesting-depth: 4
    parameters: 4
    file-size: 500
```

The provider's deterministic analyzer reports unreachable files, unreferenced
exports, unused package dependencies, and the configured maintainability
rules. Consumers with an established Knip/ESLint or architecture setup may
set `check-command`; it runs in `working-directory` and emits one JSON
document in `static-quality/v1` format (ESLint JSON and Knip JSON are accepted
directly). The provider normalizes findings into
`file:line:column rule — message`, sorts them, and publishes
`static-quality-report` as an artifact.

For another tool, the adapter can emit
`{"schema-version":1,"findings":[{"kind":"...","rule":"...","file":"src/file.ts","line":1,"column":1,"message":"..."}]}`.
The command's exit status may be non-zero when it found violations; the
provider evaluates the normalized findings and the baseline before deciding
the lane result.

`baseline-file` contains `schema-version: 1` and a `findings` array from a
previous report. Baseline findings are existing debt and are suppressed;
anything not present in the baseline remains blocking. Baselines are
consumer-owned migration records and must be reviewed when exceptions or
thresholds change. Exclude generated, vendor, build, or coverage output with
explicit config globs; do not add provider conditionals keyed to a repository
name.

The provider owns the report contract, deterministic ordering, runner and
failure semantics. Consumers own entry points, paths, thresholds, tool
commands, baselines, and justified exceptions. An exception belongs in the
consumer config so it is reviewable with the code that requires it.

## Reusable workflow boundary

Each lane is an independently callable provider workflow. The canonical
workflow files and capability boundaries are:

| Lane                  | Provider workflow           | Purpose                                                              |
| --------------------- | --------------------------- | -------------------------------------------------------------------- |
| Static quality        | `static-quality.yml`        | Dead/unused code and dependency analysis plus maintainability policy |
| Supply-chain security | `supply-chain-security.yml` | Dependency review and CodeQL integration                             |
| Workflow security     | `workflow-security.yml`     | Action/workflow syntax and security policy                           |
| Test effectiveness    | `test-effectiveness.yml`    | Independently enabled coverage, property, and mutation checks        |

Every provider declares `on.workflow_call.inputs` and
`on.workflow_call.outputs.status` explicitly. Common inputs are:

| Input               | Type     | Default | Meaning                                                                    |
| ------------------- | -------- | ------- | -------------------------------------------------------------------------- |
| `working-directory` | `string` | `.`     | Consumer package root, when the lane operates on a package                 |
| `execution-mode`    | `string` | `pr`    | `pr`, `main`, or `nightly`; expensive capabilities may be disabled in `pr` |

Lane-specific inputs are listed in the machine-readable contract. Empty
command/configuration inputs mean that capability is disabled only when the
lane documents that behavior; enabling a capability without its required
consumer input must fail explicitly. Providers may add inputs, but must not
silently infer repository identity or semantics.

The `status` output is a diagnostic value (`success`, `skipped`, or `failure`)
for callers that need it. The aggregate caller also receives the normal
reusable-job result and must treat an unavailable, cancelled, or failed lane
as a failure; skipped is passing only when the lane was intentionally
disabled by configuration or execution mode.

## Stable aggregate status

The aggregate caller owns one externally required job:

```yaml
jobs:
  quality:
    name: quality
    if: always()
    # needs: all selected quality lanes
```

`quality` is the Rulesets-facing status. Rulesets require this status, never a
lane's internal job name. The aggregate checks every selected lane result and
fails closed for `failure`, `cancelled`, `timed_out`, or `action_required`.
Internal lane jobs may be added, removed, or renamed without changing this
status. A lane that is not selected is explicitly `skipped`, and does not
block the aggregate. The aggregate workflow is integrated and rolled out by
the consumer-integration issue; this issue defines only the seam.

The quality aggregate is complementary to
[`typescript-cli-ci.yml`](../.github/workflows/typescript-cli-ci.yml), whose
existing `verify` status remains authoritative for format, lint, typecheck,
tests, build, package validation, and its governance path. Quality lanes must
not duplicate those checks merely to obtain a second status. Existing
governance, publish, CodeQL, and sync workflows remain compatible; migration
consists of adding a thin caller and removing only a consumer-owned duplicate
when the integration issue verifies equivalent coverage.

## Permissions and execution

All lanes default to:

```yaml
permissions:
  contents: read
```

The supply-chain lane may request `pull-requests: read` for dependency review.
No lane receives write permissions by default. A capability needing a
write-scoped permission (the CodeQL SARIF upload is the known example) must
isolate `security-events: write` to its own analysis job and document why it is
required; it must never become a workflow-wide default. Third-party Actions
remain pinned to full commit SHAs; calls to this organization’s reusable
workflows use `@main` according to the existing provider policy.

Repositories are single-OS by default and lanes use `ubuntu-latest`. The
contract adds no OS matrix. A future repository that genuinely needs another
runner must opt in explicitly in its own caller and document the exception.

## Execution modes

Consumers should select lanes according to cost and signal:

- `pr`: deterministic fast checks and bounded mutation/property work;
- `main`: the same required checks after merge, with broader coverage where
  configured;
- `nightly`: expensive full mutation/property runs and scheduled deep scans.

The test-effectiveness provider requires a replay seed or equivalent
deterministic replay information whenever randomized property generation is
enabled. Mutation commands and catalogs remain consumer-owned; full mutation
is not required on every pull request.

## Provider self-test

`self-test-quality-ci-contract.yml` runs the provider validator and malformed
configuration fixtures on every provider pull request. The validator checks
the lane set, explicit input declarations/defaults, `status` outputs,
least-privilege permissions, stable aggregate result policy, and forbidden
repository-name/matrix coupling. Lane-specific provider workflows add their
own pass/fail and execution tests. This layered approach catches invalid
wiring before a consumer rollout without importing consumer test semantics
into the provider.

The same self-test workflow executes the static-quality lane against the clean
provider fixture. Its unit fixtures cover pass, blocking findings, baseline
suppression with regression detection, explicit exceptions, and malformed
consumer configuration.
