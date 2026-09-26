# Developer Portal v2 design package

This directory is the approved implementation handoff for the next `dev.yohn.jp` revision.

## Selected direction

Implement **Design A's visual language / brand experience with Design C's information architecture / Product Atlas structure**.

Portal v2 is an evolution of the existing static portal, not a rewrite. Preserve the current product registry, EN/JA localization, Product pages, Work dashboard, Governance, dependency Graph, GitHub collection semantics, Pages deployment, and custom-domain behavior.

## Files

- `design-spec.md` — implementation contract distilled from the approved research and mock package.
- `prototype.html` — compact self-contained A × C browser mock for visual/layout reference.

The original research package used to approve this direction was larger; these files intentionally contain only the material an implementation worker needs in-repository.

## Authority

For implementation use, in order:

1. Accepted implementation Issue and latest maintainer instruction.
2. Current repository governance and canonical portal implementation.
3. This approved A × C design package.
4. Current product repositories and documentation for exact product behavior.

The prototype contains illustrative metric values only. Never publish them as measured values. Missing, stale, partial, failed, and unsupported metrics must remain distinguishable.

`portal/registry.json`, current collectors, product repositories, and executable contracts remain authoritative for machine identity and actual runtime behavior.
