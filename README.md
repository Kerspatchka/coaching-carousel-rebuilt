# Coaching Carousel Rebuilt

Coaching Carousel Rebuilt (CCR) is a Windows desktop tool in development for running a complete, transparent coaching carousel outside EA Sports College Football 27 and compiling the finalized result into a validated CFP National Championship week dynasty save.

The product design is documented in [`docs/Concept.txt`](docs/Concept.txt), the implementation boundary in [`docs/MVP_SPEC.md`](docs/MVP_SPEC.md), and the interface direction in [`docs/ui_concept.md`](docs/ui_concept.md).

## Development status

CCR is in MVP implementation. The first executable slice uses deterministic fixture data to prove the Part 2 interaction:

```text
offer queue -> user offer -> Coach decision -> results -> cascading vacancy
```

It includes the NCAA-inspired visual foundation, Coach portraits, school and
conference branding, animated decision reveals, and a packaged read-only save
preflight. The preflight validates schema/checkpoint compatibility and displays
the detected user Coach and Team context; the carousel after it is still an
explicit fixture preview. CCR does not yet modify a dynasty save.

## Desktop app

Requirements:

- Node.js 24+
- npm 11+
- Windows for release packaging

```powershell
cd app
npm install
npm start
```

The curated 2,043-image runtime pack is tracked as the single archive
`assets/ui_pack/ccr-ui-assets.zip`. npm automatically expands it into the
ignored renderer working directory before starting, building, or packaging the
app. To prepare it directly, run `npm run assets:prepare` from `app/`.

Validation commands:

```powershell
npm run check
npm run make
```

`npm run make` creates a portable Windows ZIP under `app/out/make`.

For the current fixture build, extract
`app/out/make/zip/win32/x64/CoachingCarouselRebuilt-win32-x64-0.1.0-alpha.1.zip`
and double-click `Coaching Carousel Rebuilt.exe` inside the extracted folder. Do
not run the executable from inside the ZIP.

## Safety boundary

CCR never automates the game UI. The final product will preserve the input save, write only after explicit final authorization, reopen and verify its generated output, and provide human-operated in-game instructions.

## Repository areas

- `app/` — production desktop application
- `docs/` — product, UI, architecture, and research documentation
- `scripts/` — controlled save-research and analysis tools
- `assets/` — local/reference evidence and machine-readable research artifacts

Licensing and public-distribution terms are not yet finalized.
