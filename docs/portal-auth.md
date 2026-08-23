# Portal collection authentication

`dev.yohn.jp` reads work across several public `yohn-jp` repositories. GitHub remains the source of truth; the Pages build only creates a static projection.

## Why a dedicated GitHub App

The workflow `GITHUB_TOKEN` is scoped to the repository that runs the workflow. It is therefore not used as authority for organization-wide collection. Public REST reads can run without authentication, but GitHub GraphQL requires authentication and Issue→PR linkage needs a credential that can read every configured repository.

Use a dedicated GitHub App so the portal receives a short-lived installation token with only the required repositories and read permissions. Do not use a long-lived classic PAT for the production portal path.

## App configuration

Create a GitHub App owned by `yohn-jp` with no webhook requirement and these repository permissions:

- **Metadata: Read-only**
- **Issues: Read-only**
- **Pull requests: Read-only**

Do not grant write permissions or unrelated organization permissions.

Install the App only on repositories configured in [`dashboard/repositories.json`](../dashboard/repositories.json). When that source list changes, update the App installation repository selection to match it. The workflow derives its requested token repository list from the JSON file, so it does not maintain another repository allowlist.

## Workflow configuration

Store the App client ID as a repository or organization Actions variable available to `.github`:

```text
PORTAL_APP_CLIENT_ID
```

Store the complete App private key as an Actions secret available to `.github`:

```text
PORTAL_APP_PRIVATE_KEY
```

The Pages workflow uses the GitHub-owned `actions/create-github-app-token` action pinned to an immutable commit. It requests only `issues: read`, `pull_requests: read`, and `metadata: read` and scopes the token to the configured portal repositories.

If `PORTAL_APP_CLIENT_ID` is unset, token creation is skipped. If the client ID is configured but the private key or App installation is invalid, the workflow fails rather than silently substituting another credential.

## Runtime boundary

The generated collection token is passed only to the build step as:

```text
PORTAL_GITHUB_TOKEN
```

`scripts/build-dashboard.mjs` does not fall back to `GITHUB_TOKEN` or `GH_TOKEN`. With no `PORTAL_GITHUB_TOKEN`, public REST requests are unauthenticated and GraphQL PR linkage is explicitly unavailable.

The token is never copied into `site/`, browser JavaScript, product data, or dashboard JSON. Existing browser-credential isolation tests guard this boundary.

## Expected degraded mode

Without App credentials the site still deploys:

- public repository and open-Issue REST data may load within anonymous API limits;
- native dependency REST data may load where public access permits;
- Issue→PR GraphQL linkage reports `unavailable` because authentication is absent;
- the dashboard reports a partial snapshot rather than treating missing relationship evidence as an empty authoritative set.
