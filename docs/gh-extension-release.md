# Reusable precompiled GitHub CLI extension release

`.github/workflows/gh-extension-release.yml` is the shared release-triggered
publishing contract for precompiled [GitHub CLI extensions](https://docs.github.com/en/github-cli/github-cli/creating-github-cli-extensions#precompiled-binaries):
checkout the exact Release/tag source revision, run the consumer's own build
command, verify the resulting artifacts, and upload them to that
already-existing GitHub Release.

The workflow is generic and does not own build implementation: the consumer
owns its build command end-to-end — language, toolchain, and which target
platforms it ships. This workflow owns only the GitHub CLI
precompiled-extension artifact naming contract, generic pre-upload
validation, and the Release upload. It does not know about, or branch on,
any specific consumer repository or language.

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
      build-command: |
        npm ci
        npm run build:binaries -- --out "$ARTIFACT_DIR"
```

`build-command` above is illustrative only: it is whatever the consumer's
own script does to produce finished binaries — Go cross-compilation, a
Node/TypeScript packager (e.g. Node single executable applications, `pkg`,
`nexe`, a Bun compile), or anything else. This workflow never invokes it per
platform and never sets `GOOS`/`GOARCH` or any other build-toolchain
variable; the consumer's own command must already write each finished
binary directly into `$ARTIFACT_DIR`, one file per platform it ships, named
per the contract below.

npm publishing (if the same repository also ships an npm package) is a
separate job/workflow calling `npm-publish.yml`, run independently from the
same Release — this workflow never merges with, or depends on, that one.

## Inputs

| Input               | Required | Default         | Purpose                                                                                                                                                                      |
| ------------------- | -------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `release-tag`       | yes      | —               | Exact Release/tag to check out, build from, and upload assets to.                                                                                                            |
| `build-command`     | yes      | —               | Shell command, owned entirely by the consumer, that builds every artifact it intends to ship and writes each one into `$ARTIFACT_DIR`, already named per the contract below. |
| `working-directory` | no       | `.`             | Directory containing the extension source, and the working directory `build-command` runs in.                                                                                |
| `extension-name`    | no       | repository name | Required artifact filename prefix. The repository name is correct as-is for a conventionally named `gh-<name>` extension repo.                                               |

## Artifact naming/layout contract

Each file the consumer's `build-command` places in `$ARTIFACT_DIR` must be
named `<extension-name>-<os>-<arch>[.exe]` (`.exe` suffix required for, and
only for, `windows-*` targets), matching the `OS-ARCHITECTURE[EXTENSION]`
suffix GitHub CLI requires to discover a precompiled extension binary for a
platform. `os`/`arch` must be one of the platform identifiers `gh` itself
recognizes (`darwin`/`freebsd`/`linux`/`windows`/`android` ×
`amd64`/`arm64`/`386`/`arm`) — this is a naming/discovery vocabulary, not a
build-toolchain requirement; a consumer can produce a `linux-amd64` binary
from Go, Node, Rust, or any other toolchain.

The workflow does not build, cross-compile, or invoke anything per
platform — it runs `build-command` exactly once and validates whatever ends
up in `$ARTIFACT_DIR` afterwards.

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

## Existing Release required

`gh release upload` is used, not `gh release create` — this workflow always
publishes to a Release that already exists at `release-tag` (e.g. created by
the consumer's own tagging/release step) and fails if it doesn't.
