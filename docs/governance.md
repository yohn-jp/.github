# PR and Issue governance

`.github/workflows/pr-governance.yml` and `.github/workflows/issue-governance.yml`
are the shared, `workflow_call`-callable governance gates for `yohn-jp`
repositories. They exist to remove copy-pasted governance scripts from
individual repositories — **not** to define a second, competing notion of
what makes an Issue or PR valid.

## Who owns what

**The consumer's synchronized `.github/inari/**` snapshot is the contract
source of truth.** `yohn-jp/.github` owns the canonical definitions and
synchronizes them together with a deterministic manifest containing the
snapshot revision and per-file digests. The reusable workflows check out
the shared adapters, but run them with the consumer checkout as their root;
the adapters therefore compile and validate the snapshot actually present in
that consumer.

**`yohn-jp/gh-inari` remains the shared semantic implementation.** It
compiles the local snapshot's Issue Forms and PR templates into typed
contracts and validates the rendered artifacts. The workflow adapters only
own event plumbing and candidate selection; they do not duplicate required
headings or field rules. They invoke the published `gh-inari` package:

```sh
gh-inari pr validate <number> --repository <owner>/<repo> [--template <id>]
gh-inari issue validate <number> --repository <owner>/<repo> [--template <id>]
```

The workflows install the organization-owned `gh-inari@latest` compiler in
an isolated temporary directory. Updating that implementation does not alter
which governance revision a consumer enforces: the local snapshot and its
manifest remain the input. This is distinct from the SHA-pinning policy for
third-party Actions (see `scripts/validate-action-pins.mjs`), which exists
specifically to bound supply-chain risk from repositories this organization
does not control.

**Branch-name validation is owned directly by `.github/workflows/pr-governance.yml`**
(via `scripts/validate-branch-name.mjs`), because gh-inari's own scope is
explicitly Issue/PR *content* governance — it does not validate branch
names. Owning this here does not create a competing authority over
anything gh-inari already owns; it fills a gap next to it. The default
pattern (`^(feat|fix|docs|refactor|test|chore)/\d+-[a-z0-9-]+$`) remains
Issue-bound. The separate `release/<semver>` class is accepted without an
Issue; malformed `release/*` names fail closed. `branch-name-pattern` and
`branch-name-exempt` remain available for ordinary consumer-specific naming
differences, but cannot authorize a malformed release branch.

## Consuming these workflows

```yaml
# .github/workflows/pr-governance.yml in a consumer repository
name: PR governance

on:
  pull_request:
    types: [opened, edited, synchronize, reopened, ready_for_review]

permissions:
  contents: read

jobs:
  governance:
    uses: yohn-jp/.github/.github/workflows/pr-governance.yml@main
```

```yaml
# .github/workflows/issue-governance.yml in a consumer repository
name: Issue governance

on:
  issues:
    types: [opened, edited, reopened]

permissions:
  contents: read
  issues: write

jobs:
  governance:
    uses: yohn-jp/.github/.github/workflows/issue-governance.yml@main
```

Both accept `pr-template` / `issue-template` when a repository needs to
pin a specific template rather than rely on gh-inari's deterministic
auto-detection (required for repositories using gh-inari's multi-template
PR policy). See the `on: workflow_call: inputs:` block in each workflow
file for the full, current input list — this document intentionally does
not duplicate it, to avoid the two drifting out of sync. For PRs, branch
classification takes precedence: a `release/<semver>` head ref explicitly
selects the `release` contract, so it does not depend on generic
multi-template matching.

## Release PR path

Release preparation is operational packaging of already-reviewed changes and
does not require a synthetic Issue:

```text
release/<semver> -> release PR contract -> merge
  -> immutable v<semver> GitHub Release -> publish workflow
```

For a release head branch, the shared adapter deterministically selects the
canonical `release` contract before validating the body. `Tracking` remains
optional and is informational; it is never an authorization prerequisite. The
release path contains no linked-Issue fetch or linked-Issue contract
validation. Ordinary `feat|fix|docs|refactor|test|chore/<issue>-<slug>` PRs
retain their existing Issue-bound branch and default-contract governance.

Mottainai keeps its repository-specific ordinary-PR quality gates and their
linked-Issue validation. Those gates already exclude `release/*`; its synced
`release-governance.yml` wrapper routes only release-prefixed PRs to the same
shared release contract, without adding an Issue fetch.

The publish workflows are outside this routing change. They continue to verify
the immutable release tag, resolved commit, package version, and exact packed
tarball before publish.

## Why PRs and Issues are enforced differently

- **PR governance fails the check.** `validate-pr-contract` simply exits
  non-zero when `gh-inari pr validate` reports a violation. There is no
  labeling or commenting step — a failing required-status check, enforced
  by the repository's Ruleset, *is* the enforcement mechanism for
  something that gates a merge.
- **Issue governance labels and comments instead.** Issues aren't merged,
  so there's no natural check to block. On violation, `issue-governance.yml`
  applies (creating if necessary) a `status:invalid` label and posts a
  comment built from gh-inari's structured `violations` JSON
  (`scripts/format-governance-violations.mjs` renders `code`/`path`/`message`
  as an ordered Markdown list — the same structured fields gh-inari
  documents as stable, so the comment is exactly as deterministic and
  automation/LLM-readable as the underlying validator output). On the next
  edit that passes validation, the label is removed; no removal comment is
  posted, matching the low-noise behavior `gh-inari`'s own repository
  already uses for itself.

This mirrors `yohn-jp/gh-inari`'s own `.github/workflows/governance.yml`
and `issue-governance.yml`. The reusable workflows here check out the
provider-owned adapters at the exact workflow revision and execute them
against the consumer snapshot. A consumer does not need an independent
validator implementation; Nawabari's migration additionally synchronizes
the adapters over its former local entry points so the old hard-coded copy
cannot remain a second structural authority.

## Migration note for repositories with existing local scripts

A repository currently running its own copy of branch-name/PR/Issue
validation scripts can switch to these reusable workflows without a
functional gap: the branch-name default matches the existing convention,
and the shared adapters compile the local snapshot through gh-inari. Once
switched, remove any obsolete local workflow entry point or let the sync
contract replace it with the shared adapter; keeping independent required
heading rules is the "second authority" this issue exists to avoid.
