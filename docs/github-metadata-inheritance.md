# GitHub metadata inheritance and overrides

This repository (`yohn-jp/.github`) is the organization's [special `.github`
repository](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/creating-a-default-community-health-file-for-your-organization).
GitHub uses it to supply organization-wide defaults for certain community
health files. This document describes exactly what is inherited, what is
not, and how a repository should override a default on purpose.

## What GitHub inherits automatically

For any repository in the `yohn-jp` organization that does **not** define
its own copy of a file below, GitHub serves the version from this
repository's `.github/` directory instead:

| File | Purpose |
| --- | --- |
| `.github/ISSUE_TEMPLATE/*.yml` | Issue Forms (`bug.yml`, `feature.yml`) |
| `.github/ISSUE_TEMPLATE/config.yml` | Issue template chooser configuration |
| `.github/pull_request_template.md` | Default PR description template |

This inheritance is purely file-presence based: GitHub checks the
consuming repository first, and only falls back to `yohn-jp/.github` when
the file is absent there. There is no merging — a repository-local file
entirely replaces the corresponding org default, not just for that one
template but that whole file's identity (e.g. a local
`ISSUE_TEMPLATE/bug.yml` shadows only the org's `bug.yml`; other org
templates such as `feature.yml` still apply unless the repository also
defines its own).

## What is NOT inherited

- **GitHub Actions workflows** (`.github/workflows/*.yml`) are never
  inherited implicitly. Every consumer repository must explicitly
  reference this repository's reusable workflows via `uses:
  yohn-jp/.github/.github/workflows/<name>.yml@<pinned-sha>` in its own
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

A repository with genuinely different Issue/PR semantics should add its
own copy of the relevant file at the same path
(`.github/ISSUE_TEMPLATE/bug.yml`, `.github/pull_request_template.md`,
etc.). Once present, GitHub uses the local file for that path only —
document *why* the repository needs a different template in that file's
own history/PR description so future maintainers understand it's a
deliberate divergence rather than drift.

Do not partially copy an org default "to tweak one line" — that creates a
silent fork that will not receive future fixes (such as the flow-mapping
regression this repository's validation now catches). Prefer requesting
the change here if it is broadly useful, and only fork locally when the
semantics are genuinely repository-specific.

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
- Rejects any `uses:` reference (workflow step, job-level reusable
  workflow call, or composite action) that is not pinned to an immutable
  reference: a full 40-character commit SHA for GitHub-hosted actions, or
  an image digest (`@sha256:...`) for `docker://` actions. Local action
  references (`./path`) are exempt since there is no remote ref to pin.
- Runs [`actionlint`](https://github.com/rhysd/actionlint) for general
  GitHub Actions workflow syntax validation.

Other repositories can call the same gate as a reusable workflow:

```yaml
jobs:
  metadata:
    uses: yohn-jp/.github/.github/workflows/metadata-validation.yml@<pinned-sha>
```

The workflow resolves `github.job_workflow_ref` to check out the matching
version of the validator scripts from `yohn-jp/.github`, so the version of
the tooling that runs always matches the ref the caller pinned to — never
an unpinned moving branch.

## Versioning and rollout safety

Consumers must reference shared workflows and actions in this repository
by full commit SHA (`@<40-hex-chars>`), never by branch or floating tag.
This is enforced for this repository's own workflow files by the same
SHA-pinning validator described above, and is expected of every
`yohn-jp/.github`-consuming repository for the same reason: a defect
introduced here must not instantly propagate to every consumer without an
explicit, reviewable update (a bump of the pinned SHA) in that consumer's
own repository.
