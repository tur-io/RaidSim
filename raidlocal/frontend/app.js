async function postJSON(url, data){
  const r = await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
  if(!r.ok) throw new Error(await r.text());
  return r.json();
}

function val(id){ return document.getElementById(id).value; }
function set(id, html){ document.getElementById(id).innerHTML = html; }
function text(id, s){ document.getElementById(id).textContent = s; }

function renderTrinkets(list){
  const el = document.getElementById("tgList");
  if(!list.length){ el.innerHTML = "<div class='status'>No trinkets found.</div>"; return; }
  el.innerHTML = "";
  list.forEach((t,i)=>{
    const row = document.createElement("div");
    row.className = "tg-item";
    row.dataset.index = i;

    const icon = document.createElement("div"); icon.className = "tg-icon";
    const name = document.createElement("div"); name.className = "tg-name";
    name.textContent = (t.name || `trinket_${t.item_id || i}`).replace(/^trinket[12]_/, "");

    const meta = document.createElement("div"); meta.className = "tg-slot badge";
    meta.textContent = `${t.slot} • ${t.source}`;

    const sel = document.createElement("input"); sel.type = "checkbox"; sel.className = "tg-select"; sel.checked = true;

    row.append(icon, name, meta, sel);
    el.append(row);
  });
}

// Parse button
document.getElementById("tgParse").onclick = async ()=>{
  const simc = val("tgSimc").trim();
  const includeEq = document.getElementById("tgIncludeEquipped").checked;
  const st = document.getElementById("tgParseStatus");
  st.textContent = "Parsing...";
  try{
    const data = await postJSON("/api/parse-trinkets-all", { simc_input: simc, include_equipped: includeEq });
    window.__tgTrinkets = data.trinkets;
    renderTrinkets(data.trinkets);
    st.textContent = `Found ${data.trinkets.length} trinket(s)`;
  }catch(e){
    st.textContent = "Error: " + e.message;
  }
};
document.getElementById("tgSelectAll").onclick = ()=>{
  document.querySelectorAll(".tg-item .tg-select").forEach(cb => cb.checked = true);
};
document.getElementById("tgSelectNone").onclick = ()=>{
  document.querySelectorAll(".tg-item .tg-select").forEach(cb => cb.checked = false);
};

function renderRanking(resultJson){
  const ps = resultJson?.sim?.profilesets?.results || resultJson?.profilesets?.results || [];
  if(!Array.isArray(ps) || ps.length === 0){
    return "<div class='status'>Profileset results not found in JSON (open the HTML report for the full table).</div>";
  }
  const base = baselineDpsFromJson(resultJson);
  const rows = ps.map(r=>{
    const name = r.name || r.profileset || r.profile || "set";
    const dps  = (r.dps?.mean ?? r.collected_data?.dps?.mean ?? r.mean ?? null);
    return { name, dps: (typeof dps === "number" ? dps : null) };
  }).filter(x=>x.dps !== null);
  rows.sort((a,b)=>b.dps - a.dps);

  const top = rows[0];
  const delta = (base!=null && top) ? (top.dps - base) : null;
  const deltaStr = (delta!=null) ? ` (${delta>=0?"+":""}${delta.toFixed(0)} vs baseline)` : "";

  let html = "";
  if(top){
    const equipTag = isEquippedPairName(top.name) ? " <span class='badge'>Equipped pair</span>" : "";
    html += `<div class="badge">Best pair: <b>${top.name}</b> — ${top.dps.toFixed(2)} DPS${deltaStr}${equipTag}</div>`;
  }

  // top 10 table with deltas and equipped labels
  const list = rows.slice(0,10).map(r=>{
    const d = (base!=null) ? ` (${(r.dps-base>=0?"+":"")}${(r.dps-base).toFixed(0)})` : "";
    const tag = isEquippedPairName(r.name) ? " [Equipped pair]" : "";
    return { name: r.name+tag, dps: r.dps, delta: d };
  });
  html += "\n\n" + JSON.stringify(list, null, 2);
  return `<pre>${html}</pre>`;
}

async function runPairs(items){
  const st = document.getElementById("tgRunStatus");
  const out = document.getElementById("tgResult");
  const base = (val("tgBase").trim() || val("tgSimc").trim());
  const extra = (val("tgArgs")||"").split(",").map(s=>s.trim()).filter(Boolean);

  st.textContent = "Submitting...";
  out.innerHTML = "";

  const { job_id } = await postJSON("/api/top-gear-trinket-pairs", { base_profile: base, items, extra_args: extra });

  for(;;){
    const r = await (await fetch(`/api/job/${job_id}`)).json();
    st.textContent = `Status: ${r.status}`;
    if(r.status === "finished"){
      let htmlLink = "";
      if(r.result?.html_base64){
        const blob = new Blob([atob(r.result.html_base64)], { type: "text/html" });
        const url = URL.createObjectURL(blob);
        htmlLink = `<a class="button" href="${url}" target="_blank" rel="noopener">Open HTML Report</a>`;
      }
      const ranking = renderRanking(r.result?.json || {});
      out.innerHTML = `${htmlLink}${ranking}`;
      break;
    }
    if(r.status === "failed"){ out.textContent = r.error || "Job failed"; break; }
    await new Promise(r => setTimeout(r, 1500));
  }
}

document.getElementById("tgRunPairs").onclick = async ()=>{
  const all = (window.__tgTrinkets || []);
  const rows = Array.from(document.querySelectorAll(".tg-item"));
  const selected = rows.map((row, idx)=>{
    if(!row.querySelector(".tg-select").checked) return null;
    const t = all[idx];
    return { name: t.name, override: t.override };
  }).filter(Boolean);
  if(selected.length < 2){ document.getElementById("tgRunStatus").textContent = "Pick at least 2 trinkets."; return; }
  await runPairs(selected);
};

document.getElementById("tgRunPairsAll").onclick = async ()=>{
  const all = (window.__tgTrinkets || []);
  if(all.length < 2){ document.getElementById("tgRunStatus").textContent = "Need at least 2 trinkets."; return; }
  // use *all* parsed trinkets regardless of UI selection
  await runPairs(all.map(t => ({ name: t.name, override: t.override })));
};

function sanitizeName(s){
  return (s||"").replace(/[^A-Za-z0-9_]+/g,"_").replace(/_+/g,"_").replace(/^_+|_+$/g,"").slice(0,64) || "item";
}

function baselineDpsFromJson(j){
  const p = (j?.sim?.players || j?.players || [])[0];
  const m = p?.collected_data?.dps?.mean;
  return (typeof m === "number") ? m : null;
}
function equippedNameParts(){
  const eq = (window.__tgTrinkets||[]).filter(t=>t.source==="equipped").map(t=>sanitizeName(t.name));
  return eq.length === 2 ? eq : null;
}
function isEquippedPairName(name){
  const eq = equippedNameParts();
  if(!eq) return false;
  const n = name || "";
  return eq.every(x => n.includes(x));
}


function verdictAgainstEquipped(topProfilesetName){
  const all = window.__tgTrinkets || [];
  const eq = all.filter(t => t.source === "equipped");
  if (eq.length < 2) return "";
  const a = sanitizeName(eq[0].name), b = sanitizeName(eq[1].name);
  const n = topProfilesetName || "";
  const alreadyBest = (n.includes(a) && n.includes(b));
  return alreadyBest
    ? "✅ You’re already using the best trinket pair."
    : "👉 Recommendation: equip the two trinkets shown in the Best pair line above.";
}

// …inside the `if (r.status === "finished")` block after you compute `ranking`…
const topName = (r.result?.json?.sim?.profilesets?.results?.[0]?.name)
             || (r.result?.json?.profilesets?.results?.[0]?.name) || "";
const verdict = verdictAgainstEquipped(topName);
out.innerHTML = `${htmlLink}${ranking}${verdict ? `<div class="badge" style="margin-top:8px">${verdict}</div>` : ""}`;
