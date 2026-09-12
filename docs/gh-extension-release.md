# Reusable precompiled GitHub CLI extension release

`.github/workflows/gh-extension-release.yml` is the shared release-triggered
publishing contract for precompiled [GitHub CLI extensions](https://docs.github.com/en/github-cli/github-cli/creating-github-cli-extensions#precompiled-binaries):
checkout the exact Release/tag source revision, run the consumer's own
version-controlled build entrypoint, verify the resulting artifacts, run the
optional certification gate against those exact artifacts, and upload them to
that already-existing GitHub Release.

The workflow takes no caller-controlled command to execute. It calls a
fixed, version-controlled entrypoint script the consumer commits at
`scripts/build-gh-extension-release.sh`; that script owns build
implementation end-to-end — language/toolchain setup, dependency install,
build, and cross-platform strategy. This workflow owns only invoking that
fixed entrypoint, the GitHub CLI precompiled-extension artifact naming
contract, generic pre-upload validation, and the Release upload. It does not
know about, or branch on, any specific consumer repository or language.

## Consuming it from another repository

```yaml
# .github/workflows/release-extension.yml in a consumer repository
name: Release precompiled extension

on:
  release:
    types: [published]

jobs:
  precompiled-extension:
    permissions:
      contents: write
    uses: yohn-jp/.github/.github/workflows/gh-extension-release.yml@main
    with:
      release-tag: ${{ github.event.release.tag_name }}
```

```sh
# scripts/build-gh-extension-release.sh in the consumer repository
#!/bin/bash
set -euo pipefail

# Consumer-owned: language/toolchain setup, dependency install, build, and
# cross-platform strategy — Go cross-compilation, a Node/TypeScript packager
# (e.g. Node single executable applications, `pkg`, `nexe`, a Bun compile),
# or anything else. Must write each finished binary directly into
# $ARTIFACT_DIR, already named per the contract below.
npm ci
npm run build:binaries -- --out "$ARTIFACT_DIR"
```

This script is the entire build contract: the shared workflow always runs
`scripts/build-gh-extension-release.sh` (relative to `working-directory`)
exactly once via `bash`, with no per-platform invocation and no
build-toolchain variables (no `GOOS`/`GOARCH`) injected into it. Everything
about how many platforms it targets and how is entirely up to this script.

The workflow sets `ARTIFACT_DIR` to a dedicated directory under the runner's
temporary storage, removes and recreates that directory before the build, and
uses the same directory for verification and upload. It is intentionally
separate from the repository workspace, so a consumer may use a local
`dist/` directory for normal build output without affecting release artifact
discovery.

npm publishing (if the same repository also ships an npm package) is a
separate job/workflow calling `npm-publish.yml`, run independently from the
same Release — this workflow never merges with, or depends on, that one.

## Inputs

| Input                               | Required | Default         | Purpose                                                                                                                                                |
| ----------------------------------- | -------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `release-tag`                       | yes      | —               | Exact Release/tag to check out, build from, and upload assets to.                                                                                      |
| `working-directory`                 | no       | `.`             | Directory containing the extension source, `scripts/build-gh-extension-release.sh`, and the working directory it runs in.                              |
| `extension-name`                    | no       | repository name | Required artifact filename prefix. The repository name is correct as-is for a conventionally named `gh-<name>` extension repo.                         |
| `certification-verification-script` | no       | `""`            | Optional path to a consumer-owned Node script that gates the release; see [Optional release-certification gate](#optional-release-certification-gate). |

## Build entrypoint contract

`scripts/build-gh-extension-release.sh`, committed in the consumer
repository under `working-directory`, is the fixed, required entrypoint:

- The workflow fails clearly if the file doesn't exist.
- It is run once, via `bash`, with `$ARTIFACT_DIR` set to a directory the
  script must create its finished artifacts in.
- It receives no other workflow-controlled inputs and is invoked with no
  caller-supplied shell string — the shared workflow contains no
  command-execution surface driven by `workflow_call` input.

## Artifact naming/layout contract

Each file `scripts/build-gh-extension-release.sh` places in `$ARTIFACT_DIR`
must be named `<extension-name>-<os>-<arch>[.exe]` (`.exe` suffix required
for, and only for, `windows-*` targets), matching the
`OS-ARCHITECTURE[EXTENSION]` suffix GitHub CLI requires to discover a
precompiled extension binary for a platform. `os`/`arch` must be one of the
platform identifiers `gh` itself recognizes (`darwin`/`freebsd`/`linux`/`windows`/`android`
× `amd64`/`arm64`/`386`/`arm`) — this is a naming/discovery vocabulary, not a
build-toolchain requirement; a consumer can produce a `linux-amd64` binary
from Go, Node, Rust, or any other toolchain.

## Verification before upload

Before uploading, the workflow fails the job if any file in `$ARTIFACT_DIR`:

- doesn't match the `<extension-name>-<os>-<arch>[.exe]` naming (including
  the `.exe` suffix rule above), or
- is missing or empty.

This is generic presence/naming validation only — the workflow does not
inspect binary format (no ELF/Mach-O/PE magic-byte checks), since it has no
assumption about what toolchain produced the file.

## Permissions

The workflow's top-level default is `contents: read`; only the single
`release` job that uploads assets elevates to `contents: write`. Consumers
must grant `contents: write` on the calling job (see the example above) —
GitHub permissions only ever narrow across a reusable workflow call, never
widen, so this is the minimum a consumer needs to grant.

## Optional release-certification gate

If `certification-verification-script` is set, the workflow checks out
`yohn-jp/.github` at the exact provider revision selected by the caller's
`@main` reference, uses its `setup-node-pnpm` composite action to install
Node/pnpm and the consumer's `devDependencies` (the consumer's
`package.json` must declare an exact pnpm `packageManager` version, same
requirement as `npm-publish.yml`), then runs
`node --import tsx <certification-verification-script>` with no
workflow-controlled arguments after the consumer build and generic artifact
verification, immediately before upload. A missing script or non-zero exit
fails the release. The release-tooling checkout is removed immediately
after setup so it cannot be mistaken for consumer source by the build,
artifact verification, or upload steps.

The verifier receives this bounded, product-neutral context through
environment variables:

| Variable                           | Value                                                                                        |
| ---------------------------------- | -------------------------------------------------------------------------------------------- |
| `RELEASE_SOURCE_SHA`               | Full SHA of the exact commit checked out from `refs/tags/<release-tag>`.                     |
| `RELEASE_TAG`                      | Exact `release-tag` input used for checkout and the target GitHub Release.                   |
| `RELEASE_ARTIFACT_DIR`             | Absolute `$RUNNER_TEMP/gh-extension-artifacts` directory after generic presence/name checks. |
| `RELEASE_ARTIFACT_MANIFEST_SHA256` | SHA-256 of the deterministic path-and-content manifest captured before the verifier.         |

`RELEASE_ARTIFACT_DIR` is the same dedicated directory used by the consumer
build, generic verification, and `gh release upload`; every file in it is an
exact upload candidate. The workflow compares the manifest after the verifier
and immediately before upload, so changed, added, removed, or renamed files
fail closed. The script remains entirely consumer-owned: it decides what
"certified" means and where its own evidence lives. This workflow knows
nothing about evidence shape, location, schema, or product-specific contract
versions. Leaving the input empty (the default) skips the gate and the
Node/pnpm setup it requires entirely, so non-Node consumers and consumers
without a certification contract are unaffected.

## Existing Release required

`gh release upload` is used, not `gh release create` — this workflow always
publishes to a Release that already exists at `release-tag` (e.g. created by
the consumer's own tagging/release step) and fails if it doesn't.
