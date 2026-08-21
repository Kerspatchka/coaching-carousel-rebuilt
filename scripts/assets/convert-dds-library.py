#!/usr/bin/env python3
"""Convert selected DDS image-library exports to browser-ready WebP files."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET

from PIL import Image


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("input_dir", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument(
        "--ids",
        nargs="*",
        type=int,
        help="Only convert these numeric image-library asset IDs.",
    )
    parser.add_argument("--quality", type=int, default=92)
    parser.add_argument("--lossless", action="store_true")
    parser.add_argument("--method", type=int, choices=range(0, 7), default=4)
    parser.add_argument(
        "--metadata-dir",
        type=Path,
        help="ImageLibraryTexture XML directory used to label numeric asset IDs.",
    )
    return parser.parse_args()


def load_metadata(metadata_dir: Path | None) -> dict[int, dict[str, object]]:
    if metadata_dir is None:
        return {}

    result: dict[int, dict[str, object]] = {}
    for path in metadata_dir.rglob("*.xml"):
        if "_assetlibrary_" in path.name.lower() or "blueprint" in path.name.lower():
            continue
        try:
            root = ET.parse(path).getroot()
        except ET.ParseError:
            continue
        instance = root.find("./instance[@type='ImageLibraryTexture']")
        if instance is None:
            continue
        name_field = instance.find("./field[@name='Name']")
        source_field = instance.find("./field[@name='SourcePath']")
        asset_name = Path(name_field.text or "").name if name_field is not None else path.stem
        suffix = re.search(r"_(\d+)$", asset_name)
        metadata: dict[str, object] = {
            "assetName": asset_name,
            "sourcePath": source_field.text if source_field is not None else None,
            "sourceNumericSuffix": int(suffix.group(1)) if suffix else None,
        }
        if asset_name.lower().startswith("nilcp_") and suffix:
            metadata["sourcePortraitId"] = int(suffix.group(1))
        for item in instance.findall("./array[@name='AssetIdList']/item"):
            if item.text is not None:
                result[int(item.text)] = metadata
    return result


def main() -> None:
    args = parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    metadata = load_metadata(args.metadata_dir)

    requested = set(args.ids) if args.ids else None
    sources = sorted(
        args.input_dir.glob("*.dds"),
        key=lambda path: int(path.stem) if path.stem.isdigit() else path.stem,
    )
    if requested is not None:
        sources = [path for path in sources if path.stem.isdigit() and int(path.stem) in requested]

    records: list[dict[str, object]] = []
    for index, source in enumerate(sources, start=1):
        output = args.output_dir / f"{source.stem}.webp"
        with Image.open(source) as image:
            image.load()
            image.save(
                output,
                "WEBP",
                quality=args.quality,
                lossless=args.lossless,
                method=args.method,
            )
            record: dict[str, object] = {
                "assetId": int(source.stem) if source.stem.isdigit() else source.stem,
                "source": source.name,
                "output": output.name,
                "width": image.width,
                "height": image.height,
                "mode": image.mode,
                "alphaRange": list(image.getchannel("A").getextrema())
                if "A" in image.getbands()
                else None,
                "sourceBytes": source.stat().st_size,
                "outputBytes": output.stat().st_size,
            }
            if source.stem.isdigit() and int(source.stem) in metadata:
                record.update(metadata[int(source.stem)])
            records.append(record)
        if index % 50 == 0 or index == len(sources):
            print(f"{args.input_dir.name}: {index}/{len(sources)}", flush=True)

    manifest = {
        "format": "webp",
        "quality": args.quality,
        "lossless": args.lossless,
        "method": args.method,
        "images": records,
    }
    (args.output_dir / "conversion-manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Converted {len(records)} image(s) to {args.output_dir}")


if __name__ == "__main__":
    main()
