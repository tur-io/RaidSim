from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from typing import List, Optional
from backend.queue_utils import get_queue
from backend import simc_runner

app = FastAPI(title="RaidLocal", version="0.1.0")

class QuickSimRequest(BaseModel):
    simc_input: str = Field(..., description="Paste /simc addon export or .simc profile text")
    extra_args: Optional[List[str]] = None

class ProfilesetDef(BaseModel):
    name: str
    overrides: List[str]

class ProfilesetRequest(BaseModel):
    base_profile: str
    profilesets: List[ProfilesetDef]
    extra_args: Optional[List[str]] = None

@app.get("/", response_class=HTMLResponse)
def root():
    with open("frontend/index.html","r",encoding="utf-8") as f:
        return HTMLResponse(f.read())

@app.get("/healthz")
def healthz(): return {"status":"ok"}

@app.post("/api/quick-sim")
def quick_sim(req: QuickSimRequest):
    job = get_queue().enqueue(simc_runner.run_simc_from_text, req.simc_input, req.extra_args or [])
    return {"job_id": job.id}

@app.post("/api/top-gear")
def top_gear(req: ProfilesetRequest):
    text = simc_runner.generate_profilesets(req.base_profile, [p.model_dump() for p in req.profilesets])
    job = get_queue().enqueue(simc_runner.run_simc_from_text, text, req.extra_args or [])
    return {"job_id": job.id}

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


