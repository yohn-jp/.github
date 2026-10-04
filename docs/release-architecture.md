# Organization release architecture

This document is the organization-level authority for release automation in
`yohn-jp`. Product repositories consume release mechanisms; they do not fork
or reimplement them.

## Authority

Reusable workflows in `yohn-jp/.github` are the canonical implementation of
release mechanics. Consumer repositories may define product-specific build,
test, smoke-test, and certification logic, but must not duplicate installation,
packing, artifact-integrity, provenance, publication, or release orchestration.

Consumers reference canonical reusable workflows at `@main`. Pinning an
organization-owned reusable workflow to an old commit, copying it locally, or
maintaining a parallel publication workflow is an architectural divergence and
requires migration rather than compatibility preservation.

## Release invariants

1. **Pre-release parity.** Every validation command, artifact construction step,
   certification verifier, integrity check, and smoke test that can block a
   release must execute before a Release is created. Publication credentials
   and the external publish side effect are the only release-only operations.
2. **Same reusable path.** PR/main certification and Release publication use the
   same reusable workflow implementation. A similar test workflow is not
   equivalent.
3. **Exact artifact.** Build/pack creates one artifact. Certification,
   smoke-testing, and publication operate on those exact bytes, with digest
   verification between stages. Repacking is forbidden.
4. **No hidden consumer tooling dependency.** A shared workflow must not assume
   an undeclared consumer devDependency merely to execute shared orchestration.
   Consumer-owned verifier entrypoints must satisfy the documented shared
   runtime contract.
5. **Fail before release.** A failure reproducible without publication authority
   is a defect in the pre-release gate if it first appears after Release
   creation.
6. **Consumer thinness.** Consumer workflow files declare triggers, product
   inputs, and permissions and call the shared workflow. Product-specific
   release orchestration does not belong in consumer YAML.
7. **Shared fixes are shared.** A defect in a reusable release mechanism is
   fixed in `.github`, documented there, and validated through a real consumer;
   per-product workarounds are not the remedy.

## Canonical release families

| Artifact family | Canonical reusable workflow | Pre-release contract | Publication |
| --- | --- | --- | --- |
| npm / TypeScript CLI | `npm-publish.yml@main` | same workflow in dry-run/certification mode | npm Trusted Publishing (OIDC) |
| Go / Linux | `go-release.yml@main` | shared build/verification contract | GitHub Release artifact |
| Go / Windows | `go-windows-release.yml@main` plus product E2E certification | shared build plus Windows E2E | certified GitHub Release artifact |

Different artifact families may have different canonical workflows. Products
within one family must not acquire independent release implementations merely
because a historical fix was made locally.

## npm lifecycle

```text
PR / main candidate
  -> npm-publish.yml@main (dry-run)
  -> install
  -> typecheck
  -> test
  -> build
  -> pack exactly once
  -> consumer certification verifier
  -> artifact digest verification
  -> clean smoke install/test
  -> release-ready

GitHub Release of the certified revision
  -> npm-publish.yml@main
  -> same validation/build/pack/certification/smoke path
  -> npm OIDC publish of the verified tarball
```

A dry run may synthesize release metadata such as
`RELEASE_TAG=v<package.json version>` and use `github.sha` as
`RELEASE_SOURCE_SHA`. It must not skip executable certification merely because
publication has not occurred.

## Ownership boundary

The shared repository owns runner setup, Node/pnpm policy, dependency
installation policy, version/tag validation, repository metadata validation,
pack orchestration, artifact integrity, smoke orchestration, OIDC publication,
and release-state mechanics.

A consumer owns its package metadata and product behavior: `package.json`,
source, `typecheck`/`test`/`build` scripts, a Node-built-in smoke-test
entrypoint, and—where needed—a product-specific certification verifier. The
consumer verifier defines what product evidence means; the shared workflow
defines when and how the verifier is executed.

## Current inventory and convergence

Audit performed 2026-10-04 against repository workflow files.

| Product | Family | Current mechanism | Status / required action |
| --- | --- | --- | --- |
| gh-inari | npm | `npm-publish.yml@main` | canonical wrapper; require executable pre-release certification parity |
| wabachi | npm | `npm-publish.yml@main` | canonical wrapper; require executable pre-release certification parity |
| suzukuri | npm | `npm-publish.yml@main` | canonical wrapper; require executable pre-release certification parity |
| cli-canon | npm | `npm-publish.yml@main` | canonical wrapper; require executable pre-release certification parity |
| tsukai | npm | `npm-publish.yml@main` | canonical wrapper; require executable pre-release certification parity |
| yokodori | npm | `npm-publish.yml@main` | canonical wrapper; recovery consumer for parity defect |
| gh-makami | npm | shared workflow pinned to a commit, with local runtime overrides | migrate to canonical `@main` contract unless an explicit product requirement is documented |
| nawabari | npm | repository-owned publish workflow | divergence: migrate release mechanics to canonical shared workflow |
| mottainai | npm | repository-owned publish workflow | divergence: migrate release mechanics to canonical shared workflow |
| jinushi | Go/Linux | `go-release.yml@main` | canonical |
| hachidori | Go/Windows | `go-windows-release.yml@main` plus Windows E2E publication gate | canonical product-family specialization |
| mihari | PowerShell/Windows | no canonical release wrapper identified in this audit | define family contract before adding release automation |
| arcadia-platform | private workspace | no publish workflow | outside current public release scope |
| arcadia-loom | private workspace; local publish script exists | no shared publish workflow | migrate if/when public package publication is enabled |
| majiwari | private workspace | no publish workflow | outside current public release scope |
| white-sigil | private package | no publish workflow | outside current public release scope |
| PresentHTML | non-npm in this audit | no npm release workflow | outside npm contract |

The inventory records migration state; it does not authorize preserving a
divergence. When a product moves onto a canonical family, remove the superseded
local release implementation.

## Change requirements

A change to a canonical release workflow is incomplete until:

- its contract documentation is updated in the same change;
- provider CI is green;
- a real consumer exercises the changed reusable path without publication;
- release-only behavior is limited to credentials/external publication;
- no consumer-specific workaround is introduced to compensate for a shared
  defect.

When a release failure reveals a reusable-workflow defect, fix and certify the
shared contract first. Only then create the next immutable product Release.

## Adding a product

Choose the artifact family, implement the required product scripts, add only a
thin caller workflow referencing the canonical `@main` workflow, and ensure
PR/main invokes the pre-release path. A new product must not bootstrap by
copying another product's release YAML.
