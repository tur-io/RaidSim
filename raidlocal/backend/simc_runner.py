import json, os, subprocess, tempfile, re
from typing import Dict, List, Optional

SIMC_BIN = os.environ.get("SIMC_BIN", "/usr/local/bin/simc")

class SimcRunError(Exception): ...

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
    if extra: cmd.extend(extra)
    return cmd

def run_simc_from_text(simc_text: str, extra_args: Optional[List[str]] = None) -> Dict:
    with tempfile.TemporaryDirectory(prefix="simcjob_") as d:
        simc_file = os.path.join(d, "input.simc")
        json_path = os.path.join(d, "report.json")
        html_path = os.path.join(d, "report.html")
        with open(simc_file, "w", encoding="utf-8") as f: f.write(simc_text)
        proc = subprocess.run(_build_cmd(simc_file, html_path, json_path, extra_args or []),
                              stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        if proc.returncode != 0:
            raise SimcRunError(f"simc rc={proc.returncode}\n{proc.stdout}")
        data = {}
        if os.path.exists(json_path):
            with open(json_path, "r", encoding="utf-8") as jf: data = json.load(jf)
        html = ""
        if os.path.exists(html_path):
            with open(html_path, "r", encoding="utf-8") as hf: html = hf.read()
        return {"json": data, "html": html, "stdout": proc.stdout}

def generate_profilesets(base_profile: str, profiles: List[Dict]) -> str:
    lines = [base_profile.strip(), ""]
    for p in profiles:
        # The profileset name may contain spaces or special characters from user
        # input. SimulationCraft expects a restricted character set, so sanitize
        # the name before emitting it to the .simc file to prevent malformed
        # profileset declarations.
        name = _sanitize_name(p.get("name", "noname"))
        overrides = p.get("overrides", [])
        if not overrides: continue
        lines.append(f'profileset."{name}"={overrides[0]}')
        for opt in overrides[1:]:
            lines.append(f'profileset."{name}"+={opt}')
    return "\n".join(lines) + "\n"

def extract_bag_overrides(simc_text: str, slots=("trinket1","trinket2")):
    """
    Parse the '### Gear from Bags' section of a /simc export and return
    [{"name": str, "overrides": ["<slot>=,id=...,bonus_id=..."]}, ...]
    Defaults to trinket1/trinket2.
    """
    wanted = set(slots)
    results = []
    in_bags = False
    last_label = None

    pat_bags_hdr   = re.compile(r"^###\s*Gear from Bags\s*$")
    pat_next_hdr   = re.compile(r"^###\s+")
    pat_item_label = re.compile(r"^#\s*(.+?)\s*\(\d+\)\s*$")      # "# Void-Touched Fragment (681)"
    pat_assign     = re.compile(r"^#\s*(\w+)\s*=\s*(,.*)$")       # "# trinket1=,id=238386,bonus_id=..."

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


def extract_equipped_trinkets(simc_text: str, slots=("trinket1","trinket2")):
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
    # You already have extract_bag_overrides(..); reuse it
    bags = extract_bag_overrides(simc_text, ("trinket1","trinket2"))
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
        out.append({
            "name": it["name"],
            "slot": slot,
            "item_id": mid.group(1) if mid else None,
            "override": ov,
            "source": it.get("source", "bags"),
        })
    return out

# --- add anywhere below (module level) ---
def make_trinket_pairs_profilesets(base_profile: str, items: list[dict]) -> str:
    """
    items: [{"name": str, "override": "trinket1=,id=...,bonus_id=..."}]
    Build profilesets for every unique trinket pair, but skip the exact equipped pair (baseline already shows it).
    """
    # dedupe items by full tail
    uniq, seen = [], set()
    for it in items:
        ov = (it.get("override") or "")
        if "trinket" not in ov:
            continue
        tail = trinket_tail_from_override(ov)
        if tail in seen:
            continue
        seen.add(tail)
        uniq.append({"name": _sanitize_name(it.get("name") or "item"), "tail": tail})

    # detect the equipped pair from the base actor
    t1, t2 = _equipped_trinket_tails(base_profile)
    equipped_pair = {t1, t2} if t1 and t2 else set()

    lines = [base_profile.strip(), ""]
    n = len(uniq)
    for i in range(n):
        for j in range(i + 1, n):
            a, b = uniq[i], uniq[j]
            pair = {a["tail"], b["tail"]}
            if equipped_pair and pair == equipped_pair:
                continue  # skip duplicate of baseline equipment
            pname = _sanitize_name(f"T_{a['name']}__{b['name']}")
            lines.append(f'profileset."{pname}"=trinket1={a["tail"]}')
            lines.append(f'profileset."{pname}"+=trinket2={b["tail"]}')

    # if nothing got created, at least make singles
    if len(lines) == 2:
        for it in uniq:
            pname = _sanitize_name(f"T_{it['name']}")
            lines.append(f'profileset."{pname}"=trinket1={it["tail"]}')

    return "\n".join(lines) + "\n"