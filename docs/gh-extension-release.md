# Reusable precompiled GitHub CLI extension release

`.github/workflows/gh-extension-release.yml` is the shared release-triggered
publishing contract for precompiled [GitHub CLI extensions](https://docs.github.com/en/github-cli/github-cli/creating-github-cli-extensions#precompiled-binaries):
checkout the exact Release/tag source revision, build one binary per target
platform from a consumer-supplied build command, verify each binary, and
upload them to that already-existing GitHub Release.

The workflow is generic: consumer repositories own their build command and
product semantics, and this workflow owns only the GitHub CLI
precompiled-extension packaging/verification/upload contract. It does not
know about, or branch on, any specific consumer repository.

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
        go build -trimpath -ldflags="-s -w" -o "$OUTPUT_PATH" ./cmd/gh-inari
```

npm publishing (if the same repository also ships an npm package) is a
separate job/workflow calling `npm-publish.yml`, run independently from the
same Release — this workflow never merges with, or depends on, that one.

## Inputs

| Input               | Required | Default (canonical `go tool dist list` platform set)                                                                                                    | Purpose                                                                                                                                                                        |
| ------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `release-tag`       | yes      | —                                                                                                                                                       | Exact Release/tag to check out, build from, and upload assets to.                                                                                                              |
| `build-command`     | yes      | —                                                                                                                                                       | Shell command building **one** binary for one platform. Runs with `GOOS`, `GOARCH`, `OUTPUT_PATH` set in its environment; it must write the compiled binary to `$OUTPUT_PATH`. |
| `setup-command`     | no       | `""`                                                                                                                                                    | Shell command run once before the platform build loop (e.g. installing extra build dependencies).                                                                              |
| `working-directory` | no       | `.`                                                                                                                                                     | Directory containing the extension source, and the working directory for `setup-command`/`build-command`.                                                                      |
| `extension-name`    | no       | repository name                                                                                                                                         | Artifact filename prefix. The repository name is correct as-is for a conventionally named `gh-<name>` extension repo.                                                          |
| `platforms`         | no       | `darwin-amd64,darwin-arm64,freebsd-386,freebsd-amd64,freebsd-arm64,linux-386,linux-amd64,linux-arm,linux-arm64,windows-386,windows-amd64,windows-arm64` | Comma-separated `os-arch` targets to build and release.                                                                                                                        |

`build-command` is intentionally build-tool agnostic (Go, Rust, or anything
else that can cross-compile from `GOOS`/`GOARCH`) — the workflow only
supplies the platform pair and the required output path, mirroring the same
build matrix as GitHub's own [`cli/gh-extension-precompile`](https://github.com/cli/gh-extension-precompile)
reference action.

## Artifact naming/layout contract

Each produced asset is named `<extension-name>-<os>-<arch>[.exe]` (`.exe`
suffix only for `windows-*` targets), matching the suffix GitHub CLI requires
to discover precompiled extension binaries for a platform
(`OS-ARCHITECTURE[EXTENSION]`, per the docs linked above).

## Verification before upload

Before uploading, the workflow fails the job if any produced file:

- doesn't match the `<extension-name>-<os>-<arch>[.exe]` naming,
- is missing or empty, or
- isn't the expected binary format for its target (`PE32` for `windows-*`,
  `Mach-O` for `darwin-*`, `ELF` otherwise), via `file`.

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
