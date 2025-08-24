// ---------- tiny fetch helper ----------
async function postJSON(url, data){
  const r = await fetch(url, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(data)
  });
  if(!r.ok) throw new Error(await r.text());
  return r.json();
}

// ===== item meta cache (icons/names/tooltips) =====
const ITEM_IMG_CDN = "https://wow.zamimg.com/images/wow/icons/large/";
const PLACEHOLDER_ICON = ITEM_IMG_CDN + "inv_misc_questionmark.jpg";

// in-memory cache: id -> { id, name, icon, unique_equipped, ... }
window.__itemMeta = window.__itemMeta || {};
function getItemMeta(id){ return id ? window.__itemMeta[id] : null; }
function iconForItem(id){
  const m = getItemMeta(id);
  return m?.icon ? `${ITEM_IMG_CDN}${m.icon}.jpg` : PLACEHOLDER_ICON;
}
function isUniqueEquipped(id){
  const m = getItemMeta(id);
  return !!(m && m.unique_equipped);
}

function cleanFallbackLabel(s = "") {
  // strip trailing _123456 id if present, turn underscores into spaces
  return s.replace(/_\d{6}\b/, "").replace(/_/g, " ").trim();
}

function prettyItemNameById(id, fallback = "") {
  const meta = getItemMeta(id);
  if (meta?.name) return meta.name;           // best case
  return cleanFallbackLabel(fallback) || (id ? `Item ${id}` : "Item");
}

function pairLabel(A, B, raw = "") {
  // A and B are { item_id, label }
  const a = prettyItemNameById(A.item_id, A.label || raw);
  const b = prettyItemNameById(B.item_id, B.label || raw);
  return `${a} + ${b}`;
}


// Fetch icons/names for a list of trinkets (dedup by id), store in __itemMeta
async function warmItemMetaFromTrinkets(trinkets){
  const ids = [...new Set((trinkets || []).map(t => t.item_id).filter(Boolean))];
  if (!ids.length) return false;

  const res = await fetch(`/api/items?ids=${ids.join(",")}`);
  if (!res.ok) return false;

  const raw = await res.json();
  const list = Array.isArray(raw) ? raw : (Array.isArray(raw?.value) ? raw.value : []);
  list.forEach(m => { if (m?.id) window.__itemMeta[m.id] = m; });
  return true;
}

function idsFromResultJson(json){
  const rows = json?.sim?.profilesets?.results || json?.profilesets?.results || [];
  const ids = new Set();
  for (const r of rows) {
    const name = r?.name || r?.profileset || r?.profile || "";
    (name.match(/\b\d{6}\b/g) || []).forEach(s => ids.add(parseInt(s, 10)));
  }
  return [...ids];
}

async function warmItemMetaFromIds(ids){
  const want = ids.filter(id => !window.__itemMeta[id]);
  if (!want.length) return;
  const res = await fetch(`/api/items?ids=${want.join(",")}`);
  if (!res.ok) return;
  const raw = await res.json();
  const list = Array.isArray(raw) ? raw : (Array.isArray(raw.value) ? raw.value : []);
  list.forEach(m => { if (m?.id) window.__itemMeta[m.id] = m; });
}

async function warmItemMetaFromResult(json){
  const ids = idsFromResultJson(json);
  await warmItemMetaFromIds(ids);
}

// ------ saved state ------
function saveState(){
  try {
    localStorage.setItem("tgSimc", document.getElementById("tgSimc").value);
    localStorage.setItem("tgBase", document.getElementById("tgBase").value);
    localStorage.setItem("tgArgs", document.getElementById("tgArgs").value);
    localStorage.setItem("tgIncludeEquipped",
      document.getElementById("tgIncludeEquipped").checked ? "1" : "0");
  } catch {}
}
function loadState(){
  try {
    const g = k => localStorage.getItem(k);
    if (g("tgSimc")) document.getElementById("tgSimc").value = g("tgSimc");
    if (g("tgBase")) document.getElementById("tgBase").value = g("tgBase");
    if (g("tgArgs")) document.getElementById("tgArgs").value = g("tgArgs");
    const inc = g("tgIncludeEquipped");
    if (inc!==null) document.getElementById("tgIncludeEquipped").checked = (inc==="1");
  } catch {}
}
document.addEventListener("input", e=>{
  if(["tgSimc","tgBase","tgArgs"].includes(e.target.id)) saveState();
});
document.getElementById("tgIncludeEquipped").addEventListener("change", saveState);
document.addEventListener("DOMContentLoaded", loadState);

// ---------- dom helpers ----------
function val(id){ return document.getElementById(id).value; }
function set(id, html){ document.getElementById(id).innerHTML = html; }
function text(id, s){ document.getElementById(id).textContent = s; }

// ---------- formatting ----------
function fmtInt(n){ return Math.round(n).toLocaleString(); }
function fmtDps(n){
  if (n == null || Number.isNaN(n)) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(3) + "M";
  return fmtInt(n);
}
function fmtDelta(n){
  if (n == null || Number.isNaN(n)) return "—";
  const s = Math.round(n);
  return (s >= 0 ? "+" : "") + s.toLocaleString();
}

// =====================================================
// ===============  Trinket picker  ====================
// =====================================================
function renderTrinkets(list){
  const el = document.getElementById("tgList");
  if(!list.length){
    el.innerHTML = "<div class='status'>No trinkets found.</div>";
    return;
  }
  el.innerHTML = "";
  list.forEach((t,i)=>{
    const row = document.createElement("div");
    row.className = "tg-item";
    row.dataset.index = i;

    const icon = document.createElement("div");
    icon.className = "tg-icon";
    icon.innerHTML = `<img src="${iconForItem(t.item_id)}" alt="">`;

    const name = document.createElement("div");
    name.className = "tg-name";
    name.textContent = prettyItemNameById(t.item_id, (t.name || `trinket_${t.item_id || i}`).replace(/^trinket[12]_/, ""));


    const meta = document.createElement("div");
    meta.className = "tg-slot badge";
    const uBadge = isUniqueEquipped(parseInt(t.item_id,10))
      ? ` <span class="badge" title="Unique-Equipped — you can’t equip two copies">Unique</span>`
      : "";
    meta.innerHTML = `${t.slot} • ${t.source}${uBadge}`;

    const sel = document.createElement("input");
    sel.type = "checkbox";
    sel.className = "tg-select";
    sel.checked = true;

    row.append(icon, name, meta, sel);
    el.append(row);
  });
}

document.getElementById("tgParse").onclick = async ()=>{
  const simc = val("tgSimc").trim();
  const includeEq = document.getElementById("tgIncludeEquipped").checked;
  const st = document.getElementById("tgParseStatus");
  st.textContent = "Parsing...";
  try{
    const data = await postJSON("/api/parse-trinkets-all", {
      simc_input: simc,
      include_equipped: includeEq
    });
    window.__tgTrinkets = data.trinkets;

    // Preload item meta so icons/names are available before rendering
    await warmItemMetaFromTrinkets(window.__tgTrinkets);

    renderTrinkets(window.__tgTrinkets);
    st.textContent = `Found ${data.trinkets.length} trinket(s)`;
  }catch(e){
    st.textContent = "Error: " + e.message;
  }
};

document.getElementById("tgSelectAll").onclick =
  ()=> document.querySelectorAll(".tg-item .tg-select").forEach(cb => cb.checked = true);
document.getElementById("tgSelectNone").onclick =
  ()=> document.querySelectorAll(".tg-item .tg-select").forEach(cb => cb.checked = false);

// =====================================================
// =================  Result helpers  ==================
// =====================================================
function sanitizeName(s){
  return (s||"")
    .replace(/[^A-Za-z0-9_]+/g,"_")
    .replace(/_+/g,"_")
    .replace(/^_+|_+$/g,"")
    .slice(0,64) || "item";
}
function baselineDpsFromJson(j){
  const p = (j?.sim?.players || j?.players || [])[0];
  const m = p?.collected_data?.dps?.mean;
  return (typeof m === "number") ? m : null;
}
function isEquippedPairName(name){
  const eq = (window.__tgTrinkets||[])
    .filter(t=>t.source==="equipped")
    .map(t=>sanitizeName(t.name));
  if(eq.length !== 2) return false;
  const n = name || "";
  return eq.every(x => n.includes(x));
}

// --- Robust partsFromProfilesetName ---
// 0) If name is "T_<left>__<right>", split and take the LAST 6-digit id from each side
// 1) Otherwise: first-two-ids regex
// 2) Otherwise: known-IDs scan
// 3) Otherwise: sanitized-name contains
function partsFromProfilesetName(name){
  const all = window.__tgTrinkets || [];
  const raw = (name || "");

  // 0) Decode our own naming: T_<left>__<right>
  const m = /^T_(.+?)__(.+)$/.exec(raw);
  if (m) {
    const pick = (s) => {
      const idMatch = (s.match(/\d{6}(?!.*\d)/) || [])[0]; // last 6-digit token
      const id = idMatch ? parseInt(idMatch, 10) : null;
      const meta = id ? getItemMeta(id) : null;
      return { item_id: id, label: meta?.name || cleanFallbackLabel(s) };
    };
    const A = pick(m[1]);
    const B = pick(m[2]);
    return [A, B];
  }

  // 1) direct "first two unique 6-digit ids" in the whole string
  const firstTwo = [...new Set((raw.match(/\b\d{6}\b/g) || []).map(x => parseInt(x,10)))].slice(0,2);
  if (firstTwo.length === 2){
    const [idA,idB] = firstTwo;
    const metaA = getItemMeta(idA), metaB = getItemMeta(idB);
    return [
      { item_id: idA, label: metaA?.name || `Item ${idA}` },
      { item_id: idB, label: metaB?.name || `Item ${idB}` }
    ];
  }

  // 2) scan with known IDs (from parsed trinkets + warmed meta)
  const knownIds = new Set([
    ...((all.map(t => t.item_id).filter(Boolean)) || []),
    ...Object.keys(window.__itemMeta || {}).map(x => parseInt(x,10))
  ]);
  const found = [];
  for (const id of knownIds){
    if (raw.includes(String(id))){
      found.push(id);
      if (found.length === 2) break;
    }
  }
  if (found.length === 2){
    const [idA,idB] = found;
    const metaA = getItemMeta(idA), metaB = getItemMeta(idB);
    return [
      { item_id: idA, label: metaA?.name || `Item ${idA}` },
      { item_id: idB, label: metaB?.name || `Item ${idB}` }
    ];
  }

  // 3) fallback to sanitized-name matching
  const hits = [];
  for (const t of all) {
    const sn = sanitizeName(t.name);
    if (sn && raw.includes(sn)) hits.push({ item_id: t.item_id || null, label: t.name || "" });
    if (hits.length === 2) break;
  }
  if (hits.length === 2) return hits;

  return [{ item_id: null, label: "" }, { item_id: null, label: "" }];
}


// Build the Top-Gear-style table
function buildTopGearTable(resultJson){
  const profiles = resultJson?.sim?.profilesets?.results
                || resultJson?.profilesets?.results || [];
  const baseline = baselineDpsFromJson(resultJson);

  // Normalize + sort (desc)
  const rows = profiles.map(p=>{
    const name = p.name || p.profileset || p.profile || "set";
    const dps  = (p.dps?.mean ?? p.collected_data?.dps?.mean ?? p.mean ?? null);
    return {
      name,
      dps: (typeof dps === "number" ? dps : null),
      items: partsFromProfilesetName(name),
      isEquipped: isEquippedPairName(name)
    };
  }).filter(x => x.dps !== null);
  rows.sort((a,b)=>b.dps - a.dps);
  if (rows.length) rows[0].isTop = true;

  // ---- References / toggles
  const refIsTop = document.getElementById("tgRefTop")?.checked || false;
  const relative = document.getElementById("tgRelDps")?.checked || false;

  // Reference number used for delta cells (equipped baseline or top)
  const ref = refIsTop ? (rows[0]?.dps ?? baseline ?? 0) : (baseline ?? 0);

  // **Top DPS** (used for bar widths ONLY)
  const topDps = rows.length ? rows[0].dps : (baseline ?? 0);

  // Bar helper (always vs top DPS)
  const bar = (val) => {
    const pct = topDps ? Math.max(0, Math.min(100, (val / topDps) * 100)) : 0;
    return `<div class="tg-bar"><div class="fill" style="width:${pct.toFixed(1)}%"></div></div>`;
  };

  // Header
  let html = `
    <div class="tg-row header">
      <div class="tg-rank">#</div><div></div><div></div>
      <div>Trinket Pair</div>
      <div class="tg-dps">${relative ? "Rel DPS" : "DPS"}</div>
      <div class="tg-delta">Δ vs ${refIsTop ? "Top" : "Equipped"}</div>
    </div>
  `;

  // Equipped baseline row
  if (typeof baseline === "number") {
    const eq = (window.__tgTrinkets||[]).filter(t=>t.source==="equipped");
    const [t1,t2] = [eq[0]?.item_id, eq[1]?.item_id];
    const m1 = getItemMeta(t1), m2 = getItemMeta(t2);

    const dpsCell = relative && ref
      ? (baseline / ref * 100).toFixed(1) + "%"
      : fmtDps(baseline);

    html += `
      <div class="tg-row equipped" id="row-equipped">
        <div class="tg-rank"></div>
        <div class="tg-icon">${t1?`<img src="${iconForItem(t1)}" alt="" title="${((m1?.name||"") + (isUniqueEquipped(parseInt(t1,10))?' (Unique-Equipped)':'')).replace(/"/g,'&quot;')}">`:``}</div>
        <div class="tg-icon">${t2?`<img src="${iconForItem(t2)}" alt="" title="${((m2?.name||"") + (isUniqueEquipped(parseInt(t2,10))?' (Unique-Equipped)':'')).replace(/"/g,'&quot;')}">`:``}</div>
        <div class="tg-name">Current Gear <span class="badge-eq">Equipped</span></div>
        <div class="tg-dps">${dpsCell}${bar(baseline)}</div>
        <div class="tg-delta">—</div>
      </div>
    `;
  }

  // Rows
  rows.forEach((row, idx)=>{
    const [A,B] = row.items;
    const aMeta = getItemMeta(A.item_id);
    const bMeta = getItemMeta(B.item_id);

    const tag = row.isTop
      ? `<span class="badge-top">Top Gear</span>`
      : (row.isEquipped ? `<span class="badge-eq">Equipped pair</span>` : "");

    const dpsCell = relative && ref
      ? (row.dps / ref * 100).toFixed(1) + "%"
      : fmtDps(row.dps);

    const delta = (ref ? (row.dps - ref) : null);
    const deltaCell = relative && ref
      ? (row.dps / ref * 100).toFixed(1) + "%"
      : fmtDelta(delta);
    const dCls = (delta!=null) ? (delta>=0 ? "delta-pos" : "delta-neg") : "";

    const titleA = ((aMeta?.name||"") + (isUniqueEquipped(A.item_id)?' (Unique-Equipped)':'')).replace(/"/g,'&quot;');
    const titleB = ((bMeta?.name||"") + (isUniqueEquipped(B.item_id)?' (Unique-Equipped)':'')).replace(/"/g,'&quot;');

    html += `
      <div class="tg-row ${row.isTop ? "top" : ""}">
        <div class="tg-rank">${idx+1}</div>
        <div class="tg-icon">${A.item_id?`<img src="${iconForItem(A.item_id)}" alt="" title="${titleA}">`:``}</div>
        <div class="tg-icon">${B.item_id?`<img src="${iconForItem(B.item_id)}" alt="" title="${titleB}">`:``}</div>
        <div class="tg-name" title="${pairLabel(A,B,row.name).replace(/"/g,'&quot;')}">
          ${pairLabel(A,B,row.name)} ${tag}
        </div>
        <div class="tg-dps">${dpsCell}${bar(row.dps)}</div>
        <div class="tg-delta ${dCls}">${deltaCell}</div>
      </div>
    `;
  });

  return `<div class="tg-table">${html}</div>`;
}

// Rebind toggle controls to re-render the current results
function attachTopGearControls(){
  const rerender = ()=>{
    if(window.__tgLast){
      set("tgResult", buildTopGearTable(window.__tgLast));
    }
  };
  ["tgRelDps","tgRefTop","tgRefEquipped"].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.onchange = rerender;
  });
  const btn = document.getElementById("tgGoEquipped");
  if(btn){
    btn.onclick = ()=>{
      const el = document.getElementById("row-equipped");
      if(el) el.scrollIntoView({ behavior:"smooth", block:"center" });
    };
  }
}

// =====================================================
// ===================  Run sims  ======================
// =====================================================
async function runPairs(items){
  const st = document.getElementById("tgRunStatus");
  const out = document.getElementById("tgResult");
  const base = (val("tgBase").trim() || val("tgSimc").trim());
  const extra = (val("tgArgs")||"").split(",").map(s=>s.trim()).filter(Boolean);

  // Heads-up if user selected two copies of a unique-equipped item
  try{
    const all = window.__tgTrinkets || [];
    const idByName = new Map(all.map(t => [t.name, parseInt(t.item_id,10) || null]));
    const counts = new Map();
    for (const sel of items){
      const id = idByName.get(sel.name);
      if (id && isUniqueEquipped(id)){
        counts.set(id, (counts.get(id)||0) + 1);
      }
    }
    const dupes = [...counts.entries()].filter(([,c]) => c > 1);
    if (dupes.length){
      st.textContent = "Note: duplicate Unique-Equipped items selected — those pairs will be skipped.";
    }
  }catch{ /* non-fatal */ }

  st.textContent = st.textContent || "Submitting...";
  out.innerHTML = "";

  const { job_id } = await postJSON("/api/top-gear-trinket-pairs", {
    base_profile: base,
    items,
    extra_args: extra
  });

  for(;;){
    const jr = await (await fetch(`/api/job/${job_id}`)).json();
    st.textContent = `Status: ${jr.status}`;

    if(jr.status === "finished"){
      window.__tgLast = jr.result?.json || {};

      let htmlLink = "";
      if(jr.result?.html_base64){
        const blob = new Blob([atob(jr.result.html_base64)], { type: "text/html" });
        const url = URL.createObjectURL(blob);
        htmlLink = `<div style="padding:8px 0">
          <a class="button" href="${url}" target="_blank" rel="noopener">Open HTML Report</a>
        </div>`;
      }

      // ensure icons are ready for whatever pairs came out on top
      await warmItemMetaFromTrinkets(window.__tgTrinkets || []);
      // Also warm by scanning ids that appear only in the profileset names
      const idsAll = new Set([
        ...(idsFromResultJson(window.__tgLast) || []),
        ...((window.__tgTrinkets || []).map(t => t.item_id).filter(Boolean))
      ]);
      await warmItemMetaFromIds([...idsAll]);

      set("tgResult", htmlLink + buildTopGearTable(window.__tgLast));
      attachTopGearControls();
      break;
    }

    if(jr.status === "failed"){
      out.textContent = jr.error || "Job failed";
      break;
    }

    await new Promise(r => setTimeout(r, 1500));
  }
}

document.getElementById("tgRunPairs").onclick = async ()=>{
  const all = (window.__tgTrinkets || []);
  const rows = Array.from(document.querySelectorAll(".tg-item"));
  const selected = rows.map((row, idx)=>{
    if(!row.querySelector(".tg-select").checked) return null;
    const t = all[idx];
      const id = parseInt(t.item_id, 10) || null;
      return {
        name: t.name,
        override: t.override,
        item_id: id,
        unique_equipped: isUniqueEquipped(id)
      };
  }).filter(Boolean);

  if(selected.length < 2){
    document.getElementById("tgRunStatus").textContent = "Pick at least 2 trinkets.";
    return;
  }
  await runPairs(selected);
};

document.getElementById("tgRunPairsAll").onclick = async ()=>{
  const all = (window.__tgTrinkets || []);
  if(all.length < 2){
    document.getElementById("tgRunStatus").textContent = "Need at least 2 trinkets.";
    return;
  }
  await runPairs(all.map(t => {
    const id = parseInt(t.item_id, 10) || null;
    return {
      name: t.name,
      override: t.override,
      item_id: id,
      unique_equipped: isUniqueEquipped(id)
     };
  }));
};

// Optional: ensure controls are bound if toggled before first sim
document.addEventListener("DOMContentLoaded", attachTopGearControls);
