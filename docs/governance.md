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
contracts, validates the rendered artifacts, and owns canonical branch and
Issue/Epic/Implementation integration routing. The workflow adapters only
own event plumbing and enforcement; they do not duplicate required headings,
field rules, parentage, or route selection. They invoke the published
`gh-inari` package:

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

**Branch-name validation is projected by `.github/workflows/pr-governance.yml`**
(via `scripts/validate-branch-name.mjs`) to the canonical Inari branch
validator. The shared adapter does not define ordinary, `issue/*`, or
`epic/*` grammar. `branch-name-pattern` and `branch-name-exempt` remain
bounded legacy transport inputs: they may narrow an already-canonical
ordinary branch or preserve an explicit exemption, but cannot authorize an
Inari-invalid branch or any malformed reserved integration prefix. The
separate `release/<semver>` class remains local compatibility plumbing because
release branches are intentionally Issue-less and are outside Inari's Change
branch grammar; malformed `release/*` names fail closed.

**Integration routing is projected by the same workflow and owned by Inari.**
Consumers that opt into the three-level topology pass canonical route
evidence through the reusable workflow's `integration-routing` input. The
adapter adds only the observed pull-request head and base refs from the event,
then fails on Inari's structured decision. It never derives parentage from a
branch name or body shape:

```text
Implementation -> issue/<source-Issue> -> epic/<parent-Epic> -> default
```

Implementation PRs target the source-Issue branch, source-Issue integration
PRs target the parent Epic, and Epic integration PRs target the default
branch. Standalone and explicit legacy routes remain compatible according to
the canonical result. Missing or unavailable canonical route validation fails
closed whenever route evidence is supplied.

The `epic/<issue-number>-<slug>` class is an integration branch for one
tracking/Epic Issue and its independently implemented child Issues — not an
implementation leaf branch. Canonical Inari branch validation accepts it and
`issue/<issue-number>-<slug>`; malformed reserved prefixes fail closed before
legacy compatibility inputs are considered. Because no executable authority
in this repository owns actual GitHub-native branch protection settings (there
is no repository-ruleset-as-code here, only file sync — see
`.github/workflows/sync-org-templates.yml`), the operator enabling `epic/**`
in a consumer repository must also configure, via that repository's own
GitHub branch protection settings: require a pull request before merging,
block force pushes, and block deletion.

**The separate `epic(<scope>): <description>` PR-title class**
(`classifyEpicPrTitle()` in `scripts/epic-branch.mjs`, wired into
`scripts/validate-pr.mjs`) is likewise owned directly here, for the same
reason branch-name validation is: gh-inari's own scope is PR _content_
(body) governance, and today it checks a title only for being non-empty —
no shared governance anywhere validates a PR title's
`<type>(<scope>): <description>` form at all, for any type. This addition
is intentionally as narrow as that gap: `classifyEpicPrTitle()` only
recognizes and validates a title that is itself attempting the epic type
(starting `epic(` or `epic:`); a malformed attempt fails closed
(`GOVERNANCE_EPIC_PR_TITLE_INVALID`), but every other title — ordinary,
release, or anything else — is left completely unclassified and
unaffected, exactly as before. It does not introduce a distinct Epic PR
_content_ contract, automatic child-PR routing, merge-method semantics,
certification freshness, or lifecycle automation — those remain out of
scope for #177 and belong to the follow-up Epic development model (#178).

## `@main` is a live, mutable authority

Reusable-workflow callers in this document and in synced wrappers
(`templates/workflows/governance.yml` and this repository's own
`typescript-cli-ci.yml` guidance) intentionally reference
`yohn-jp/.github/.github/workflows/*.yml@main`, not a pinned commit SHA. This
is a deliberate, organization-level trust boundary and is **not** the same
kind of reference as the commit-SHA pinning `scripts/validate-action-pins.mjs`
enforces for third-party Actions/workflows:

- Third-party SHA pinning exists to bound supply-chain risk from code this
  organization does not control; a moving ref there is a governance
  violation.
- `yohn-jp/.github@main` is code this organization owns and operates. Callers
  intentionally track it live so that a fix or contract change (for example,
  this release-branch precedence fix) reaches every consumer's next PR run
  without a second, per-consumer bump. `scripts/validate-action-pins.mjs`
  requires this specific reference to stay unpinned for exactly that reason.

**This means the reusable-workflow _engine_ a consumer's PR run actually
executes can be newer than what any point-in-time reading of this repository
shows, and does not move in lockstep with that consumer's synced
`.github/inari/**` snapshot.** The snapshot (Issue Form / PR template
content, `manifest.json` digests) only changes when `.github/sync.yml`'s
rollout runs and commits to the consumer; the `@main` reusable-workflow
_logic_ changes the moment this repository's `main` moves, independent of
that sync. A consumer can therefore be running last week's content snapshot
against today's workflow logic. This divergence is expected and is not
silently hidden: it is the direct, accepted consequence of choosing `@main`
live authority over pinning, and consumers relying on exact reproducibility
of governance _behavior_ (not just content) should treat `.github`'s commit
history, not their own snapshot commit, as the source of truth for what ran.

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

`issue-governance.yml` accepts `issue-template` when a repository needs to
pin a specific Issue Form template rather than rely on gh-inari's
deterministic auto-detection. `pr-governance.yml` has no equivalent input
(Issue #211): PR template selection is resolved directly from the PR body's
own hidden `inari:template` marker, never from branch name, changed paths,
repository conditions, or body-shape matching. A `release/<semver>` head
branch is still validated as its own independent branch-name contract, but
which PR contract the body must satisfy is determined solely by that body's
marker. See the `on: workflow_call: inputs:` block in each workflow file for
the full, current input list — this document intentionally does not
duplicate it, to avoid the two drifting out of sync.

## Release PR path

Release preparation is operational packaging of already-reviewed changes and
does not require a synthetic Issue:

```text
release/<semver> -> release PR contract -> merge
  -> immutable v<semver> GitHub Release -> publish workflow
```

The release contract itself is selected the same way as every other PR
contract: from the body's own `inari:template` marker, rendered by gh-inari
when the release PR is created. `Tracking` remains
optional and is informational; it is never an authorization prerequisite. The
release path contains no linked-Issue fetch or linked-Issue contract
validation. Ordinary `feat|fix|docs|refactor|test|chore/<issue>-<slug>` PRs
retain their existing Issue-bound branch and default-contract governance.

Mottainai keeps its repository-specific ordinary-PR quality gates and their
linked-Issue validation, alongside product-specific CI
(`standards-self-check`), in a single, repository-owned
`.github/workflows/governance.yml` — not synced from `templates/workflows/`,
because it is not byte-identical to the generic canonical wrapper (see
`.github/sync.yml`). That same file adds a `validate-release` job that calls
the canonical `pr-governance.yml@main` reusable workflow directly for
`release/*` head refs, with no Issue fetch. Mottainai therefore has exactly
one PR-governance caller/path, not separate ordinary and release governance
workflows (Issue #49). This composition is covered by
`test/integration/mottainai-consumer-composition.test.mjs`, which evaluates
the real job-level `if:` gating from a frozen copy of Mottainai's own
`governance.yml` against both an ordinary and a release branch — this
reproduces the composition logic, but does not itself run on
`yohn-jp/mottainai`'s Actions runners. Confirm on that repository directly
after this change lands there:

- open a throwaway `feat/<issue>-x` PR: `standards-self-check` and
  `validate-pr` run (including the linked-Issue fetch), and `validate-release`
  shows as skipped, not merely absent;
- open a throwaway `release/<semver>` PR: `standards-self-check` and
  `validate-pr` show as skipped, `validate-release` runs and resolves the
  `release` contract, and no step in that run fetches or validates a linked
  Issue.

The publish workflows are outside this routing change. They continue to verify
the immutable release tag, resolved commit, package version, and exact packed
tarball before publish.

## Why PRs and Issues are enforced differently

- **PR governance fails the check.** `validate-pr-contract` simply exits
  non-zero when `gh-inari pr validate` reports a violation. There is no
  labeling or commenting step — a failing required-status check, enforced
  by the repository's Ruleset, _is_ the enforcement mechanism for
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
