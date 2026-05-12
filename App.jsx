import { useState, useRef, useCallback, useEffect } from "react";

// ════════════════════════════════════════════════════════════════════════════════
// SUPABASE SETUP — corré este SQL en tu proyecto Supabase (SQL Editor):
//
// create table profiles (
//   id uuid references auth.users on delete cascade primary key,
//   company_name text default '',
//   ruc text default '',
//   tel text default '',
//   email_empresa text default '',
//   catalog_json jsonb default '[]',
//   default_margin integer default 30
// );
// alter table profiles enable row level security;
// create policy "own_profile" on profiles for all using (auth.uid() = id);
//
// create table budgets (
//   id uuid default gen_random_uuid() primary key,
//   user_id uuid references auth.users on delete cascade not null,
//   project_name text default 'Sin título',
//   created_at timestamptz default now(),
//   data_json jsonb not null
// );
// alter table budgets enable row level security;
// create policy "own_budgets" on budgets for all using (auth.uid() = user_id);
// ════════════════════════════════════════════════════════════════════════════════


function localStorage_get(key) {
  try { const v = localStorage.getItem(key); return v ? { value: v } : null; } catch { return null; }
}
function localStorage_set(key, value) {
  try { localStorage.setItem(key, value); return { value }; } catch { return null; }
}

// ─── Supabase helpers (sin librería externa) ───────────────────────────────────
const TIMEOUT_MS = 12000;

async function fetchWithTimeout(url, opts = {}) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    clearTimeout(id);
    return r;
  } catch (e) {
    clearTimeout(id);
    if (e.name === "AbortError") throw new Error("Tiempo de espera agotado. Verificá tu conexión o las credenciales de Supabase.");
    throw e;
  }
}

const sb = {
  h(key, token, extra = {}) {
    return { apikey: key, Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "return=representation", ...extra };
  },
  async signUp(url, key, email, password) {
    const r = await fetchWithTimeout(`${url}/auth/v1/signup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    return r.json();
  },
  async signIn(url, key, email, password) {
    const r = await fetchWithTimeout(`${url}/auth/v1/token?grant_type=password`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    return r.json();
  },
  async signOut(url, key, token) {
    await fetchWithTimeout(`${url}/auth/v1/logout`, { method: "POST", headers: { apikey: key, Authorization: `Bearer ${token}` } }).catch(() => {});
  },
  async get(url, key, token, table, qs = "") {
    const r = await fetchWithTimeout(`${url}/rest/v1/${table}?${qs}`, { headers: this.h(key, token) });
    return r.json();
  },
  async upsert(url, key, token, table, data) {
    const r = await fetchWithTimeout(`${url}/rest/v1/${table}`, { method: "POST", headers: this.h(key, token, { Prefer: "resolution=merge-duplicates,return=representation" }), body: JSON.stringify(data) });
    return r.json();
  },
  async insert(url, key, token, table, data) {
    const r = await fetchWithTimeout(`${url}/rest/v1/${table}`, { method: "POST", headers: this.h(key, token), body: JSON.stringify(data) });
    return r.json();
  },
  async del(url, key, token, table, qs) {
    await fetchWithTimeout(`${url}/rest/v1/${table}?${qs}`, { method: "DELETE", headers: this.h(key, token) }).catch(() => {});
  },
};

// ─── Constantes ────────────────────────────────────────────────────────────────
const SHEET_AREA = 2.44 * 1.22;
const WASTE = 1.15;

const DEFAULT_CATALOG = [
  { id: "mdf15",  label: "MDF 15mm",           unit: "chapa", price: 0, note: "Internos — el más utilizado" },
  { id: "mdf18",  label: "MDF 18mm",            unit: "chapa", price: 0, note: "Envolventes y exteriores" },
  { id: "mdf9",   label: "MDF 9mm",             unit: "chapa", price: 0, note: "Fondos" },
  { id: "mdfh15", label: "MDF Hidrofugo 15mm",  unit: "chapa", price: 0, note: "Baños y húmedos" },
  { id: "mdfh18", label: "MDF Hidrofugo 18mm",  unit: "chapa", price: 0, note: "Baños y húmedos" },
  { id: "tap",    label: "Tapacantos ABS 2mm",  unit: "m",     price: 0, note: "Metro lineal" },
  { id: "gran",   label: "Granito",             unit: "m²",    price: 0, note: "Por m² colocado" },
  { id: "mar",    label: "Mármol",              unit: "m²",    price: 0, note: "Por m² colocado" },
  { id: "ultra",  label: "Ultracompact",        unit: "m²",    price: 0, note: "Dekton, Silestone, Neolith" },
];

const C = {
  bg: "#F8F6F2", surface: "#FFFFFF", border: "#E2DDD6",
  text: "#1C1B19", muted: "#7A776F", accent: "#1D4E7A",
  warm: "#F2EDE5", tag: "#E8E3DA", green: "#2A7A4A", red: "#8A2A2A",
};
const CAT_COLOR = { Tableros: "#1D4E7A", Mesadas: "#6B3A8A", Accesorios: "#2A7A4A", Herrajes: "#8A5A2A" };

// ─── Motor de cálculo ──────────────────────────────────────────────────────────
function normMat(r) {
  if (/hidro.*15|15.*hidro/i.test(r)) return "MDF Hidrofugo 15mm";
  if (/hidro.*18|18.*hidro/i.test(r)) return "MDF Hidrofugo 18mm";
  if (/15\s*mm/i.test(r))             return "MDF 15mm";
  if (/18\s*mm/i.test(r))             return "MDF 18mm";
  if (/9\s*mm/i.test(r))              return "MDF 9mm";
  return r.trim();
}
function normTop(r) {
  if (/granito/i.test(r))                  return "Granito";
  if (/m[aá]rmol/i.test(r))               return "Mármol";
  if (/ultra|dekton|sile|neolit/i.test(r)) return "Ultracompact";
  return r.trim();
}
function calcBOM(muebles, catalog) {
  const panels = {}, tops = {}, hw = {};
  let edging = 0, has30 = false, id = 0;
  for (const m of muebles) {
    const q = m.cantidad || 1;
    for (const c of m.componentes || []) {
      const raw = c.material || "MDF 15mm";
      const area = (c.ancho_mm / 1000) * (c.alto_mm / 1000) * (c.cantidad || 1) * q;
      if (/30\s*mm/i.test(raw)) { panels["MDF 15mm"] = (panels["MDF 15mm"] || 0) + area * 2; has30 = true; }
      else { const mat = normMat(raw); panels[mat] = (panels[mat] || 0) + area; }
      edging += 2 * ((c.ancho_mm / 1000) + (c.alto_mm / 1000)) * (c.cantidad || 1) * q;
    }
    if (m.mesada) {
      const t = m.mesada, area = (t.ancho_mm / 1000) * (t.profundidad_mm / 1000) * (t.cantidad || 1) * q;
      const mat = normTop(t.material || "Mesada");
      tops[mat] = (tops[mat] || 0) + area;
    }
    for (const h of m.herrajes || []) hw[h.nombre] = (hw[h.nombre] || 0) + (h.cantidad || 1) * q;
  }
  const ORDER = ["MDF 15mm", "MDF 18mm", "MDF 9mm", "MDF Hidrofugo 15mm", "MDF Hidrofugo 18mm"];
  const sorted = [...ORDER.filter(k => panels[k]), ...Object.keys(panels).filter(k => !ORDER.includes(k))];
  const items = [];
  for (const mat of sorted) {
    const sheets = Math.ceil((panels[mat] * WASTE) / SHEET_AREA);
    const catMatch = catalog.find(c => c.label.toLowerCase().includes(mat.toLowerCase()) || mat.toLowerCase().includes(c.label.toLowerCase()));
    items.push({ id: id++, cat: "Tableros", desc: mat, qty: sheets, unit: "chapa", price: catMatch?.price || 0, detail: `${parseFloat((panels[mat] * WASTE).toFixed(2))} m²` });
  }
  for (const [mat, area] of Object.entries(tops)) {
    const catMatch = catalog.find(c => c.label.toLowerCase().includes(mat.toLowerCase()) || mat.toLowerCase().includes(c.label.toLowerCase()));
    items.push({ id: id++, cat: "Mesadas", desc: mat, qty: parseFloat((area * WASTE).toFixed(2)), unit: "m²", price: catMatch?.price || 0, detail: `${parseFloat(area.toFixed(2))} m² netos` });
  }
  if (edging > 0) {
    const catMatch = catalog.find(c => /tapacanto/i.test(c.label));
    items.push({ id: id++, cat: "Accesorios", desc: "Tapacantos ABS 2mm", qty: parseFloat((edging * WASTE).toFixed(1)), unit: "m", price: catMatch?.price || 0, detail: `${parseFloat(edging.toFixed(1))} m netos` });
  }
  for (const [h, count] of Object.entries(hw))
    items.push({ id: id++, cat: "Herrajes", desc: h, qty: count, unit: "u", price: 0, detail: "" });
  return { items, has30 };
}

// ─── Demo data ─────────────────────────────────────────────────────────────────
const DEMO = { proyecto: "Cocina + Baño — Ejemplo", muebles: [{ nombre: "Alacena Alta", cantidad: 2, componentes: [{ descripcion: "Lateral exterior", material: "MDF 18mm", ancho_mm: 350, alto_mm: 720, cantidad: 2 }, { descripcion: "Estante", material: "MDF 15mm", ancho_mm: 314, alto_mm: 350, cantidad: 3 }, { descripcion: "Fondo", material: "MDF 9mm", ancho_mm: 600, alto_mm: 720, cantidad: 1 }, { descripcion: "Puerta", material: "MDF 18mm", ancho_mm: 297, alto_mm: 716, cantidad: 2 }, { descripcion: "Regrueso zócalo", material: "MDF 30mm", ancho_mm: 600, alto_mm: 80, cantidad: 1 }], herrajes: [{ nombre: "Bisagra cazoleta 35mm", cantidad: 4 }, { nombre: "Jalador barra 128mm", cantidad: 2 }] }, { nombre: "Bajo Mesada Cocina", cantidad: 1, componentes: [{ descripcion: "Lateral exterior", material: "MDF 18mm", ancho_mm: 550, alto_mm: 720, cantidad: 2 }, { descripcion: "Piso", material: "MDF 15mm", ancho_mm: 764, alto_mm: 550, cantidad: 1 }, { descripcion: "Fondo", material: "MDF 9mm", ancho_mm: 800, alto_mm: 720, cantidad: 1 }, { descripcion: "Regrueso lateral", material: "MDF 30mm", ancho_mm: 550, alto_mm: 100, cantidad: 2 }], mesada: { material: "Granito Negro Absoluto", ancho_mm: 900, profundidad_mm: 600, cantidad: 1 }, herrajes: [{ nombre: "Corredera telescópica 500mm", cantidad: 4 }] }, { nombre: "Vanitory Baño", cantidad: 1, componentes: [{ descripcion: "Lateral", material: "MDF Hidrofugo 15mm", ancho_mm: 450, alto_mm: 500, cantidad: 2 }, { descripcion: "Puerta", material: "MDF Hidrofugo 18mm", ancho_mm: 578, alto_mm: 490, cantidad: 2 }, { descripcion: "Regrueso base", material: "MDF 30mm", ancho_mm: 600, alto_mm: 60, cantidad: 1 }], mesada: { material: "Mármol Carrara", ancho_mm: 700, profundidad_mm: 500, cantidad: 1 }, herrajes: [{ nombre: "Bisagra cazoleta 35mm", cantidad: 4 }] }] };

// ─── Estilos ───────────────────────────────────────────────────────────────────
const btn    = { padding: "9px 18px", background: "transparent", border: `0.5px solid ${C.border}`, borderRadius: 8, cursor: "pointer", fontSize: 12, color: C.text, fontFamily: "inherit" };
const btnPri = { padding: "11px 24px", background: C.text, color: C.surface, border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontFamily: "inherit", fontWeight: 500 };
const btnTab = on => ({ padding: "7px 16px", background: on ? C.surface : "transparent", border: on ? `0.5px solid ${C.border}` : "none", borderRadius: 7, cursor: "pointer", fontSize: 12, color: on ? C.text : C.muted, fontFamily: "inherit", fontWeight: on ? 500 : 400 });
const th     = { padding: "10px 14px", fontSize: 10, fontWeight: 500, color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "system-ui" };
const inp    = { width: "100%", padding: "10px 14px", border: `0.5px solid ${C.border}`, borderRadius: 8, fontSize: 14, fontFamily: "inherit", boxSizing: "border-box", outline: "none" };
const fmt    = n => "Gs. " + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");

// ═══════════════════════════════════════════════════════════════════════════════
// APP
// ═══════════════════════════════════════════════════════════════════════════════
export default function App() {
  // ── Config & Auth ────────────────────────────────────────────────────────────
  const [cfg,     setCfg    ] = useState(null);     // { url, anonKey }
  const [session, setSession] = useState(null);     // { access_token, user }
  const [screen,  setScreen ] = useState("boot");   // boot|config|auth|app
  const [authTab, setAuthTab] = useState("login");
  const [authForm,setAuthForm] = useState({ email: "", password: "", confirm: "" });
  const [authErr, setAuthErr] = useState("");
  const [authLoad,setAuthLoad] = useState(false);
  const [cfgForm, setCfgForm] = useState({ url: "", anonKey: "" });
  const [cfgErr,  setCfgErr  ] = useState("");
  const [showSQL, setShowSQL ] = useState(false);

  // ── App state ────────────────────────────────────────────────────────────────
  const [tab,     setTab    ] = useState("upload");
  const [view,    setView   ] = useState("upload");
  const [project, setProject] = useState(null);
  const [items,   setItems  ] = useState([]);
  const [has30,   setHas30  ] = useState(false);
  const [margin,  setMargin ] = useState(30);
  const [status,  setStatus ] = useState("");
  const [dragging,setDragging] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [catalog, setCatalog] = useState(DEFAULT_CATALOG);
  const [company, setCompany] = useState({ name: "", ruc: "", tel: "", email: "" });
  const [history, setHistory] = useState([]);
  const [saving,  setSaving ] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const fileRef = useRef();

  const subtotal = items.reduce((s, i) => s + i.qty * i.price, 0);
  const gain     = subtotal * (margin / 100);
  const total    = subtotal + gain;

  // ── Boot: check saved credentials ───────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const r1 = localStorage_get("sb_cfg");
        const r2 = localStorage_get("sb_session");
        if (r1) {
          const c = JSON.parse(r1.value);
          setCfg(c);
          if (r2) {
            const s = JSON.parse(r2.value);
            setSession(s);
            await loadUserData(c, s);
            setScreen("app");
          } else setScreen("auth");
        } else setScreen("config");
      } catch { setScreen("config"); }
    })();
  }, []);

  // ── Load user data from Supabase ─────────────────────────────────────────────
  async function loadUserData(c, s) {
    try {
      const profiles = await sb.get(c.url, c.anonKey, s.access_token, "profiles", `id=eq.${s.user.id}`);
      if (profiles && profiles[0]) {
        const p = profiles[0];
        setCompany({ name: p.company_name || "", ruc: p.ruc || "", tel: p.tel || "", email: p.email_empresa || "" });
        if (p.catalog_json && p.catalog_json.length) setCatalog(p.catalog_json);
        if (p.default_margin) setMargin(p.default_margin);
      }
      const bgs = await sb.get(c.url, c.anonKey, s.access_token, "budgets", `user_id=eq.${s.user.id}&order=created_at.desc&limit=20`);
      if (Array.isArray(bgs)) setHistory(bgs);
    } catch (e) { console.error("loadUserData", e); }
  }

  // ── Save profile to Supabase ─────────────────────────────────────────────────
  async function saveProfile(co, cat, mar) {
    if (!cfg || !session) return;
    setSaving(true);
    try {
      await sb.upsert(cfg.url, cfg.anonKey, session.access_token, "profiles", {
        id: session.user.id,
        company_name: co.name, ruc: co.ruc, tel: co.tel, email_empresa: co.email,
        catalog_json: cat, default_margin: mar,
      });
      setSavedOk(true); setTimeout(() => setSavedOk(false), 2000);
    } catch (e) { console.error("saveProfile", e); }
    setSaving(false);
  }

  const updateCompany = async co => { setCompany(co); await saveProfile(co, catalog, margin); };
  const updateCatalog = async cat => { setCatalog(cat); await saveProfile(company, cat, margin); };
  const updateMargin  = async m   => { setMargin(m);   await saveProfile(company, catalog, m); };

  // ── Save budget to Supabase ──────────────────────────────────────────────────
  async function saveBudget() {
    if (!cfg || !session || !project) return;
    setSaving(true);
    try {
      const bg = await sb.insert(cfg.url, cfg.anonKey, session.access_token, "budgets", {
        user_id: session.user.id,
        project_name: project.proyecto || "Sin título",
        data_json: { project, items, margin, has30 },
      });
      if (Array.isArray(bg) && bg[0]) setHistory(h => [bg[0], ...h]);
      setSavedOk(true); setTimeout(() => setSavedOk(false), 2000);
    } catch (e) { console.error("saveBudget", e); }
    setSaving(false);
  }

  async function deleteBudget(id) {
    if (!cfg || !session) return;
    await sb.del(cfg.url, cfg.anonKey, session.access_token, "budgets", `id=eq.${id}`);
    setHistory(h => h.filter(b => b.id !== id));
  }

  function loadBudget(bg) {
    const d = bg.data_json;
    setProject(d.project);
    setItems(d.items);
    setHas30(d.has30);
    setMargin(d.margin);
    setTab("results");
    setView("results");
  }

  // ── Auth actions ─────────────────────────────────────────────────────────────
  async function handleSignIn() {
    setAuthErr(""); setAuthLoad(true);
    const res = await sb.signIn(cfg.url, cfg.anonKey, authForm.email, authForm.password);
    if (res.error) { setAuthErr(res.error.message || "Error al ingresar"); setAuthLoad(false); return; }
    const s = { access_token: res.access_token, user: res.user };
    setSession(s);
    localStorage_set("sb_session", JSON.stringify(s));
    await loadUserData(cfg, s);
    setScreen("app"); setAuthLoad(false);
  }

  async function handleSignUp() {
    setAuthErr(""); 
    if (authForm.password !== authForm.confirm) { setAuthErr("Las contraseñas no coinciden"); return; }
    if (authForm.password.length < 6) { setAuthErr("La contraseña debe tener al menos 6 caracteres"); return; }
    setAuthLoad(true);
    const res = await sb.signUp(cfg.url, cfg.anonKey, authForm.email, authForm.password);
    if (res.error) { setAuthErr(res.error.message || "Error al registrar"); setAuthLoad(false); return; }
    setAuthErr(""); setAuthLoad(false);
    setAuthTab("login");
    setAuthErr("✓ Cuenta creada. Revisá tu email para confirmar y luego ingresá.");
  }

  async function handleSignOut() {
    if (cfg && session) await sb.signOut(cfg.url, cfg.anonKey, session.access_token).catch(() => {});
    localStorage.removeItem("sb_session");
    setSession(null); setScreen("auth"); setView("upload"); setTab("upload"); setProject(null);
  }

  async function handleSaveConfig() {
    setCfgErr("");
    const url = cfgForm.url.replace(/\/$/, "");
    if (!url.includes("supabase.co")) { setCfgErr("La URL debe ser de Supabase (termina en .supabase.co)"); return; }
    if (!cfgForm.anonKey || !cfgForm.anonKey.startsWith("eyJ")) { setCfgErr("La clave anon debe empezar con 'eyJ' — copiala desde Project Settings → API"); return; }
    const c = { url, anonKey: cfgForm.anonKey };
    setCfg(c);
    localStorage_set("sb_cfg", JSON.stringify(c));
    setScreen("auth");
  }

  // ── Analysis ─────────────────────────────────────────────────────────────────
  function applyAnalysis(parsed) {
    setProject(parsed);
    const { items: bom, has30: h } = calcBOM(parsed.muebles || [], catalog);
    setItems(bom); setHas30(h);
    setTab("results"); setView("results");
  }

  async function analyzeFile(file) {
    setView("analyzing"); setStatus("Leyendo el documento…");
    try {
      const base64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.onerror = rej; r.readAsDataURL(file); });
      setStatus("Identificando muebles con IA…");
      const isPDF = file.type === "application/pdf";
      const resp = await fetch("/api/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514", max_tokens: 4000,
          system: `Sos un experto en lectura de planos de detallamiento para carpintería en Paraguay.
Analizá el plano y extraé cada mueble con todos sus componentes, materiales y medidas.
Respondé ÚNICAMENTE con JSON válido. Sin backticks, sin texto adicional.

ESPESORES MDF: 15mm (internos, el más usado), 18mm (envolventes/puertas), 9mm (fondos), 30mm (regrueso = 2×15mm), Hidrofugo 15mm/18mm (baños).
MESADAS: Granito, Mármol, Ultracompact (Dekton/Silestone/Neolith).

JSON:
{"proyecto":"descripción","muebles":[{"nombre":"nombre","cantidad":1,"componentes":[{"descripcion":"Lateral","material":"MDF 15mm","ancho_mm":350,"alto_mm":720,"cantidad":2}],"mesada":{"material":"Granito","ancho_mm":900,"profundidad_mm":600,"cantidad":1},"herrajes":[{"nombre":"Bisagra 35mm","cantidad":4}]}]}
Omití mesada/herrajes si no hay.`,
          messages: [{ role: "user", content: [isPDF ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } } : { type: "image", source: { type: "base64", media_type: file.type, data: base64 } }, { type: "text", text: "Analizá este plano y extraé todos los muebles con componentes, materiales y medidas." }] }]
        })
      });
      setStatus("Calculando materiales…");
      const data = await resp.json();
      const text = data.content?.find(b => b.type === "text")?.text || "{}";
      const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
      applyAnalysis(parsed);
    } catch (e) { console.error(e); setStatus("Error. Intentá con otro archivo."); setTimeout(() => setView("upload"), 3000); }
  }

  const onDrop = useCallback((e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer?.files?.[0] || e.target?.files?.[0]; if (f) analyzeFile(f); }, [catalog]);
  const resetApp = () => { setView("upload"); setTab("upload"); setProject(null); setItems([]); setHas30(false); };

  const updatePrice = (id, v) => setItems(p => p.map(i => i.id === id ? { ...i, price: parseFloat(v) || 0 } : i));
  const updateDesc  = (id, v) => setItems(p => p.map(i => i.id === id ? { ...i, desc: v } : i));
  const updateQty   = (id, v) => setItems(p => p.map(i => i.id === id ? { ...i, qty: parseFloat(v) || 0 } : i));

  // ════════════════════════════════════════════════════════════════════════════
  // SCREENS
  // ════════════════════════════════════════════════════════════════════════════

  // ── BOOT ─────────────────────────────────────────────────────────────────────
  if (screen === "boot") return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: C.bg }}>
      <div style={{ width: 36, height: 36, border: `3px solid ${C.border}`, borderTopColor: C.accent, borderRadius: "50%", animation: "spin 1s linear infinite" }}/>
      <style>{"@keyframes spin{to{transform:rotate(360deg)}}"}</style>
    </div>
  );

  // ── CONFIG ────────────────────────────────────────────────────────────────────
  if (screen === "config") return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem", fontFamily: "'Georgia', serif" }}>
      <div style={{ maxWidth: 540, width: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: "2rem" }}>
          <div style={{ width: 32, height: 32, background: C.accent, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg viewBox="0 0 18 18" width="16" height="16" fill="none"><rect x="2" y="3" width="14" height="12" rx="1.5" stroke="white" strokeWidth="1.3"/><line x1="2" y1="7" x2="16" y2="7" stroke="white" strokeWidth="1.3"/><line x1="7" y1="7" x2="7" y2="15" stroke="white" strokeWidth="1.3"/></svg>
          </div>
          <span style={{ fontSize: 17, fontWeight: 500 }}>Presupuestador IA</span>
        </div>

        <h2 style={{ fontSize: 24, fontWeight: 400, margin: "0 0 8px" }}>Conectar con Supabase</h2>
        <p style={{ color: C.muted, fontSize: 13, margin: "0 0 1.5rem", lineHeight: 1.7 }}>
          Para guardar tus datos necesitás un proyecto Supabase gratuito. Solo toma 2 minutos.
        </p>

        {/* Steps */}
        <div style={{ background: C.warm, border: `0.5px solid ${C.border}`, borderRadius: 10, padding: "1.25rem", marginBottom: "1.5rem" }}>
          {[
            ["1", "Creá tu proyecto en", "supabase.com → New project"],
            ["2", "Corré el SQL de las tablas", "Project → SQL Editor → New query"],
            ["3", "Copiá las credenciales", "Project Settings → API"],
          ].map(([n, a, b]) => (
            <div key={n} style={{ display: "flex", gap: 12, marginBottom: n === "3" ? 0 : 10, alignItems: "flex-start" }}>
              <div style={{ width: 22, height: 22, background: C.accent, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "white", fontFamily: "system-ui", flexShrink: 0, marginTop: 1 }}>{n}</div>
              <div style={{ fontSize: 13 }}>
                <span>{a} </span>
                <span style={{ color: C.muted, fontFamily: "system-ui", fontSize: 11 }}>{b}</span>
              </div>
            </div>
          ))}
          <button onClick={() => setShowSQL(s => !s)} style={{ marginTop: 12, background: "transparent", border: "none", color: C.accent, fontSize: 12, cursor: "pointer", textDecoration: "underline", padding: 0, fontFamily: "inherit" }}>
            {showSQL ? "Ocultar" : "Ver"} el SQL para crear las tablas
          </button>
          {showSQL && (
            <pre style={{ marginTop: 10, background: "#1C1B19", color: "#A8D0A0", fontSize: 10, padding: "1rem", borderRadius: 8, overflowX: "auto", lineHeight: 1.6, fontFamily: "monospace" }}>{`create table profiles (
  id uuid references auth.users on delete cascade primary key,
  company_name text default '', ruc text default '',
  tel text default '', email_empresa text default '',
  catalog_json jsonb default '[]', default_margin integer default 30
);
alter table profiles enable row level security;
create policy "own" on profiles for all using (auth.uid() = id);

create table budgets (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  project_name text default 'Sin título',
  created_at timestamptz default now(),
  data_json jsonb not null
);
alter table budgets enable row level security;
create policy "own" on budgets for all using (auth.uid() = user_id);`}
            </pre>
          )}
        </div>

        {/* Inputs */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 5, fontFamily: "system-ui" }}>Project URL</label>
          <input value={cfgForm.url} onChange={e => setCfgForm(p => ({ ...p, url: e.target.value }))} placeholder="https://xxxxxxxx.supabase.co" style={inp}/>
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 5, fontFamily: "system-ui" }}>Anon / Public Key</label>
          <input value={cfgForm.anonKey} onChange={e => setCfgForm(p => ({ ...p, anonKey: e.target.value }))} placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." style={inp}/>
        </div>
        {cfgErr && <p style={{ color: C.red, fontSize: 12, margin: "0 0 12px", fontFamily: "system-ui" }}>{cfgErr}</p>}
        <button onClick={handleSaveConfig} style={{ ...btnPri, width: "100%" }}>Conectar y continuar</button>
      </div>
    </div>
  );

  // ── AUTH ──────────────────────────────────────────────────────────────────────
  if (screen === "auth") return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem", fontFamily: "'Georgia', serif" }}>
      <div style={{ maxWidth: 400, width: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: "2.5rem" }}>
          <div style={{ width: 32, height: 32, background: C.accent, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg viewBox="0 0 18 18" width="16" height="16" fill="none"><rect x="2" y="3" width="14" height="12" rx="1.5" stroke="white" strokeWidth="1.3"/><line x1="2" y1="7" x2="16" y2="7" stroke="white" strokeWidth="1.3"/><line x1="7" y1="7" x2="7" y2="15" stroke="white" strokeWidth="1.3"/></svg>
          </div>
          <span style={{ fontSize: 17, fontWeight: 500 }}>Presupuestador IA</span>
        </div>

        {/* Tabs login/register */}
        <div style={{ display: "flex", gap: 4, background: C.warm, padding: 4, borderRadius: 9, border: `0.5px solid ${C.border}`, marginBottom: "1.5rem" }}>
          <button onClick={() => { setAuthTab("login"); setAuthErr(""); }} style={{ ...btnTab(authTab === "login"), flex: 1 }}>Ingresar</button>
          <button onClick={() => { setAuthTab("register"); setAuthErr(""); }} style={{ ...btnTab(authTab === "register"), flex: 1 }}>Crear cuenta</button>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 5, fontFamily: "system-ui" }}>Email</label>
          <input type="email" value={authForm.email} onChange={e => setAuthForm(p => ({ ...p, email: e.target.value }))} placeholder="tu@email.com" style={inp}/>
        </div>
        <div style={{ marginBottom: authTab === "register" ? 12 : 16 }}>
          <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 5, fontFamily: "system-ui" }}>Contraseña</label>
          <input type="password" value={authForm.password} onChange={e => setAuthForm(p => ({ ...p, password: e.target.value }))} placeholder="Mínimo 6 caracteres" style={inp} onKeyDown={e => e.key === "Enter" && (authTab === "login" ? handleSignIn() : null)}/>
        </div>
        {authTab === "register" && (
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 5, fontFamily: "system-ui" }}>Confirmar contraseña</label>
            <input type="password" value={authForm.confirm} onChange={e => setAuthForm(p => ({ ...p, confirm: e.target.value }))} placeholder="Repetí la contraseña" style={inp}/>
          </div>
        )}
        {authErr && <p style={{ fontSize: 12, margin: "0 0 12px", fontFamily: "system-ui", color: authErr.startsWith("✓") ? C.green : C.red }}>{authErr}</p>}
        <button onClick={authTab === "login" ? handleSignIn : handleSignUp} disabled={authLoad}
          style={{ ...btnPri, width: "100%", opacity: authLoad ? 0.6 : 1 }}>
          {authLoad ? "Procesando…" : authTab === "login" ? "Ingresar" : "Crear cuenta"}
        </button>
        <button onClick={() => { setCfg(null); window.storage.delete("sb_cfg"); setScreen("config"); }}
          style={{ marginTop: 12, background: "transparent", border: "none", color: C.muted, fontSize: 11, cursor: "pointer", width: "100%", fontFamily: "system-ui" }}>
          Cambiar proyecto Supabase
        </button>
      </div>
    </div>
  );

  // ── MAIN APP ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "'Georgia', serif", color: C.text }}>
      <style>{`
        @media print { .np{display:none!important} .po{display:flex!important} body{background:white} @page{margin:2cm} }
        .po{display:none} tr:hover td{background:${C.warm}} button{transition:opacity .15s} button:hover{opacity:.8}
        input[type=number]::-webkit-inner-spin-button{opacity:.5}
      `}</style>

      {/* Header */}
      <header className="np" style={{ height: 52, background: C.surface, borderBottom: `0.5px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 1.75rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 30, height: 30, background: C.accent, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg viewBox="0 0 18 18" width="16" height="16" fill="none"><rect x="2" y="3" width="14" height="12" rx="1.5" stroke="white" strokeWidth="1.3"/><line x1="2" y1="7" x2="16" y2="7" stroke="white" strokeWidth="1.3"/><line x1="7" y1="7" x2="7" y2="15" stroke="white" strokeWidth="1.3"/></svg>
          </div>
          <span style={{ fontSize: 15, fontWeight: 500 }}>Presupuestador IA</span>
          {view === "results" && (
            <div style={{ display: "flex", gap: 4, marginLeft: 16, background: C.warm, padding: 4, borderRadius: 9, border: `0.5px solid ${C.border}` }}>
              <button onClick={() => setTab("results")}  style={btnTab(tab === "results")}>Presupuesto</button>
              <button onClick={() => setTab("catalog")}  style={btnTab(tab === "catalog")}>Catálogo</button>
              <button onClick={() => setTab("history")}  style={btnTab(tab === "history")}>Historial {history.length > 0 && `(${history.length})`}</button>
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {saving   && <span style={{ fontSize: 11, color: C.muted,  fontFamily: "system-ui" }}>Guardando…</span>}
          {savedOk  && <span style={{ fontSize: 11, color: C.green,  fontFamily: "system-ui" }}>✓ Guardado</span>}
          {view === "results" && <button onClick={resetApp}             style={btn}>+ Nuevo</button>}
          {view === "results" && <button onClick={() => window.print()} style={btnPri}>Imprimir</button>}
          <button onClick={() => setSettingsOpen(s => !s)} style={btn}>⚙ Mi empresa</button>
          <div style={{ display: "flex", alignItems: "center", gap: 8, borderLeft: `0.5px solid ${C.border}`, paddingLeft: 12 }}>
            <span style={{ fontSize: 11, color: C.muted, fontFamily: "system-ui" }}>{session?.user?.email}</span>
            <button onClick={handleSignOut} style={{ ...btn, padding: "6px 12px", fontSize: 11 }}>Salir</button>
          </div>
        </div>
      </header>

      {/* Panel empresa */}
      {settingsOpen && (
        <div className="np" style={{ background: C.warm, borderBottom: `0.5px solid ${C.border}`, padding: "1rem 1.75rem" }}>
          <p style={{ fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 10px", fontFamily: "system-ui" }}>Datos de empresa · se sincronizan con Supabase</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
            {[["name","Nombre empresa"],["ruc","RUC"],["tel","Teléfono"],["email","Email empresa"]].map(([k, lbl]) => (
              <div key={k}>
                <label style={{ fontSize: 10, color: C.muted, display: "block", marginBottom: 3, fontFamily: "system-ui" }}>{lbl}</label>
                <input value={company[k]} onChange={e => updateCompany({ ...company, [k]: e.target.value })}
                  style={{ width: "100%", padding: "6px 10px", border: `0.5px solid ${C.border}`, borderRadius: 6, fontSize: 12, background: "white", boxSizing: "border-box" }}/>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upload / Analyzing */}
      {(view === "upload" || view === "analyzing") && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "calc(100vh - 52px)", padding: "2rem" }}>
          {view === "upload" ? (
            <div style={{ maxWidth: 540, width: "100%", textAlign: "center" }}>
              <h1 style={{ fontSize: 30, fontWeight: 400, margin: "0 0 8px", letterSpacing: "-0.025em" }}>Del plano al presupuesto</h1>
              <p style={{ color: C.muted, fontSize: 14, margin: "0 0 2rem", lineHeight: 1.7 }}>
                Subí el PDF del detallamiento. La IA extrae muebles, calcula chapas por espesor, m² de mesadas y herrajes — todo en Gs.
              </p>
              <div onClick={() => fileRef.current.click()} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}
                style={{ border: `1.5px dashed ${dragging ? C.accent : C.border}`, borderRadius: 14, padding: "3rem 2rem", cursor: "pointer", background: dragging ? "#EEF3FA" : C.surface, transition: "all .2s", marginBottom: "1rem" }}>
                <svg viewBox="0 0 52 52" width="52" height="52" style={{ margin: "0 auto 1rem", display: "block" }}>
                  <rect x="8" y="5" width="28" height="38" rx="3" fill="none" stroke={C.border} strokeWidth="2"/>
                  <line x1="14" y1="15" x2="30" y2="15" stroke={C.border} strokeWidth="1.5"/><line x1="14" y1="21" x2="30" y2="21" stroke={C.border} strokeWidth="1.5"/><line x1="14" y1="27" x2="22" y2="27" stroke={C.border} strokeWidth="1.5"/>
                  <circle cx="40" cy="40" r="11" fill={C.accent}/>
                  <line x1="40" y1="34" x2="40" y2="46" stroke="white" strokeWidth="2.2"/><line x1="34" y1="40" x2="46" y2="40" stroke="white" strokeWidth="2.2"/>
                </svg>
                <p style={{ fontWeight: 500, margin: "0 0 5px", fontSize: 15 }}>Arrastrá el PDF aquí</p>
                <p style={{ color: C.muted, fontSize: 12, margin: 0 }}>PDF · JPG · PNG</p>
              </div>
              <input ref={fileRef} type="file" accept=".pdf,image/*" style={{ display: "none" }} onChange={onDrop}/>
              <button onClick={() => { setView("analyzing"); setStatus("Cargando ejemplo…"); setTimeout(() => applyAnalysis(DEMO), 1400); }}
                style={{ background: "transparent", border: "none", color: C.accent, fontSize: 13, cursor: "pointer", textDecoration: "underline" }}>
                Ver demo sin subir archivo
              </button>
              {history.length > 0 && (
                <div style={{ marginTop: "2rem", textAlign: "left" }}>
                  <p style={{ fontSize: 11, color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 10px", fontFamily: "system-ui" }}>Presupuestos recientes</p>
                  {history.slice(0, 3).map(bg => (
                    <button key={bg.id} onClick={() => loadBudget(bg)}
                      style={{ display: "block", width: "100%", textAlign: "left", background: C.surface, border: `0.5px solid ${C.border}`, borderRadius: 8, padding: "10px 14px", marginBottom: 6, cursor: "pointer", fontFamily: "inherit" }}>
                      <span style={{ fontSize: 13 }}>{bg.project_name}</span>
                      <span style={{ fontSize: 11, color: C.muted, marginLeft: 10, fontFamily: "system-ui" }}>{new Date(bg.created_at).toLocaleDateString("es-PY")}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div style={{ textAlign: "center" }}>
              <div style={{ width: 48, height: 48, border: `3px solid ${C.border}`, borderTopColor: C.accent, borderRadius: "50%", margin: "0 auto 1.5rem", animation: "spin 1s linear infinite" }}/>
              <style>{"@keyframes spin{to{transform:rotate(360deg)}}"}</style>
              <p style={{ fontWeight: 500, fontSize: 17, margin: "0 0 6px" }}>Analizando con IA</p>
              <p style={{ color: C.muted, fontSize: 13 }}>{status}</p>
            </div>
          )}
        </div>
      )}

      {/* Results */}
      {view === "results" && (
        <main style={{ maxWidth: 1000, margin: "0 auto", padding: "2rem 1.5rem" }}>

          {/* Print header */}
          <div className="po" style={{ borderBottom: `1px solid ${C.border}`, paddingBottom: "1rem", marginBottom: "1.5rem", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 400 }}>{company.name}</h2>
              {company.ruc   && <p style={{ margin: "2px 0", fontSize: 12, color: C.muted, fontFamily: "system-ui" }}>RUC: {company.ruc}</p>}
              {company.tel   && <p style={{ margin: "2px 0", fontSize: 12, color: C.muted, fontFamily: "system-ui" }}>Tel: {company.tel}</p>}
              {company.email && <p style={{ margin: "2px 0", fontSize: 12, color: C.muted, fontFamily: "system-ui" }}>{company.email}</p>}
            </div>
            <div style={{ textAlign: "right" }}>
              <p style={{ margin: 0, fontSize: 22, fontWeight: 400 }}>Presupuesto de Materiales</p>
              <p style={{ margin: "4px 0 0", fontSize: 12, color: C.muted, fontFamily: "system-ui" }}>{new Date().toLocaleDateString("es-PY")} · Válido 15 días</p>
            </div>
          </div>

          {/* TAB: PRESUPUESTO */}
          {tab === "results" && (
            <>
              <div style={{ marginBottom: "1.5rem", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <p style={{ margin: 0, fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: "0.09em", fontFamily: "system-ui" }}>Proyecto detectado por IA</p>
                  <h2 style={{ margin: "4px 0 8px", fontSize: 22, fontWeight: 400 }}>{project?.proyecto}</h2>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {(project?.muebles || []).map((m, i) => (
                      <span key={i} style={{ fontSize: 11, padding: "3px 10px", background: C.tag, border: `0.5px solid ${C.border}`, borderRadius: 20, fontFamily: "system-ui" }}>
                        {m.cantidad > 1 ? `${m.cantidad}× ` : ""}{m.nombre}
                      </span>
                    ))}
                  </div>
                  {has30 && <div style={{ marginTop: 10, padding: "7px 13px", background: "#FFF8E8", border: "0.5px solid #E8D080", borderRadius: 8, fontSize: 11, color: "#7A6020", fontFamily: "system-ui", display: "inline-block" }}>Regruesos 30mm → calculados como 2× MDF 15mm</div>}
                </div>
                <button className="np" onClick={saveBudget} disabled={saving}
                  style={{ ...btn, fontSize: 12, color: C.green, borderColor: C.green, opacity: saving ? 0.6 : 1 }}>
                  {saving ? "Guardando…" : "↑ Guardar presupuesto"}
                </button>
              </div>

              {/* Tabla */}
              <div style={{ background: C.surface, border: `0.5px solid ${C.border}`, borderRadius: 12, overflow: "hidden", marginBottom: "1.5rem" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: C.warm }}>
                      <th style={{ ...th, textAlign: "left" }}>Material / Modelo</th>
                      <th style={{ ...th }}>Cant.</th><th style={{ ...th }}>Ud.</th>
                      <th style={{ ...th, fontSize: 9 }}>Detalle</th>
                      <th style={{ ...th, width: 140 }}>Precio unit. (Gs.)</th>
                      <th style={{ ...th, textAlign: "right" }}>Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {["Tableros","Mesadas","Accesorios","Herrajes"].flatMap(cat => {
                      const rows = items.filter(i => i.cat === cat);
                      if (!rows.length) return [];
                      return [
                        <tr key={"h-"+cat}><td colSpan={6} style={{ padding: "8px 16px 4px", fontSize: 10, fontWeight: 600, color: CAT_COLOR[cat], textTransform: "uppercase", letterSpacing: "0.09em", borderTop: `0.5px solid ${C.border}`, fontFamily: "system-ui" }}>{cat}</td></tr>,
                        ...rows.map(item => (
                          <tr key={item.id} style={{ borderTop: `0.5px solid ${C.border}` }}>
                            <td style={{ padding: "7px 16px" }}>
                              <input className="np" value={item.desc} onChange={e => updateDesc(item.id, e.target.value)} style={{ border: "none", background: "transparent", fontSize: 13, width: "100%", color: C.text }}/>
                              <span className="po">{item.desc}</span>
                            </td>
                            <td style={{ padding: "7px 8px", textAlign: "center" }}>
                              <input className="np" type="number" min="0" step="0.1" value={item.qty} onChange={e => updateQty(item.id, e.target.value)} style={{ width: 52, padding: "4px 6px", border: `0.5px solid ${C.border}`, borderRadius: 5, fontSize: 12, textAlign: "center", fontFamily: "system-ui" }}/>
                              <span className="po" style={{ fontFamily: "system-ui" }}>{item.qty}</span>
                            </td>
                            <td style={{ padding: "7px 8px", textAlign: "center", color: C.muted, fontSize: 11, fontFamily: "system-ui" }}>{item.unit}</td>
                            <td style={{ padding: "7px 8px", textAlign: "center", color: C.muted, fontSize: 10, fontFamily: "system-ui" }}>{item.detail}</td>
                            <td style={{ padding: "7px 10px", textAlign: "center" }}>
                              <input className="np" type="number" min="0" step="1" value={item.price || ""} placeholder="0" onChange={e => updatePrice(item.id, e.target.value)} style={{ width: 100, padding: "5px 8px", border: `0.5px solid ${C.border}`, borderRadius: 6, fontSize: 12, textAlign: "right", fontFamily: "system-ui" }}/>
                              <span className="po" style={{ fontFamily: "system-ui" }}>{item.price > 0 ? fmt(item.price) : "—"}</span>
                            </td>
                            <td style={{ padding: "7px 16px", textAlign: "right", fontFamily: "system-ui", fontWeight: item.price > 0 ? 500 : 400, color: item.price > 0 ? C.text : C.muted }}>
                              {item.price > 0 ? fmt(item.qty * item.price) : "—"}
                            </td>
                          </tr>
                        ))
                      ];
                    })}
                  </tbody>
                </table>
              </div>

              {/* Margen + Total */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem" }}>
                <div className="np" style={{ background: C.surface, border: `0.5px solid ${C.border}`, borderRadius: 12, padding: "1.25rem" }}>
                  <p style={{ fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: "0.09em", margin: "0 0 12px", fontFamily: "system-ui" }}>Margen comercial</p>
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <input type="range" min="0" max="100" step="1" value={margin} onChange={e => updateMargin(+e.target.value)} style={{ flex: 1 }}/>
                    <span style={{ fontSize: 24, minWidth: 52, fontFamily: "system-ui" }}>{margin}%</span>
                  </div>
                  <div style={{ marginTop: 10, fontSize: 12, fontFamily: "system-ui", display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: C.muted }}>Costo materiales</span><span>{fmt(subtotal)}</span></div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: C.muted }}>Tu ganancia</span><span style={{ color: C.green }}>+ {fmt(gain)}</span></div>
                  </div>
                </div>
                <div style={{ background: C.surface, border: `0.5px solid ${C.border}`, borderRadius: 12, padding: "1.25rem" }}>
                  <p style={{ fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: "0.09em", margin: "0 0 10px", fontFamily: "system-ui" }}>Total al cliente</p>
                  <div style={{ fontSize: 34, fontWeight: 400, letterSpacing: "-0.02em" }}>{fmt(total)}</div>
                  <div style={{ borderTop: `0.5px solid ${C.border}`, paddingTop: 10, marginTop: 10, fontSize: 12, fontFamily: "system-ui", color: C.muted, display: "flex", flexDirection: "column", gap: 3 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}><span>Materiales</span><span>{fmt(subtotal)}</span></div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}><span>Margen {margin}%</span><span>{fmt(gain)}</span></div>
                  </div>
                  {subtotal === 0 && <p style={{ fontSize: 11, color: C.muted, margin: "10px 0 0", fontFamily: "system-ui" }}>Ingresá los precios unitarios →</p>}
                </div>
              </div>

              {/* Print footer */}
              <div className="po" style={{ marginTop: "2rem", paddingTop: "1rem", borderTop: `0.5px solid ${C.border}`, justifyContent: "space-between", fontSize: 11, color: C.muted, fontFamily: "system-ui" }}>
                <span>{company.name}</span><span>Precios en Gs. · Válido 15 días</span>
              </div>
            </>
          )}

          {/* TAB: CATÁLOGO */}
          {tab === "catalog" && (
            <div>
              <div style={{ marginBottom: "1.5rem", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <h2 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 400 }}>Catálogo de precios</h2>
                  <p style={{ color: C.muted, fontSize: 13, margin: 0 }}>Tus precios habituales. Se auto-completan en cada nuevo presupuesto y se sincronizan con Supabase.</p>
                </div>
                <button onClick={() => updateCatalog([...catalog, { id: `c${Date.now()}`, label: "Nuevo material", unit: "u", price: 0, note: "" }])} style={btn}>+ Agregar</button>
              </div>
              <div style={{ background: C.surface, border: `0.5px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead><tr style={{ background: C.warm }}>
                    <th style={{ ...th, textAlign: "left" }}>Material</th>
                    <th style={{ ...th, textAlign: "left" }}>Nota / Proveedor</th>
                    <th style={{ ...th }}>Unidad</th>
                    <th style={{ ...th, width: 180 }}>Precio (Gs.)</th>
                    <th style={{ ...th, width: 50 }}></th>
                  </tr></thead>
                  <tbody>
                    {catalog.map((item, idx) => (
                      <tr key={item.id} style={{ borderTop: `0.5px solid ${C.border}` }}>
                        <td style={{ padding: "7px 16px" }}><input value={item.label} onChange={e => { const c=[...catalog]; c[idx]={...c[idx],label:e.target.value}; updateCatalog(c); }} style={{ border: "none", background: "transparent", fontSize: 13, width: "100%", color: C.text }}/></td>
                        <td style={{ padding: "7px 10px" }}><input value={item.note} onChange={e => { const c=[...catalog]; c[idx]={...c[idx],note:e.target.value}; updateCatalog(c); }} placeholder="Proveedor, modelo…" style={{ border: "none", background: "transparent", fontSize: 12, width: "100%", color: C.muted }}/></td>
                        <td style={{ padding: "7px 8px", textAlign: "center" }}>
                          <select value={item.unit} onChange={e => { const c=[...catalog]; c[idx]={...c[idx],unit:e.target.value}; updateCatalog(c); }} style={{ border: `0.5px solid ${C.border}`, borderRadius: 5, fontSize: 11, padding: "3px 4px", background: "white" }}>
                            {["chapa","m²","m","u","kg","lt"].map(u => <option key={u}>{u}</option>)}
                          </select>
                        </td>
                        <td style={{ padding: "7px 10px" }}>
                          <input type="number" min="0" step="1" value={item.price || ""} placeholder="0" onChange={e => { const c=[...catalog]; c[idx]={...c[idx],price:parseFloat(e.target.value)||0}; updateCatalog(c); }} style={{ width: "100%", padding: "5px 8px", border: `0.5px solid ${C.border}`, borderRadius: 6, fontSize: 12, textAlign: "right", fontFamily: "system-ui", boxSizing: "border-box" }}/>
                        </td>
                        <td style={{ padding: "7px 10px", textAlign: "center" }}>
                          <button onClick={() => updateCatalog(catalog.filter((_,i) => i!==idx))} style={{ background: "transparent", border: "none", color: C.muted, cursor: "pointer", fontSize: 16 }}>×</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB: HISTORIAL */}
          {tab === "history" && (
            <div>
              <h2 style={{ fontSize: 22, fontWeight: 400, margin: "0 0 1.5rem" }}>Historial de presupuestos</h2>
              {history.length === 0 ? (
                <p style={{ color: C.muted, fontSize: 14 }}>Todavía no guardaste ningún presupuesto. Usá el botón "↑ Guardar presupuesto" en la pantalla de resultados.</p>
              ) : (
                <div style={{ background: C.surface, border: `0.5px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead><tr style={{ background: C.warm }}>
                      <th style={{ ...th, textAlign: "left" }}>Proyecto</th>
                      <th style={{ ...th }}>Fecha</th>
                      <th style={{ ...th }}>Ítems</th>
                      <th style={{ ...th, width: 160 }}></th>
                    </tr></thead>
                    <tbody>
                      {history.map(bg => (
                        <tr key={bg.id} style={{ borderTop: `0.5px solid ${C.border}` }}>
                          <td style={{ padding: "10px 16px", fontWeight: 500 }}>{bg.project_name}</td>
                          <td style={{ padding: "10px 8px", textAlign: "center", color: C.muted, fontSize: 12, fontFamily: "system-ui" }}>{new Date(bg.created_at).toLocaleDateString("es-PY")}</td>
                          <td style={{ padding: "10px 8px", textAlign: "center", color: C.muted, fontSize: 12, fontFamily: "system-ui" }}>{bg.data_json?.items?.length || 0}</td>
                          <td style={{ padding: "10px 16px", textAlign: "right" }}>
                            <button onClick={() => loadBudget(bg)} style={{ ...btn, fontSize: 11, marginRight: 6 }}>Abrir</button>
                            <button onClick={() => deleteBudget(bg.id)} style={{ ...btn, fontSize: 11, color: C.red, borderColor: C.red }}>Eliminar</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </main>
      )}
    </div>
  );
}
