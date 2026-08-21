# MVP application architecture

**Status:** Initial implementation decision  
**Last updated:** 2026-08-20

## Technology decision

CCR will begin as a Windows Electron desktop application using React, TypeScript, Vite, and Electron Forge. The renderer's component foundation is Tailwind CSS 4 with daisyUI 5, integrated through the Tailwind Vite plugin and pinned to exact package versions in the app lockfile. CCR uses a custom theme and deliberate component overrides rather than shipping an unchanged daisyUI theme. The release target is a portable Windows x64 ZIP. The deterministic engine is framework-independent so packaging, styling, or renderer technology can change without rewriting carousel policy.

Bahnschrift is the renderer's approved type family. CCR uses the Windows-supplied variable font rather than bundling or redistributing `Bahnschrift.ttf`: semi-condensed/condensed bold weights serve display text, while regular-width weights serve body text. The supported Windows 10/11 target includes Bahnschrift; explicit Segoe UI and generic sans-serif fallbacks keep failure behavior readable.

## Process boundary

```text
React renderer
  presentation, user intent, local view state
        |
        | narrow typed preload API
        v
Electron main process
  file dialogs, session orchestration, finalization authority
        |
        +-- normalized save adapter
        +-- deterministic carousel engine
        +-- compiler / verifier
        +-- report writer
```

The renderer has no Node integration or arbitrary filesystem access. `contextIsolation`, sandboxing, and a narrow preload bridge are required. Save mutation is never exposed as a generic renderer command.

The implemented M2 bridge exposes `getAppInfo()` and `selectAndInspectSave()` only. Save selection and parsing occur in the main process; the renderer receives a serialized preflight result containing the normalized `DynastySnapshot` and never receives a filesystem primitive or franchise-library object. The snapshot includes a SHA-256 source fingerprint, stable source-derived IDs, Conferences, Teams, Coaches, staffs, résumé/contract/job-security/scheme context, resources, staged openings, native offers, indexed Staff Moves, and a complete integrity result. Binary references remain adapter evidence and never become market-policy inputs. The selected save is opened read-only and is never passed to the parser's `save()` method. The portable package carries the tested schema 833.0 as an Electron resource and injects the parser plus its production dependency closure into the packaged ASAR after Vite's copy phase, preserving the parser's own runtime-path behavior.

## Source boundaries

- `src/core` — pure domain types, reducer/state machine, scoring, market resolution, ledgers, and deterministic RNG.
- `src/save` — schema selection, franchise-table repositories, normalization, reference audits, compiler, and reopen verification.
- `src/config` — the shared configuration schema consumed by engine and Settings UI.
- `src/main` — Electron window lifecycle, file dialogs, orchestration, and authorized commands.
- `src/preload` — typed allowlisted bridge.
- `src/renderer` — React application and NCAA-inspired presentation components.
- `src/shared` — IPC contracts and cross-boundary result/error types.

Dependencies point inward: Electron and React may depend on domain contracts; the core engine may not import Electron, React, filesystem APIs, or franchise-library records.

## Normalized model

Stable identifiers are strings that retain source table/row identity without exposing binary references to domain policy.

```text
DynastyContext
  season, checkpoint, schema, seed, userContext, teams, coaches

DynastySnapshot
  sourceFingerprint, season, conferences, teams, coaches,
  stagedOpenings, nativeOffers, indexedStaffMoves, integrity

Team
  id, name, conference, prestige, record, ratings, staff, resources

Coach
  id, identity, role, employer, contract, résumé, prestige,
  schemes, userControlled, availability, evidenceConfidence

BuyoutQuote
  id, teamId, coachId, role, dismissalReason, contractYearsRemaining,
  careerWins, basePoints, remainingTermPoints, careerWinsPremium,
  modifiers, totalPoints, reasonCodes

Opening
  id, teamId, role, reason, incumbentId, stage, age, priority,
  status, shortlist, selectedCoachId, parentEventId

Offer
  id, openingId, teamId, coachId, role, round, term,
  expectedPoints, offeredPoints, schoolInterest, coachInterest, status

CarouselEvent
  id, sequence, part, stage, round, type, subjectIds,
  facts, reasonCodes, parentEventId, visibility

LedgerEntry
  teamId, sourceId, kind(reserve/release/commit/buyout), points, balanceAfter

CompilationPlan
  sourceFingerprint, finalStaff, openings, transactions,
  contracts, prices, buyouts, userControl, allowlist, invariants
```

## State machine

The UI renders engine state rather than inventing workflow state:

```text
setup -> preflight -> ready -> part1
-> part2.hc(schools -> coaches -> results)*
-> part2.coordinators(schools -> coaches -> results)*
-> part3 -> authorized -> compiling -> verifying -> complete
```

The implemented transition from `ready` constructs a pure `MarketBaseline`: 3 seats per normalized Team, unique role-coherent incumbents, deterministic seeded ordering inputs, user contexts, and native staged outcomes retained only as evidence. A second pure transition produces `PartOneEvaluation` from that baseline and the same normalized snapshot. It retains every weighted component, reason detail, failure signal, grace result, catastrophic-failure result, and user-confirmation requirement; it does not yet remove a Coach or create a vacancy. This separation keeps scoring/calibration independently testable from departure, buyout, contract, and market mutations.

An internal packaged batch mode reuses the production preflight, normalizer, market initializer, and evaluator without opening a window or writing to dynasty saves. Given explicit save-directory roots and an output path through environment variables, it inventories top-level dynasty files, records blocked checkpoints and integrity failures, separates natural/reference and named experiment cohorts, deduplicates byte-level files and semantically identical evaluation landscapes, and emits machine-readable classification, role, score, signal, component, tenure, grace, outlier, and threshold-sensitivity evidence. It is a calibration/diagnostic path only and is not exposed as an end-user workflow.

Any user decision creates a recorded deterministic command. Events are append-only during a run. Derived screens—queue, New Openings, Filled Positions, round history, cascades, and reports—are projections of the same event/state data.

An early dismissal is one atomic domain command: calculate and record the immutable `BuyoutQuote`, verify affordability, commit the buyout ledger entry, release the Coach, and create the resulting opening or `Cleans House` cascade. Formula inputs and reason codes are retained so the result is deterministic and auditable. The compiler adapter may translate this expense only through a separately validated native financial authority; derived Team balance fields remain outside its allowlist.

## Error contract

Errors include phase, stable code, summary, evidence, affected entities, whether retry is safe, and the required next action. Integrity warnings cannot be hidden by the renderer.

## Testing strategy

- Unit tests for pure rules, reducers, score components, RNG, and ledgers.
- Scenario tests for complete multi-round markets and cascades.
- Fixture tests for normalization and compiler manifests.
- Negative fixtures for unsupported schemas, invalid references, capacity failure, duplicate Coaches, and financial failure.
- Packaged smoke test on Windows.
- Human-operated in-game validation only for questions requiring the game; CCR never drives the game UI.

The packaged smoke-test mode is intentionally non-interactive: when both `CCR_PREFLIGHT_SMOKE_SAVE` and `CCR_PREFLIGHT_SMOKE_OUTPUT` are set, the main process runs the same packaged preflight adapter, writes a JSON result, and exits without creating a window. This verifies the ASAR dependency closure, external schema resource, and production path resolution rather than merely retesting source modules.
