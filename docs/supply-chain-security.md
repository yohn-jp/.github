# Reusable supply-chain security lane

`.github/workflows/supply-chain-security.yml` implements the
`supply-chain-security` lane in the organization quality CI contract. It
combines two distinct capabilities without adding a second scanner:

- GitHub's `actions/dependency-review-action` gates dependency changes in
  pull requests.
- The existing organization CodeQL reusable workflow remains the authority for
  static analysis on pull requests, pushes to `main`, and nightly schedules.

The provider has no repository-name conditionals and uses one
`ubuntu-latest` runner per job; it does not introduce an OS matrix.

## Consumer contract

The caller owns event triggers and passes the matching `execution-mode`:

```yaml
jobs:
  supply-chain-security:
    uses: yohn-jp/.github/.github/workflows/supply-chain-security.yml@main
    with:
      working-directory: .
      execution-mode: pr
      severity: high
      license-policy-file: .github/dependency-review.yml
      codeql-config-file: .github/codeql/codeql-config.yml
    permissions:
      contents: read
      pull-requests: read
```

`execution-mode` and event mapping are strict: `pr` requires
`pull_request`, `main` requires `push`, and `nightly` requires `schedule`.
The dependency-diff job runs only in `pr` mode. CodeQL is reused in all three
modes, so scheduled/main analysis is not mistaken for a dependency diff and no
duplicate CodeQL implementation is maintained here.

Inputs:

| Input                 | Default | Contract                                                               |
| --------------------- | ------- | ---------------------------------------------------------------------- |
| `working-directory`   | `.`     | Repository-relative package root used to resolve the two config paths. |
| `execution-mode`      | `pr`    | `pr`, `main`, or `nightly`; must match the caller event.               |
| `severity`            | `high`  | Dependency review threshold: `low`, `moderate`, `high`, or `critical`. |
| `license-policy-file` | empty   | Optional consumer-owned dependency-review config.                      |
| `codeql-config-file`  | empty   | Optional consumer-owned CodeQL config; empty selects CodeQL defaults.  |

The license policy file follows the dependency-review action's YAML format,
for example:

```yaml
allow-licenses:
  - MIT
  - Apache-2.0
  - BSD-2-Clause
```

Allow lists, deny lists, and exceptions remain consumer-owned. The provider
does not infer a license policy from repository identity. For PRs, a local
license policy is checked out from the base revision, preventing a proposed
PR change from weakening the policy it is being checked against.

## Permissions and failure behavior

The provider defaults to `contents: read`. Dependency review additionally
receives `pull-requests: read`; CodeQL receives `security-events: write` and
`actions: read` only on its own job so SARIF upload remains least-privilege.
No write permission is granted to dependency review or the status job.

Policy mode, severity, and repository-relative paths are validated before any
scanner runs. Dependency vulnerability and license checks are always enabled,
`warn-only` is fixed to `false`, all dependency scopes are checked, and the
summary stays in the check log (`comment-summary-in-pr: never`). Policy and
scanner errors emit actionable `::error` diagnostics and the status job
aggregates `success`, `skipped`, or `failure`, failing closed for failed or
cancelled capabilities.
