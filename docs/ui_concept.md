# Coaching Carousel Rebuilt UI concept

**Document status:** Phase 2 working UI plan  
**Last updated:** 2026-08-20
**Product source:** [`Concept.txt`](Concept.txt)  
**Reference images:** [`../assets/ncaa14_ref`](../assets/ncaa14_ref)

This document translates the approved CCR product concept into an initial desktop UI direction. It defines the intended experience, information architecture, primary screens, interaction patterns, and an implementation sequence. It is not yet a pixel-perfect specification, final brand system, or commitment to a UI framework.

## 1. Experience statement

CCR should feel like a live coaching-carousel broadcast controlled by the user one turn at a time. It is not a general dynasty dashboard and should not feel like a bulk database editor.

The interface should make three things continuously understandable:

1. What just happened?
2. What opening, Coach, or decision is active now?
3. What will happen when the user advances?

The app opens quietly, validates one CFP National Championship week save, and lets the user confirm settings. Once the carousel begins, the main shell stays visually stable while Parts 1-3 change its content. The run ends with one explicit finalization action, a verified new save, and human-operated in-game instructions.

## 2. Reference synthesis

### NCAA 14 coaching-carousel references

The NCAA 14 screens provide the interaction model:

- a prominent top tab rhythm for `Now Hiring`, new/unexpected openings, and `Filled Positions`;
- an ordered left queue of schools with visible active, waiting, new, and completed states;
- a large Team-branded detail surface instead of a spreadsheet as the primary view;
- immediate visibility when one hire creates the next opening;
- vacancy reasons, candidate context, and hire details presented as part of the story;
- persistent bottom controls for advancing, skipping, and reviewing relevant information; and
- a filled-position history that accumulates while the carousel unfolds.

The supplied references are also the approved typography and color target. CCR should carry forward their bold condensed broadcast-style headings, high-contrast black/charcoal panels, silver and white navigation structure, warm gold status accents, and prominent Team-color moments. It should modernize spacing, accessibility, navigation, and explanation depth while preserving that character. It must not copy EA logos, controller prompts, or other protected brand elements.

### Fang's RO27 Official V3.4

The portable RO27 app at `RO27-Official-V3.4-win-x64-portable` provides a useful desktop-tool reference. Its packaged application and guide establish several patterns worth carrying forward:

- a very clear `Select file -> Calculate -> Preview -> Save` safety boundary;
- a focused dark desktop shell with restrained color and a compact centered start surface;
- disabled actions rendered neutrally, with strong accent color reserved for a ready primary action;
- one consistent feedback area for loading progress, calculation progress, results, and errors;
- readable labels paired with familiar icons rather than icon-only navigation;
- Settings organized by category in a two-pane launcher/detail layout;
- short explanations beside controls, exact values, reset actions, and configuration import/export; and
- a dense table/detail workbench only when the task actually calls for large-scale browsing.

CCR should borrow those clarity and safety patterns, not RO27's recruit-dashboard structure. In particular:

- CCR's primary surface is the carousel queue and story card, not a table.
- CCR should use one visual language from setup through final review rather than switching between a simple dashboard and a separate legacy workbench.
- The setup screen should not expose the full settings schema as a wall of toggles; Settings gets a dedicated browsable surface.
- Color should communicate state and Team identity through the NCAA 14-inspired palette. It should not depend on RO27's red accent.

## 3. Design principles

### Story first, data behind it

The default view explains the current event in football language. Scores, model factors, contract points, and audit evidence remain one click away in structured detail.

### One obvious next action

The persistent action bar always names the exact next operation, such as `Review next departure`, `Submit coordinator offers`, `Reveal Coach decisions`, or `Finalize carousel`. Generic labels such as `Continue` should be avoided when a more precise verb is available.

### Reveal complexity progressively

The active event card shows the key reason and result. Expandable sections or drawers expose score components, candidate comparisons, offer details, and ledger evidence without crowding the main story.

### State is visible, not inferred

Waiting, active, newly created, user action required, resolved, warning, and failed states receive distinct labels, icons, and accessible text. Color alone never carries the distinction.

### Safety is part of the normal flow

The UI continually distinguishes read-only simulation from the one final write. The original-save guarantee, validation state, output destination, and known limitations remain visible before finalization.

### CPU logic is transparent without spoiling hidden bids

School and Coach interest explanations are visible. Before the user's offer is submitted, CPU offer values remain hidden and competition is summarized as Low, Moderate, or High. Exact offers appear after the Results turn.

### Team branding supports orientation

The active Team supplies a restrained accent, logo or fallback monogram, and background treatment. Team color never reduces text contrast or recolors the entire application.

## 4. Global application shell

The main carousel window uses four persistent regions:

```text
+-----------------------------------------------------------------------+
| CCR identity | Part / stage | contextual tabs | Settings / Help      |
+----------------------+------------------------------------------------+
| Opening queue        | Active Team / event detail                     |
|                      |                                                |
| [state] Team - role  | Story, evaluation, candidates, offers, result  |
| [state] Team - role  | with expandable explanation sections           |
| [state] Team - role  |                                                |
| ...                  |                                                |
+----------------------+------------------------------------------------+
| Phase, round, counts, user status       | Skip Ahead | Primary action |
+-----------------------------------------------------------------------+
```

### Top application header

- CCR wordmark and current dynasty season.
- A three-part progress indicator: `Departures`, `Coaching Market`, `Review`.
- Contextual tabs. Part 2 centers `Now Hiring`, `New Openings`, and `Filled Positions`; Parts 1 and 3 use tabs appropriate to their content.
- Settings is available before the run and visibly locked after Part 1 begins.
- Help/about can explain the required in-game checkpoint and the fan-made nature of the tool.

### Left queue

- Default width should support school name, role, and one concise state label without truncating common names.
- Queue rows contain Team mark/fallback, school, role, and state.
- State vocabulary: `Waiting`, `Active`, `New`, `User Action`, `Resolved`, and `Warning`.
- The queue supports role and conference filters when the list becomes long, but queue order remains the engine's authoritative Offer Queue order.
- Selecting an inactive row is safe for inspection and does not change simulation order.
- Returning to the active row is always one click away.

### Main detail surface

The Team-branded header establishes school, open role, previous-season record, national ranking when available (otherwise `NR`), program prestige, conference, vacancy age, and opening reason. The content beneath it changes by turn while preserving the same visual hierarchy:

- headline and plain-language summary;
- previous Coach or incumbent context;
- current candidates, offers, decision, or final hire;
- each Coach's current role/school, previous-season record, career record, prestige, and numeric level wherever the Coach is presented as a candidate or decision subject;
- leading reasons and scores;
- contract length and Staff Offer Program Points when relevant;
- an `Explain this result` section with component breakdowns and reason codes; and
- links into the originating cascade and round history.

### Persistent action and status bar

- Left: current Part, stage, round, and progress counts by role.
- Center: user-relevant status, including pending offers or decisions that will stop Skip Ahead.
- Right: secondary `Skip Ahead` action and one primary action.
- Skip Ahead opens a concise scope chooser and explicitly states the stop conditions.
- Validation errors replace the primary action with a clear repair or return path; they are never hidden in a toast.

## 5. Start, preflight, and run lock

### Welcome / Open Dynasty Save

Use a compact, RO27-inspired start surface rather than the full carousel shell.

- `Select CFP National Championship Week Save` is the primary action.
- Settings is available before a file is selected.
- A short checklist explains: manual save required, original preserved, no in-game automation, and no unfinished-run resume.
- Recent paths should not imply a resumable carousel; at most they are file-picker conveniences.

### Loading and preflight

Use one feedback region for progress and final status. Show named stages such as `Reading save header`, `Checking checkpoint`, `Resolving Coach and Team tables`, and `Validating carousel capacity` rather than a decorative spinner alone.

The successful preflight summary includes:

- dynasty season and CFP National Championship week confirmation;
- detected user Coach, role, school, and current staff;
- schema compatibility status;
- source filename and read-only fingerprint;
- current opening/transaction headroom status; and
- freshly generated Unix-time run seed and settings summary, with the exact seed retained for deterministic reruns.

A failed preflight stops the flow and groups errors by `Unsupported`, `Unsafe`, or `Needs user correction` with specific next actions.

### Ready to begin

The confirmation screen should make the run boundary unmistakable:

- `Review Settings`;
- `Change Save`;
- `Begin Coaching Carousel` as the primary action; and
- an explicit note that settings lock and closing the app discards the unfinalized run.

## 6. Part 1 — departures and initial market

Part 1 advances event by event through NFL departures, retirements, Unexpected Scenarios, performance evaluation, contract decisions, and Internal Succession Reviews.

Recommended top tabs:

- `Current Event`;
- `Open Positions`;
- `Evaluations`;
- `Part 1 History`.

Event cards should use a consistent structure:

- event category and factual/fictional label;
- Coach, Team, and role;
- outcome headline;
- leading reasons;
- staff consequence: one vacancy, Internal Succession Review, or `Cleans House`;
- early-termination buyout and post-buyout hiring resources when applicable;
- newly created openings; and
- expandable model evidence.

Unexpected Scenarios require a persistent `CCR fictional scenario` label. User-HC protection presents Accept/Nullify as a deliberate decision card rather than a transient modal. Generic FCS programs are excluded from fictional-scenario targeting.

`Looking for a Change` must read as a voluntary resignation rather than a firing: the reveal states that the Coach has entered the available Coaches pool, the vacancy is created normally, and the financial panel shows no school-initiated buyout.

The implemented departure review mirrors Staff Review: four complete tabs—`NFL`, `Retirements`, `Unexpected`, and `Performance`—use compact counts and an active downward indicator. Each tab exposes its full event list with combinable `All`/`HC`/`OC`/`DC` and Conference filters, staggered card arrival, Team-color/helmet Coach portraits, contract impact, staff consequence, result, and event evidence. Only the card-list region scrolls. Protected scenario and performance recommendations must be resolved before review begins.

Each event then receives a full-screen NCAA-inspired presentation using the same Coach portrait treatment, Team identity art, a high-contrast result badge, and any additional staff affected by a `Cleans House` outcome. NFL call-ups rise into view, retirements settle through a restrained legacy fade, fictional scenarios use a brief disrupted reveal, and performance actions arrive with a firmer impact motion; these are presentation distinctions only and never alter the precomputed result. Additional affected coordinators use readable portrait/name/role treatments and arrive in sequence. Space and the visible Advance button move exactly one event; Skip Remaining returns to the reviewed manifest, and Replay Event Review does not reroll the seed.

Performance evaluation uses a 0-100 score visualization with `Fire`, `Vulnerable`, or `Secure`, but the classification text and failure-signal count are primary. Coordinator cards must identify linked Team unit evidence rather than implying unsupported Coach-only statistics.

The performance-review screen consolidates its title, explanation, loaded-save identity, seat count, completion state, and green validation mark into one compact panel header rather than repeating a separate page hero above the data. The summary uses four compact, keyboard-accessible tabs: `Fire`, `Vulnerable`, `Secure`, and `New-Hire Grace`. Counts remain prominent, with the active downward indicator aligned directly beside its count; restrained padding and short supporting labels keep the strip vertically efficient. Each tab exposes the complete matching Coach list rather than a fixed sample. Secondary controls inside the list filter the active classification by `All`, `HC`, `OC`, or `DC`, display live role counts, and optionally isolate one Conference. Role and Conference filters combine. Coach rows size to their complete content and use the standard portrait-over-Team-color-and-flat-helmet treatment while showing role, Team/current record, career record, prestige, numeric level, role-specific unit rank/rating, current earned-versus-expected contract points, job security, tenure/grace, score, classification, and primary failure signals. Every tab or secondary-filter change receives one staggered arrival animation, and reduced-motion mode suppresses the list animation. Only the Staff Action List region scrolls; the evaluation header and classification tabs remain fixed. The view omits a separate recommendations notice so the list receives the maximum practical height; the persistent read-only footer and page-level Back/Advance actions retain the safety and navigation context without consuming an additional notice row.

The evaluation surface is vertically scrollable with a clearly visible scrollbar and keeps its navigation actions in the normal document flow so every Coach and the final Advance action remain reachable. At high-resolution desktop widths, the content frame, type, portraits, controls, and evidence panels scale into a larger layout tier rather than remaining fixed at the 1080p pixel size in the center of the display.

Any school-initiated dismissal before contract expiration includes a Buyout panel before confirmation. It shows full contract years remaining, career wins, base cost, remaining-term cost, career-wins premium, total Staff Offer Program Points, resources after dismissal, and the resulting replacement-offer constraint. Expiring-contract nonrenewals and voluntary departures explicitly show `No buyout` so users can distinguish the cases. CPU events use the same calculation and preserve the breakdown in expandable evidence.

Contract decisions show current term, proposed term, expected and offered program points, school rationale, and the staff consequence of each result.

## 7. Part 2 — coaching market

### Contextual tabs

- `Now Hiring`: active Offer Queue and current turn.
- `New Openings`: vacancies created by the latest revealed decisions, with a persistent unread count.
- `Filled Positions`: accumulating resolved hires, promotions, retentions, and extensions.
- `Round History`: offer and decision ledger revealed so far.

### Three-turn round presentation

Each round visibly moves through:

1. `Schools Make Offers`;
2. `Coaches Consider Offers`;
3. `Results & New Openings`.

The round stepper belongs near the top of the detail surface. All offers remain pending until the Coach Decisions turn, so the UI must never visually imply that an earlier school has exclusive first choice.

### Turn event animations

Advancing a turn should trigger a brief in-shell event vignette for each consequential carousel event. This is a core storytelling layer inspired by the older NCAA carousel presentation, especially its animation of a school considering multiple Coach options and settling on its choice. The stable application shell remains visible so the animation feels like the carousel progressing rather than a disconnected video or loading screen.

The standard school-selection sequence should:

1. bring the school identity strip and open role into focus;
2. introduce the final Coach options as portrait/name cards;
3. move deliberate visual emphasis across the options to communicate consideration;
4. resolve onto the selected Coach with school color, role, and accepted-offer treatment; and
5. transition directly into the result card and any downstream `New Opening` alert.

The animation presents an outcome already resolved by the deterministic engine; it must not look like a roulette wheel or imply that timing, clicks, or animation order influence the result. It must also respect simultaneous-offer information boundaries: a Coach's acceptance is not revealed until the Results turn.

Use a small reusable event-animation vocabulary across the carousel:

- departure, firing, retirement, extension, and `Cleans House`;
- buyout commitment and reduced replacement budget;
- school shortlist/offer submission;
- Coach considering simultaneous offers;
- accepted hire, rejected offer, retention, and internal promotion; and
- cascading vacancy and newly opened position.

Ordinary beats should remain measured but short enough for repeated use, while rare headline events may receive a slightly larger treatment. Multi-stage vignettes never auto-advance: each stage remains visible until the user presses Space or clicks the visible `Advance` button. Space and Advance move exactly one stage—deliberation, selection, cascade, then return—so the user controls the storytelling pace. Skip Ahead may still summarize routine CPU events before a vignette begins. Reduced-motion mode replaces travel, cycling, and scale effects with a brief crossfade and the same manual stage controls and final information. Every result remains visible as text after the animation finishes.

### School offer turn

For CPU schools, show the shortlist progressing without requiring user input. For the user-controlled school:

- default shortlist plus `Browse all eligible Coaches`;
- candidate comparison with School Interest and Coach Interest separated;
- qualification, upgrade margin, role readiness, fit, and affordability reasons;
- contract-length and exact program-point inputs;
- visible reserved and available staff resources;
- Low/Moderate/High competition only before submission;
- one final-offer warning explaining that a rejection ends pursuit of that Coach; and
- separate OC and DC offer panels when both positions are open.

Browsing all eligible candidates may use a table/list with sticky filters and a comparison drawer. This is one of the few places where a RO27-style dense workbench is appropriate.

### Coach decisions turn

The default CPU presentation can advance Coach by Coach or summarize noncompetitive decisions in small batches. A user Coach's offers stop progression and use a dedicated comparison card:

- offered school and role;
- current situation / remain option;
- contract term and program points;
- career, stability, program, and fit reasons;
- other simultaneous offers; and
- explicit Accept or Reject actions.

### Results and new openings

Reveal acceptances and rejections together through the turn-event animation system without artificial delay. A newly created vacancy should:

- add a durable badge to `New Openings`;
- insert a visibly marked queue row;
- show the move that caused it; and
- link back to the parent cascade.

The reveal view exposes exact offer terms now that the round is resolved.

## 8. Part 3 — review and finalization

Part 3 uses the same list/detail language and adds no new decisions until final authorization.

Recommended views:

- `Headlines`;
- `Filled Positions`;
- `Departures & Events`;
- `Cascade Explorer`;
- `Before / After Staffs`;
- `My School`;
- `Storylines`;
- `Final Validation`.

The Cascade Explorer should use a vertical move chain in the detail area: initiating event, each resulting departure/opening, competing offers, accepted hire, and terminal vacancy fill. It should not require a general-purpose node graph for the MVP.

Final Validation groups checks into `Staffing`, `Contracts & Program Points`, `Openings & History`, `User Control`, and `Output Safety`. Each group has Passed, Warning, or Failed status and supports evidence expansion.

`Finalize Carousel` is enabled only after every required check passes and known limitations have been acknowledged. This is the only point at which CCR writes a working copy.

## 9. Save generation and completion

During generation, the UI shows the real pipeline:

1. compiling the finalized plan;
2. writing a temporary copy;
3. reopening the generated file;
4. validating assignments, contracts, finances, openings, history, and user control;
5. atomically producing the new short-named save; and
6. writing the carousel report.

Failure preserves the original, does not publish an unverified output as complete, and shows the exact failed stage plus a diagnostic-report action.

The completion screen includes:

- `Coaching Carousel Complete`;
- output filename and folder;
- report filename and folder;
- HC/OC/DC movement totals and extension count;
- verification status;
- `Open Folder` and `Copy Path` conveniences; and
- concise human instructions to load the new save and advance normally in-game.

There is no EOS return, sync, or dashboard continuation.

## 10. Settings information architecture

Settings are generated from the shared engine configuration schema and use a two-pane layout inspired by RO27:

- left: searchable category navigation with changed-value counts;
- right: settings for the selected category with label, description, control, units, exact value, valid range, default, and per-value reset.

Categories follow the approved concept:

- Departures & Turnover;
- Performance Evaluation & Grace;
- Market Review & Candidate Qualification;
- School Interest;
- Coach Interest;
- Offers, Contracts, Extensions, Buyouts & Program Points;
- Unexpected Scenarios;
- User Control & Protection; and
- Seed & Simulation Behavior.

Control rules:

- slider plus exact numeric field for bounded scalars;
- exact percentage input for probabilities;
- numeric input for integer limits;
- toggles for booleans;
- dropdowns only for genuine engine categories;
- `Reset value` and `Restore all defaults`;
- no presets, qualitative modes, or hidden advanced layer; and
- no presentation settings.

Before the run, Settings shows unsaved/changed state and supports config import/export if retained in the implementation scope. After the run begins, the same values remain readable but locked, with `Restart carousel to change settings` explained in place.

## 11. Visual direction

### Foundation

- use the NCAA 14 screenshots as the primary color reference rather than a generic dark productivity-tool theme;
- frame the experience with black and glossy charcoal navigation/action surfaces against silver, soft-white, and pale-gray structural areas;
- use bright white primary text on dark panels, near-black text on light queue rows, and subdued silver/gray for secondary information;
- use a warm gold accent for persistent status, counts, progress highlights, and select CCR identity moments;
- allow active Team colors to become the dominant detail-card accent and oversized background watermark while keeping text surfaces readable;
- use restrained gradients, metallic/satin highlights, inset borders, and shallow shadows to capture the reference screens' broadcast presentation without reproducing their exact chrome;
- reserve green for validated/success, amber for attention/new, and red for failure or destructive consequence when Team colors are not already carrying the visual emphasis; and
- keep motion brief and functional so the stronger presentation styling does not slow repeated turns;
- use dark foreground text without a light shadow on every bright gold, orange, green, or warning badge so small status labels meet the same contrast standard throughout the app; and
- translate native Coach prestige labels into compact football grades (`Aplus` → `A+`, `Cminus` → `C-`), render every displayed grade in a bold, subtly shadowed treatment, and keep prestige, `lvl.`, and age together on one compact metadata line wherever a Coach appears. Color the level number on a low-to-high scale from 10 through 50 while preserving text contrast and clamping values outside that display range. Label the displayed current-season record with the actual loaded dynasty year consistently across cards, shortlists, decisions, and event reveals. Level and its color remain informational until backend weighting is separately approved.

Provisional neutral tokens for the first prototype should stay close to this family rather than becoming a final locked palette:

```text
Ink / action bar       near-black
Primary panel          charcoal
Secondary panel        graphite
Navigation frame       silver
Light queue surface    soft white
Primary dark text      near-black
Primary light text     bright white
CCR status accent      warm gold
Team accent            derived per active Team
```

### Component foundation

Use Tailwind CSS 4 and daisyUI 5 as the renderer's component foundation. daisyUI is a source of reusable structure, interaction states, and small transition patterns—not the product's visual identity. Define a custom `ccr` theme that maps daisyUI semantic variables onto the approved charcoal, silver/white, warm-gold, success/warning/error, and active-Team tokens, then override shape, border, shadow, density, and typography where the NCAA-inspired presentation requires it. Do not ship an unchanged built-in daisyUI theme or allow generic rounded dashboard styling to dominate the app.

The strongest daisyUI candidates are buttons, tabs, steps, badges/status, cards, dialogs, drawers, collapses, alerts, progress/loading indicators, form controls, tables/lists, tooltips, and keyboard-hint treatments. Wrap the chosen class combinations in CCR-owned React components so screens use stable domain components rather than scattering framework classes and theme assumptions throughout the renderer.

Reuse daisyUI's restrained component transitions where they fit—such as swaps, loading indicators, progress changes, collapses, dialogs, and drawers. The multi-stage turn-event vignettes remain CCR-owned choreography built from engine events, Team assets, and explicit animation states; daisyUI effects may support individual beats but must not determine event order or simulation timing. Every imported motion pattern must follow the same manual-stage progression and reduced-motion requirements as the broader reveal system.

NFL, retirement, fictional-scenario, and performance events may use distinct motion treatments when the event stage first appears. Moving from one queued Coach to the next updates the mounted stage in place: do not replay the full entrance, briefly restore the prior event, blank the stage, or postpone the new Coach card. A grouped `Cleans House` reveal gives the departing HC visual priority while presenting both affected coordinators as full supporting mini-cards with larger portraits, readable names and roles, and the same prestige / `lvl.` / age metadata as every other Coach treatment.

For an individual Coach departure, keep the identity card focused on the Coach, record, and Team identity. Move the outcome badge and explanatory sentence into a distinct centered consequence panel directly beneath the card, visually connected by a small notch. Grouped staff changes retain the outcome inside the primary card because the supporting-staff row already occupies the lower consequence region.

Coach portraits use the Coach's contextual Team primary color as their background and place the Team's left-facing `teamhelmets_flat` illustration as a subdued layer behind the Coach head. The helmet is centered on the square portrait frame and scaled to fill it, with intentional edge cropping rather than unused transparent padding. The primary school logo remains the fallback for a missing helmet. The portrait remains the foreground subject, and contrast/fallback treatments must keep the Coach readable when Team colors or helmet art are unusually light, dark, detailed, or unavailable.

The cascade reveal makes both consequences immediately legible: the departing Coach's old role sits below a destination `New Role` card with a strong upward connector, while the newly vacated opening receives the largest consequence card on the right and explicitly states that it was added to the Offer Queue.

### Typography and density

Readability is a product constraint rather than a per-screen polish item. At the supported minimum window size, functional labels and secondary evidence should ordinarily remain at least 11–12 px, normal supporting copy at least 13–14 px, and prominent Coach identity metadata at least 16 px. Larger displays scale those classes upward rather than leaving microcopy fixed at desktop-minimum sizes. Compact layout work should reclaim spacing, wrapping, and hierarchy before reducing type below these floors.

- Bahnschrift is the approved CCR type family. Use its SemiCondensed or Condensed width with bold/heavy weights for the wordmark, top tabs, school names, role headings, major event headlines, numeric callouts, and primary actions;
- use regular-width Bahnschrift at regular through semibold weights for explanations, settings descriptions, offer details, dense tables, and other sustained reading;
- consume the Windows system installation rather than redistributing Microsoft's font file. CCR targets Windows 10/11, which supply Bahnschrift; retain Segoe UI Variable/Segoe UI as the defensive body fallback and Arial Narrow/sans-serif as display fallbacks;
- define shared display and body font tokens so width, weight, tracking, and line-height choices remain consistent across daisyUI wrappers and custom event surfaces;
- use uppercase confidently for top tabs, major headings, state labels, and short actions, matching the NCAA reference character;
- keep longer explanations and narrative copy in sentence case with more generous line height so the broadcast-style display face does not harm readability;
- maintain comfortable modern row heights while using weight, condensation, and contrast to retain the references' compact football presentation;
- support 100-200% Windows scaling without clipped controls; and
- design first for a desktop window around 1440x900, then verify a provisional minimum around 1180x720 before committing it as a product requirement.

### Team assets

The leading application-shell background is the neutral 3840×2160 `tbak_Default` export (`assets/image_table_previews/teambackgrounds/0.webp`). Its near-black football texture and restrained orange details establish the NCAA-style atmosphere while leaving room for readable panels and active-Team colors. Treat it as a provisional production candidate: optimize a curated copy for the app rather than loading the ignored review file at runtime, and verify crops at every supported window size.

For Team-specific presentation, prioritize the 150 transparent 952×300 `tast_stickerpacks_<School>` composites from TeamAssets. Their converted numeric filenames all end in `3` (for example `13.webp`, `533.webp`, and `543.webp`), and each combines helmet, wordmarks, mascot marks, and pennant art into a strong school identity strip. Use these primarily in Team-branded detail headers or opening cards, with enough empty space and contrast protection that they support rather than compete with decision text.

Primary logos, conference marks, the sticker-pack school mapping, and Team colors must be connected through a generated production manifest rather than numeric preview filenames. The UI must retain a first-class fallback using a school monogram, neutral role icon, and accessible generated accent. Asset licensing and patch compatibility must be resolved before branded assets become a release dependency.

## 12. Component inventory

Initial reusable components:

- application header and Part stepper;
- contextual tab strip with badges;
- opening queue and queue row;
- Team identity header;
- event / opening detail card;
- Coach summary card;
- candidate shortlist and candidate comparison row;
- School Interest and Coach Interest breakdowns;
- Job Evaluation Score breakdown;
- contract and program-point offer editor;
- round stepper and revealed-offer ledger;
- reusable turn-event animation stage and reduced-motion reveal;
- new-opening alert and cascade link;
- factual / fictional content label;
- validation checklist group;
- progress / feedback region;
- persistent action bar;
- settings category launcher and schema-driven control row; and
- empty, loading, warning, failed, and completed states.

## 13. Accessibility and usability requirements

- Full keyboard navigation for tabs, queue, candidate lists, settings, and primary actions.
- Visible focus rings and logical focus restoration after dialogs or detail drawers.
- Color contrast meeting WCAG AA for text and interactive states.
- Status changes announced through accessible live regions without repeatedly interrupting navigation.
- No meaning communicated by animation, color, or Team logo alone.
- Reduced-motion behavior for reveals and queue insertions.
- Confirmation only at consequential boundaries; ordinary turn advancement should remain fast.
- User decisions and validation failures must not rely on short-lived toasts.

## 14. Implementation sequence

### UI-0 — application-shell decision

- Decide desktop technology and portable packaging strategy.
- Treat Electron plus a web renderer as the leading reference because RO27 demonstrates the desired portable Windows experience, but compare bundle size, native integration, testability, and long-running simulation behavior before approval.
- Define the renderer/main-process boundary so the UI cannot access arbitrary files or mutate saves directly.

### UI-1 — static shell prototype

- Build the start/preflight surface and the persistent carousel shell using fixture data.
- Add Tailwind CSS 4 and daisyUI 5, define the initial custom `ccr` theme, and establish CCR-owned wrappers for the first shared controls.
- Implement top Part progress, contextual tabs, queue, Team detail card, and bottom action bar.
- Validate window scaling, typography, contrast, keyboard order, and long school/Coach names.

### UI-2 — interactive Part 2 vertical slice

- Use a deterministic fake carousel fixture to implement one HC round that produces a downstream opening.
- Include one user-school offer, one user-Coach decision, one rejection, one accepted hire, and one new-opening cascade.
- Implement the school-deliberation/Coach-selection animation and the reduced-motion/skipped paths against the same event fixture.
- This slice should establish the state machine and action semantics before broad screen production.

### UI-3 — Part 1 and Settings

- Departure/evaluation event cards, the locked event manifest, protected scenario/performance decisions, manual reveal pacing, replay, and skip are implemented against normalized save data.
- Add buyout/contract event cards and financial authority.
- Render the complete settings interface from a provisional shared schema.
- Verify lock behavior at `Begin Coaching Carousel`.

### UI-4 — Part 3 and finalization states

- Add headlines, filled positions, cascade view, before/after staff, user-school review, validation, write progress, failure recovery, and completion.
- Use a fake compiler response first so error and verification states are designed intentionally.

### UI-5 — engine and save-adapter integration

- Connect normalized read-only save data to preflight.
- Connect engine events to the UI state machine through typed domain events rather than screen-specific objects.
- Connect finalization to the copy/write/reopen/verify pipeline behind one narrow command boundary.

### UI-6 — packaged-app validation

- Test a portable Windows build on clean-machine conditions.
- Validate large saves, long runs, file dialogs, output paths, failure diagnostics, DPI scaling, window resizing, and app interruption.
- Confirm that closing before finalization discards the run while persisted settings remain intact.

## 15. Decisions still required

- Desktop framework and packaging technology.
- Exact CCR wordmark/icon treatment and final color-token values within the approved NCAA 14-inspired direction.
- Production source and licensing policy for Team/conference logos and colors.
- Supported minimum window size and whether the window may enter a compact layout.
- Whether config import/export is MVP or post-MVP.
- Whether candidate browsing uses a table, card list, or optional view toggle.
- Exact Part 1 contextual tabs and grouping order.
- Whether CPU-only events advance singly by default or in small narratively related batches.
- The report format and whether the completion screen can open its containing folder.

## 16. Immediate design deliverable

The next UI artifact should be a low-fidelity, fixture-driven prototype of the Part 2 vertical slice, not a polished start screen. It should prove the hardest interaction: an ordered offer queue, simultaneous offers, a user decision, a revealed hire, and the resulting new-opening cascade inside one stable shell.

That prototype can then establish the final component hierarchy and state model before visual polish or save-adapter integration begins.
