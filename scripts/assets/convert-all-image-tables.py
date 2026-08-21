#!/usr/bin/env python3
"""One-time conversion of all MMC DDS exports into a browsable preview tree."""

from __future__ import annotations

import argparse
from pathlib import Path
import runpy
import sys


LIBRARIES = {
    "assetlibrary_nil_coachportraits_brt": "nil/coachportraits/assets",
    "dynastyrtghubbackgrounds": "dynastyrtghubbackgrounds",
    "teamconferences": "teamconferences",
    "teamdecals": "teamdecals",
    "teamassets": "TeamAssets",
    "teambackgrounds": "teambackgrounds",
    "teamhelmets": "teamhelmets",
    "teamhelmets_flat": "teamhelmetsflat",
    "teamlogos": "teamlogos/TeamLogos",
    "teamlogos3d": "teamlogos/teamlogos3d",
    "teamlogossecondary": "TeamLogosSecondary",
    "teamlogosstickers": "teamlogos/TeamLogosStickers",
    "teamselectbackgrounds": "TeamSelectBackgrounds",
    "utbackgrounds": "utbackgrounds",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("repo_root", type=Path)
    parser.add_argument("pillow_dir", type=Path)
    parser.add_argument("--quality", type=int, default=88)
    parser.add_argument("--method", type=int, default=4)
    parser.add_argument(
        "--libraries",
        nargs="*",
        choices=sorted(LIBRARIES),
        help="Convert only these libraries, then rebuild the combined gallery.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    repo_root = args.repo_root.resolve()
    sys.path.insert(0, str(args.pillow_dir.resolve()))

    converter = repo_root / "scripts/assets/convert-dds-library.py"
    gallery_builder = repo_root / "scripts/assets/build-preview-gallery.py"
    input_root = repo_root / "assets/image_table_exports"
    output_root = repo_root / "assets/image_table_previews"
    metadata_root = repo_root / "assets/mod_exports/content/ui/ImageAssetLibraries/global"
    output_root.mkdir(parents=True, exist_ok=True)

    selected = set(args.libraries) if args.libraries else set(LIBRARIES)
    for library, metadata_relative in LIBRARIES.items():
        if library not in selected:
            continue
        print(f"\n=== {library} ===", flush=True)
        sys.argv = [
            converter.name,
            str(input_root / library),
            str(output_root / library),
            "--quality",
            str(args.quality),
            "--method",
            str(args.method),
            "--metadata-dir",
            str(metadata_root / metadata_relative),
        ]
        runpy.run_path(str(converter), run_name="__main__")

    sys.argv = [gallery_builder.name, str(output_root)]
    runpy.run_path(str(gallery_builder), run_name="__main__")


if __name__ == "__main__":
    main()
