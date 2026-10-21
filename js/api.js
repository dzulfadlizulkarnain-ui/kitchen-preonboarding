/* Backend client: where the API lives, the session, and a demo mode used when
 * no API URL is configured (the demo reads the form spec from the real backend
 * file, so it can never drift from it). */
"use strict";

// The deployed Apps Script web app. A localStorage override lets a phone point at a test
// deployment: localStorage.setItem("kp.api", url). ?demo=1 runs the in-page demo instead (PIN 1234).
// Deployed 21 Oct 2026 (version 1) from the Apps Script project bound to the Kitchen Pre-onboarding sheet.
const API_URL = new URLSearchParams(location.search).get("demo") ? ""
  : localStorage.getItem("kp.api") || "https://script.google.com/macros/s/AKfycbyxSzWxwY0MY-3iy7kU7fdh2MJvye9cDC6_2It_pR_dajuoHGfSetzLGIkZZa4M28AizQ/exec";

const session = {
  get token() { return localStorage.getItem("kp.token") || ""; },
  get name() { return localStorage.getItem("kp.name") || ""; },
  save(a) { localStorage.setItem("kp.token", a.token); localStorage.setItem("kp.name", a.name); },
  clear() { ["kp.token", "kp.name", "kp.home", "kp.meta"].forEach(k => localStorage.removeItem(k)); }, // Lock leaves nothing of the records on a shared phone
};

let inflight = 0; // while any call is in flight the page shows the moving bar at the top (body.busy)
// Apps Script sometimes answers a POST with its ping page or an HTML error even though the script may have run, so only
// actions that are safe to repeat are sent again by themselves; upload reports the error and the person retries.
const RETRY_SAFE = ["list", "meta", "get", "img", "upcoming", "floorplan", "roster", "create", "save", "unphoto", "preview", "complete", "discard", "reopen"]; // create: a repeat finds the draft the first try made
async function api(action, payload, attempt) {
  attempt = attempt || 0;
  try { return await apiOnce(action, payload); }
  catch (e) {
    const again = e.retry && RETRY_SAFE.includes(action) && attempt < (e.retry === "ping" ? 2 : 1);
    if (!again) throw e;
    await new Promise(r => setTimeout(r, 1200 * (attempt + 1)));
    return api(action, payload, attempt + 1);
  }
}
async function apiOnce(action, payload) {
  const body = Object.assign({ action, token: session.token }, payload || {});
  inflight++; document.body.classList.add("busy");
  try {
    let data;
    if (!API_URL) data = await mock(body);
    else {
      // text/plain keeps the request "simple": Apps Script cannot answer a CORS preflight
      const res = await fetch(API_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body) });
      const text = await res.text();
      try { data = JSON.parse(text); } catch (e) { const err = new Error("The server is busy. Try again in a moment."); err.retry = "html"; throw err; }
      // a POST that Google turns into a GET lands on doGet and answers the ping; never treat that as data
      if (data.app === "kitchen-preonboarding" && !data.items && !data.forms && !data.item && !data.moves && action !== "ping") { const err = new Error("The server is busy. Try again in a moment."); err.retry = "ping"; throw err; }
    }
    if (data.error) { const e = new Error(data.error); e.auth = !!data.auth; throw e; }
    return data;
  } finally { if (--inflight === 0) document.body.classList.remove("busy"); }
}

/* ---------- demo mode: same actions, in memory, PIN 1234. Every name, licensee and address here is invented. ---------- */
let demo = null;
async function mock(b) {
  if (!demo) {
    const src = await (async () => { for (const u of ["backend/Code.gs", "../backend/Code.gs"]) { const r = await fetch(u).catch(() => null); if (r && r.ok) return r.text(); } throw new Error("Demo mode needs backend/Code.gs served beside the app (run the server from the project folder)."); })();
    const { FORMS, fieldsOf, missingFor, notReady } = new Function(src + "\nreturn { FORMS, fieldsOf, missingFor, notReady };")();
    const day = days => new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
    const seed = (site, kitchen, brand, days, access, extra) => { const d = new Date(Date.now() - days * 864e5).toISOString(); return Object.assign({ id: `PO-demo-${site}${kitchen}`, status: "done", site, kitchen, brand,
      date: d.slice(0, 10), access_date: access, by: "Demo Supervisor", created_at: d, completed_at: d, folder: "demo", pdf: "https://drive.google.com/open?id=demo-pdf", source: "" }, extra || {}); };
    const PIC = "https://drive.google.com/open?id=demo-pic"; // one invented photo stands in wherever a seed needs one
    const allYes = () => Object.assign(Object.fromEntries(fieldsOf("preonboarding").filter(f => f.type === "yesno").map(f => [f.key, "Y"])),
      Object.fromEntries(fieldsOf("preonboarding").filter(f => f.type === "photos" && f.min).map(f => [f.key, PIC])), { cages_serial: "DC 8", chiller_serial: "NA", freezer_serial: "NA" });
    const day0 = (days) => new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
    demo = { FORMS, fieldsOf, missingFor, notReady, n: 0,
      files: { "demo-pic": { mime: "image/png", b64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=" } },
      // due 14 days before access, or on the last off-boarding when that is later (Dzul's rules, 21 Oct 2026); K4's previous licensee leaves 5 days before the move
      moves: [[14, "S8", "K2", "Demo Bakery"], [9, "S8", "K5", "Demo Kitchen Co"], [3, "S1", "K2", "Demo Satay"], [21, "S8", "K4", "Demo Noodle House", 16], [60, "S1", "K3", "Demo Cafe"]].map(([days, site, kitchen, brand, outDays]) => {
        const dueDays = outDays != null && outDays > days - 14 ? outDays : days - 14;
        return { date: day0(-days), days, site, kitchen, brand, due: day0(-dueDays), dueDays, rule: outDays != null && outDays > days - 14 ? "after the previous licensee leaves" : "14 days before access" };
      }),
      rows: [seed("S1", "K2", "Demo Satay", 12, day(-3), allYes()), seed("S8", "K5", "Demo Kitchen Co", 4, day(-9), Object.assign(allYes(), { chiller_ready: "N", chiller_note: "Gasket to be replaced, cleaning booked", tablet_ready: "N", tablet_issue: "Not required by licensee" })),
        seed("S8", "K2", "Demo Bakery", 1, day(-14), Object.assign(allYes(), { status: "draft", completed_at: "", pdf: "", by: "Demo Auditor", lights_ok: "", door_ok: "", floorplan_match: "" }))],
      names: ["Demo Auditor", "Demo Supervisor"],
      sites: [{ code: "S1", name: "Demo North", address: "1 Demo Drive, Singapore 000001", kitchens: ["K1", "K2", "K3"] },
              { code: "S8", name: "Demo East", address: "8 Demo Avenue, Singapore 000008", kitchens: ["K1", "K2", "K3", "K4", "K5"] }] };
  }
  await new Promise(r => setTimeout(r, 120));
  const d = new Date(), today = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const meta = () => ({ sites: demo.sites, forms: demo.FORMS, company: "KitchenBASE (demo)" });
  const find = id => { const r = demo.rows.find(r => r.id === id); if (!r) throw new Error("not found"); return r; };
  const missing = r => { const m = demo.missingFor("preonboarding", r); if (m.length) throw new Error("Missing: " + m.join(", ")); };
  try {
    switch (b.action) {
      case "roster": return { names: demo.names };
      case "login": return String(b.pin) === "1234" ? Object.assign({ token: "demo", name: b.name }, meta()) : { error: "Wrong PIN. The demo PIN is 1234." };
    }
    if (b.token !== "demo") return { error: "Session expired. Log in again.", auth: true };
    switch (b.action) {
      case "meta": return meta();
      case "list": return { items: demo.rows.map(r => Object.assign({ type: "preonboarding" }, r)).sort((a, c) => c.created_at.localeCompare(a.created_at)) };
      case "upcoming": return { moves: demo.moves.map(m => { const c = demo.rows.find(r => r.site === m.site && r.kitchen === m.kitchen); return Object.assign({}, m, c ? { check: { id: c.id, status: c.status, by: c.by } } : {}); }) };
      case "floorplan": return { error: "No floor plans in the demo." };
      case "get": return { item: find(b.id) };
      case "create": {
        if (!b.site || !b.kitchen) return { error: "Site and kitchen are required." };
        const mv = demo.moves.find(m => m.site === b.site && m.kitchen === b.kitchen), date = b.date || today, brand = b.brand || (mv && mv.brand) || "TBC";
        const open = demo.rows.find(r => r.status === "draft" && r.site === b.site && r.kitchen === b.kitchen);
        if (open) return { item: open, existing: true };
        const item = { id: "PO-" + date.replace(/-/g, "") + "-" + (++demo.n), status: "draft", site: b.site, kitchen: b.kitchen, brand, date, by: "Demo Auditor",
          created_at: new Date().toISOString(), completed_at: "", folder: "demo", pdf: "", source: "", access_date: b.access_date || (mv && mv.date) || "" };
        demo.rows.push(item);
        return { item };
      }
      case "save": return { item: Object.assign(find(b.id), b.data) };
      case "upload": { const fileId = "f" + (++demo.n); demo.files[fileId] = { mime: b.mime && b.mime.startsWith("video/") ? b.mime : "image/jpeg", b64: b.b64s || b.b64 };
        const url = "https://drive.google.com/open?id=" + fileId, r = find(b.id), f = demo.fieldsOf("preonboarding").find(x => x.key === b.key);
        const have = String(r[b.key] || "").split("\n").filter(Boolean);
        if (have.length >= f.max) return { error: `${f.label}: ${f.max} is the maximum.` };
        r[b.key] = have.concat(url).join("\n"); return { url, fileId, value: r[b.key] }; }
      case "unphoto": { const r = find(b.id); r[b.key] = String(r[b.key] || "").split("\n").filter(u => u && u !== b.url).join("\n"); return { value: r[b.key] }; }
      case "preview": { const r = find(b.id); missing(r); const bad = demo.notReady("preonboarding", r);
        return { html: `<style>body { font-family: sans-serif }</style><h1>Demo preview</h1><p>${r.kitchen} · ${String(r.brand).replace(/[<&]/g, "")}</p><p>${bad.length ? "Not ready yet: " + bad.map(x => (x.label + (x.note ? ": " + x.note : "")).replace(/[<&]/g, "")).join(", ") : "Everything checked was ready."}</p><p>The live app shows the PDF report here.</p>`, cc: "" }; }
      case "complete": { const r = find(b.id); missing(r);
        Object.assign(r, { status: "done", completed_at: new Date().toISOString(), pdf: "https://drive.google.com/open?id=demo-pdf" });
        return { pdf: r.pdf }; }
      case "reopen": { const r = find(b.id); Object.assign(r, { status: "draft", completed_at: "", pdf: "" }); return { ok: true }; }
      case "discard": { demo.rows = demo.rows.filter(r => r.id !== b.id); return { ok: true }; }
      case "img": return demo.files[b.fileId] || { error: "no such file" };
    }
    return { error: "unknown action " + b.action };
  } catch (e) { return { error: e.message }; }
}
