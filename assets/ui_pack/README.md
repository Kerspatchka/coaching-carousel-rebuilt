# CCR UI asset pack

This directory contains the curated, app-ready visual asset archive owned by
the CCR project structure. It has no runtime or packaging dependency on
DynastyOS.

Raw MMC image-table exports live in `assets/image_table_exports/` and are kept
out of Git because they are large intermediate DDS files. App-ready assets are
converted to WebP and connected to game/save identifiers through a generated
semantic manifest before they are used by the renderer.

## MVP asset scope

- Coach portraits
- Primary, secondary, and 3D school logos
- Left-facing flat Team helmets
- Conference logos
- Team sticker-pack header artwork and the neutral application background
- Generated missing-asset fallbacks in the renderer

The tracked `ccr-ui-assets.zip` contains 1,089 Coach portrait references, 232
primary school logos, 149 secondary school logos, 209 3D school logos, 150
left-facing flat helmets, 63 conference marks, all 150 Team sticker packs, and
one shell background. These 2,043 WebP files occupy about 67 MB before desktop
packaging. Git stores the curated pack as this single archive rather than 2,043
loose image files. `npm start`, `npm run build`, `npm run package`, and
`npm run make` automatically expand it into the ignored
`app/src/renderer/assets/` working directory. The numeric Coach
portrait identity mapping is intentionally preserved even where exported blank
textures repeat; physical deduplication can be added later without changing the
manifest contract.

The review library also includes TeamAssets hero/historic/team photography and
school-specific 1080p/4K backgrounds. These are strong candidates for branded
Team detail views, but only a deliberately selected and optimized subset should
ship with the MVP. Full-resolution Dynasty/RTG and Ultimate Team backgrounds
remain optional because they add substantial size and are not required for the
carousel workflow.

The local `_samples/` directory contains validation conversions, is ignored by
Git, and is not loaded by the production app.

## Current visual selections

- Leading shell-background candidate: `teambackgrounds/0.webp`, identified by
  the manifest as the neutral 3840x2160 `tbak_Default` asset.
- Priority Team-header artwork: all 150 transparent 952x300
  `tast_stickerpacks_<School>` assets. Their numeric preview filenames end in
  `3`, including `13.webp`, `533.webp`, and `543.webp`.

Production code addresses these through
`app/src/renderer/assets/production-manifest.json`, not through numeric preview
filenames. Run `scripts/assets/curate-app-ui-assets.py` to rebuild the renderer's
self-contained asset catalog from the local preview library. The current Part 2
fixture verifies the shell background, sticker header, primary/secondary/3D
school marks, conference mark, and Coach portraits together.

## Local review gallery

The ignored `assets/image_table_previews/` directory is a one-time WebP
conversion of every MMC export. Open its `index.html` to browse all libraries,
filter by library, or search XML-backed asset names and numeric IDs. Rebuild it
with `scripts/assets/convert-all-image-tables.py` after installing the pinned
dependency in `scripts/assets/requirements.txt`. Pass `--libraries` followed by
one or more library directory names to convert only newly exported libraries
while still rebuilding the combined gallery.
