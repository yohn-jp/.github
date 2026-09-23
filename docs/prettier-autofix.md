# Prettier stacked-PR autofix

The organization-owned wrapper is synchronized only to the current TypeScript
CLI consumers whose default-branch package provides the shared pnpm setup
contract and a `format` script: `gh-inari`, `gh-makami`, `suzukuri`,
`shikitari`, `nawabari`, `wabachi`, `cli-canon`, and `majiwari`. The wrapper calls
`yohn-jp/.github/.github/workflows/prettier-autofix.yml@main`; its consumer
copy is controlled by `.github/sync.yml`.

## Activate the feature

1. Create a dedicated GitHub App for Prettier autofix. A webhook URL and
   webhook events are not required; the App is used only to mint short-lived
   installation tokens from Actions.
2. Grant only these repository permissions:
   - **Contents: read and write** — read the source PR Git tree and
     create/update the deterministic autofix branch;
   - **Pull requests: read and write** — re-read, find, create, and reuse the
     stacked pull request;
   - **Workflows: write** — still required because the trusted whole-repository
     Prettier run can produce formatting changes under `.github/workflows`,
     and GitHub requires this permission to push those changes;
   - **Metadata: read-only** — GitHub's required repository metadata access.
3. Install the App on the opted-in `yohn-jp` consumer repositories. Do not
   install it on contributor forks. The reusable workflow discovers the
   installation from the repository owner and scopes each token to the current
   repository; no installation ID is configured.
4. Configure the App ID as an Actions variable and the private key as an Actions secret for each consumer, or at organization scope restricted to those repositories:
   - variable `AUTOFIX_APP_ID` — the App's numeric ID;
   - secret `AUTOFIX_APP_PRIVATE_KEY` — the App's PEM private key.

No PAT or token fallback is used for writes. The formatter job receives no App
secret; its job-scoped `GITHUB_TOKEN` is read-only and is not persisted by either
checkout. If a dirty same-repository PR runs before the App ID variable and private-key secret are
present, the writer fails with an explicit setup diagnostic.
Clean PRs do not invoke the writer and do not need App credentials.

## Runtime and trust boundaries

The synchronized wrapper runs on `pull_request_target`, so its definition comes
from the consumer's default branch. External fork PRs are explicitly skipped
before the reusable workflow is called or App secrets are forwarded. Autofix
PRs are excluded from recursion.

The unprivileged formatter job checks out the exact source PR head as data and
separately checks out the consumer's current default branch as the formatter
authority. It installs Node/pnpm dependencies from that trusted default-branch
`package.json` and lockfile, then invokes that checkout's pinned Prettier CLI
directly with its trusted `prettier.config.mjs` and `.prettierignore`. It does
not run the PR's `format` script or install dependencies from the PR. Explicit
config/ignore paths and disabled EditorConfig discovery prevent PR-controlled
Prettier configuration, plugins, dependencies, `.prettierignore`,
`.gitignore`, or `.editorconfig` from determining the repair. Provenance records
the exact source PR head and formatter authority commit, package/lock/config/
ignore digests, Prettier version, and patch digest.

The formatter job emits only a bounded text patch and provenance artifact. A
separate writer job re-reads the source PR and fetches its PR ref into a bare Git
repository; it does not check out or execute PR-authored files. It validates
provenance, the exact current head, patch paths/types, and patch applicability
to the source Git tree before requesting App credentials. Using Git's index and
`commit-tree`, the writer creates a commit based on the exact source head, then
uses a short-lived installation token to update
`autofix/prettier/pr-<number>` and create or reuse one PR targeting the source
PR head branch. It never pushes to the source branch or auto-merges either PR.

The existing `format:check` remains unchanged and merge-gating; autofix is
remediation, not a replacement for that check. The repair formatter intentionally
uses trusted default-branch tooling, even when the source PR changes its own
formatter scripts, config, plugins, or dependencies.

## Branch rules

The App needs permission to create and update `autofix/prettier/pr-*` branches
and open pull requests. Do not grant direct-main bypass. If an existing ruleset
prevents those operations, configure the narrowest rule for the
`autofix/prettier/pr-*` branch pattern and the dedicated App; do not weaken the
source branch or default-branch protections.
