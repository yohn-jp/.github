# Prettier stacked-PR autofix

The organization-owned Prettier autofix wrapper is synchronized only to the
current TypeScript CLI consumers whose `package.json` provides the shared
pnpm setup contract and a `format` script: `gh-inari`, `gh-makami`, `suzukuri`,
`shikitari`, `nawabari`, and `wabachi`. The wrapper calls
`yohn-jp/.github/.github/workflows/prettier-autofix.yml@main`; its consumer
copy is controlled by `.github/sync.yml`.

## Activate the feature

1. Create a dedicated GitHub App for Prettier autofix. A webhook URL and
   webhook events are not required; the App is used only to mint short-lived
   installation tokens from Actions.
2. Grant only these repository permissions:
   - **Contents: read and write** — create/update the deterministic autofix
     branch;
   - **Pull requests: read and write** — find, create, and reuse the stacked
     pull request;
   - **Workflows: write** — required only because the existing whole-repository
     Prettier command can format files under `.github/workflows`;
   - **Metadata: read-only** — GitHub's required repository metadata access.
3. Install the App on the opted-in `yohn-jp` consumer repositories. Do not
   install it on contributor forks. The reusable workflow discovers the
   installation from the repository owner and scopes each token to the current
   repository; no installation ID is configured.
4. Configure these Actions secrets for each consumer, or as organization
   secrets restricted to those repositories:
   - `AUTOFIX_APP_ID` — the App's numeric ID;
   - `AUTOFIX_APP_PRIVATE_KEY` — the App's PEM private key.

No other secret, PAT, or token is used as a write fallback. If a dirty
same-repository PR runs before both secrets are present, the writer fails with
an explicit setup diagnostic. Clean PRs do not invoke the writer and do not
need App credentials.

## Runtime and trust boundaries

The synchronized wrapper runs on `pull_request_target`, so its definition comes
from the consumer's default branch. Same-repository PRs are checked out at the
observed head SHA in a separate unprivileged formatter job. That job uses the
consumer's canonical setup action and `pnpm run format`; it receives no App
credentials and produces only a text patch plus provenance. A separate writer
job re-reads the source PR, rejects stale provenance and unsafe patches, then
uses a short-lived App installation token, scoped to the current repository and limited to Contents,
Pull requests, Workflows, and Metadata permissions, to update
`autofix/prettier/pr-<number>` and create or reuse one PR targeting the source
PR head branch. It never executes source-PR code and never pushes to the source
branch. Autofix PRs are excluded from recursion and are not auto-merged.

Clean formatter output creates no artifact, branch, or PR. The existing
`format:check` CI job remains unchanged and merge-gating; the autofix is
remediation, not a replacement for that check.

**External fork PRs are explicitly excluded.** The wrapper reports a skip
before invoking the reusable workflow or forwarding App secrets. No patch is
generated, no App token is obtained, and no branch or PR is created. The
ordinary `format:check` still runs as before; contributors are responsible for
formatting changes on their forks.

## Branch rules

The App needs permission to create and update `autofix/prettier/pr-*` branches
and open pull requests. Do not grant direct-main bypass. If an existing
ruleset prevents those operations, configure the narrowest rule for the
`autofix/prettier/pr-*` branch pattern and the dedicated App; do not weaken the
source branch or default-branch protections.
