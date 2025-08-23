import json, os, subprocess, tempfile
from typing import Dict, List, Optional

SIMC_BIN = os.environ.get("SIMC_BIN", "/usr/local/bin/simc")

class SimcRunError(Exception): ...

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
        name = p.get("name","noname").replace(".","_")
        overrides = p.get("overrides", [])
        if not overrides: continue
        lines.append(f'profileset."{name}"={overrides[0]}')
        for opt in overrides[1:]:
            lines.append(f'profileset."{name}"+={opt}')
    return "\n".join(lines) + "\n"


