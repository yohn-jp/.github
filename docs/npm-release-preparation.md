# Reusable npm release preparation

`.github/workflows/npm-release-prepare.yml` is the shared pre-publication
workflow for `yohn-jp` npm packages. It turns an explicit release intent and
an exact caller source revision into one verified, governed
`release/<version>` pull request. It never publishes.

## Boundary with `npm-publish.yml`

| Step                                               | Owner                                                       |
| -------------------------------------------------- | ----------------------------------------------------------- |
| Release-history interpretation, version projection | published `gh-inari` (`inari release prepare`)              |
| Version-bearing files, release document, `verify`  | published `gh-inari` (`inari release prepare`)              |
| Release PR body                                    | published `gh-inari` (`inari pr render --template release`) |
| Idempotent release PR creation / reuse             | published `gh-inari` (`inari pr publish`)                   |
| Exact checkout, Inari resolution, commit, push     | `npm-release-prepare.yml` (orchestration only)              |
| Merge of the release PR                            | human reviewers under PR governance                         |
| `v<version>` tag and GitHub Release                | maintainers, after merge                                    |
| npm publication (Trusted Publishing / OIDC)        | `npm-publish.yml`, triggered by the published Release       |

```text
workflow_dispatch (intent) -> npm-release-prepare.yml -> release/<version> PR
  -> review + merge -> immutable v<version> GitHub Release -> npm-publish.yml
```

`npm-release-prepare.yml` requests only `contents: write` and
`pull-requests: write`. It declares no secrets, requests no `id-token`, and
contains no `npm publish`, tag, or GitHub Release operation.

## Consuming it from another repository

The canonical wrapper `templates/workflows/release-prepare.yml` is distributed
through `.github/sync-groups.yml` (the generated `.github/sync.yml` must not
be hand-edited):

```yaml
on:
  workflow_dispatch:
    inputs:
      release-intent:
        required: true
        type: string

permissions:
  contents: read

jobs:
  prepare:
    if: github.ref == format('refs/heads/{0}', github.event.repository.default_branch)
    uses: yohn-jp/.github/.github/workflows/npm-release-prepare.yml@main
    with:
      source-revision: ${{ github.sha }}
      release-intent: ${{ inputs.release-intent }}
    permissions:
      contents: write
      pull-requests: write
```

Inputs:

| Input             | Required | Meaning                                                                |
| ----------------- | -------- | ---------------------------------------------------------------------- |
| `source-revision` | yes      | Exact 40-character caller commit SHA; must be the default-branch head. |
| `release-intent`  | yes      | `patch`, `minor`, `major`, or an exact semantic version.               |
| `node-version`    | no       | Node.js version for install and verification (default `24`).           |

Outputs: `source-revision`, `inari-version`, `inari-integrity`,
`target-version`, `release-branch`, `release-head-revision`,
`pull-request-url`. The same identities are written to the job summary.

The caller repository must satisfy the repository contract of the resolved
`gh-inari` release (its version-bearing files, `docs/releases/`, and the
`pnpm run verify` entry point). The workflow does not add, rename, or
override any of them; an unsupported repository shape fails closed inside
`inari release prepare`.

## Run sequence

1. Fail closed unless the caller runs on its default branch at exactly
   `source-revision` (nothing is checked out for a pull-request or other
   ref); check out that revision and record it.
2. Install the caller's dependencies with the shared `setup-node-pnpm` action.
3. Resolve `gh-inari@latest` from the npm registry, require at least the
   first release carrying the release-preparation surface (`0.18.0`), install
   that exact version, and record its version, tarball, and integrity.
4. Run `inari release prepare <intent>`. Inari reads governed history from
   the caller's default branch, fails closed unless that head is
   `source-revision`, writes the version-bearing files and
   `docs/releases/<version>.md`, and runs `pnpm run verify`.
5. Commit only the paths Inari reported (any other change fails closed) and
   reconcile `release/<version>`:
   - absent: push the prepared commit;
   - present and its single parent is `source-revision` with the identical
     prepared tree: reuse it unchanged (exact retry);
   - anything else: fail closed without overwriting.
6. Render the release PR body with `inari pr render --template release` and
   publish it with `inari pr publish` using Inari's
   `createReleasePrPublicationRequest`. Inari returns the existing exact PR on
   retry and fails closed on an ambiguous or conflicting PR.

## Token note

The run uses the caller's `GITHUB_TOKEN`. GitHub does not start
`pull_request` workflows for pull requests or pushes made with that token, so
re-run or re-trigger the release PR's required checks before merge.
