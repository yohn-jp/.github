# GitHub metadata distribution and overrides

This repository (`yohn-jp/.github`) is the organization's [special `.github`
repository](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/creating-a-default-community-health-file-for-your-organization),
but its Issue/PR templates are **not** left to GitHub's implicit
community-health-file inheritance. They are pushed out explicitly by
`.github/workflows/sync-org-templates.yml`. This document describes what
is distributed, how, and how a repository should override a synced file on
purpose.

## Why not GitHub's automatic inheritance

GitHub's built-in fallback only covers a single `.github/pull_request_template.md`
file. This repository's PR templates live under `.github/PULL_REQUEST_TEMPLATE/`
(`default.md` and `release.md`, GitHub's multi-template convention — see
`.github/PULL_REQUEST_TEMPLATE/`) so a PR author can pick the right one via
`?template=`. That directory form is outside what GitHub's org-defaults
fallback serves, so relying on it would silently distribute Issue Forms
while leaving every consumer without a PR template. `sync-org-templates.yml`
is therefore the **only** distribution path for both Issue and PR
templates — treat this repository's `.github/ISSUE_TEMPLATE/` and
`.github/PULL_REQUEST_TEMPLATE/` as the source of truth, not as something
GitHub also happens to serve automatically.

## What is distributed

`.github/workflows/sync-org-templates.yml` runs on every push to `main`
that touches `.github/ISSUE_TEMPLATE/**`, `.github/PULL_REQUEST_TEMPLATE/**`,
or `.github/sync.yml` (also available via `workflow_dispatch`). It uses a
GitHub App installation token (`ORG_TEMPLATE_SYNC_APP_ID` /
`ORG_TEMPLATE_SYNC_APP_PRIVATE_KEY`) and
[`BetaHuhn/repo-file-sync-action`](https://github.com/BetaHuhn/repo-file-sync-action)
to push the files listed in `.github/sync.yml` directly to each target
repository's default branch (`SKIP_PR: true` — no review gate, matching
this task's "Actions can commit directly to main" requirement):

| File | Purpose |
| --- | --- |
| `.github/ISSUE_TEMPLATE/*.yml` | Issue Forms (`bug.yml`, `feature.yml`, `architecture.yml`, `maintenance.yml`, `research.yml`) |
| `.github/ISSUE_TEMPLATE/config.yml` | Issue template chooser configuration |
| `.github/PULL_REQUEST_TEMPLATE/default.md` | Default PR template (general work) |
| `.github/PULL_REQUEST_TEMPLATE/release.md` | Release PR template (no linked-Issue/scope sections) |

`.github/sync.yml` explicitly lists every target `owner/repo` and which
files it receives — there is no automatic org-wide or topic-based
discovery. Adding a repository to the distribution means adding it to
that file.

## What is NOT distributed

- **GitHub Actions workflows** (`.github/workflows/*.yml`) are never
  inherited implicitly. Every consumer repository must explicitly
  reference this repository's reusable workflows via `uses:
  yohn-jp/.github/.github/workflows/<name>.yml@main` in its own
  workflow files. See the versioning note below.
- **Composite/other Actions** under `.github/actions/` are likewise only
  available to a consumer if it explicitly references them by
  `owner/repo/path@ref`.
- **Repository Rulesets** are configured per-repository (or at the
  organization level via GitHub's Rulesets UI/API); nothing here changes
  that automatically. Organization-level Ruleset consolidation is tracked
  separately (see the parent EPIC, issue #1, item 10).
- `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `FUNDING.yml`,
  and profile `README.md` behave under the same file-presence rule as the
  Issue/PR templates above, but this repository does not currently define
  them; add them here if/when the organization wants shared defaults for
  those too.

## How to override intentionally

A repository with genuinely different Issue/PR semantics should be removed
from (or never added to) `.github/sync.yml`, then define its own copy of
the relevant file locally. Because the sync workflow pushes directly to
each target's default branch with no review gate (`SKIP_PR: true`),
opting out of `sync.yml` is what makes a local override stick, not just
adding the file — and the `sync.yml` removal must land and run *before*
the local override is added, in its own commit/push to `main`, not bundled
into the same push as other template edits. Bundling them risks the sync
workflow run still reading the old `sync.yml` (still listing the target)
while racing the override's own commit, which would silently overwrite
the fresh local override. Document *why* the repository needs a different
template in that file's own history/PR description so future maintainers
understand it's a deliberate divergence rather than drift.

Do not leave a repository in `sync.yml` while also locally patching "just
one line" of a synced file — that patch will be silently overwritten by
the next sync. Prefer requesting the change here if it is broadly useful,
and only opt a repository out when the semantics are genuinely
repository-specific.

## Validating Issue Forms and workflow metadata

This repository ships a deterministic validation gate
(`.github/workflows/metadata-validation.yml`, backed by
`scripts/validate-issue-forms.mjs` and `scripts/validate-action-pins.mjs`)
that:

- Rejects Issue Form YAML that parses successfully but has an invalid
  structure for its declared `type` (unsupported/missing keys, missing
  required attributes such as `label` or `options`). This specifically
  catches the case where an unquoted comma inside a flow mapping like
  `attributes: { label: X, description: a, b, c }` silently splits one
  field into several unexpected ones — valid YAML, wrong shape. See
  `test/fixtures/issue-forms/invalid-flow-mapping.yml` for the reproduction
  fixture and `test/issue-forms.test.mjs` for the regression test.
- Rejects any third-party `uses:` reference (workflow step, job-level
  reusable workflow call, or composite action) that is not pinned to an
  immutable reference: a full 40-character commit SHA for GitHub-hosted
  actions, or an image digest (`@sha256:...`) for `docker://` actions.
  Organization-owned reusable workflows under `yohn-jp/.github` must use
  `@main`; local action references (`./path`) are exempt since there is no
  remote ref to pin.
- Runs [`actionlint`](https://github.com/rhysd/actionlint) for general
  GitHub Actions workflow syntax validation.

Other repositories can call the same gate as a reusable workflow:

```yaml
jobs:
  metadata:
    uses: yohn-jp/.github/.github/workflows/metadata-validation.yml@main
```

The workflow uses `job.workflow_repository` and `job.workflow_sha` to check
out the matching version of the validator scripts from `yohn-jp/.github`,
so the version of the tooling that runs always matches the exact provider
revision selected by the caller's `@main` reference — never the caller's own
HEAD/merge commit.

## Versioning and rollout safety

Consumers must reference reusable workflows in this repository by `@main`.
Third-party workflows/actions in those consumers must remain full
commit-SHA-pinned, and this distinction is enforced by the same validator
described above. Updating the shared organization authority is therefore a
central change on `yohn-jp/.github`; consumer callers stay thin.
