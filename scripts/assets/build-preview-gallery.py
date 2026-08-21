#!/usr/bin/env python3
"""Build a searchable local HTML gallery from DDS conversion manifests."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("preview_root", type=Path)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    items: list[dict[str, object]] = []
    for manifest_path in sorted(args.preview_root.glob("*/conversion-manifest.json")):
        library = manifest_path.parent.name
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        for image in manifest["images"]:
            items.append(
                {
                    "library": library,
                    "assetId": image["assetId"],
                    "name": image.get("assetName") or f"Asset {image['assetId']}",
                    "width": image["width"],
                    "height": image["height"],
                    "bytes": image["outputBytes"],
                    "src": f"{library}/{image['output']}",
                }
            )

    libraries = sorted({str(item["library"]) for item in items})
    payload = json.dumps(items, separators=(",", ":")).replace("</", "<\\/")
    options = "".join(f'<option value="{name}">{name}</option>' for name in libraries)
    html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CCR Image Table Preview Gallery</title>
<style>
:root {{ color:#f2f2ed; background:#101112; font-family:Segoe UI,Arial,sans-serif; }}
* {{ box-sizing:border-box; }}
body {{ margin:0; }}
header {{ position:sticky; top:0; z-index:2; padding:16px 22px; background:#151719f2; border-bottom:2px solid #c6a84a; }}
h1 {{ margin:0 0 12px; font:800 25px/1.1 "Arial Narrow",sans-serif; letter-spacing:.04em; }}
.controls {{ display:grid; grid-template-columns:minmax(260px,1fr) 280px auto; gap:10px; }}
input,select,button {{ min-height:40px; padding:8px 12px; color:#fff; background:#25282a; border:1px solid #5b5d5e; border-radius:4px; }}
button {{ cursor:pointer; border-color:#c6a84a; }}
.status {{ margin-top:10px; color:#c9c9c2; }}
main {{ display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:14px; padding:18px; }}
article {{ overflow:hidden; background:#1c1e20; border:1px solid #3b3d3e; border-radius:5px; box-shadow:0 5px 16px #0006; }}
.image {{ display:grid; place-items:center; height:210px; background:repeating-conic-gradient(#282a2c 0 25%,#1f2123 0 50%) 50%/24px 24px; }}
img {{ width:100%; height:100%; object-fit:contain; }}
.meta {{ padding:10px 12px 12px; }}
.name {{ overflow:hidden; margin-bottom:5px; font-weight:700; text-overflow:ellipsis; white-space:nowrap; }}
.detail {{ color:#aaa; font-size:12px; }}
footer {{ display:flex; justify-content:center; align-items:center; gap:12px; padding:0 18px 24px; }}
@media(max-width:760px) {{ .controls {{ grid-template-columns:1fr; }} }}
</style>
</head>
<body>
<header>
  <h1>CCR IMAGE TABLE PREVIEW GALLERY</h1>
  <div class="controls">
    <input id="search" type="search" placeholder="Search names or asset IDs">
    <select id="library"><option value="">All libraries</option>{options}</select>
    <button id="reset" type="button">Reset</button>
  </div>
  <div class="status" id="status"></div>
</header>
<main id="gallery"></main>
<footer>
  <button id="previous" type="button">Previous</button>
  <span id="page"></span>
  <button id="next" type="button">Next</button>
</footer>
<script>
const allItems={payload};
const pageSize=100;
let page=0;
const gallery=document.querySelector('#gallery');
const search=document.querySelector('#search');
const library=document.querySelector('#library');
const status=document.querySelector('#status');
const pageLabel=document.querySelector('#page');
function filtered(){{
  const q=search.value.trim().toLowerCase();
  return allItems.filter(item=>(!library.value||item.library===library.value)&&(!q||`${{item.name}} ${{item.assetId}}`.toLowerCase().includes(q)));
}}
function render(){{
  const items=filtered();
  const pages=Math.max(1,Math.ceil(items.length/pageSize));
  page=Math.min(page,pages-1);
  const shown=items.slice(page*pageSize,(page+1)*pageSize);
  gallery.innerHTML=shown.map(item=>`<article><div class="image"><img loading="lazy" src="${{item.src}}" alt=""></div><div class="meta"><div class="name" title="${{item.name}}">${{item.name}}</div><div class="detail">${{item.library}} · ID ${{item.assetId}} · ${{item.width}}×${{item.height}}</div></div></article>`).join('');
  status.textContent=`${{items.length.toLocaleString()}} matching images · ${{allItems.length.toLocaleString()}} total`;
  pageLabel.textContent=`Page ${{page+1}} of ${{pages}}`;
  document.querySelector('#previous').disabled=page===0;
  document.querySelector('#next').disabled=page>=pages-1;
}}
search.addEventListener('input',()=>{{page=0;render();}});
library.addEventListener('change',()=>{{page=0;render();}});
document.querySelector('#reset').addEventListener('click',()=>{{search.value='';library.value='';page=0;render();}});
document.querySelector('#previous').addEventListener('click',()=>{{page--;render();scrollTo(0,0);}});
document.querySelector('#next').addEventListener('click',()=>{{page++;render();scrollTo(0,0);}});
render();
</script>
</body>
</html>
"""
    output = args.preview_root / "index.html"
    output.write_text(html, encoding="utf-8")
    print(f"Wrote {output} with {len(items)} images")


if __name__ == "__main__":
    main()
