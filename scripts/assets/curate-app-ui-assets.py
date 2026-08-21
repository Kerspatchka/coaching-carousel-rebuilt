#!/usr/bin/env python3
"""Curate reviewed image-table previews into the renderer's production asset pack."""

from __future__ import annotations

import json
from pathlib import Path
import re
import shutil


REPO_ROOT = Path(__file__).resolve().parents[2]
PREVIEW_ROOT = REPO_ROOT / "assets/image_table_previews"
OUTPUT_ROOT = REPO_ROOT / "app/src/renderer/assets"
COLLECTIONS = {
    "coachPortraits": ("assetlibrary_nil_coachportraits_brt", "coach-portraits", None),
    "primaryLogos": ("teamlogos", "team-logos/primary", "tmlg_ncaa_Primary_"),
    "secondaryLogos": ("teamlogossecondary", "team-logos/secondary", "tlsec_Secondary_"),
    "threeDimensionalLogos": ("teamlogos3d", "team-logos/3d", "tl3d_Primary_"),
    "flatHelmets": ("teamhelmets_flat", "team-helmets/flat", "thf_"),
    "conferenceLogos": ("teamconferences", "conference-logos", "tcon_"),
}
STICKER_PREFIX = "tast_stickerpacks_"


def display_name(key: str) -> str:
    return re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", key)


def read_manifest(library: str) -> list[dict[str, object]]:
    path = PREVIEW_ROOT / library / "conversion-manifest.json"
    return json.loads(path.read_text(encoding="utf-8"))["images"]


def copy_asset(library: str, output_relative: str, image: dict[str, object]) -> str:
    output_file = f"{output_relative}/{image['assetId']}.webp"
    destination = OUTPUT_ROOT / output_file
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(PREVIEW_ROOT / library / str(image["output"]), destination)
    return output_file


def main() -> None:
    sticker_output = OUTPUT_ROOT / "team-stickerpacks"
    background_output = OUTPUT_ROOT / "backgrounds"
    sticker_output.mkdir(parents=True, exist_ok=True)
    background_output.mkdir(parents=True, exist_ok=True)

    team_visuals: dict[str, dict[str, object]] = {}
    sticker_assets: list[dict[str, object]] = []
    for image in read_manifest("teamassets"):
        asset_name = image.get("assetName") or ""
        if not str(asset_name).startswith(STICKER_PREFIX):
            continue

        key = str(asset_name).removeprefix(STICKER_PREFIX)
        filename = f"{key}.webp"
        source = PREVIEW_ROOT / "teamassets" / image["output"]
        shutil.copy2(source, sticker_output / filename)
        record = {
            "key": key,
            "label": display_name(key),
            "file": f"team-stickerpacks/{filename}",
            "sourceAssetId": image["assetId"],
            "sourceAssetName": asset_name,
            "width": image["width"],
            "height": image["height"],
        }
        sticker_assets.append(record)
        team_visuals[key] = {"key": key, "label": display_name(key), "stickerPack": record}

    collection_records: dict[str, list[dict[str, object]]] = {}
    for collection_name, (library, output_relative, prefix) in COLLECTIONS.items():
        records: list[dict[str, object]] = []
        for image in read_manifest(library):
            asset_name = str(image.get("assetName") or f"Asset_{image['assetId']}")
            if collection_name == "flatHelmets" and asset_name.startswith("thf_rthelmets_"):
                continue
            semantic_key = asset_name.removeprefix(prefix) if prefix else str(image["assetId"])
            record = {
                "key": semantic_key,
                "label": display_name(semantic_key),
                "file": copy_asset(library, output_relative, image),
                "sourceAssetId": image["assetId"],
                "sourceAssetName": asset_name,
                "width": image["width"],
                "height": image["height"],
            }
            if image.get("sourcePortraitId") is not None:
                record["sourcePortraitId"] = image["sourcePortraitId"]
            records.append(record)

            if prefix and collection_name != "conferenceLogos":
                team_record = team_visuals.setdefault(
                    semantic_key,
                    {"key": semantic_key, "label": display_name(semantic_key)},
                )
                field = {
                    "primaryLogos": "primaryLogo",
                    "secondaryLogos": "secondaryLogo",
                    "threeDimensionalLogos": "threeDimensionalLogo",
                    "flatHelmets": "flatHelmet",
                }[collection_name]
                team_record[field] = record
        collection_records[collection_name] = records

    background_source = PREVIEW_ROOT / "teambackgrounds/0.webp"
    background_filename = "ccr-shell.webp"
    shutil.copy2(background_source, background_output / background_filename)

    audit_manifest = {
        "background": {
            "file": f"backgrounds/{background_filename}",
            "sourceAssetId": 0,
            "sourceAssetName": "tbak_Default",
            "width": 3840,
            "height": 2160,
        },
        "teams": sorted(team_visuals.values(), key=lambda item: str(item["key"])),
        "teamStickerPacks": sticker_assets,
        **collection_records,
    }
    (OUTPUT_ROOT / "production-manifest.json").write_text(
        json.dumps(audit_manifest, indent=2) + "\n", encoding="utf-8"
    )

    print(
        f"Curated {len(sticker_assets)} sticker packs, "
        f"{len(collection_records['coachPortraits'])} coach portrait references, "
        f"{len(collection_records['primaryLogos'])} primary logos, "
        f"{len(collection_records['secondaryLogos'])} secondary logos, "
        f"{len(collection_records['threeDimensionalLogos'])} 3D logos, "
        f"{len(collection_records['flatHelmets'])} flat helmets, "
        f"{len(collection_records['conferenceLogos'])} conference marks, "
        f"and 1 shell background into {OUTPUT_ROOT}"
    )


if __name__ == "__main__":
    main()
