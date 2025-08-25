# backend/item_parser.py
from __future__ import annotations

import asyncio
import time
import re
import xml.etree.ElementTree as ET
from typing import Dict, Optional, List

import httpx
from pydantic import BaseModel
from fastapi import APIRouter, Query

def _detect_unique_equipped(text: str | None) -> bool:
    if not text:
        return False
    t = text.lower()
    # Covers: Unique-Equipped, Unique–Equipped, Unique — Equipped (various dashes)
    return ("unique-equipped" in t) or ("unique – equipped" in t) or ("unique — equipped" in t) or ("unique –equipped" in t) or ("unique equipped" in t)


# Router that app.py will include
router = APIRouter()

# ---- Data model ----
class ItemMeta(BaseModel):
    id: int
    name: str | None = None
    icon: str | None = None
    quality: int | None = None
    ilvl: int | None = None
    unique_equipped: bool = False
    tooltip_html: str | None = None

# ---- Tiny in-memory cache ----
_CACHE: Dict[int, tuple[float, ItemMeta]] = {}
_TTL = 60 * 60 * 6  # 6 hours

# ---- Helpers ----
def _is_unique_equipped(tooltip_html: Optional[str]) -> bool:
    """
    Best-effort detection from Wowhead tooltip HTML.
    Handles various phrasings like 'Unique-Equipped', 'Unique-Equipped:' etc.
    """
    if not tooltip_html:
        return False
    # Normalize and search
    s = tooltip_html.lower()
    return "unique-equipped" in s

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
                        unique = _detect_unique_equipped(tip)
                        return ItemMeta(
                            id=item_id,
                            name=name,
                            icon=icon,
                            ilvl=int(ilvl) if isinstance(ilvl, (int, float, str)) and str(ilvl).isdigit() else None,
                            quality=int(quality) if isinstance(quality, (int, float, str)) and str(quality).isdigit() else None,
                            unique_equipped=unique,
                            tooltip_html=tip,
                        )
                except Exception:
                    pass

            # Fallback: old XML endpoint (no tooltip here, so unique_equipped stays False)
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
                        xml_text = ET.tostring(root, encoding="unicode", method="xml")
                        unique = _detect_unique_equipped(xml_text)
                        return ItemMeta(
                            id=item_id, name=name, icon=icon, ilvl=ilvl, quality=quality,
                            unique_equipped=unique
                        )

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

async def get_items_meta_async(ids: List[int]) -> List[ItemMeta]:
    """Async bulk helper."""
    # Dedup, preserve order
    seen: set[int] = set()
    ordered = [i for i in ids if isinstance(i, int) and not (i in seen or seen.add(i))]
    metas = await asyncio.gather(*(get_item_meta(i) for i in ordered))
    return metas

def get_items_meta(ids: List[int]) -> List[ItemMeta]:
    """
    Sync wrapper for codepaths that are not async (e.g., simc_runner building profilesets).
    Uses asyncio.run() only if there is no running loop.
    """
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        # When called from an async context we cannot block the running loop.
        # Run the async helper in a separate thread with its own event loop.
        import threading

        result: List[ItemMeta] = []

        def runner() -> None:
            nonlocal result
            result = asyncio.run(get_items_meta_async(ids))

        t = threading.Thread(target=runner)
        t.start()
        t.join()
        return result
    else:
        return asyncio.run(get_items_meta_async(ids))

# ---- Router endpoint (NO reference to `app` here) ----
@router.get("/api/items", response_model=list[ItemMeta])
async def api_items(ids: str = Query(..., description="comma-separated item IDs")):
    wanted = sorted({int(x) for x in ids.split(",") if x.strip().isdigit()})
    results = await get_items_meta_async(wanted)
    return results
