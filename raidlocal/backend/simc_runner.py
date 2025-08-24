# backend/simc_runner.py
from __future__ import annotations
import json, os, subprocess, tempfile, re
from typing import Dict, List, Optional

SIMC_BIN = os.environ.get("SIMC_BIN", "/usr/local/bin/simc")

# Optional: batch metadata fetch (if implemented in item_parser)
try:
    from .item_parser import get_items_meta  # type: ignore
except Exception:  # pragma: no cover
    get_items_meta = None  # type: ignore


class SimcRunError(Exception):
    ...


def _sanitize_name(s: str) -> str:
    s = re.sub(r'[^A-Za-z0-9_]+', '_', s)
    s = re.sub(r'_+', '_', s).strip('_')
    return s[:64] or "item"


def trinket_tail_from_override(override: str) -> str:
    # "trinket1=,id=..."  -> ",id=..."
    _, rhs = override.split("=", 1)
    rhs = rhs.strip()
    return rhs if rhs.startswith(",") else ("," + rhs)


def _equipped_trinket_tails(base_profile: str):
    """Return (t1_tail, t2_tail) from the base actor or (None, None) if missing."""
    t1 = t2 = None
    pat = re.compile(r'^\s*(trinket[12])\s*=\s*(,.*)$')
    for line in base_profile.splitlines():
        if line.lstrip().startswith("#"):
            continue
        m = pat.match(line)
        if not m:
            continue
        slot, rhs = m.group(1), m.group(2).strip()
        rhs = rhs if rhs.startswith(",") else ("," + rhs)
        if slot == "trinket1":
            t1 = rhs
        else:
            t2 = rhs
    return t1, t2


def _build_cmd(simc_file: str, html_path: str, json_path: str, extra: Optional[List[str]]) -> List[str]:
    cmd = [SIMC_BIN, simc_file, f"json2={json_path}", f"html={html_path}"]
    if extra:
        cmd.extend(extra)
    return cmd


def run_simc_from_text(simc_text: str, extra_args: Optional[List[str]] = None) -> Dict:
    with tempfile.TemporaryDirectory(prefix="simcjob_") as d:
        simc_file = os.path.join(d, "input.simc")
        json_path = os.path.join(d, "report.json")
        html_path = os.path.join(d, "report.html")
        with open(simc_file, "w", encoding="utf-8") as f:
            f.write(simc_text)
        proc = subprocess.run(
            _build_cmd(simc_file, html_path, json_path, extra_args or []),
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True
        )
        if proc.returncode != 0:
            raise SimcRunError(f"simc rc={proc.returncode}\n{proc.stdout}")
        data: Dict = {}
        if os.path.exists(json_path):
            with open(json_path, "r", encoding="utf-8") as jf:
                data = json.load(jf)
        html = ""
        if os.path.exists(html_path):
            with open(html_path, "r", encoding="utf-8") as hf:
                html = hf.read()
        return {"json": data, "html": html, "stdout": proc.stdout}


def generate_profilesets(base_profile: str, profiles: List[Dict]) -> str:
    lines = [base_profile.strip(), ""]
    for p in profiles:
        name = p.get("name", "noname").replace(".", "_")
        overrides = p.get("overrides", [])
        if not overrides:
            continue
        lines.append(f'profileset."{name}"={overrides[0]}')
        for opt in overrides[1:]:
            lines.append(f'profileset."{name}"+={opt}')
    return "\n".join(lines) + "\n"


def extract_bag_overrides(simc_text: str, slots=("trinket1", "trinket2")):
    """
    Parse the '### Gear from Bags' section of a /simc export and return
    [{"name": str, "overrides": ["<slot>=,id=...,bonus_id=..."]}, ...]
    Defaults to trinket1/trinket2.
    """
    wanted = set(slots)
    results = []
    in_bags = False
    last_label = None

    pat_bags_hdr = re.compile(r"^###\s*Gear from Bags\s*$")
    pat_next_hdr = re.compile(r"^###\s+")
    pat_item_label = re.compile(r"^#\s*(.+?)\s*\(\d+\)\s*$")  # "# Void-Touched Fragment (681)"
    pat_assign = re.compile(r"^#\s*(\w+)\s*=\s*(,.*)$")       # "# trinket1=,id=238386,bonus_id=..."

    for line in simc_text.splitlines():
        if pat_bags_hdr.match(line):
            in_bags = True
            continue
        if in_bags and pat_next_hdr.match(line):
            break  # end of bags section

        if not in_bags:
            continue

        m_lbl = pat_item_label.match(line)
        if m_lbl:
            last_label = m_lbl.group(1)
            continue

        m_ass = pat_assign.match(line)
        if not m_ass:
            continue

        slot, rhs = m_ass.group(1), m_ass.group(2)
        if slot not in wanted:
            continue

        # Keep the string EXACTLY as SimC emits it (leading comma + equals)
        override = f"{slot}={rhs}"  # e.g. "trinket1=,id=238386,bonus_id=..."

        m_id = re.search(r"id=(\d+)", rhs)
        item_id = m_id.group(1) if m_id else "item"
        base_name = last_label or f"{slot}_{item_id}"
        name = _sanitize_name(f"{slot}_{base_name}_{item_id}")

        results.append({"name": name, "overrides": [override]})

    return results


def extract_equipped_trinkets(simc_text: str, slots=("trinket1", "trinket2")):
    """Read the *equipped* trinkets from the top gear block (non-comment lines)."""
    pat = re.compile(rf'^\s*(?P<slot>{"|".join(slots)})\s*=\s*(?P<rhs>,.*)$')
    out = []
    for line in simc_text.splitlines():
        if line.lstrip().startswith("#"):  # skip comments
            continue
        m = pat.match(line)
        if not m:
            continue
        slot, rhs = m.group("slot"), m.group("rhs")
        override = f"{slot}={rhs}"  # keep exact format
        mid = re.search(r"id=(\d+)", rhs)
        item_id = mid.group(1) if mid else "item"
        name = _sanitize_name(f"{slot}_Equipped_{item_id}")
        out.append({"name": name, "overrides": [override], "source": "equipped"})
    return out


def extract_trinkets_all(simc_text: str, include_equipped: bool = True):
    """
    Return a deduped list of trinkets from bags (+ equipped if requested)
    with a uniform shape for the UI/endpoint.
    """
    bags = extract_bag_overrides(simc_text, ("trinket1", "trinket2"))
    for b in bags:
        b["source"] = "bags"

    items = bags + (extract_equipped_trinkets(simc_text) if include_equipped else [])
    out, seen = [], set()
    for it in items:
        ov = it["overrides"][0]
        tail = trinket_tail_from_override(ov)  # used as dedupe key
        if tail in seen:
            continue
        seen.add(tail)
        slot = ov.split("=", 1)[0]
        mid = re.search(r"id=(\d+)", ov)
        item_id = int(mid.group(1)) if mid else None
        out.append({
            "name": it["name"],
            "slot": slot,
            "item_id": item_id,
            "override": ov,
            "source": it.get("source", "bags"),
        })
    return out


# --- helpers for unique-equipped fallback (optional) ---
def _id_from_tail(tail: str) -> Optional[int]:
    m = re.search(r"id=(\d+)", tail or "")
    return int(m.group(1)) if m else None


def _unique_map_for_ids(ids: List[int]) -> Dict[int, bool]:
    """
    Build {item_id: unique_equipped_bool} for the given IDs using item_parser.get_items_meta(),
    if available. Otherwise returns {}.
    """
    if not ids or not get_items_meta:
        return {}
    try:
        metas = get_items_meta(ids)  # synchronous helper you may add to item_parser
    except Exception:
        return {}
    out: Dict[int, bool] = {}
    for m in metas:
        out[getattr(m, "id", None)] = bool(getattr(m, "unique_equipped", False))
    return {k: v for k, v in out.items() if isinstance(k, int)}


def make_trinket_pairs_profilesets(base_profile: str, items: list[dict]) -> str:
    """
    items: [{"name": str, "override": "trinket1=,id=...", "item_id": int|None, "unique_equipped": bool|None}]
    Build profilesets for every unique trinket pair, skipping:
      - the exact equipped pair (baseline already covers it)
      - duplicate 'same item id' pairs when that item is Unique-Equipped
    """
    # Dedup by full tail
    uniq, seen = [], set()
    for it in items:
        ov = (it.get("override") or "")
        if "trinket" not in ov:
            continue
        tail = trinket_tail_from_override(ov)
        if tail in seen:
            continue
        seen.add(tail)
        iid = int(it.get("item_id")) if it.get("item_id") else _id_from_tail(tail)
        uniq.append({
            "name": _sanitize_name(it.get("name") or "item"),
            "tail": tail,
            "id": iid,
            "unique": bool(it.get("unique_equipped", False)),
        })

    # If some items don't have 'unique' set but we can look them up, fill them in
    missing_ids = sorted({u["id"] for u in uniq if u["id"] and not u["unique"]})
    if missing_ids:
        u_map = _unique_map_for_ids(missing_ids)  # {} if helper not available
        for u in uniq:
            if u["id"] in u_map:
                u["unique"] = bool(u_map[u["id"]])

    # Equipped pair (to avoid duplicating baseline)
    t1, t2 = _equipped_trinket_tails(base_profile)
    equipped_pair = {t1, t2} if t1 and t2 else set()

    lines = [base_profile.strip(), ""]
    n = len(uniq)
    for i in range(n):
        for j in range(i + 1, n):
            a, b = uniq[i], uniq[j]

            # Skip exact equipped pair
            pair_tails = {a["tail"], b["tail"]}
            if equipped_pair and pair_tails == equipped_pair:
                continue

            # Skip same-ID pairs unconditionally (cannot equip two copies of the same trinket)
            if a["id"] and b["id"] and a["id"] == b["id"]:
                continue

            # Prefer a compact, id-based profileset name so item ids are preserved
            ida = a["id"] or 0
            idb = b["id"] or 0
            pname = _sanitize_name(f"T_{ida}_VS_{idb}")
            lines.append(f'profileset."{pname}"=trinket1={a["tail"]}')
            lines.append(f'profileset."{pname}"+=trinket2={b["tail"]}')

    # Fallback: if nothing got created, at least make singles
    if len(lines) == 2:
        for it in uniq:
            pname = _sanitize_name(f"T_{it['name']}")
            lines.append(f'profileset."{pname}"=trinket1={it["tail"]}')

    return "\n".join(lines) + "\n"
