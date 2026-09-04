# Portal collection authentication

`dev.yohn.jp` reads work across several public `yohn-jp` repositories. GitHub remains the source of truth; the Pages build only creates a static projection.

## Why a dedicated GitHub App

The workflow `GITHUB_TOKEN` is scoped to the repository that runs the workflow. It is therefore not used as authority for organization-wide collection. Public REST reads can run without authentication, but GitHub GraphQL requires authentication and Issue→PR linkage needs a credential that can read every configured repository.

Use a dedicated GitHub App so the portal receives a short-lived installation token with only the required repositories and read permissions. Do not use a long-lived classic PAT for the production portal path.

## App configuration

Create a GitHub App owned by `yohn-jp` with no webhook requirement and these repository permissions:

- **Contents: Read-only**
- **Metadata: Read-only**
- **Issues: Read-only**
- **Pull requests: Read-only**

Do not grant write permissions or unrelated organization permissions.

Any existing GitHub App installation used by the portal must also include **Contents: Read-only** in its repository permissions; update the App configuration and installation before using the workflow.

Install the App only on repositories listed or product-mapped in [`portal/registry.json`](../portal/registry.json). When the registry changes, update the App installation repository selection to match it. The workflow derives its requested token repository list from the validated registry, so it does not maintain another repository allowlist.

## Workflow configuration

Store the App client ID as a repository or organization Actions variable available to `.github`:

```text
PORTAL_APP_CLIENT_ID
```

Store the complete App private key as an Actions secret available to `.github`:

```text
PORTAL_APP_PRIVATE_KEY
```

The Pages workflow uses the GitHub-owned `actions/create-github-app-token` action pinned to an immutable commit. It requests only the four required read permissions: `contents: read`, `metadata: read`, `issues: read`, and `pull_requests: read`; it scopes the token to the configured portal repositories.

If `PORTAL_APP_CLIENT_ID` is unset, token creation is skipped. If the client ID is configured but the private key or App installation is invalid, the workflow fails rather than silently substituting another credential.

## Governance collection contract

Issue governance is a separate operational capability from public Issue
collection. Before evaluating any Issue, the build runs an Inari preflight for
each repository: it authenticates, discovers the repository-native governance
contract, and reads the trusted contract source. Per-Issue evaluation does not
start when that preflight is unavailable.

The portal does not treat anonymous access as sufficient for governance. Public
REST Issue collection may run anonymously, but Inari's repository contract
authority requires the authenticated collection token. A missing or blank
`PORTAL_GITHUB_TOKEN` produces an unavailable governance collection and leaves
every Issue `unknown` with `valid: null`; unknown evidence is never compliant.

Operational diagnostics use stable reasons:

- `authentication-unavailable` — no collection token was provided;
- `insufficient-permissions` — the token cannot read the required repository
  source or Issue;
- `inari-contract-unavailable` — Inari contract discovery or trusted-source
  read failed;
- `evaluator-failed` — an unexpected per-Issue evaluator failure;
- `repository-source-unavailable` — public repository/Issue collection failed.

The generated `governanceHealth.collection` projection reports `healthy`,
`degraded`, or `unavailable` repository collection, with cause counts and
bounded diagnostic messages. The Governance page renders these causes and the
repository-level state. It does not recreate Inari validation semantics.

Inari's Issue dependency projection (blocked/blocking state; see
[portal-work-links.md](portal-work-links.md#blocker-projection)) rides the
same governance evidence and therefore the same preflight: it is available
only when governance for that Issue is `valid`, so every cause above that
leaves governance `unknown` also leaves the Issue's blocker projection
`unavailable`. This is deliberate — Portal does not maintain a second
collection-health model for dependencies.

## Runtime boundary

The generated collection token is passed only to the build step as:

```text
PORTAL_GITHUB_TOKEN
```

`scripts/build-dashboard.mjs` does not fall back to `GITHUB_TOKEN` or `GH_TOKEN`. With no `PORTAL_GITHUB_TOKEN`, public REST requests are unauthenticated and GraphQL PR linkage is explicitly unavailable.

The token is never copied into `site/`, browser JavaScript, product data, or dashboard JSON. Existing browser-credential isolation tests guard this boundary.

## Expected Pages behavior

When `PORTAL_APP_CLIENT_ID` is unset, the token step is skipped deliberately.
The Pages build still publishes the public portal, but it must be visibly
degraded:

- public repository and open-Issue REST data may load within anonymous API limits;
- GitHub-native dependency REST data may still load where public access
  permits, but it is shown only as observed metadata and never drives
  blocked/blocking classification;
- Issue→PR GraphQL linkage reports `unavailable` because authentication is absent;
- governance preflight reports `authentication-unavailable`, all governance
  projections remain `unknown`/`valid: null`, the Inari blocker projection is
  `unavailable` for the same reason, and the Governance page shows the
  unavailable cause;
- the generated dashboard status is `partial`; missing governance evidence is
  never silently presented as a complete snapshot.

If the App client ID is configured but the private key, installation, or
requested permissions are invalid, App-token creation fails and the Pages
build fails. It never substitutes `GITHUB_TOKEN`, `GH_TOKEN`, a PAT, or an
anonymous result for the required governance capability.
