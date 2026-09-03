# Reusable test-effectiveness contract

`.github/workflows/test-effectiveness.yml` is the organization-owned reusable
workflow for three independently selectable capabilities:

- coverage with an explicit regression gate;
- property-based tests, with deterministic replay information for randomized
  generation;
- mutation testing with an event-selected budget.

The provider owns orchestration, input validation, time bounds, stable status,
and report collection. A consumer owns its commands, instrumentation,
baselines, generators, properties, mutation catalogue, thresholds, and
domain-specific exceptions. The provider does not select a test tool or copy
repository-specific paths or semantics into this repository.

## Consumer invocation

The caller owns triggers and passes the repository-local commands and paths.
The organization workflow reference is `@main`; third-party Actions in the
caller remain subject to the organization pinning policy.

```yaml
name: Test effectiveness

on:
  pull_request:
  push:
    branches: [main]
  schedule:
    - cron: "23 3 * * 1"

permissions:
  contents: read

jobs:
  test-effectiveness:
    uses: yohn-jp/.github/.github/workflows/test-effectiveness.yml@main
    with:
      working-directory: .
      execution-mode: pr # main on push, nightly on schedule
      install-command: pnpm install --frozen-lockfile

      coverage-enabled: true
      coverage-command: pnpm test:coverage
      coverage-regression-command: pnpm test:coverage:regression
      coverage-baseline-path: quality/coverage-baseline.json
      coverage-report-path: quality/coverage-report.json
      coverage-config-path: quality/coverage.config.json

      property-enabled: true
      property-command: pnpm test:property
      property-randomized: true
      replay-seed: "consumer-fixed-seed-2026-01"
      property-replay-command: pnpm test:property:replay
      property-report-path: quality/property-report.json
      property-config-path: quality/property.config.json

      mutation-enabled: true
      mutation-command: pnpm test:mutation
      mutation-timeout-seconds: 600
      mutation-report-path: quality/mutation-report.json
      mutation-config-path: quality/mutation.config.json
```

All capabilities default to disabled. Enabling coverage requires both a
report-producing command and a separate regression command plus a checked-in
baseline. This makes the gate regression-oriented; a provider-wide global
percentage is not imposed. Enabling property or mutation testing requires its
command and report path. Optional configuration paths must refer to existing
files in the consumer workspace. Missing or malformed enabled inputs fail in
the `plan` job before any consumer test command runs.

The provider resolves the consumer revision once in `plan`: a
`pull_request` caller uses `github.event.pull_request.head.sha`, while every
other supported caller uses `github.sha`. Coverage, property, and mutation
jobs pass that exact SHA to `actions/checkout`; they do not rely on the
checkout action's default merge ref. Each job records `git rev-parse HEAD` as
`consumerSha` in its manifest.

## Execution modes

`execution-mode` is explicit and must match the caller event. The mutation
command receives `MUTATION_MODE`, allowing the consumer's existing tool and
catalogue to choose the appropriate scope:

| Caller event            | Mode           | Recommended use                                        |
| ----------------------- | -------------- | ------------------------------------------------------ |
| `pull_request`          | `pr-bounded`   | Fast, bounded mutation subset and deterministic checks |
| `push` to the main line | `main-full`    | Full mutation and post-merge regression checks         |
| `schedule`              | `nightly-deep` | Broader mutation/property exploration and diagnostics  |
| `workflow_dispatch`     | `main-full`    | Explicit operator rerun or investigation               |

Callers pass `pr`, `main`, or `nightly`, respectively. Full mutation is not
required on every pull request; if mutation is enabled there, the provider
still supplies only the bounded `pr-bounded` mode. The mutation command is
terminated after `mutation-timeout-seconds`, which prevents an accidental
unbounded PR run while leaving catalogue and tool selection with the
consumer.

## Determinism and diagnostics

When `property-randomized` is true, `replay-seed` (or the compatibility alias
`property-seed`) and `property-replay-command` are required. The provider
exports `PROPERTY_SEED`, `REPLAY_SEED`, `PROPERTY_REPLAY_COMMAND`, and
`PROPERTY_CONFIG_PATH` to the consumer command and records them in the
manifest. The consumer command must honor that interface; the provider cannot
infer generator semantics.

Each enabled capability uploads a stable artifact:

- `test-effectiveness-coverage`;
- `test-effectiveness-property`;
- `test-effectiveness-mutation`.

Artifacts contain the consumer report and a JSON `run.json` manifest with the
schema version, capability, event, commit, run attempt, command/configuration
paths, result, the actual checked-out `consumerSha`, and (for
mutation/property) selected mode or replay data. This
makes a failed run diagnosable and identifies the exact command and revision
needed for reproduction. Report and configuration paths must be relative to
`working-directory`; absolute and parent-traversing paths are rejected. Do
not put credentials in command strings because command metadata is stored in
the manifest.

The reusable workflow exposes `status` through its `verify` job. It passes only
when the plan and every enabled capability succeeds; disabled capabilities are
skipped. Failure, cancellation, timeout, or an unknown result fails closed.
Require this stable status (or the consumer's organization quality aggregate)
in repository Rulesets rather than depending on internal capability job names.

Existing repository-specific property, coverage, and mutation infrastructure
can be called directly. This contract does not require replacing a mature
tool with a third-party implementation.

The provider's `self-test-quality-ci-contract.yml` runs the contract tests on
every provider pull request, including mode selection, independent capability
wiring, deterministic replay requirements, and fail-closed status behavior.
