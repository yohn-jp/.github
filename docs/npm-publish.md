# Reusable npm publishing

`.github/workflows/npm-publish.yml` is the shared release-triggered npm
publishing contract for `yohn-jp` TypeScript CLI packages: build/test,
verify the release tag matches `package.json`'s version, pack a tarball,
run the optional certification gate against that exact tarball, smoke-test
the same bytes across a Node-version matrix, then publish them via npm
Trusted Publishing (OIDC) — no long-lived `npm publish` token.

## Consuming it from another repository

```yaml
# .github/workflows/publish.yml in a consumer repository
name: Publish to npm

on:
  release:
    types: [published]

permissions:
  contents: read

jobs:
  publish:
    uses: yohn-jp/.github/.github/workflows/npm-publish.yml@main
    with:
      working-directory: . # optional, default "."
      node-version: "24" # optional, default "24"
      smoke-test-node-versions: "24" # optional, default "24"
      npm-cli-version: "12.0.2" # optional, default "12.0.2"
      certification-verification-script: "" # optional, default "" (gate disabled)
```

## Required package.json scripts and files

| Contract                                       | Used by                                                         |
| ---------------------------------------------- | --------------------------------------------------------------- |
| `pnpm run typecheck`                           | `build` job                                                     |
| `pnpm test`                                    | `build` job                                                     |
| `pnpm run build`                               | `build` job (must write whatever `files` in package.json packs) |
| `node scripts/smoke-test.mjs --tarball <path>` | `smoke-test` job                                                |

`scripts/smoke-test.mjs` must work using **only Node built-ins** — the
`smoke-test` job deliberately does not install this package's own
`devDependencies`, since it's simulating a real external consumer
installing the packed tarball fresh (see
`test/fixtures/ts-cli/scripts/smoke-test.mjs` for a working example: it
installs the tarball into a scratch directory and runs any declared `bin`
entry with `--version`, falling back to `--help`).

Package name and version are read directly from `package.json` — never
passed as separate inputs or inferred from the repository name.

## Release tag / version verification

The `build` job fails deterministically before any build work if the
triggering release's tag (`github.event.release.tag_name`, with an
optional leading `v` stripped) doesn't equal `package.json`'s `version`.
This check is `scripts/check-release-version.mjs` (unit tested in
`test/check-release-version.test.mjs`), fetched into the job the same way
other reusable workflows in this repository fetch their tooling — via a
checkout of `yohn-jp/.github` at `job.workflow_repository`/`job.workflow_sha`,
so it always matches the exact provider revision selected by the caller's
`@main` reference.

## Optional release-certification gate

If `certification-verification-script` is set, the `build` job runs it
(`node --import tsx <script>`, relative to `working-directory`) after
`pnpm pack` has created exactly one tarball and before it is uploaded for
smoke/publish. The script receives no workflow-controlled arguments and the
release fails if it is missing or exits non-zero. The workflow also checks
that the script did not change the packed tarball bytes before uploading it;
there is no second pack operation.

The verifier receives this bounded, product-neutral context through
environment variables:

| Variable                  | Value                                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| `RELEASE_SOURCE_SHA`      | Full SHA of the exact release-tag commit checked out by the workflow.                                |
| `RELEASE_TAG`             | Exact tag from the triggering Release.                                                               |
| `RELEASE_ARTIFACT_PATH`   | Absolute path to the one packed `.tgz` file; this is the file uploaded, smoke-tested, and published. |
| `RELEASE_ARTIFACT_SHA256` | SHA-256 of `RELEASE_ARTIFACT_PATH` immediately after packing.                                        |

The consumer script may read the tarball and its metadata, but must treat
`RELEASE_ARTIFACT_PATH` as the immutable release artifact and must not modify
it. The workflow checks the path digest after the verifier and again after
artifact download; any byte change fails closed. The script remains entirely
consumer-owned: it decides what "certified" means and where its own evidence
lives. This workflow knows nothing about evidence shape, location, schema, or
product-specific contract versions. Leaving the input empty (the default)
skips the gate entirely, so existing consumers without a certification
contract are unaffected.

## Idempotent publish

The `publish` job downloads the exact tarball produced by `build`, verifies
its SHA-256 against the build output, and passes that same file to
`npm publish`. It then checks `npm view <name>@<version> version` before
publishing; if that version is already on the registry, the publish step is
skipped rather than failing. This makes it safe to re-run a publish workflow
(e.g. after a transient failure earlier in the same run) without manual
registry cleanup.

## OIDC Trusted Publishing setup (per consumer repository)

This workflow assumes npm Trusted Publishing is configured for the target
package on npmjs.com, pointing at the environment (`environment: npm`, set
in this workflow) and the **consumer's own caller workflow file** — e.g.
`.github/workflows/publish.yml` in the consumer repository, not
`npm-publish.yml` in `yohn-jp/.github`. GitHub's OIDC token claims for a
job running through a reusable workflow call reflect the calling
workflow's identity for this purpose; verify the exact "Workflow filename"
value npm's Trusted Publisher UI expects against
[npm's current documentation](https://docs.npmjs.com/trusted-publishers)
at setup time, since this is a per-npmjs.com-account configuration step
that lives outside this repository and isn't something `npm-publish.yml`
itself can validate. No `NODE_AUTH_TOKEN`/npm token secret should be
configured on the `npm` environment — the whole point of Trusted
Publishing is that none is needed.

## Why this isn't self-tested end-to-end in this repository

Unlike `typescript-cli-ci.yml` and `codeql.yml`, this repository doesn't
run `npm-publish.yml` against a fixture end-to-end: doing so would require
either a real npm package + live OIDC Trusted Publisher configuration
(a genuine external side effect, not appropriate to wire up implicitly) or
a `skip-publish`-style test-only input diluting the production contract.
Instead, the two novel pieces are verified independently: the version-tag
check via unit tests, and the tarball/smoke-test contract by hand against
`test/fixtures/ts-cli` (the same fixture `typescript-cli-ci.yml` self-tests
against). The `publish` job's already-published check and OIDC publish
step mirror `yohn-jp/gh-inari`'s own `publish.yml`, which already
publishes real releases with this exact pattern.
