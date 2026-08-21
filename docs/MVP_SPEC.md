# Coaching Carousel Rebuilt MVP specification

**Status:** Implementation-ready baseline  
**Last updated:** 2026-08-20
**Product authority:** [`Concept.txt`](Concept.txt)  
**UI plan:** [`ui_concept.md`](ui_concept.md)  
**Architecture:** [`architecture.md`](architecture.md)

This document defines the build boundary for the first usable CCR release. `Concept.txt` remains authoritative for approved simulation rules; this specification defines what the MVP must ship and how completion will be judged.

## Product outcome

Given one supported CFP National Championship week dynasty save, CCR runs one complete external coaching carousel, obtains required user decisions, validates the final plan, and emits one new verified CFP National Championship week save plus an audit report while preserving the input.

## Included workflow

1. Select and read-only validate a dynasty save.
2. Confirm detected dynasty/user context, freshly generated Unix-time run seed, and complete engine settings; allow an exact recorded seed to be reused for a deterministic rerun.
3. Lock the input and settings when the user begins.
4. Run Part 1 departures, evaluations, contract decisions, and initial openings.
5. Run Part 2 HC rounds followed by concurrent OC/DC rounds until every seat is filled.
6. Stop for every user-school or user-Coach decision and approved protection/override.
7. Present Part 3 review, storylines, cascade history, before/after staffs, and final validation.
8. Compile to a temporary copy only after explicit final authorization.
9. Reopen and verify the temporary output.
10. Publish one collision-safe short-named output and report beside the input.
11. End with concise human-operated in-game instructions.

Closing before finalization discards the run. Settings persist independently; carousel progress does not.

## MVP capabilities

### Save boundary

- Header-driven, explicitly supported schema selection.
- CFP National Championship week checkpoint validation.
- Team, Coach, contract, opening, offer, history, program-point, and user-control normalization.
- Original input treated as immutable.
- Copy/write/reopen/verify finalization with a machine-readable mutation manifest.
- Fail closed on unsupported schema, invalid references, insufficient proven capacity, duplicate employment, or financial/invariant failure.

### Carousel engine

- Deterministic output from input save, configuration, seed, and recorded user choices.
- Approved Part 1 departure, performance, contract, succession, and protection rules.
- Deterministic early-termination buyouts for school-initiated dismissals before contract expiration, increasing with full years remaining and career wins.
- Separate School Interest and Coach Interest with visible components and reason codes.
- Deterministic eligibility and ordered shortlists.
- HC stage before concurrent OC/DC stage.
- Three-turn rounds: Schools Make Offers, Coaches Consider Offers, Results & New Openings.
- Simultaneous offers, one move per Coach, final offers, and complete vacancy cascades.
- External reservation/commitment ledger for Staff Offer Program Points, including buyout expenses that reduce replacement-offer capacity.
- Event-capacity preflight using only validated native structures and safety policy.

### User interaction

- User Coach decisions are always made by the user.
- User HC controls coordinator retention, dismissal, browsing, offers, and approved overrides.
- Every user-controlled early dismissal previews its buyout, remaining hiring resources, and replacement-budget consequence before confirmation.
- Hidden CPU amounts remain concealed before submission and become visible after reveal.
- Skip Ahead stops for user decisions, protections, overrides, or validation problems.
- Every meaningful outcome can be explained from stored score components and events.

### Interface

- Windows desktop application.
- NCAA 14-inspired top tabs, ordered queue, Team-branded detail card, new-opening alerts, and persistent action/status bar.
- Approved Bahnschrift typography system—semi-condensed/condensed bold display text and regular-width body text—plus the black/charcoal, silver/white, gold, and Team-color direction.
- Tailwind CSS 4 and daisyUI 5 component foundation behind CCR-owned React wrappers and a custom `ccr` theme; built-in daisyUI themes do not define the product appearance.
- Brief NCAA-inspired in-shell event animations for school deliberation, Coach selection, offers, departures, hires, and cascading vacancies. Animations present deterministic outcomes, preserve simultaneous-offer reveal boundaries, and never auto-advance: Space or the visible Advance button moves one stage at a time. Reduced-motion equivalents retain the same manual progression.
- Team headers show current-season record, national ranking when available, program prestige, and conference; every visible Coach presentation labels that record with the actual loaded dynasty year and shows career record plus prestige, `lvl.`, and age. The numeric level uses a contrast-safe low-to-high color scale from 10 through 50, clamped at its endpoints, but remains informational in the initial MVP and does not implicitly become a scoring factor. Coach portraits use contextual Team-color backgrounds with a large subdued flat-helmet layer and primary-logo fallback. Cascade reveals connect the old role upward to the Coach's new role and give the resulting new opening the dominant consequence card. Departure categories retain type-specific styling, but queued events update one mounted stage directly without full-screen replay or stale-state flashing; grouped performance resets show affected coordinators as readable supporting Coach cards with the same metadata.
- Schema-driven Settings with exact values, descriptions, defaults, reset behavior, and run locking.
- Keyboard-accessible and scaling-safe at the supported minimum window size.

### Reporting

- Human-readable carousel report.
- Machine-readable event ledger and mutation/verification manifest.
- Movement totals by role, extensions and buyouts separately, user decisions/overrides, offers, prices, contracts, cascades, warnings, output path, and verification result.

## Explicitly outside MVP

- Game UI automation.
- Earlier-week or post-EOS import requirements.
- Unfinished-carousel resume.
- A general dynasty dashboard or ongoing sync service.
- Cloud accounts, multiplayer coordination, or hosted storage.
- Automatic updating.
- macOS/Linux builds.
- Presentation settings or qualitative gameplay presets.
- Dependence on prior CCR seasons or an external dynasty-history database.

## Delivery increments

### M0 — executable shell

- Electron opens with secure main/preload/renderer separation.
- Fixture-driven carousel shell runs locally.
- Typecheck, tests, renderer build, and portable packaging pass.

### M1 — Part 2 vertical slice

- Ordered offer queue.
- One user-school offer.
- One user-Coach decision.
- Simultaneous results reveal.
- At least one accepted hire creates a new vacancy.
- Filled Positions and New Openings update from domain events.

### M2 — normalized read adapter

- Supported fixture loads read-only into the normalized model.
- Preflight identifies checkpoint, schema, user context, and structural integrity.
- No production write path is exposed.
- **Current status:** complete. The read-only adapter produces a source-fingerprinted normalized snapshot of Conferences, all Teams and staffs, Coaches, résumé/contract/job-security/scheme data, records and ratings, program-point resources and role budgets, staged openings, native offers, and indexed Staff Moves. The supported fixture passes more than 2,000 reference, ownership, and employment-coherence checks with zero findings; the earlier-week negative fixture remains blocked. No production write path is exposed.

### M3 — complete deterministic engine

- Parts 1 and 2 complete from normalized state.
- Multi-seed calibration and invariant suites pass.
- Settings are generated from the shared configuration schema.
- **Current status:** in progress. The pure initialization boundary converts a validated snapshot into one deterministic seat per HC/OC/DC role, rejects missing, duplicate, or role-incoherent incumbents, records user context and seed, and retains native staged outcomes only as non-authoritative comparison evidence. It also reads the single finalized week-20 National Championship `SeasonGame`, verifies its winner/status against the final score, resolves both participants into normalized Team IDs, and supplies the winner automatically to `Retiring on Top` evaluation. Normal app initialization creates a fresh seed from Unix time in milliseconds plus season/save identity; explicit seeds remain available for exact reruns and calibration. Part 1 evaluates every incumbent with the approved role-specific 100-point weights, Team-linked unit performance/talent for coordinators, exact grace bonuses, calibrated HC 32 / OC 24 / DC 32 Fire cutoffs, independent failure-signal gates, catastrophic-failure checks, and visible component/reason evidence. On the locked research fixture it deterministically evaluates 429 seats as 33 Fire, 119 Vulnerable, and 277 Secure. An ordered departure planner resolves calibrated NFL departures, retirements, and Unexpected Scenarios, rejects duplicate Coach departures or vacancies, consumes nullified user-HC scenarios without rerolling, excludes generic FCS programs from both NFL and fictional-event targeting, and feeds the combined result into a separate pure performance-action planner. `Looking for a Change` creates a voluntary vacancy while preserving that Coach as an available candidate with no dismissal buyout. The performance planner converts Fire results into provisional dismissals, `Staff Not Retained` releases, `Cleans House` cascades, vacancies, and explicit user decisions while marking unresolved under-contract buyouts; Teams already affected by an earlier departure are excluded from a second performance action. Keyed seeded rolls and weighted sampling support auditable variation without introducing randomness into performance Fire results. The app presents four complete departure tabs with role/Conference filtering and detailed Coach cards, followed by manually paced and type-specific NFL, retirement, fictional-scenario, and grouped-performance reveals, including protected user decisions, direct in-place event advancement, and skip. Buyout affordability, contract decisions, shortlists, offers, and round resolution remain next.

### M4 — compiler and verification

- Proven write primitives are extracted from research scripts into a narrow adapter.
- Full plan compiles to a copy and independently verifies.
- Negative fixtures fail closed.

### M5 — review and release candidate

- Part 3, reports, final authorization, completion handoff, packaging, diagnostics, and clean-machine testing complete.

## MVP acceptance criteria

- A nontechnical user can identify the next action throughout the run.
- Every one of 429 staff roles is filled exactly once in the final plan.
- No Coach accepts more than one job or moves twice.
- Offer reservations and committed costs reconcile without exceeding the approved affordability boundary.
- Every early-termination buyout is reproducible from recorded contract years, career wins, configuration values, and reason codes; natural expiration and voluntary departure never incur one.
- Every opening, movement, contract, history entry, and user-control result passes preflight and post-write verification.
- The original save remains unchanged.
- The generated save reopens successfully before it is presented as complete.
- The same input/configuration/seed/choices reproduce the same event ledger.
- A tagged build produces a downloadable Windows x64 ZIP in GitHub Releases.

## Nonblocking decisions

The following may be finalized during the relevant increment: exact calibrated buyout formula values and bands, the validated native buyout-settlement representation, other calibrated formula values, over-capacity extension priority, report presentation format, final licensed fonts/logo assets, Team-asset licensing, config import/export, installer delivery, and code-signing provider.
