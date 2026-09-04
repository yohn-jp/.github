# Reusable CodeQL security scanning

`.github/workflows/codeql.yml` is the shared CodeQL contract for `yohn-jp`
repositories: JavaScript/TypeScript and GitHub Actions workflow analysis,
behind least-privilege permissions, immutable SHA-pinned Actions, and a
checkout with `persist-credentials: false` (no credential is left on disk
for later steps to use).

## Consuming it from another repository

```yaml
# .github/workflows/codeql.yml in a consumer repository
name: CodeQL

on:
  push:
    branches: [main]
  pull_request:
  schedule:
    - cron: "43 4 * * 3" # pick your own off-the-hour time

permissions:
  contents: read

jobs:
  analyze:
    uses: yohn-jp/.github/.github/workflows/codeql.yml@main
    with:
      languages: "javascript-typescript,actions" # optional, this is the default
      config-file: ".github/codeql/codeql-config.yml" # optional, default: none
```

This organization-owned reusable workflow intentionally uses `@main`. The
third-party Actions inside the shared implementation remain immutable
SHA-pinned; consumer workflows must apply the same SHA rule to any
third-party `uses:` references they add.

## Inputs

| Input         | Default                         | Purpose                                                                                                                                                                                                                                                                                                                                             |
| ------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `languages`   | `javascript-typescript,actions` | Comma-separated CodeQL language identifiers. Each becomes its own isolated matrix job (`fail-fast: false`), so one language's analysis failure doesn't hide another's results.                                                                                                                                                                      |
| `config-file` | `""` (unset)                    | Optional path to a repository-local CodeQL config file (query filters, path exclusions, etc). When set, it's passed straight through to `github/codeql-action/init`; when empty, CodeQL's default configuration is used for each language. This is how repository-specific scanning differences are expressed — never by duplicating this workflow. |

## Permissions

Kept least-privilege and split by job:

- The `plan` job (splits the `languages` input into a matrix) only needs
  the workflow-level default: `contents: read`.
- The `analyze` job additionally needs `security-events: write` (to
  upload SARIF results) and `actions: read` (required by
  `github/codeql-action` on private repositories). Neither is granted at
  the workflow level, only on the job that actually needs them.

## Triggers

The reusable workflow only reacts to `workflow_call` — it does not declare
its own `push`/`pull_request`/`schedule` triggers for _consumers_; each
consumer repository's own caller workflow (shown above) decides when to
run, including its own scheduled-scan cadence. This repository's copy of
`codeql.yml` additionally declares `push`/`pull_request`/`schedule`
directly on itself, so this repository's own `scripts/*.mjs` and
workflow files are scanned too (dogfooding, not a requirement consumers
need to replicate).

## Provider self-test

This repository's own push/pull_request/schedule triggers on `codeql.yml`
exercise the direct-trigger path only (default languages, no
`config-file`). `self-test-codeql.yml` proves the `workflow_call` contract
itself by calling `./.github/workflows/codeql.yml` with an explicit
`languages` selection and a supplied `config-file`
(`test/fixtures/codeql/codeql-config.yml`), the same way a consumer
repository does. Using a local `uses: ./...` path runs the proof against
the current branch's copy of the workflow, not the version already merged
to `main`.

## Why GitHub Actions workflows are analyzed too

CodeQL's `actions` language identifier analyzes workflow YAML itself for
issues like script-injection via untrusted `${{ }}` expansion into `run:`
steps — exactly the class of problem the SHA-pinning and metadata
validation from #2/#3 address from a different angle (supply-chain
integrity vs. runtime injection). Both are included by default.
