# backend/item_parser.py
from __future__ import annotations

import asyncio
import time
import re
import xml.etree.ElementTree as ET
from typing import Dict, Optional

import httpx
from pydantic import BaseModel
from fastapi import APIRouter, Query

# Router that app.py will include
router = APIRouter()

# ---- Data model ----
class ItemMeta(BaseModel):
    id: int
    name: Optional[str] = None
    icon: Optional[str] = None
    quality: Optional[int] = None
    ilvl: Optional[int] = None
    tooltip_html: Optional[str] = None

# ---- Tiny in-memory cache ----
_CACHE: Dict[int, tuple[float, ItemMeta]] = {}
_TTL = 60 * 60 * 6  # 6 hours

# ---- Fetchers (best-effort; never raise) ----
async def fetch_item_from_wowhead(item_id: int) -> Optional[ItemMeta]:
    # Try JSON tooltip endpoints first (domains may vary by region)
    urls = [
        f"https://nether.wowhead.com/tooltip/item/{item_id}?json",
        f"https://www.wowhead.com/tooltip/item/{item_id}?json",
    ]
    try:
        async with httpx.AsyncClient(timeout=10.0, headers={"User-Agent": "raidlocal/0.1"}) as client:
            for u in urls:
                try:
                    r = await client.get(u)
                    if r.status_code == 200:
                        j = r.json()
                        name = j.get("name") or j.get("title")
                        icon = j.get("icon")
                        ilvl = j.get("ilvl") or j.get("level")
                        quality = j.get("quality") or j.get("q")
                        tip = j.get("tooltip") or j.get("tooltip_html")
                        return ItemMeta(
                            id=item_id,
                            name=name,
                            icon=icon,
                            ilvl=int(ilvl) if isinstance(ilvl, (int, float, str)) and str(ilvl).isdigit() else None,
                            quality=int(quality) if isinstance(quality, (int, float, str)) and str(quality).isdigit() else None,
                            tooltip_html=tip,
                        )
                except Exception:
                    pass

            # Fallback: old XML endpoint
            try:
                r = await client.get(f"https://www.wowhead.com/item={item_id}&xml")
                if r.status_code == 200:
                    root = ET.fromstring(r.text)
                    item = root.find(".//item")
                    if item is not None:
                        name = item.findtext("name")
                        icon = item.findtext("icon")
                        ilvl_text = item.findtext("level")
                        qual_text = item.findtext("quality", default="")
                        # Sometimes "quality" is like "q4"
                        q_match = re.search(r"q(\d+)", qual_text or "")
                        quality = int(q_match.group(1)) if q_match else None
                        ilvl = int(ilvl_text) if (ilvl_text and ilvl_text.isdigit()) else None
                        return ItemMeta(id=item_id, name=name, icon=icon, ilvl=ilvl, quality=quality)
            except Exception:
                pass
    except Exception:
        pass
    return None

async def get_item_meta(item_id: int) -> ItemMeta:
    now = time.time()
    hit = _CACHE.get(item_id)
    if hit and (now - hit[0] < _TTL):
        return hit[1]
    meta = await fetch_item_from_wowhead(item_id) or ItemMeta(id=item_id)
    _CACHE[item_id] = (now, meta)
    return meta

# ---- Router endpoint (NO reference to `app` here) ----
@router.get("/api/items", response_model=list[ItemMeta])
async def api_items(ids: str = Query(..., description="comma-separated item IDs")):
    wanted = sorted({int(x) for x in ids.split(",") if x.strip().isdigit()})
    results = await asyncio.gather(*(get_item_meta(i) for i in wanted))
    return results
