# GitHub metadata distribution and overrides

This repository (`yohn-jp/.github`) is the organization's [special `.github`
repository](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/creating-a-default-community-health-file-for-your-organization),
but its Issue/PR templates and shared coding-agent authorities are **not** left
to GitHub's implicit community-health-file inheritance. They are pushed out
explicitly by `.github/workflows/sync-org-templates.yml`. This document
describes what is distributed, how, and how a repository should override or
extend a synced file on purpose.

## Why not GitHub's automatic inheritance

GitHub's built-in fallback only covers a single `.github/pull_request_template.md`
file. This repository's PR templates live under `.github/PULL_REQUEST_TEMPLATE/`
(`default.md` and `release.md`, GitHub's multi-template convention — see
`.github/PULL_REQUEST_TEMPLATE/`) so a PR author can pick the right one via
`?template=`. That directory form is outside what GitHub's org-defaults
fallback serves, so relying on it would silently distribute Issue Forms
while leaving every consumer without a PR template. `sync-org-templates.yml`
is therefore the **only** distribution path for both Issue and PR templates
and for the shared agent files described below. Treat their sources in this
repository as authoritative, not as files GitHub also happens to inherit.

## What is distributed

`.github/workflows/sync-org-templates.yml` runs on pushes to `main` that touch
its managed source/configuration paths (and is also available via
`workflow_dispatch`). It uses a GitHub App installation token
(`ORG_TEMPLATE_SYNC_APP_ID` / `ORG_TEMPLATE_SYNC_APP_PRIVATE_KEY`) and
[`BetaHuhn/repo-file-sync-action`](https://github.com/BetaHuhn/repo-file-sync-action)
to push the configured files directly to each target repository's default
branch (`SKIP_PR: true`). Two explicit maps are used:

- `.github/sync.yml` for repository metadata, governance adapters, and opted-in workflow wrappers;
- `.github/sync-agents.yml` for shared coding-agent instructions, workflow guidance, and runtime profiles.

| File | Purpose |
| --- | --- |
| `.github/ISSUE_TEMPLATE/*.yml` | Issue Forms (`bug.yml`, `feature.yml`, `architecture.yml`, `maintenance.yml`, `research.yml`) |
| `.github/ISSUE_TEMPLATE/config.yml` | Issue template chooser configuration |
| `.github/PULL_REQUEST_TEMPLATE/default.md` | Default PR template (general work) |
| `.github/PULL_REQUEST_TEMPLATE/release.md` | Release PR template (no linked-Issue/scope sections) |
| `AGENTS.md` | Minimal shared coding-agent execution contract. |
| `CLAUDE.md` | Claude-specific style adapter; execution governance stays in the shared contract/profile authorities. |
| `docs/agent-change-workflow.md` → `.github/agent-governance/change-workflow.md` | Canonical standalone/Epic change-execution workflow, distributed as a generated consumer copy. |
| `docs/agent-runtime-profiles.md` → `.github/agent-governance/runtime-profiles.md` | Human-readable runtime-specific prompt/delegation guidance, distributed as a generated consumer copy. |
| `.github/agents/runtime-profiles.json` → `.github/agent-governance/runtime-profiles.json` | Machine-readable runtime profile source for deterministic future prompt projection. |
| `.github/agents/runtime-profiles.schema.json` → `.github/agent-governance/runtime-profiles.schema.json` | Structural contract for the machine-readable runtime profiles. |
| `templates/workflows/*.yml` → `.github/workflows/*.yml` | Opt-in: canonical wrapper files (`codeql.yml`, `governance.yml`, `issue-governance.yml`, `publish.yml`) that call this repository's reusable workflows. Only listed per-target in `.github/sync.yml` for repositories whose `with:` values match the canonical file exactly — see `docs/typescript-cli-ci.md` and `docs/governance.md`. A repository whose governance workflow carries repository-specific jobs alongside the canonical caller (e.g. `yohn-jp/mottainai`) owns that file directly instead of receiving it via sync. |
| `scripts/validate-action-pins.mjs` | Opt-in: the canonical Action-pin governance validator, replacing a consumer's own drifted copy. |

Both sync configuration files explicitly list every target `owner/repo` and
which files it receives — there is no automatic org-wide or topic-based
discovery. Adding a repository to distribution means adding it to the
appropriate map and keeping the GitHub App token repository scope aligned.

The agent distribution intentionally does **not** manage
`.github/agent-governance/repository-overlay.md`. That path is reserved for
repository-owned constraints that extend the generated shared workflow without
creating a competing copy of it.

## What is NOT distributed

- **GitHub Actions workflows** (`.github/workflows/*.yml`) are never
  inherited implicitly by GitHub itself. Every consumer repository must
  explicitly reference this repository's reusable workflows via `uses:
  yohn-jp/.github/.github/workflows/<name>.yml@main` in its own
  workflow files. See the versioning note below. This is separate from
  the explicit `.github/sync.yml` mechanism above: a repository may
  additionally opt in to having the thin wrapper file itself (the file
  containing that `uses:` line) kept in sync from `templates/workflows/`,
  so it doesn't have to hand-maintain that wrapper — but nothing here
  changes GitHub's own lack of implicit workflow inheritance, and `ci.yml`
  (the CI wrapper) is not yet part of that sync set (see
  `docs/typescript-cli-ci.md`).
- **Composite/other Actions** under `.github/actions/` are likewise only
  available to a consumer if it explicitly references them by
  `owner/repo/path@ref`.
- **Repository Rulesets** are configured per-repository (or at the
  organization level via GitHub's Rulesets UI/API); nothing here changes
  that automatically. Organization-level Ruleset consolidation is tracked
  separately (see the parent EPIC, issue #1, item 10).
- **Repository-specific agent overlays** are never generated from the shared
  repository. A consumer may own `.github/agent-governance/repository-overlay.md`
  for product-specific architecture, validation, generated-file, or stricter
  execution constraints. It may not silently weaken the shared invariants.
- `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `FUNDING.yml`,
  and profile `README.md` behave under the same file-presence rule as the
  Issue/PR templates above, but this repository does not currently define
  them; add them here if/when the organization wants shared defaults for
  those too.

## How to override or extend intentionally

A repository with genuinely different Issue/PR semantics should be removed
from (or never added to) `.github/sync.yml`, then define its own copy of the
relevant metadata file locally. Because the sync workflow pushes directly to
each target's default branch with no review gate (`SKIP_PR: true`), opting out
of the relevant sync map is what makes a local replacement stick, not just
adding the file. The removal must land and run before a local replacement is
added; otherwise an in-flight sync can overwrite the local change.

Shared agent governance follows a stricter extension model. Do not locally
patch generated `AGENTS.md`, `CLAUDE.md`, or
`.github/agent-governance/{change-workflow.md,runtime-profiles.md,runtime-profiles.json,runtime-profiles.schema.json}`
while the repository remains in `.github/sync-agents.yml`: the next sync will
replace the patch and would create an ambiguous authority in the meantime.
Request broadly useful changes in this canonical repository. Put legitimate
repository-specific additions in
`.github/agent-governance/repository-overlay.md` instead.

If a repository must fully opt out of shared agent governance, remove its
mapping from `.github/sync-agents.yml` through a reviewed canonical change
before replacing generated files locally. Document why the divergence is
intentional so future maintainers do not mistake it for drift.

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

The release-governance rollout follows the same explicit distribution path.
The standard `governance.yml` wrapper is synced to consumers that use the
shared PR gate; `gh-makami` and `suzukuri` are explicitly mapped to that
wrapper so their stale pinned PR-governance SHA is replaced by `@main`.
Mottainai owns its `governance.yml` directly instead of receiving it via
sync (see the table above and `docs/governance.md`): that file's
`validate-release` job calls the same canonical `pr-governance.yml@main`
other consumers reach through the synced wrapper, so there is one canonical
`yohn-jp/.github` reusable-workflow reference org-wide, not a
Mottainai-specific trust exception. Nawabari receives the routing helper
alongside its synced validator so the copied adapter has no unresolved local
dependency.

Shared agent workflow/profile changes follow `.github/sync-agents.yml` and
are triggered by changes to `AGENTS.md`, `CLAUDE.md`, the canonical agent
workflow/profile docs, the machine-readable profile sources, or the sync map.
After such a change reaches `.github` `main`, `sync-org-templates` must finish
successfully; its direct, batched consumer commits are rollout evidence. A
consumer snapshot is not considered aligned merely because the canonical
source changed.
