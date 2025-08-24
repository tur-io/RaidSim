# backend/app.py
from fastapi import FastAPI, HTTPException, Body
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Optional

from backend.queue_utils import get_queue
from backend import simc_runner

app = FastAPI(title="RaidLocal", version="0.1.0")

# serve frontend assets
app.mount("/frontend", StaticFiles(directory="frontend"), name="frontend")

class QuickSimRequest(BaseModel):
    simc_input: str
    extra_args: Optional[List[str]] = None

class ProfilesetDef(BaseModel):
    name: str
    overrides: List[str]

class ProfilesetRequest(BaseModel):
    base_profile: str
    profilesets: List[ProfilesetDef]
    extra_args: Optional[List[str]] = None

class TrinketItem(BaseModel):
    name: str
    override: str

class TrinketPairsRequest(BaseModel):
    base_profile: str
    items: List[TrinketItem]
    extra_args: Optional[List[str]] = None

class ParseTrinketsAllRequest(BaseModel):
    simc_input: str
    include_equipped: bool = True

@app.get("/", response_class=HTMLResponse)
def root():
    with open("frontend/index.html","r",encoding="utf-8") as f:
        return HTMLResponse(f.read())

@app.get("/healthz")
def healthz(): return {"status": "ok"}

@app.post("/api/quick-sim")
def quick_sim(req: QuickSimRequest):
    job = get_queue().enqueue(simc_runner.run_simc_from_text, req.simc_input, req.extra_args or [])
    return {"job_id": job.id}

@app.post("/api/top-gear")
def top_gear(req: ProfilesetRequest):
    text = simc_runner.generate_profilesets(req.base_profile, [p.model_dump() for p in req.profilesets])
    job = get_queue().enqueue(simc_runner.run_simc_from_text, text, req.extra_args or [])
    return {"job_id": job.id}

@app.post("/api/parse-trinkets")
def parse_trinkets(simc_input: str = Body(..., embed=True)):
    items = simc_runner.extract_bag_overrides(simc_input, ("trinket1","trinket2"))
    out = []
    import re
    for it in items:
        ov = it["overrides"][0]; slot = ov.split("=",1)[0]
        m = re.search(r"id=(\d+)", ov)
        out.append({"name": it["name"], "slot": slot, "item_id": m.group(1) if m else None, "override": ov})
    return {"trinkets": out}

@app.post("/api/parse-trinkets-all")
def parse_trinkets_all(req: ParseTrinketsAllRequest):
    items = simc_runner.extract_trinkets_all(req.simc_input, include_equipped=req.include_equipped)
    return {"trinkets": items}

@app.post("/api/top-gear-trinket-pairs")
def top_gear_trinket_pairs(req: TrinketPairsRequest):
    if not req.items:
        raise HTTPException(status_code=400, detail="No trinkets selected.")
    if len(req.items) > 60:
        raise HTTPException(status_code=400, detail="Too many trinkets selected (max 60).")
    sim_text = simc_runner.make_trinket_pairs_profilesets(req.base_profile, [i.model_dump() for i in req.items])
    job = get_queue().enqueue(simc_runner.run_simc_from_text, sim_text, req.extra_args or [])
    return {"job_id": job.id, "pair_count": (len(req.items)*(len(req.items)-1))//2}

@app.get("/api/job/{job_id}")
def job_status(job_id: str):
    from rq.job import Job
    q = get_queue()
    try:
        job = Job.fetch(job_id, connection=q.connection)
    except Exception:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.is_finished:
        import base64
        result = job.result or {}
        html_b64 = base64.b64encode((result.get("html") or "").encode("utf-8")).decode("ascii") if result.get("html") else ""
        return {"status":"finished","result":{"json":result.get("json",{}),"html_base64":html_b64,"stdout":result.get("stdout","")}}
    if job.is_failed:
        return {"status":"failed","error":str(job.exc_info)}
    return {"status": job.get_status()}
