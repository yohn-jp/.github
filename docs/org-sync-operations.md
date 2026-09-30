# Organization sync operations

How files in this repository reach consumer repositories, and the procedures
for changing that. Read this before editing `.github/sync-groups.yml`.

## Model

```text
.github/sync-groups.yml   (the only hand-edited source)
        │  node scripts/generate-sync-config.mjs
        ▼
.github/sync.yml          (generated, flat, committed; never edit by hand)
        │  sync-org-templates.yml (one repo-file-sync-action step)
        ▼
consumer repositories     (direct push to the default branch)
```

`sync-org-templates.yml` regenerates `sync.yml` before syncing, but the
committed copy is validated (`--check`), so regenerate and commit it with every
change to `sync-groups.yml`.

`sync-groups.yml` has four parts:

| Key               | Meaning                                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| `file-groups`     | Named lists of `source`/`dest` mappings. Keep each group one feature (`governance`, `npm-release`, ...). |
| `bundles`         | Files that only work together (a workflow and the local files it references). See below.                 |
| `default-include` | Groups every sync group receives first (`common`, `agent-governance`).                                   |
| `sync-groups`     | `repositories` plus `include` of extra groups/bundles. List **only what differs** from the default.      |

Entries may set `deleteOrphaned: true` (directories such as the Skills tree):
files removed here are also removed in consumers.

A repository must appear in exactly one sync group. Two different sources
mapped to the same `dest` in one repository is an error.

## Bundles: never distribute a workflow alone

If a distributed workflow references a local file (`./.github/...`,
`./scripts/...`, or a `config-file:` value), that file must be distributed to
the same repository. Put both in a bundle and include the bundle:

```yaml
bundles:
  codeql:
    - source: templates/workflows/codeql.yml
      dest: .github/workflows/codeql.yml
    - source: .github/codeql/codeql-config.yml
      dest: .github/codeql/codeql-config.yml
```

`generate-sync-config.mjs --check` fails with the repository, workflow and
missing path when a dependency is not distributed. This is what caused CodeQL
to fail in repositories that received `codeql.yml` without
`codeql-config.yml`. `metadata-validation.yml` runs the check, so the PR is
blocked.

Never add a missing file by hand in a consumer; it is org-managed and arrives
through sync.

## Procedures

### Add a repository

1. Add it to a group in `.github/sync-groups.yml` (`repositories`). Use an
   existing group when the repository is of the same kind; create a group only
   for a real difference, listing only the extra groups/bundles in `include`.
2. Add its short name to `repositories:` of the `Create GitHub App token` step
   in `.github/workflows/sync-org-templates.yml`. Without it the token has no
   access and the run fails with `Resource not accessible by integration`. A
   test enforces that this list equals the repositories in `sync-groups.yml`.
3. Confirm the sync GitHub App is installed on the repository.
4. If the repository should receive Prettier autofix, it needs the shared pnpm
   setup contract and a `format` script, and must be added to
   `compatibleConsumers` in `test/integration/prettier-autofix-workflow.test.mjs`
   and `docs/prettier-autofix.md`.
5. Add it to the repository list in `test/sync-release-governance.test.mjs`.
6. `node scripts/generate-sync-config.mjs`, then commit `sync.yml`.

### Add a file to everyone

Add the mapping to `common` (metadata) or `agent-governance` (agent
instructions, workflow guidance, runtime profiles, Skills). Regenerate.

### Add a file to some repositories

Create or extend a small file group and include it from the sync groups that
need it. If the file is a workflow with local dependencies, make it a bundle.

### Add a workflow template

Put the template in `templates/workflows/`, then distribute it with the
mechanism above. `templates/workflows/**` triggers a sync on push to `main`.

## Validation

Run before pushing a sync change:

```sh
node scripts/generate-sync-config.mjs --check
pnpm test
pnpm run validate
```

Review the `sync.yml` diff: every added or removed `dest` must be intended. A
refactor of `sync-groups.yml` alone should change no (source, dest) pair.

## After merge

The sync runs on push to `main`. Confirm in the `Sync org templates` run, then
check a consumer's default branch for the expected files and that its CodeQL
(or other affected) workflow is green. Report an unconfirmed result as
unconfirmed.

## Pitfalls already hit

- Adding a repository in only one place (repository list, token scope, agent
  mapping). Now there is a single list plus the token-scope test.
- `sync.yml` committed stale. `--check` catches it.
- A workflow distributed without its config file. Bundles and the dependency
  check catch it.
- Tests with hard-coded repository lists go stale when a repository is added
  (step 5 above).
