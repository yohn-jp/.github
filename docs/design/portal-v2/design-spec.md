# Developer Portal v2 — A × C implementation specification

## Intent

Turn `dev.yohn.jp` into the product portal for the yohn-jp ecosystem: a strong brand entry point, a precise Product Atlas, and an engineering observatory backed by real repository evidence.

The approved composition is:

- **A for visual language:** editorial, restrained, premium, large typography, deliberate whitespace, paper/ink surfaces, strong product imagery, minimal decorative motion.
- **C for information architecture:** products and responsibility boundaries are the primary navigation model; engineering state and current work are first-class projections beneath that model.

Do not redesign this into a generic SaaS dashboard.

## Preserve the current system

Portal v2 must retain the existing architecture unless a bounded implementation need proves otherwise:

- static GitHub Pages output;
- `portal/registry.json` as product identity/relationship registry;
- EN/JA output and existing Product pages;
- Work issue dashboard, Governance, and native dependency Graph;
- GitHub Issue/PR relationship collection semantics;
- explicit unavailable/partial collection states;
- CNAME and Pages deployment;
- current browser geometry/accessibility regression protection.

The live portal and repository data remain authorities. This package is a presentation and information-architecture contract.

## Target routes

```text
/
├── products/<product>/
├── engineering/
└── work/
    ├── governance/
    └── graph/
```

Locale variants remain first-class under `/en/` and `/ja/`.

## Home

Order the narrative approximately as:

1. **Brand Hero** — one strong statement about governed agent infrastructure; editorial visual treatment.
2. **Product Atlas** — the product family is the main object, not repository cards.
3. **System relationships** — show ownership/delegation without implying false runtime dependencies.
4. **Engineering snapshot** — compact real metrics with provenance/freshness.
5. **Current Work** — entry into the existing operational dashboard.

The first viewport should feel like a product/brand site. Data density should increase toward Engineering and Work.

## Product Atlas

Refresh the catalog against current repository truth. At minimum inspect Mottainai, Nawabari, Inari, Suzukuri, Wabachi, Majiwari, CLI Canon, and Shikitari.

Keep descriptions concise and responsibility-oriented. Do not copy README prose mechanically.

Known audit points:

- CLI Canon and Shikitari were absent from the six-product portal snapshot and should be evaluated for inclusion.
- Majiwari remains a product.
- Wabachi must reflect current repository-analysis and Architecture Canon capabilities, not an obsolete early-stage description.
- Relationships describe actual authority/delegation/adjacency, not aesthetic grouping.

## Product detail

Each Product page should expose, where applicable:

- identity and one-line role;
- why it exists;
- current capabilities;
- what it owns and explicitly does not own;
- architecture/ecosystem position;
- maturity/status;
- engineering metrics;
- current/recent work;
- related products;
- repository/documentation links.

These are curated projections, not README mirrors. Exact CLI/API behavior remains authoritative in the product repository.

## Engineering

Add an Engineering surface, preferably `/engineering/`.

Establish one versioned canonical metrics model and project it into Engineering overview, Home summary, and Product pages.

Useful fields include source/test LOC and file counts, test count/pass/skip, coverage lines/branches/functions with scope, verification status/duration/provenance, package/version/release metadata, and freshness/provenance.

Metric rules:

- Never invent a value or convert missing data to zero.
- Distinguish available, unavailable, unsupported, stale, partial, and collection failure where relevant.
- Generated/vendor/dist/lockfiles/coverage output and vendored code must not inflate Source LOC.
- Source LOC and Test LOC remain separate.
- Coverage carries provenance/scope so unlike reports are not presented as equivalent.
- Prefer existing consumer-produced CI/quality artifacts.
- The scheduled Pages build must not become a cross-repository test farm.
- Portal v2 must not require edits to all product repositories merely to render Engineering.

Existing organization test-effectiveness infrastructure can emit coverage artifacts when consumers opt in. Consume authoritative evidence when present; otherwise show absence explicitly.

## Visual system

Use the established editorial portal character and move it toward Design A:

- off-white/paper surfaces;
- near-black/deep-ink typography;
- restrained lime/accent for state/action, not decoration;
- large editorial headings;
- fine rules and structured whitespace;
- dark inverse sections where they clarify system content;
- product imagery/marks as focal elements where real assets exist.

Avoid generic dashboard chrome, glassmorphism, floating blobs, neon gradients, excessive cards, parallax, 3D tilt, and looping animation.

Home/Product may be expressive. Engineering/Work/Governance/Graph favor legibility while sharing the same tokens.

## Responsive and accessibility

EN/JA and desktop/mobile are acceptance criteria. Preserve and extend browser tests for no horizontal overflow, no CTA/content collision, 320–390px mobile behavior, Japanese variable-length content, keyboard-visible focus, reduced motion, and navigation continuity.

Do not hide content behind JavaScript animation initialization.

## Implementation boundaries

Prefer extending the current renderer/build rather than adding a frontend framework. Expected write scope is `portal/**`, directly required `dashboard/**`, portal build/render/registry/detail/metrics scripts, `messages.js`, portal/browser tests, and the Pages workflow only if collection inputs actually require it.

Do not modify other yohn-jp repositories as part of Portal v2.

## Recommended order

1. Re-read current portal and latest product repositories.
2. Reconcile product registry/detail canon.
3. Add versioned Engineering metrics schema/model and collector boundaries.
4. Implement Engineering with explicit unavailable/partial states.
5. Restructure Home to the A × C narrative.
6. Upgrade Product detail projection.
7. Project Engineering summaries into Home/Product.
8. Apply the final A visual pass and shared tokens.
9. Preserve/align Work, Governance, and Graph.
10. Extend EN/JA responsive/browser tests.
11. Build, inspect representative routes in a browser, run required validation, then publish the implementation PR.

## Completion contract

Portal v2 is complete only when Home expresses A × C, Product Atlas accurately represents the ecosystem, Engineering shows only authoritative evidence, Product pages combine responsibility/capability/metrics/work, existing Work/Governance/Graph remain functional, EN/JA and mobile/desktop are robust, and repository-required validation is green.

README badges and cross-repository instrumentation rollout are follow-up projections, not prerequisites.
