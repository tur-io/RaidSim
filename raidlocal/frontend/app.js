async function postJSON(url, data){
    const r = await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
    if(!r.ok) throw new Error(await r.text());
    return r.json();
  }
  async function poll(jobId, statusEl){
    for(;;){
      const d = await (await fetch(`/api/job/${jobId}`)).json();
      statusEl.textContent = `Status: ${d.status}`;
      if(d.status==="finished") return d.result;
      if(d.status==="failed") throw new Error(d.error||"Job failed");
      await new Promise(r=>setTimeout(r,1500));
    }
  }
  function pretty(x){ return JSON.stringify(x,null,2); }
  
  document.getElementById("runQuickSim").onclick = async ()=>{
    const simc = document.getElementById("simcInput").value;
    const extra = (document.getElementById("extraArgs").value||"").split(",").map(s=>s.trim()).filter(Boolean);
    const st = document.getElementById("quickSimStatus");
    const out = document.getElementById("quickSimResult");
    st.textContent="Submitting..."; out.textContent="";
    try {
      const {job_id} = await postJSON("/api/quick-sim",{simc_input:simc,extra_args:extra});
      const res = await poll(job_id, st);
      let summary="";
      try {
        const players = res.json?.sim?.players||[];
        const dps = players[0]?.collected_data?.dps?.mean;
        if(typeof dps==="number") summary = `DPS (mean): ${dps.toFixed(2)}\n\n`;
      } catch {}
      let htmlLink="";
      if(res.html_base64){
        const blob = new Blob([atob(res.html_base64)],{type:"text/html"});
        const url = URL.createObjectURL(blob);
        htmlLink = `<a class="button" href="${url}" target="_blank" rel="noopener">Open HTML Report</a>`;
      }
      out.innerHTML = `${htmlLink}<pre>${summary+pretty(res.json)}</pre>`;
    } catch(e){ out.textContent = "Error: "+e.message; }
  };
  
  document.getElementById("runTopGear").onclick = async ()=>{
    const base = document.getElementById("baseProfile").value;
    let sets = [];
    try { sets = JSON.parse(document.getElementById("profilesets").value||"[]"); }
    catch { alert("Profilesets must be valid JSON array"); return; }
    const extra = (document.getElementById("psExtraArgs").value||"").split(",").map(s=>s.trim()).filter(Boolean);
    const st = document.getElementById("psStatus");
    const out = document.getElementById("psResult");
    st.textContent="Submitting..."; out.textContent="";
    try {
      const {job_id} = await postJSON("/api/top-gear",{base_profile:base,profilesets:sets,extra_args:extra});
      const res = await poll(job_id, st);
      let htmlLink="";
      if(res.html_base64){
        const blob = new Blob([atob(res.html_base64)],{type:"text/html"});
        const url = URL.createObjectURL(blob);
        htmlLink = `<a class="button" href="${url}" target="_blank" rel="noopener">Open HTML Report</a>`;
      }
      out.innerHTML = `${htmlLink}<pre>${pretty(res.json)}</pre>`;
    } catch(e){ out.textContent = "Error: "+e.message; }
  };
  

