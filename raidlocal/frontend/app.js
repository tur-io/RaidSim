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

// ===== rich item tooltip (uses Wowhead tooltip_html if present) =====
let __tipEl = null;
function ensureTip(){
  if (__tipEl) return __tipEl;
  const el = document.createElement("div");
  el.id = "tgTooltip";
  el.className = "tg-tooltip";
  el.style.display = "none";
  document.body.appendChild(el);
  __tipEl = el;
  return el;
}
function showItemTipAt(id, x, y){
  const el = ensureTip();
  const meta = getItemMeta(id) || {};
  const name = meta.name || `Item ${id||""}`;
  const body = meta.tooltip_html || "";
  el.innerHTML = `<div class="tg-tooltip-inner">${body || name}</div>`;
  el.style.display = "block";
  positionTip(x, y);
}
function positionTip(x, y){
  const el = ensureTip();
  const pad = 12;
  const vw = window.innerWidth, vh = window.innerHeight;
  const rect = { w: el.offsetWidth, h: el.offsetHeight };
  let left = x + pad, top = y + pad;
  if (left + rect.w > vw - 6) left = Math.max(6, x - rect.w - pad);
  if (top + rect.h > vh - 6) top = Math.max(6, y - rect.h - pad);
  el.style.left = left + "px";
  el.style.top = top + "px";
}
function hideItemTip(){ const el = ensureTip(); el.style.display = "none"; }

function attachItemTooltips(){
  const container = document.getElementById("tgResult");
  if (!container) return;
  // Remove any existing handlers by cloning
  const clone = container.cloneNode(true);
  container.parentNode.replaceChild(clone, container);
  const root = clone;

  root.addEventListener("mousemove", (e)=>{
    const img = e.target.closest && e.target.closest("img.tg-item-icon");
    if (!img) return;
    const id = parseInt(img.getAttribute("data-item-id"), 10) || null;
    if (!id) return;
    // Warm meta if tooltip missing
    const meta = getItemMeta(id);
    if (!meta || !meta.tooltip_html){ warmItemMetaFromIds([id]).then(()=>{ showItemTipAt(id, e.clientX, e.clientY); }); }
    showItemTipAt(id, e.clientX, e.clientY);
  });
  root.addEventListener("mouseleave", (e)=>{ hideItemTip(); });
}

function pairLabel(A, B) {
  // A and B are { item_id, label }
  const a = prettyItemNameById(A.item_id, A.label);
  const b = prettyItemNameById(B.item_id, B.label);
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
    // Also catch ids embedded in trinket segments
    (name.match(/trinket[12]_[^_]*_(\d{6})/g) || []).forEach(seg => {
      const m = seg.match(/(\d{6})/);
      if (m) ids.add(parseInt(m[1], 10));
    });
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
document.addEventListener("DOMContentLoaded", () => {
  loadState();
  populateSimOptions();
});

// ---------- dom helpers ----------
function val(id){ return document.getElementById(id).value; }
function set(id, html){ document.getElementById(id).innerHTML = html; }
function text(id, s){ document.getElementById(id).textContent = s; }

// ---------- sim options ----------
const FIGHT_STYLE_OPTIONS = [
  "Patchwerk",
  "CastingPatchwerk",
  "LightMovement",
  "HeavyMovement",
  "DungeonSlice",
  "DungeonRoute",
  "HecticAddCleave",
  "HelterSkelter",
  "CleaveAdd",
  "Beastlord",
  "Ultraxion"
];

const RAID_BUFF_OPTIONS = [
  { id: "bloodlust", opt: "override.bloodlust" },
  { id: "arcane_intellect", opt: "override.arcane_intellect" },
  { id: "power_word_fortitude", opt: "override.power_word_fortitude" },
  { id: "mark_of_the_wild", opt: "override.mark_of_the_wild" },
  { id: "battle_shout", opt: "override.battle_shout" },
  { id: "mystic_touch", opt: "override.mystic_touch" },
  { id: "chaos_brand", opt: "override.chaos_brand" },
  { id: "windfury_totem", opt: "override.windfury" },
  { id: "hunters_mark", opt: "override.hunters_mark" },
  { id: "power_infusion", opt: "external_buffs.power_infusion" },
  { id: "bleeding", opt: "override.bleeding" },
];

function populateSimOptions(){
  const fs = document.getElementById("fightStyle");
  if(fs){
    FIGHT_STYLE_OPTIONS.forEach(v => {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = v.replace(/([A-Z])/g,' $1').trim();
      fs.appendChild(o);
    });
    fs.value = "Patchwerk";
  }
  const bc = document.getElementById("bossCount");
  if(bc){
    for(let i=1;i<=20;i++){
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = i === 1 ? "1 Boss" : `${i} Bosses`;
      bc.appendChild(o);
    }
    bc.value = "1";
  }
  const fl = document.getElementById("fightLength");
  if(fl){
    for(let m=1;m<=10;m++){
      const o = document.createElement("option");
      o.value = String(m*60);
      o.textContent = `${m} min`;
      fl.appendChild(o);
    }
    fl.value = "300";
  }
}

function collectSimcOptions(){
  const opts = [];
  const fs = document.getElementById("fightStyle");
  if(fs && fs.value) opts.push(`fight_style=${fs.value}`);
  const bc = document.getElementById("bossCount");
  if(bc && bc.value) opts.push(`desired_targets=${bc.value}`);
  const fl = document.getElementById("fightLength");
  if(fl && fl.value) opts.push(`max_time=${fl.value}`);
  RAID_BUFF_OPTIONS.forEach(({ id, opt }) => {
    const el = document.getElementById(id);
    if (el) opts.push(`${opt}=${el.checked ? 1 : 0}`);
  });
  return opts;
}

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
// 0) If name is "T_<left>__<right>", try to match item names from parsed trinkets
// 1) Otherwise: first-two-ids regex
// 2) Otherwise: known-IDs scan
// 3) Otherwise: sanitized-name contains
function partsFromProfilesetName(name){
  const all = window.__tgTrinkets || [];
  const raw = (name || "");

  // 0) Decode id-based naming: T_<idA>_VS_<idB>
  let m = /^T_(\d{6})_VS_(\d{6})$/.exec(raw);
  if (m){
    const idA = parseInt(m[1], 10), idB = parseInt(m[2], 10);
    const metaA = getItemMeta(idA), metaB = getItemMeta(idB);
    return [
      { item_id: idA, label: metaA?.name || `Item ${idA}` },
      { item_id: idB, label: metaB?.name || `Item ${idB}` }
    ];
  }

  // 0a) Decode our previous naming: T_<left>_VS_<right> or legacy T_<left>__<right>
  m = /^T_(.+?)_VS_(.+)$/.exec(raw) || /^T_(.+?)__(.+)$/.exec(raw);
  if (m) {
    const pick = (s) => {
      const idMatch = (s.match(/\d{6}(?!.*\d)/) || [])[0];
      const id = idMatch ? parseInt(idMatch, 10) : null;
      const meta = id ? getItemMeta(id) : null;
      return { item_id: id, label: meta?.name || cleanFallbackLabel(s) };
    };
    const A = pick(m[1]);
    const B = pick(m[2]);
    return [A, B];
  }

  // 0b) Generic SimC-like names containing two segments starting with trinket1_/trinket2_
  // Example: "T_trinket1_Soulbreaker_s_Sigil_238390_trinket2_Equipped_242394"
  {
    const segs = (raw.match(/trinket[12]_[A-Za-z0-9_]+/g) || []);
    if (segs.length >= 2) {
      const pick = (s) => {
        const idMatch = (s.match(/\d{6}(?!.*\d)/) || [])[0];
        const id = idMatch ? parseInt(idMatch, 10) : null;
        const meta = id ? getItemMeta(id) : null;
        return { item_id: id, label: meta?.name || cleanFallbackLabel(s) };
      };
      return [pick(segs[0]), pick(segs[1])];
    }
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

  // Normalize
  const rowsRaw = profiles.map(p=>{
    const name = p.name || p.profileset || p.profile || "set";
    const dps  = (p.dps?.mean ?? p.collected_data?.dps?.mean ?? p.mean ?? null);
    return {
      name,
      dps: (typeof dps === "number" ? dps : null),
      items: partsFromProfilesetName(name),
      isEquipped: isEquippedPairName(name)
    };
  }).filter(x => x.dps !== null);
  
  // De-duplicate by item-id pair (unordered) and drop same-id pairs defensively
  const bestByPair = new Map();
  for(const r of rowsRaw){
    const [A,B] = r.items || [];
    const idA = parseInt(A?.item_id, 10) || null;
    const idB = parseInt(B?.item_id, 10) || null;
    if (idA && idB && idA === idB) continue; // skip identical trinket pairs
    const key = (idA && idB)
      ? (idA < idB ? `${idA}-${idB}` : `${idB}-${idA}`)
      : sanitizeName(r.name);
    const cur = bestByPair.get(key);
    if (!cur || (r.dps > cur.dps)) bestByPair.set(key, r);
  }
  const rows = [...bestByPair.values()];

  // Inject equipped as a ranked row instead of a fixed header, if we have baseline & ids
  if (typeof baseline === "number"){
    const eq = (window.__tgTrinkets||[]).filter(t=>t.source==="equipped");
    const idA = parseInt(eq[0]?.item_id,10) || null;
    const idB = parseInt(eq[1]?.item_id,10) || null;
    if (idA && idB){
      const equipKey = (idA < idB ? `${idA}-${idB}` : `${idB}-${idA}`);
      const findKey = (r)=>{
        const a = parseInt(r?.items?.[0]?.item_id,10) || null;
        const b = parseInt(r?.items?.[1]?.item_id,10) || null;
        return (a && b) ? (a < b ? `${a}-${b}` : `${b}-${a}`) : null;
      };
      const idx = rows.findIndex(r => findKey(r) === equipKey);
      if (idx >= 0){
        rows[idx].isEquipped = true;
        rows[idx]._equip = true;
      } else {
        const equipRow = {
          name: `T_${idA}_VS_${idB}`,
          dps: baseline,
          items: [{ item_id:idA, label:"" }, { item_id:idB, label:"" }],
          isEquipped: true,
          _equip: true
        };
        rows.push(equipRow);
      }
    }
  }
  
  // Sort (desc)
  rows.sort((a,b)=>b.dps - a.dps);
  if (rows.length) rows[0].isTop = true;

  // ---- References / toggles
  const refIsTop = document.getElementById("tgRefTop")?.checked || false;

  // Reference number used for delta cells (equipped row or top)
  const equippedRow = rows.find(r => r.isEquipped);
  const ref = refIsTop ? (rows[0]?.dps ?? 0) : (equippedRow?.dps ?? baseline ?? 0);

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
      <div class="tg-dps">DPS</div>
      <div class="tg-delta">Δ vs ${refIsTop ? "Top" : "Equipped"}</div>
    </div>
  `;

  // Rows
  rows.forEach((row, idx)=>{
    const [A,B] = row.items;
    const aMeta = getItemMeta(A.item_id);
    const bMeta = getItemMeta(B.item_id);

    const tag = row.isTop
      ? `<span class="badge-top">Top Gear</span>`
      : (row.isEquipped ? `<span class="badge-eq">Equipped</span>` : "");

    const dpsCell = fmtDps(row.dps);

    const delta = (ref ? (row.dps - ref) : null);
    let deltaCell = "—";
    if (delta!=null){
      const pct = ref ? ((row.dps / ref - 1) * 100) : 0;
      const sign = pct>=0 ? "+" : "";
      deltaCell = `${fmtDelta(delta)} (${sign}${pct.toFixed(1)}%)`;
    }
    const dCls = (delta!=null) ? (delta>0 ? "delta-pos" : (delta<0 ? "delta-neg" : "")) : "";

    const titleA = ((aMeta?.name||"") + (isUniqueEquipped(A.item_id)?' (Unique-Equipped)':'')).replace(/"/g,'&quot;');
    const titleB = ((bMeta?.name||"") + (isUniqueEquipped(B.item_id)?' (Unique-Equipped)':'')).replace(/"/g,'&quot;');

    const label = row.isEquipped ? `Current Gear — ${pairLabel(A,B)}` : pairLabel(A,B);
    html += `
      <div class="tg-row ${row.isTop ? "top" : ""} ${row.isEquipped ? "equipped" : ""}" ${row.isEquipped ? "id=\"row-equipped\"" : ""}>
        <div class="tg-rank">${idx+1}</div>
        <div class="tg-icon">${A.item_id?`<img class="tg-item-icon" data-item-id="${A.item_id}" src="${iconForItem(A.item_id)}" alt="" title="${titleA}">`:``}</div>
        <div class="tg-icon">${B.item_id?`<img class="tg-item-icon" data-item-id="${B.item_id}" src="${iconForItem(B.item_id)}" alt="" title="${titleB}">`:``}</div>
        <div class="tg-name" title="${label.replace(/"/g,'&quot;')}">
          ${label} ${tag}
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
async function runQuickSim(){
  const st = document.getElementById("quickSimStatus");
  const out = document.getElementById("quickSimResult");
  const simc = val("simcInput").trim();
  const extra = (val("extraArgs")||"").split(",").map(s=>s.trim()).filter(Boolean);
  const extraArgs = [...extra, ...collectSimcOptions()];
  if(!simc){ st.textContent = "Paste SimC input first."; return; }
  st.textContent = st.textContent || "Submitting...";
  out.textContent = "";
  const { job_id } = await postJSON("/api/quick-sim", { simc_input: simc, extra_args: extraArgs });
  for(;;){
    const jr = await (await fetch(`/api/job/${job_id}`)).json();
    st.textContent = `Status: ${jr.status}`;
    if(jr.status === "finished"){
      const dps = jr.result?.json?.sim?.players?.[0]?.collected_data?.dps?.mean;
      out.textContent = dps ? `DPS: ${fmtInt(dps)}` : JSON.stringify(jr.result?.json || {});
      break;
    }
    if(jr.status === "failed"){
      out.textContent = jr.error || "Job failed";
      break;
    }
    await new Promise(r=>setTimeout(r,1500));
  }
}

async function runPairs(items){
  const st = document.getElementById("tgRunStatus");
  const out = document.getElementById("tgResult");
  const base = (val("tgBase").trim() || val("tgSimc").trim());
  const extra = (val("tgArgs")||"").split(",").map(s=>s.trim()).filter(Boolean);
  const extraArgs = [...extra, ...collectSimcOptions()];

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
    extra_args: extraArgs
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
      attachItemTooltips();
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
document.getElementById("runQuickSim").onclick = runQuickSim;

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
