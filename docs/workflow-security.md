# Reusable workflow security gate

`.github/workflows/workflow-security.yml` is the organization-owned reusable
security lane for GitHub Actions workflows. It is callable from a consumer
repository and audits the configured workflow paths (default:
`.github/workflows/**`) with a fixed, offline zizmor release. The caller owns
the event trigger; the lane does not use repository-name conditionals or an
operating-system matrix.

## Ownership boundary

The checks are deliberately split so a finding has one clear owner:

| Rule class                                                   | Authority                                                        | Behavior                                                                                                                                                                       |
| ------------------------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `uses:` reference policy                                     | `scripts/validate-action-pins.mjs` via `metadata-validation.yml` | Requires full commit SHAs for third-party Actions, digest pins for Docker Actions, and the organization-owned reusable-workflow `@main` convention.                            |
| Workflow YAML syntax and GitHub Actions expression semantics | `actionlint` via `metadata-validation.yml`                       | Reports parser, context, expression, and workflow-schema errors.                                                                                                               |
| Workflow security data flow and trigger hazards              | zizmor via this gate                                             | Reports distinct security findings such as template injection, dangerous trigger/permission combinations, credential exposure, artifact poisoning, and related workflow risks. |
| Issue Form and Inari metadata contracts                      | Existing metadata/governance validators                          | Remains unchanged and is not replaced by a generic scanner.                                                                                                                    |

zizmor's overlapping `unpinned-uses` audit is disabled in this lane. The
organization validator is stronger for this repository: it requires SHA pins
even for GitHub-maintained Actions and explicitly models the organization's
trusted `yohn-jp/.github` reusable-workflow `@main` authority. Disabling only
that audit prevents duplicate or contradictory findings; all other zizmor
audits remain enabled.

## Determinism and permissions

- zizmor action revision is SHA-pinned and its embedded scanner version is
  fixed to `1.25.0`.
- Online audits, annotations, and colorized output are disabled. Findings are
  emitted as stable plain diagnostics with the rule name and source location.
- The workflow writes no SARIF and requests no `security-events: write`; the
  job receives only `contents: read` for checkout, while workflow-level
  permissions are empty.
- A missing workflow directory is treated as an empty input set. A malformed
  workflow remains a failure through the existing actionlint/metadata lane;
  scanner availability is not silently treated as a pass.

The `workflow_call` interface has three explicit inputs: `workflow-paths`
(space-separated paths/globs), optional consumer-owned `config-file`, and
`execution-mode` (`pr`, `main`, or `nightly`). The mode is validated to catch
miswired aggregate callers; it does not silently weaken the audit policy.
The `status` output is `success` only when input validation and the zizmor
audit both complete successfully; scanner findings or configuration errors
produce `failure` and a failed job.

When `config-file` is supplied, it must be inside the consumer workspace and
must retain `rules.unpinned-uses.disable: true`; that rule belongs to the
organization's existing pin validator and is intentionally not delegated to
consumer configuration. The workflow proves this on every run by adding a
run-id-specific probe containing an intentionally unpinned action to the same
zizmor invocation. A malformed or re-enabled pin rule therefore fails before
the gate can report success, while the consumer config can still tune
zizmor's distinct security audits explicitly.

## Consumer invocation

The consumer's aggregate or workflow-security caller should invoke the lane
on every event for which the resulting status is required (normally
`pull_request`, and optionally `push` on the default branch):

```yaml
jobs:
  workflow-security:
    uses: yohn-jp/.github/.github/workflows/workflow-security.yml@main
    with:
      execution-mode: pr
```

The reusable workflow itself does not add a path filter. If a required check
is filtered out at workflow dispatch time, GitHub can leave that check
pending; event/path routing therefore belongs to the consumer aggregate
workflow contract. The consumer checkout is the only input scanned, so the
same lane works for every repository without a repository-name branch.

## Diagnostics and fixtures

`test/fixtures/workflows/workflow-security-safe.yml` is a known-good,
least-privilege workflow. `workflow-security-unsafe.yml` intentionally
contains an unpinned Action, a credentialed `pull_request_target` trigger, a
write permission, and attacker-controlled template expansion. The existing
pin validator and zizmor respectively expose those findings. The malformed
`workflow-security-invalid.yml` fixture verifies that invalid YAML receives a
deterministic parser diagnostic before any scanner result is considered.
