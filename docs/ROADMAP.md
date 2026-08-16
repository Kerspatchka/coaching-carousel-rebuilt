# Coaching Carousel Rebuilt roadmap

**Document type:** Living product and engineering roadmap
**Last updated:** 2026-08-15
**Current phase:** Phase 2 — CCR Brainstorming & Product Design

## Product vision

Coaching Carousel Rebuilt (CCR) will replace EA Sports College Football 27's native coaching-carousel outcome with a transparent, configurable carousel run outside the game. It should create credible head-coach and coordinator movement, preserve visible Staff Moves history, respect the program-point economy, and safely commit the rebuilt landscape when the human advances Bowl Week 3 to End of Season.

## Fixed product constraints

- Production CCR accepts one supported Bowl Week 3 dynasty save and emits one finalized Bowl Week 3 dynasty save.
- It does not require users to preserve or provide saves from earlier weeks.
- Every carousel decision must be reproducible from the current BW3 save plus explicit CCR configuration and random seed. CCR must not require an external multi-season history database, prior CCR runs, or earlier-season snapshots for eligibility, valuation, interest, pricing, or market resolution.
- External session/audit data may support resume, explanation, and exported history, but it is non-authoritative. Deleting or losing it must not change the result of rerunning the same BW3 save with the same configuration and seed.
- For generic or low-information coaches, CCR may generate deterministic fictional lore and backstory from the current BW3 identity/context plus the run seed. Synthetic lore must be visibly labeled, must not overwrite native résumé facts, and must not imply that invented accomplishments occurred in the dynasty.
- The carousel simulation and all user choices occur outside the game.
- The dynasty save is mutated once, atomically, after the external carousel is finalized.
- The original input is preserved or backed up before output replacement.
- CCR never interacts with or automates the game UI. A human loads saves, advances weeks, and performs every in-game action.
- Save parsing and writing must fail closed on unsupported schema versions or checkpoint state.
- Every generated movement and financial adjustment must be explainable through an audit ledger.
- Human-operated research defaults to one validated treatment save compared with existing reference fixtures. New control/sham advances are reserved for mutation questions that cannot be isolated safely any other way.

## Validated foundation

The following capabilities or findings have controlled-save evidence:

- The native carousel begins before Bowl Week 1 and stages final outcomes through Bowl Week 3.
- At BW3, Team HC/OC/DC references still represent the pre-commit landscape while `JobOpening`, Coach pending state, and transaction history contain the staged native outcome.
- Rewriting `JobOpening.SelectedCoach` alone can alter the eventual EOS assignment.
- Rewriting the selected coach and synchronized transaction destination produces coherent Team/Coach assignments and Staff Moves entries at EOS.
- `OldTeam` can be preserved for team-to-team moves when the transaction history is rebuilt coherently.
- Native offers use `StaffPersonContractOffer`, expected/offered contract program points, base interest, and adjusted interest.
- CPU schools make variable program-point offers.
- Candidate order is represented both by `OfferIndex` and by position in the six-slot offer array; coherent pending-offer edits must maintain both representations and Coach offer counts.
- `Coach.IsNIL` is stable identity metadata, not the user-entered staff-offer amount and not a carousel eligibility restriction.
- Coordinator hiring uses the same global offer market as HC hiring, supports cross-role and HC-to-coordinator candidates, and can place one Coach in several simultaneous candidate lists before final resolution.
- User interest, offers received by the user Coach, and the accepted/staged outcome are separate persisted layers. CCR should preserve those concepts in its external event model even when it bypasses native transient offers at BW3.
- Native staff expenditures settle before BW3, but E1 proves the BW3 Team aggregate fields are not independently authoritative: EOS discarded a pool-conserving manual split and restored the native values.
- `RemainingProgramPoints + StaffProgramPointsSpent` behaves as the relevant conserved envelope during observed native carousel settlement, but direct edits to that split do not survive EOS without also changing its authoritative upstream state.
- The complete E1 Team-field series ruled out `RemainingProgramPoints`, `RolloverProgramPoints`, `ProgramPointBudget`, and `CoachContractGoalsProgramPoints` as independent refund authorities. Role budgets can durably reduce staff expense, but the same reduction is removed from the derived rollover and total budget, so no spendable refund is created.
- E1F proved the authoritative HC financial write path: changing a resolved HC opening's `FinalContractProgramPoints` from 30 to 5 made EOS reduce the destination Team's HC budget and staff spending by 25, increase remaining points by 25, and preserve rollover, total budget, NIL spending, and the combined staff pool.
- E2 proved the same resolved-opening price path for coordinators and in the same atomic write as an employment replacement. Pricing Auburn's rebuilt DC hire at 25 produced DC budget and staff spending `+25`, remaining points `−25`, a conserved staff pool, coherent employment and Staff Moves, and no non-ambient collateral.
- BW3 does not retain a reliable individual coach-price breakdown; every active Coach has `ContractSalary = 0` in the fixture.
- `StaffProgramPointsSpent` contains more than a simple modeled sum of the visible HC, OC, and DC prices, so CCR must use differential reconciliation rather than replace the entire aggregate.
- Native coach prestige has separate numeric score and letter-grade state with different update timing; the score can change without the grade, and the grade can refresh while the score remains fixed.
- Prestige is explicitly wired into native staff-hiring interest and contract-point tuning. It is a major market signal, but the first offer sample does not support treating it as the only attractiveness metric; Coach level remains especially important for head-coach pricing.
- A single BW3 save exposes current-season W/L and aggregate career résumé records for 419 of 497 coaches, plus a three-year contract-points window and current-year movement ledger. It does not contain a complete year-by-year employment/performance history; 78 generic pool coaches have no linked résumé.
- The 78 low-information generic coaches may receive CCR-generated lore, personality, career-origin, and narrative context. Generation is seeded and reproducible; native fields remain the source of truth for measurable résumé and market state.
- Parser reopen validation is necessary but not sufficient: a Gate 1 treatment that removed one opening, emptied two transactions, and compacted the history array was rejected by the game. In-game loadability is now an explicit gate before advancement, and destructive mutation axes must be isolated independently.
- Gate 1 proved that a native move already staged before BW3 can be canceled: selecting the incumbent in the existing opening and restoring Coach statuses retained D. Durkin at Auburn while leaving M. Payne a free agent at EOS.
- Safe cancellation does not require physical pre-EOS transaction deletion. Removing canceled transaction references from the Staff Moves array was loadable, and EOS automatically emptied the unindexed transaction records. Physical record deletion before EOS remains unsafe/unresolved.
- The National Championship is already finalized in the BW3 fixture (`SeasonGame` contains the 31–27 result). BW3-to-EOS preserves rather than resimulates it, so cloned BW3 experiment arms are expected to show the identical championship outcome.
- Gate 2 proved that CCR can introduce a free agent absent from every native BW3 selection. Replacing the opening selection, transferring a compatible transaction row to the new coach, and normalizing pending states produced a coherent Auburn hire, contract, previous-Team state, and history with no unexplained collateral changes.
- Gate 3A proved safe activation and indexing of a previously empty transaction row. The new row survived EOS, while the replaced active-but-unindexed row was cleaned up automatically, with no unexplained collateral changes.
- Gate 3B proved safe activation and EOS consumption of a new opening and paired offer-array row. It also showed that an opening selection plus pending Coach state is insufficient for a created vacancy: without a matching indexed transaction, EOS ignored M. Payne and auto-filled Florida with S. Tobias.
- Gate 3C showed that adding a coherent indexed Payne-to-Florida transaction still does not make allocated opening row 192 resolve. The row and offer array were cleaned up, and the transaction survived, but Florida again auto-filled with S. Tobias. Because native BW3 already occupies opening rows 0 through 191, the leading constraint is a 192-opening processing boundary.
- Gate 3D confirmed that boundary and completed the first generated cascade. Reusing in-range opening row 67 and indexed transaction 120 committed B. White from Florida to Auburn and M. Payne from the free-agent pool to Florida. The donated Rutgers slot fell back to S. Tobias as expected. Production writes must recycle opening rows 0 through 191; appending opening row 192 is not a valid assignment path.
- Gate 4 proved a complete bounded external-ledger rebuild with no unrelated donor school or fallback hire: Durkin was retained at Auburn, Scott was fired by Coastal Carolina, White moved Florida to Coastal, Payne filled Florida from the free-agent pool, Toure was released, and all retained/canceled history resolved coherently with zero unexplained collateral.
- Gate 5B proved the fixed-pool compiler can relocate 190 of 192 opening events while reproducing the complete native EOS Team staff, Coach employment, and Staff Moves ledgers. `JobOpening` rows are reusable when offer-array ownership follows the event, but indexed transaction identity is positional: array slot `i` must point to physical row `i+1` with `TransactionId = i`.
- Gate 6 committed the complete externally declared 429-role landscape: all 65 synthetic hires, 126 retentions, and the protected native user-Coach move resolved exactly, including the three-school HC cycle, with zero employment, Staff Moves, transaction-identity, or topology failures.
- Across all 43 Teams with generated hires, every `FinalContractProgramPoints` value settled exactly into the intended role budget and aggregate staff spending, and no remaining balance became negative. Eight Teams nevertheless diverged from the native-counterfactual remaining/NIL/rollover projection, proving EOS liquidity is not determined by staff-price delta alone at full-landscape scale.
- Gate 6B repeated the exact Gate 6 landscape with native destination prices and zero intended price delta. Seven Teams still changed EOS NIL/remaining liquidity, proving the landscape itself triggers coach-sensitive annual financial recomputation. Comparing Gate 6 with Gate 6B isolated 18 nonzero price changes: 16 settled through remaining points and two through rollover/total budget, with no mixed unexplained effects.

Research evidence and detailed experiment records live under [`docs/research/`](research/README.md).

## Experiment and evidence associations

This is the concise experiment ledger for roadmap-level conclusions. Detailed mutations, hashes, screenshots, and complete comparisons remain in the linked research documents and machine reports.

| ID | Status | Roadmap learning | Primary evidence |
|---|---|---|---|
| Lifecycle series | Complete | Native market initialization begins at Conference Championship; BW3 contains a staged plan, and BW3→EOS commits it. | [Weekly lifecycle analysis](research/internal-game-research/base-game-carousel-weekly-save-analysis.md) |
| S1 — selected-coach swap | Passed | `JobOpening.SelectedCoach` controls EOS employment, but selection-only edits leave Staff Moves stale. | [Experiment report](research/internal-game-research/bw3-selected-coach-swap-experiment.md), [machine result](../assets/experiments/bw3-selected-coach-swap/eos-evaluation.json) |
| S2 — synchronized history/`OldTeam` | Passed | Updating opening selections and hiring-transaction destinations together synchronizes employment and Staff Moves while preserving team-to-team `OldTeam`. | [Experiment report](research/internal-game-research/bw3-synchronized-history-and-oldteam-experiment-plan.md), [machine result](../assets/experiments/bw3-synchronized-history-oldteam/eos-evaluation.json) |
| G0 — reset inventory | Complete | The BW3 fixture exposes the pre-commit Team landscape, native staged opening/transaction topology, available fixed-pool capacity, and the invariants required before full-plan replacement. | [Gate 0 findings](research/internal-game-research/bw3-full-carousel-reset-test-plan.md#gate-0-forensic-reset-inventory) |
| G1 — cancel staged move | Passed after destructive variant failed | Select the incumbent, normalize Coach state, de-index canceled history, and let EOS clean records; physically emptying records before EOS is unsafe. | [Gate 1 record](research/internal-game-research/bw3-full-carousel-reset-test-plan.md#gate-1-cancel-a-native-firing-and-retain-the-incumbent), [machine result](../assets/experiments/bw3-full-reset/gate1-retain-auburn-dc-v2/eos-evaluation.json) |
| G2 — non-native free agent | Passed | A free agent absent from the native selected set can be committed by coherently replacing the opening selection, pending state, and transaction ownership. | [Gate 2 record](research/internal-game-research/bw3-full-carousel-reset-test-plan.md#gate-2-hire-a-coach-absent-from-the-native-selected-set), [machine result](../assets/experiments/bw3-full-reset/gate2-hire-bausby/eos-evaluation.json) |
| G3A — transaction allocation | Passed | A newly activated transaction row survives when uniquely identified and indexed; active unindexed rows are cleaned by EOS. | [Gate 3A result](research/internal-game-research/bw3-full-carousel-reset-test-plan.md#gate-3a-eos-result), [machine result](../assets/experiments/bw3-full-reset/gate3-transaction-row-activation/eos-evaluation.json) |
| G3B — opening without transaction | Failed intended assignment | A created opening, offer array, selection, and pending Coach state are insufficient without a matching indexed transaction. | [Gate 3B result](research/internal-game-research/bw3-full-carousel-reset-test-plan.md#gate-3b-eos-result) |
| G3C — appended opening with transaction | Failed intended assignment | Even a coherent appended row 192 is ignored by the assignment resolver, establishing a likely fixed opening-processing boundary. | [Gate 3C result](research/internal-game-research/bw3-full-carousel-reset-test-plan.md#gate-3c-eos-result), [machine result](../assets/experiments/bw3-full-reset/gate3-combined-cascade/eos-evaluation.json) |
| G3D — in-range cascade | Passed | Recycling an opening inside rows 0–191 commits a two-step active-Team/free-agent cascade; the native opening pool must be recycled rather than extended. | [Gate 3D result](research/internal-game-research/bw3-full-carousel-reset-test-plan.md#gate-3d-eos-result), [machine result](../assets/experiments/bw3-full-reset/gate3-in-range-cascade/eos-evaluation.json) |
| G4 — bounded subgraph rebuild | Passed | A complete three-school component can be regenerated from an external ledger inside the fixed opening pool, including retention, firing, active-Team hire, downstream free-agent hire, canceled-history cleanup, and coherent Staff Moves with no fallback or unexplained collateral. | [Gate 4 result](research/internal-game-research/bw3-full-carousel-reset-test-plan.md#gate-4-eos-result), [machine result](../assets/experiments/bw3-full-reset/gate4-subgraph-rebuild/eos-evaluation.json) |
| G5 — row-independent full plan | Failed presentation; employment passed | Moving 190 openings preserved every Team staff and Coach employment outcome, but moving 124 transactions broke the required Staff Moves identity layout: prestige rendered `Invalid Key`, conference filters emptied, and all moves appeared under HC. | [Gate 5 result](research/internal-game-research/bw3-full-carousel-reset-test-plan.md#gate-5-eos-result), [machine result](../assets/experiments/bw3-full-reset/gate5-native-equivalent-plan/eos-evaluation.json) |
| G5B — transaction identity invariant | Passed | Relocating 190 opening events while preserving array-slot/physical-row/`TransactionId` alignment reproduced native EOS Team staff, Coach employment, Staff Moves semantics, consumed topology, and transaction identity in both the named save and autosave; the human operator also confirmed the Staff Moves view looked corrected. | [Gate 5B result](research/internal-game-research/bw3-full-carousel-reset-test-plan.md#gate-5b-eos-result), [named-save result](../assets/experiments/bw3-full-reset/gate5b-transaction-invariant/eos-evaluation.json), [autosave result](../assets/experiments/bw3-full-reset/gate5b-transaction-invariant/autosave-evaluation.json) |
| G6 — synthetic full plan | Partial pass | All 429 Team roles, 65 synthetic hires, 126 retentions, the protected user move, Staff Moves, transaction identity, and generated role-budget/staff-expense outputs matched exactly. Eight of 43 priced Teams had additional EOS remaining/NIL/rollover variance, though none went negative. | [Gate 6 result](research/internal-game-research/bw3-full-carousel-reset-test-plan.md#gate-6-eos-result), [named-save result](../assets/experiments/bw3-full-reset/gate6-synthetic-full-plan/eos-evaluation.json), [autosave result](../assets/experiments/bw3-full-reset/gate6-synthetic-full-plan/autosave-evaluation.json) |
| G6B — native-price liquidity isolation | Passed | Seven Teams retained NIL/remaining variance at zero staff-price delta, proving a landscape-driven EOS financial effect. Across 18 nonzero Gate 6 price changes, 16 settled through remaining points and Houston/Liberty through rollover/total budget; no mixed effects remained. | [Gate 6B result](research/internal-game-research/bw3-full-carousel-reset-test-plan.md#gate-6b-eos-result), [named-save result](../assets/experiments/bw3-full-reset/gate6b-native-price-isolation/eos-evaluation.json), [autosave result](../assets/experiments/bw3-full-reset/gate6b-native-price-isolation/autosave-evaluation.json), [decomposition](../assets/experiments/bw3-full-reset/gate6b-native-price-isolation/liquidity-decomposition.json) |
| N1 — NIL/coordinator offer forensics | Complete, causal UI edges remain open | Staff-offer “NIL” is contract program points; CPU bids vary; coordinator hiring is cross-role/global; user interest, received offers, and accepted outcomes are distinct layers. | [Offer analysis](research/internal-game-research/nil-and-coordinator-offers-save-analysis.md) |
| E1 | Failed authority test | Directly changing remaining/staff-spent aggregates does not survive EOS. | [Economy experiment series](research/internal-game-research/nil-and-coordinator-offers-save-analysis.md#experiment-e1-eos-preservation-of-a-reconciled-bw3-split--highest-priority), [machine result](../assets/analysis/e1-program-points-eos-result.json) |
| E1B | Partial pass | A role-budget reduction survives as lower expense but also lowers derived total budget, producing no refund alone. | [E1B result](research/internal-game-research/nil-and-coordinator-offers-save-analysis.md), [machine result](../assets/analysis/e1b-program-points-role-budget-eos-result.json) |
| E1C–E1E | Rejected candidates | Rollover, total budget, and contract-goals Team fields are derived/cleared and cannot carry the refund. | [E1C–E1E record](research/internal-game-research/nil-and-coordinator-offers-save-analysis.md), [E1E machine result](../assets/analysis/e1e-coach-contract-goals-points-eos-result.json) |
| E1F — resolved HC price | Passed | `JobOpening.FinalContractProgramPoints` is authoritative for the tested HC price and produces an exact refund while preserving total budget and staff pool. | [Economy research record](research/internal-game-research/nil-and-coordinator-offers-save-analysis.md), [machine result](../assets/analysis/e1f-final-contract-points-eos-result.json) |
| E2 — combined coordinator move/price | Passed | The Bausby-for-Payne Auburn DC overwrite and a 25-point resolved-opening price committed atomically. Both returned saves show coherent employment/Staff Moves, DC budget and staff spending `+25`, remaining points `−25`, a conserved staff pool, valid transaction identity, and zero unexpected collateral. | [E2 result](research/internal-game-research/nil-and-coordinator-offers-save-analysis.md#experiment-e2-combined-staff-overwrite-plus-financial-recost), [named-save result](../assets/experiments/bw3-e2-coordinator-recost/eos-evaluation.json), [autosave result](../assets/experiments/bw3-e2-coordinator-recost/autosave-evaluation.json) |
| E5 — first pricing backtest | Complete, refinement required | Role/level pricing is viable as a baseline, but replacing total staff spending with three modeled prices overdraws 27 Teams; use authoritative final-price deltas around the captured base. | [Pricing analysis](research/internal-game-research/nil-and-coordinator-offers-save-analysis.md#experiment-e5-deterministic-pricing-bounds), [machine result](../assets/analysis/coach-pricing-model.json) |
| P1 — prestige/market models | Complete, causal mutation pending | Prestige is a first-class, role-specific market input; the combined role/level/grade/score price model outperforms simpler models, but prestige is not the sole attractiveness metric. | [Prestige analysis](research/internal-game-research/coach-prestige-calculation-and-market-analysis.md), [model comparison](../assets/analysis/coach-market-model-comparison.json) |
| H1 — one-save Coach history | Complete | One BW3 save provides useful compressed résumés for 419/497 Coaches and deterministic native fallbacks for the remaining 78, but not complete biographies. | [History availability](research/internal-game-research/bw3-coach-history-availability.md), [inventory](../assets/analysis/bw3-coach-history-inventory.json) |

## Reference-research associations

These sources inform product and engineering design but are not evidence of CCR's game-write authority:

| Source | Adopted learning |
|---|---|
| [ACE tools](research/reference-tool-research-media/ace-cli-tools-research.md) | Bundled runtime/schema, preview-first workflow, explicit commit, collision-safe backup, and audit output. |
| [KevinMiles carousel editor](research/reference-tool-research-media/kevin-miles-coaching-carousel-research.md) | Header-aware schema selection, verified offer/opening fields, dual candidate ordering, and separated desktop processes. |
| [PocketScout](research/reference-tool-research-media/pocketscout-tools-deep-review.md) | Signature-based semantic table resolution and strict compatibility gates; a successful physical parse is not sufficient validation. |
| [Slappey dynamic tools](research/reference-tool-research-media/slappey-dynamic-realignment-save-interactivity-research.md) | Pure plan/commit phases, capacity discovery, supply/demand preflight, fixed-pool graph validation, copied output, reopen verification, and post-verify audit commit. |
| [Ghost City tracker](research/reference-tool-research-media/ghostcity-recruiting-tracker-research.md) | Keep program strength, prestige, resources, geography, and coach fit distinct; label transparent CCR composites rather than claiming hidden EA formulas. |
| [Frosty Dynasty exports and Ace Practice Overhaul FBMOD](research/internal-game-research/frosty-stock-asset-export-analysis.md#dynasty-tuning-ftc--directory-0) | The parsed common and tuning FTCs expose the event-driven carousel lifecycle, financial-module connections, Bowl Season coordinator allocation, CPU budget postures, exact current 123-field staff-hiring tuning, and core offer/interest/contract splines. Directories 0 and 4 are complete hash-identical revision-4 snapshots; only directories 1–3 could still contain intervening distinct data. This does not supersede the validated one-save BW3 save-write design. |

## Game source and exported-data index

Review these read-only game exports whenever work touches the corresponding subsystem. They are extracted schemas, expressions, instantiated databases, and Frostbite assets—not a conventional decompilation of the game's executable—and must be paired with save-backed validation before a behavioral inference becomes a production rule. Directory `0` is the canonical current-patch FranTk reference because its complete 3,975-file tree is hash-identical to directory `4`.

Primary roots:

- [Complete Frosty mass export](../assets/mod_exports/)
- [Stock Frosty project](../assets/mod_exports/cfb27_stock.fbproject)
- [Canonical revision-4 FranTk database tree](../assets/mod_exports/legacy_explorer/common/franchise/0/)
- [Hash-identical directory-4 FranTk tree](../assets/mod_exports/legacy_explorer/common/franchise/4/)
- [Forensic interpretation and revision comparison](research/internal-game-research/frosty-stock-asset-export-analysis.md)

| Question or subsystem | Source entry points |
|---|---|
| Database layout and current schema | [Combined franchise schema](../assets/mod_exports/legacy_explorer/common/franchise/0/franchise-schemas.FTX), [individual franchise schemas](../assets/mod_exports/legacy_explorer/common/franchise/0/franchise-schemas/), [football schemas](../assets/mod_exports/legacy_explorer/common/franchise/0/football-schemas/) |
| Instantiated Dynasty behavior and tuning | [Dynasty runtime database](../assets/mod_exports/legacy_explorer/common/franchise/0/dynasty-dynasty-binary.FTC), [tuning database](../assets/mod_exports/legacy_explorer/common/franchise/0/dynasty-tuning-binary.FTC), [expression database](../assets/mod_exports/legacy_explorer/common/franchise/0/dynasty-expression-binary.FTC), [generator database](../assets/mod_exports/legacy_explorer/common/franchise/0/dynasty-generatordata-binary.FTC) |
| Carousel lifecycle and BW3/EOS hooks | [`StaffHiringEval`](../assets/mod_exports/legacy_explorer/common/franchise/0/franchise-schemas/staffhiringeval.FTX), [`SeasonInfo` period flags](../assets/mod_exports/legacy_explorer/common/franchise/0/franchise-schemas/seasoninfo.FTX), [postseason-week start reaction](../assets/mod_exports/legacy_explorer/common/franchise/0/franchise-schemas/coachcarousel_postseasonweekstartreaction.FTX), [postseason-week end reaction](../assets/mod_exports/legacy_explorer/common/franchise/0/franchise-schemas/coachcarousel_postseasonweekendreaction.FTX), [staff-hiring start reaction](../assets/mod_exports/legacy_explorer/common/franchise/0/franchise-schemas/staffhiringperiodstartreaction.FTX), [staff-hiring end reaction](../assets/mod_exports/legacy_explorer/common/franchise/0/franchise-schemas/staffhiringperiodendreaction.FTX) |
| Offers, coach interest, CPU bidding, and pricing | [`StaffPersonContractOffer`](../assets/mod_exports/legacy_explorer/common/franchise/0/franchise-schemas/staffpersoncontractoffer.FTX), [`StaffHiringTuning`](../assets/mod_exports/legacy_explorer/common/franchise/0/franchise-schemas/staffhiringtuning.FTX), [`StaffHiringPhilosophy`](../assets/mod_exports/legacy_explorer/common/franchise/0/franchise-schemas/staffhiringphilosophy.FTX), [offer/save analysis](research/internal-game-research/nil-and-coordinator-offers-save-analysis.md) |
| Program points, NIL, allocation, and EOS finance | [`ProgramPointsTuning`](../assets/mod_exports/legacy_explorer/common/franchise/0/football-schemas/programpointstuning.FTX), [`ProgramPointsTimeline`](../assets/mod_exports/legacy_explorer/common/franchise/0/franchise-schemas/programpointstimeline.FTX), [CPU allocation postures](../assets/mod_exports/legacy_explorer/common/franchise/0/franchise-schemas/programpointsbudgetallocationposture.FTX), [`FranchiseServer_FinancesFlow`](../assets/mod_exports/legacy_explorer/common/franchise/0/franchise-schemas/franchiseserver_financesflow.FTX) |
| Coach state, openings, and Staff Moves history | [`CoachingStaffPerson`](../assets/mod_exports/legacy_explorer/common/franchise/0/franchise-schemas/coachingstaffperson.FTX), [`JobOpening`](../assets/mod_exports/legacy_explorer/common/franchise/0/franchise-schemas/jobopening.FTX), [`CoachTransactionHistoryEntry`](../assets/mod_exports/legacy_explorer/common/franchise/0/franchise-schemas/coachtransactionhistoryentry.FTX) |
| Dynasty bootstrap and Frostbite packaging | [Dynasty mode schematic](../assets/mod_exports/global/Logic/frontend/dynastymodeclass_schematics.xml), [shared game-mode chunk collector](../assets/mod_exports/ContentShared/global/RtamStorages/Gamemode_Common.xml), [Ace Practice Overhaul reference mod](<../assets/ref_mod/Ace's Practice Overhaul 2.1 (Masochist Mode).fbmod>) |

## Confirmed BW3 save-write contract

The implementation must treat the following as hard requirements unless a later controlled experiment overturns them:

- Read Team HC/OC/DC references as the pre-carousel staff baseline. Do not infer the committed EOS landscape from those references at BW3.
- Express each retained or rebuilt move through a coherent combination of an in-range `JobOpening`, the selected Coach's pending state, and a matching transaction-history entry.
- Treat `JobOpening` as a fixed 192-row processing pool. CCR may rewrite and recycle rows 0 through 191, including rows freed by canceled native events, but must not depend on appended row 192 or later for EOS assignment.
- Keep each selected Coach unique across active openings and resolve the external market globally before writing the save.
- Preserve or deliberately rebuild `OldTeam`, `NewTeam`, old/new role, contract status, and transaction-array indexing so Staff Moves agrees with the committed assignment.
- New transaction records are allowed when assigned a unique ID and added to the transaction array. An active transaction omitted from that array is cleaned up by EOS.
- Staff Moves transaction identity is positional: array slot `i` must reference transaction row `i+1`, and that record must have `TransactionId = i`. Do not freely reorder transaction rows or array entries even when their semantic event fields are preserved.
- Do not physically empty canceled transaction records before EOS. De-index them and allow EOS cleanup; the physical-deletion experiment produced an unloadable save.
- Normalize every displaced or canceled Coach out of stale pending state. Free agents introduced by CCR can be committed when the opening, Coach state, and transaction agree.
- Expect EOS to auto-fill a vacancy whose opening is missing, ignored, or donated to another event. Validators must distinguish declared fallback collateral from unexplained changes.
- Do not write the Team program-point aggregates as though they were independent balances. `RemainingProgramPoints`, rollover, total budget, and contract-goal points are derived or recomputed at EOS. Role budgets are durable but do not create a spendable refund by themselves.
- Price resolved HC and coordinator hires through the in-range opening's `FinalContractProgramPoints`; EOS consumes that value exactly into the destination role budget and staff spending. Isolated E1F/E2 changes reconciled exactly through remaining points, but Gate 6 shows that full-landscape EOS can also change NIL spending, rollover, and total budget, so the staff-price delta alone cannot forecast final remaining liquidity for every Team.
- Reopen and semantically validate every generated save before delivery, then require one human-operated in-game load and advance for any newly introduced mutation axis.

## Four-phase delivery roadmap

### Phase 1 — Game & Tool Research

**Status:** Complete

**Purpose:** Prove that CCR is technically feasible, identify a safe interception boundary, and establish what the game and existing tools can reliably expose or modify.

Completed outcomes:

- Established the one-save Bowl Week 3 workflow and human-operated BW3-to-EOS validation process.
- Proved complete external replacement of the native staged coaching landscape across all 429 Team roles.
- Proved coherent HC, OC, and DC movement, Staff Moves history, `OldTeam`, and transaction identity.
- Proved resolved-opening `FinalContractProgramPoints` as the authoritative staff-price settlement input.
- Identified the fixed 192-opening pool and positional transaction-ledger constraints.
- Mapped the principal program-point, NIL, prestige, offer, candidate, and lifecycle records.
- Indexed the current revision-4 FranTk schemas, instantiated databases, Frostbite exports, and reference-mod packaging route.
- Reviewed relevant community tools and adopted their strongest safety, compatibility, backup, and validation patterns.

Phase 1 is closed as a broad discovery effort. Future research must answer a specific Phase 2 design decision, Phase 3 implementation blocker, compatibility issue, or observed defect; it does not reopen the phase by default.

### Phase 2 — CCR Brainstorming & Product Design

**Status:** Current phase

**Purpose:** Decide what CCR should simulate, what experience it should provide, and where it should intentionally reproduce or depart from EA's native carousel.

Design workstreams:

- Define the MVP user journey from BW3 import through final validated export.
- Define firing, retention, retirement, departure, and vacancy-generation rules.
- Define HC/OC/DC candidate eligibility, promotions, demotions, lateral moves, and poaching.
- Define school interest, Coach interest, fit, prestige, résumé, and low-information fallback models.
- Define coach valuation, expected price, CPU bids, escalation, withdrawal, waiting, acceptance, and tie-breaking.
- Define user applications, unsolicited offers, simultaneous offers, declines, and acceptance.
- Define global market rounds, conflict resolution, downstream vacancy recascading, and deterministic seeding.
- Define affordability reserves, landscape-driven liquidity disclosure, and insufficient-budget behavior.
- Define generic-Coach lore, fictional labeling, configurable rules, and difficulty or realism presets.
- Define the normalized domain model, application boundaries, audit ledger, and UI concepts needed to implement the design.

Every rule must be labeled as one of:

- reproduced from validated native behavior;
- calibrated from native behavior but implemented by CCR;
- intentionally redesigned for transparency, control, or realism.

**Exit condition:** A written MVP product and simulation specification is precise enough to implement without unresolved choices that would materially change results, finances, or the user workflow.

### Phase 3 — Build, Integration & Testing

**Status:** Not started

**Purpose:** Convert the proven write contract and Phase 2 specification into a complete local alpha.

Planned sequence:

1. Build the canonical save adapter with schema/checkpoint validation and normalized reads.
2. Build the deterministic pure carousel engine and immutable audit ledger.
3. Build the fixed-pool save compiler for openings, Coach state, transaction history, and final prices.
4. Add atomic output, backup, reopen validation, mutation allowlists, and diagnostic reports.
5. Convert Gates 5B, 6, and 6B into automated regression fixtures.
6. Build the external user interface on top of the stable adapter and engine.
7. Run integrated human-operated BW3-to-EOS acceptance tests across representative dynasties.
8. Resolve defects, performance problems, recovery paths, and unsupported-input handling.

**Exit condition:** A local alpha can import one supported BW3 save, complete a deterministic external carousel, export a validated finalized save, and commit correctly at EOS with explainable employment, history, and financial outcomes.

### Phase 4 — Beta Release

**Status:** Not started

**Purpose:** Make the validated alpha safe and understandable for users outside the research workflow.

Release workstreams:

- Package an installer or portable distribution with required runtime and schema resources.
- Enforce supported-version compatibility gates and fail safely after unknown title updates.
- Provide automatic backups, recovery instructions, and actionable error reporting.
- Provide onboarding, the BW3 workflow guide, configuration documentation, and known limitations.
- Provide privacy-conscious diagnostic exports suitable for external bug reports.
- Conduct a closed beta across varied teams, dynasty histories, Coach populations, and carousel sizes.
- Triage compatibility, usability, balancing, and performance feedback.
- Define patch-response, versioning, release-note, and support processes.

**Exit condition:** Outside testers can complete the supported CCR workflow safely and report actionable failures without understanding dynasty-save internals or requiring direct developer intervention.

## Supporting research and implementation detail

### Completed economy-authority research

**Status:** Complete — resolved-opening final contract price proven authoritative for HC and coordinator hires

Experiment E1 now uses one treatment save, `DYNASTY-CCRE1POINTS`, compared against the existing EOS reference fixture from the identical BW3 source. The treatment moves 25 points from Air Force's `StaffProgramPointsSpent` to `RemainingProgramPoints` while preserving the combined pool and leaving `NILProgramPointsSpent` unchanged.

Result:

- The live BW3 input retained the intended `205 remaining / 335 staff spent` state and loaded successfully.
- Both the named EOS save and branch autosave returned Air Force to the native reference values: `575 remaining / 360 staff spent / 470 NIL spent`.
- EOS therefore recomputed or restored the staff-spending split from other authoritative data. Writing only `RemainingProgramPoints` and `StaffProgramPointsSpent` cannot implement CCR reconciliation.
- Air Force's unchanged BW3 role budgets are `HeadCoachProgramPointBudget = 330`, OC = 15, and DC = 15, which sum to the restored 360 staff-spent value. This is the leading next mutation axis, but the same equality holds for only 12 of 143 BW3 Teams, so it is not yet a general formula.

Follow-up E1B completed with a partial authority result. Air Force's HC budget 330→305 and staff spent 360→335 both survived EOS, proving the role budget is authoritative for that isolated staff-expense component. The attempted remaining-points increase did not survive. Instead, EOS reduced `RolloverProgramPoints` 410→385 and `ProgramPointBudget` 1570→1545, leaving `RemainingProgramPoints` at the native 575. Lowering the role budget alone lowers both expense and available budget; it does not create a refund.

E1C completed and ruled out BW3 `RolloverProgramPoints` as the missing refund authority. Although the +25 rollover edit was present in the loaded input, EOS produced the exact same Air Force financial state as E1B: HC budget 305, staff spent 335, rollover 385, total program budget 1545, and remaining 575. EOS recomputes rollover and ignores its direct BW3 edit.

E1D completed and ruled out direct BW3 `ProgramPointBudget` mutation. Despite the +25 input edit, EOS again produced the exact E1B/E1C state: HC budget 305, staff spent 335, rollover 385, total budget 1545, and remaining 575. The role budget is durable; remaining, rollover, and total program budget are derived during EOS.

E1E completed and ruled out `CoachContractGoalsProgramPoints` as the missing refund authority. EOS cleared the BW3 0→25 edit and produced the exact same Air Force state as E1B/E1C/E1D: remaining 575, staff spent 335, HC budget 305, rollover 385, total budget 1545, and contract-goals points 0. The explicit save and branch autosave agree semantically. The tested Team-side candidates are therefore exhausted: the role-budget reduction is durable, but none of the exposed Team credits or aggregates can return that reduction to spendable points during the BW3-to-EOS transition.

A read-only upstream trace found no per-Team balance ledger behind those fields. `FranchiseServer_FinancesFlow.ProgramPointsTimeline` is a static asset reference identical at BW3/EOS; `ProgramPointsBudgetRequest` contains UI request metadata but no point amounts; budget-allocation posture is also static asset configuration. Any further in-save financial research must now target authoritative resolved-opening/contract state rather than another Team aggregate field. If that state cannot create a coherent refund from one BW3 save, CCR must use economy-neutral or external-only accounting.

E1F proved the resolved HC opening is the financial authority. Changing only Kent State opening row 108 `FinalContractProgramPoints` from 30 to 5 produced the exact true-refund signature at EOS: HC budget and staff spending fell from 30 to 5, remaining points rose from 360 to 385, rollover stayed 50, total budget stayed 460, NIL spending stayed 10, and the combined staff pool stayed 390. The explicit EOS save and autosave have zero focused semantic differences.

E2 then proved the rule is role-general and atomic with a coordinator rewrite. The already-validated Bausby-for-Payne Auburn DC replacement was priced from 0 to 25 without writing Team aggregates. Both returned saves made Bausby Auburn's DC, retained coherent Staff Moves and positional transaction identity, raised Auburn's DC budget and staff spending from 0/1550 to 25/1575, lowered remaining points from 2255 to 2230, preserved the 3805 staff pool and every unrelated budget field, and produced zero non-ambient collateral.

Gate 6 confirmed the authoritative price outputs at scale: all 43 priced Teams received the exact generated role budgets and aggregate staff-spending deltas. It also narrowed the guarantee. Thirty-five Teams matched the native-counterfactual remaining-liquidity prediction, while eight had additional EOS NIL, rollover, total-budget, or remaining changes. The compiler can guarantee staff cost and reject negative projected plans, but it must not promise an exact post-EOS spendable balance from staff-price delta alone until the separate annual liquidity flow is modeled.

Gate 6B separated those effects. With every destination restored to its native final/highest price, seven Teams still changed NIL/remaining liquidity, so those changes are caused by the synthetic coaching landscape rather than staff pricing. Gate 6's 18 nonzero price deltas were additive to that landscape effect: 16 reconciled through remaining points, while Houston and Liberty reconciled through rollover and total budget. The write adapter can therefore expose exact staff cost while treating final spendable liquidity as a game-derived value protected by a conservative preflight reserve.

### Coach-valuation research feeding Phase 2

**Status:** Grouped role/level/prestige model comparison complete; production calibration required

The initial deterministic model uses 241 populated native expected-price observations and showed that a simple three-role price replacement would overdraw 27 of 143 Teams. The follow-up grouped comparison tested role, level, prestige grade, and prestige score without leaking repeated Coach/opening rows across folds. The full combined model performed best for price prediction at coach-grouped MAE 15.2 and opening-grouped MAE 16.3, while Team-interest predictors differed materially by role. This is evidence for a role-specific combined model, not yet a production formula or causal proof.

Next work:

- add program tier, Coach résumé, role transition, current employment context, school fit, and competing-offer context;
- expand fixtures and use controlled mutations before treating observational prestige/level coefficients as causal production weights;
- incorporate BW3 aggregate career résumé and three-year recent-performance fields, with an explicit low-information fallback for generic pool coaches;
- define the seeded generic-coach lore grammar, plausibility constraints, fictional labeling, and separation between narrative-only traits and market-scoring traits;
- separate incumbent renewal expectations from open-market expectations;
- backtest modeled native-to-CCR deltas against every Team's available remaining/spent split;
- define deterministic rounding, minimums, maximums, and insufficient-budget behavior;
- define how user-selected offer amounts affect acceptance probability.

## Detailed deliverables mapped to the four phases

### Completed one-save write boundary — Phase 1

**Status:** Complete

- Treat a resolved HC or coordinator opening's `FinalContractProgramPoints` as the authoritative price EOS uses to reconstruct the destination role budget, staff spending, and remaining points.
- E2 combined a proven coordinator overwrite with a coherent final-price mutation in one atomic BW3 treatment with no unexpected collateral.
- Define the complete semantic mutation allowlist and post-write validator.

**Exit condition:** One atomically modified BW3 save commits both a rebuilt coaching result and its reconciled financial delta without unexplained collateral changes.

### Canonical save adapter — Phase 3

**Status:** Not started

- Validate schema and BW3 checkpoint eligibility.
- Read Teams, Coaches, contracts, openings, offers, transaction history, and program-point fields into a stable domain model.
- Reconstruct both the pre-commit Team landscape and native staged final landscape from the same BW3 save.
- Provide atomic output, backup, reopen validation, and a machine-readable mutation report.
- Centralize table IDs, binary-reference handling, the fixed 192-row opening recycler, safe transaction allocation, and transaction-array maintenance.

**Exit condition:** A reusable adapter can load one supported BW3 save, expose a normalized carousel state, write an approved plan, reopen it, and validate every invariant.

### Carousel rules and coach-market scoring — Phase 2 design and Phase 3 implementation

**Status:** Research in progress

- Determine job-opening triggers, retention rules, firing thresholds, and retirement/pro-departure policy.
- Define candidate eligibility for HC, OC, and DC roles, including promotions, demotions, and cross-role coordinator moves.
- Create school-interest and coach-interest models with explainable factors.
- Implement deterministic coach pricing and variable CPU bidding within Team budgets.
- Use the current-patch native policy as a calibration reference: CPU offer evaluation is configured for a 90% increase chance, 15% increase amount, 5% withdrawal chance, and 25% Coach-wait chance. CCR need not reproduce those probabilities exactly, but its alternative must be explicit and deterministic from the session seed.
- Model user applications, unsolicited offers, declines, withdrawals, acceptances, and simultaneous offers.
- Resolve the market globally so one coach cannot accept multiple jobs and downstream vacancies recascade.

**Exit condition:** Given one normalized BW3 state and a random seed, the engine produces a complete, reproducible, financially valid carousel plan and audit ledger.

### Complete BW3 landscape replacement — Phase 1 proof and Phase 3 productionization

**Status:** Full landscape/history and staff-price write surface passed; conservative liquidity policy required

Gates 1–3D established the safe primitives: repurpose in-range openings, normalize Coach state, allocate or recycle indexed transactions, de-index canceled history, and let EOS perform physical record cleanup. Gate 4 combined those primitives successfully in a complete three-school external-ledger subgraph with no fallback or unexplained collateral.

Gate 5 scaled the fixed-pool compiler across the entire native staged plan and cleanly separated opening authority from Staff Moves presentation. Canonicalizing 190 opening rows preserved every Team staff slot and Coach employment/contract outcome at EOS, supporting opening-row independence when offer-array ownership is updated. Canonicalizing 124 transaction rows failed because Staff Moves joins transaction identity to array and physical position. Gate 5B retained all 190 opening relocations while preserving all 124 instances of `array slot i → transaction row i+1 → TransactionId i`. The named EOS save and autosave then matched native Team staff, Coach employment, semantic Staff Moves, consumed topology, and transaction identity with zero differences; human visual review also reported the Staff Moves view looked corrected. The fixed-pool native-equivalent write contract is therefore validated, while Gate 6 still must prove a completely synthetic full-scale plan.

Gate 6 now compiles a deterministic full-plan ledger from the single BW3 save and seed `CCR-G6-2026-08-15`. It externally chooses all 192 opening outcomes: 126 retentions, 65 synthetic hires, and one protected native user-Coach move. The synthetic market includes all three roles, 24 active-Team moves, 42 free-agent hires, 27 cross-role hires, and the Mississippi State → Arizona State → Boise State → Mississippi State HC cycle. It moves 190 opening events through the canonical allocator while leaving all 124 transaction rows in positional identity. The saved role/level model proposes prices, then a one-save-safe cap prevents each Team's generated final-price total from exceeding the native staged total it replaces. Preflight covers all 429 Team roles with no duplicate Coach and no projected negative EOS balance; live EOS behavior remains the experiment question.

EOS committed every declared role and history event exactly. The named save and autosave agree semantically, all generated staff prices became the correct role budgets and staff expense, and no Team went negative. The only rejected assumption is exact remaining-liquidity prediction: eight Teams had downstream NIL/rollover/remaining variation beyond the generated staff-price delta. The employment and history write surface is therefore proven at full scale; the remaining production work is liquidity policy, forecasting, and implementation.

Gate 6B proved that seven of those variances survive at native prices and are landscape-driven, while the staff-price effect remains separately measurable and additive. The remaining product task is policy rather than another write-surface discovery: preserve a conservative affordability reserve, disclose that exact EOS remaining liquidity is game-derived, and verify it after advancement.

- Cancel native movements that CCR does not retain.
- Restore or normalize coaches removed from the native plan.
- Introduce CCR-selected free agents and actively employed coaches.
- Create downstream openings absent from the native topology by recycling canceled native rows within the fixed 0–191 opening pool.
- Rebuild `JobOpening`, Coach pending state, transaction records, transaction arrays, and offer-resolution values coherently.
- Model the desired economic delta in CCR's audit ledger:

```text
modeled delta = CCR final staff price - native staged final staff price
```

- Do not apply the delta directly to Team aggregate fields. Write the CCR price to each coherent resolved opening's `FinalContractProgramPoints`; E1F and E2 prove this settlement path for HC and coordinator openings.
- Predict the EOS-derived role budget, staff spending, and remaining points from the opening prices, and reject any external plan that would imply a negative balance.

**Exit condition:** A full 143-Team regenerated carousel commits correctly at EOS and passes employment, history, finance, and collateral-difference validation.

### External user experience — Phase 2 design and Phase 3 implementation

**Status:** Not started

- Import and validate one BW3 save.
- Present openings, candidates, interest, program-point budgets, and offers.
- Allow the user to control their own applications and coordinator offers.
- Show CPU carousel events and cascades in a clear timeline.
- Support save/resume through CCR-owned session data without rewriting the dynasty save.
- Provide final review, warnings, audit report, and one explicit finalize/export action.

**Exit condition:** A user can complete the entire rebuilt carousel outside the game and export a validated BW3 save without understanding the underlying save format.

### Compatibility, safety, and release readiness — Phases 3 and 4

**Status:** Not started

- Add fixture-based regression tests for supported game updates and schemas.
- Detect title-update incompatibilities and refuse unsafe writes.
- Test autosave-safe backup and recovery behavior.
- Package dependencies and schema resources appropriately.
- Document the human BW3 import/export/EOS workflow.
- Add diagnostic export suitable for bug reports without requiring game UI automation.

**Exit condition:** CCR can be distributed with a repeatable install, safe update policy, recovery path, and regression-tested save compatibility.

## Open decisions

- Final coach valuation formula and calibration targets.
- Exact user-offer reservation and settlement semantics within the external ledger.
- Whether CCR should expose native-like offer rounds or a more transparent turn-based market.
- Rules for Teams whose BW3 remaining balance cannot absorb a positive modeled delta.
- Treatment of renewals, retained incumbent prices, and multi-year contracts.
- Whether to offer optional non-authoritative longitudinal reports without implying that CCR depends on them for simulation.
- Which synthetic generic-coach attributes are presentation-only and which, if any, may become explicit configurable fit/personality inputs.
- How much native `JobOpening` offer metadata should be reconstructed for history versus kept only in CCR's audit ledger.
- Application architecture, distribution format, and user-interface technology.

## Immediate next steps

1. Define the Phase 2 MVP boundary and the complete user journey from BW3 import through validated export.
2. Decide the carousel's market structure: job-opening generation, candidate eligibility, rounds, bidding, user decisions, acceptance, and vacancy recascading.
3. Finalize the explainable interest, valuation, pricing, affordability-reserve, and generic-Coach fallback models.
4. Decide which native behaviors CCR reproduces, calibrates, or intentionally redesigns, and document the rationale for each departure.
5. Define the normalized domain model, audit ledger, application architecture, and UI concepts needed by Phase 3.
6. Convert the Phase 2 decisions into an implementation-ready MVP specification and ordered Phase 3 backlog.
7. Perform additional source analysis or human-operated game experiments only when a specific unresolved decision cannot be answered from existing evidence.

## Roadmap maintenance rules

Update this document whenever work changes:

- an experiment is prepared or evaluated; update its stable-ID row in the experiment ledger with status, concise learning, and evidence links;
- a phase, deliverable, or experiment status;
- a validated capability or falsified assumption;
- a fixed product constraint;
- an architectural or economic decision;
- an unresolved blocker or immediate priority.

Detailed forensic evidence belongs in `docs/research/`; this roadmap should retain the concise product-level conclusion and link to the supporting research.
