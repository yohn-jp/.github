# gofmt stacked-PR autofix

The organization Go profile includes a same-repository pull-request autofix for
canonical Go formatting. It complements the merge-gating `gofmt -l .` check;
it does not replace or weaken Go CI.

The synchronized consumer wrapper runs on `pull_request_target` so its
definition is taken from the consumer default branch. External forks and
`autofix/gofmt/pr-*` branches are excluded before the reusable workflow is
called.

The formatter job checks out the exact source PR head as untrusted data and
checks out the consumer default branch separately as formatter authority.
`actions/setup-go` reads the Go version from the default branch `go.mod`.
The job runs only that toolchain's `gofmt` against tracked regular `*.go`
files. It never runs PR-authored tests, generators, scripts, packages, or
binaries.

When formatting changes exist, the formatter emits a bounded text patch and
provenance. A separate writer job re-reads the pull request, rejects stale
heads, validates that the patch applies to the exact source commit and changes
only existing regular Go files, and only then requests the dedicated Autofix
GitHub App token.

The writer publishes the repair to
`autofix/gofmt/pr-<source-pr-number>` and creates or reuses one stacked pull
request targeting the original source branch. It never pushes to the source
branch and never auto-merges the repair.

## Credentials

Consumers use the same dedicated Autofix GitHub App configuration as the
Prettier autofix:

- Actions variable `AUTOFIX_APP_ID`;
- Actions secret `AUTOFIX_APP_PRIVATE_KEY`.

The App token is scoped to the current repository and needs Contents read/write,
Pull requests read/write, and Metadata read access. There is no PAT or token
fallback.

## Consumers

The workflow is distributed through the organization Go sync profile to
Jinushi, Hachidori, and Matagi.
