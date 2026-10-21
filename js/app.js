/* Kitchen Pre-onboarding — screens and flows. The same skeleton as the Kitchen Handover and Kitchen Audit apps: one
 * <section> per screen, shown by show(); the form and the record view are rendered from the spec the backend sends
 * (meta.forms), so a question changed in Code.gs is the whole change. Every user-supplied string enters the DOM as text. */
"use strict";

const $ = id => document.getElementById(id);
function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false && k !== "") n.append(k.nodeType ? k : String(k));
  return n;
}
let toastTimer = null;
function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3000); }
function show(id) { document.querySelectorAll(".screen").forEach(s => { s.hidden = s.id !== id; }); window.scrollTo(0, 0); }
function fmtDate(s) { if (!s) return ""; const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + "T12:00:00") : new Date(s); return isNaN(d) ? String(s || "") : d.toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" }); }
function todayISO() { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
function initials(name) { return name.split(/\s+/).slice(0, 2).map(w => w[0] || "").join("").toUpperCase(); }
function idFromUrl(u) { return (String(u).match(/id=([\w-]+)/) || [])[1] || ""; }
async function guard(fn) { try { await fn(); } catch (e) { if (e.auth) { session.clear(); App.cur = null; loadLogin(); } toast(e.message || String(e)); } }

const TYPE = "preonboarding"; // the one form of this app; calls and record ids still carry the type, as in the handover app
const App = { meta: null, items: [], site: "", q: "", tab: "open", cur: null, names: [] };
const ignored = i => /^test\b/i.test(String(i.brand || "")); // TEST runs never count
const siteName = code => { const s = (App.meta ? App.meta.sites : []).find(s => s.code === code); return s ? s.name : ""; };
const formTitle = type => App.meta.forms[type].title;
const kNum = k => Number(String(k).replace(/\D/g, "")) || 0;

/* ---------- login ---------- */
async function loadLogin() {
  show("scr-login");
  $("pin-panel").hidden = true; $("login-pick").hidden = false;
  if (!App.names.length) {
    $("login-list").replaceChildren(el("p", { class: "empty" }, "Loading names…"));
    try { App.names = (await api("roster")).names; }
    catch (e) { $("login-list").replaceChildren(el("button", { class: "row", type: "button", onclick: () => loadLogin() }, "Could not load the names. Tap to retry.")); throw e; }
  }
  renderNames($("login-search").value);
}
function renderNames(q) {
  const list = $("login-list"); list.replaceChildren();
  App.names.filter(n => n.toLowerCase().includes(q.trim().toLowerCase())).forEach(n => list.append(
    el("button", { class: "row", type: "button", onclick: () => pickName(n) }, el("span", { class: "avatar" }, initials(n)), el("span", { class: "row-title" }, n))));
}
function pickName(name) {
  $("login-pick").hidden = true; $("pin-panel").hidden = false;
  $("pin-name").textContent = name;
  const pin = $("pin"); pin.value = ""; pin.focus();
  const btn = $("pin-panel").querySelector("button[type=submit]");
  $("pin-panel").onsubmit = ev => {
    ev.preventDefault();
    busyBtn(btn, "Checking PIN…", async () => { const a = await api("login", { name, pin: pin.value }); session.save(a); await enterApp(a); });
  };
}
// a second tap within a few seconds confirms; pop-up confirm() boxes are blocked on some phones and the tap then does nothing
function sure(btn, label) {
  if (btn.dataset.sure) { delete btn.dataset.sure; btn.textContent = btn.dataset.was || btn.textContent; delete btn.dataset.was; return true; } // confirmed: the real label is back before the call shows its own
  const was = btn.textContent; btn.dataset.sure = "1"; btn.dataset.was = was; btn.textContent = label;
  setTimeout(() => { if (btn.dataset.sure) { delete btn.dataset.sure; delete btn.dataset.was; btn.textContent = was; } }, 5000);
  return false;
}
function busyBtn(btn, label, fn) { // a tapped button says what it is doing until the call returns
  const was = btn.textContent; btn.disabled = true; btn.textContent = label;
  return guard(async () => { try { await fn(); } finally { btn.disabled = false; btn.textContent = was; } });
}
$("login-search").oninput = e => renderNames(e.target.value);
$("pin-back").onclick = () => loadLogin();

/* ---------- home ---------- */
// last known data, so a reopened app paints at once and refreshes in the background
const cached = k => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } };
const remember = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
async function enterApp(meta) { // login already carries the sites and the form; a resumed session uses the cached copy
  const fromCache = !(meta && meta.forms) && cached("kp.meta");
  App.meta = meta && meta.forms ? meta : (fromCache || await api("meta"));
  if (!App.meta.forms) throw new Error("Could not load the app settings. Try again.");
  remember("kp.meta", App.meta);
  await loadHome();
  if (fromCache) api("meta").then(m => { if (m.forms) { App.meta = m; remember("kp.meta", m); if (!$("scr-home").hidden) renderHome(); } }).catch(() => {});
  if (App.deepLink) { const d = App.deepLink; App.deepLink = null; openNew(d); }
}
async function loadHome() {
  show("scr-home");
  $("home-user").textContent = session.name;
  const snap = cached("kp.home");
  if (snap && Array.isArray(snap.items)) { App.items = snap.items; App.moves = snap.moves || []; App.movesError = ""; renderHome(); } // an older snapshot shape is just skipped
  else $("home-list").replaceChildren(el("p", { class: "empty" }, "Loading…"));
  // the coming move-ins come from the licensee contract list; if that read fails the home screen still works
  const [l, u] = await Promise.all([api("list"), api("upcoming").catch(e => ({ moves: [], error: e.message }))]);
  App.items = l.items.filter(i => i.status !== "discarded"); App.moves = u.moves || []; App.movesError = u.error || "";
  if (!u.error) remember("kp.home", { items: App.items, moves: App.moves });
  renderHome();
}
const moveFor = (site, kitchen) => (App.moves || []).find(m => m.site === site && m.kitchen === kitchen) || null;
function renderHome() {
  // two tabs: Open (checks in progress, and the kitchens whose licensee is about to move in) and Records (finished, by site, searchable)
  const tabs = $("home-tabs"); tabs.replaceChildren(...[["open", "Open"], ["records", "Records"]].map(([k, label]) =>
    el("button", { class: "seg-btn" + (App.tab === k ? " on" : ""), type: "button", onclick: () => { App.tab = k; renderHome(); } }, label)));
  const records = App.tab === "records";
  $("btn-new").hidden = records; $("home-search").hidden = !records;
  const chips = $("site-chips"); chips.replaceChildren();
  const chip = (code, label) => el("button", { class: "chip" + (App.site === code ? " on" : ""), type: "button", onclick: () => { App.site = code; renderHome(); } }, label);
  chips.append(chip("", "All"), ...App.meta.sites.map(s => chip(s.code, s.code)));
  const list = $("home-list"); list.replaceChildren();
  const row = (i, title, sub) => el("button", { class: "row", type: "button", onclick: () => guard(() => i.status === "done" ? openDetail(TYPE, i.id) : resumeForm(TYPE, i.id)) },
    el("div", { class: "row-main" }, el("div", { class: "row-title" }, title), el("div", { class: "row-sub" }, sub)),
    el("span", { class: "badge " + (i.status === "done" ? "done" : "draft") }, i.status === "done" ? "Done" : "Draft"));
  const inSite = App.items.filter(i => !App.site || i.site === App.site);
  const where = i => `${i.site} ${siteName(i.site)}`;
  if (!records) {
    const drafts = inSite.filter(i => i.status === "draft");
    if (drafts.length) {
      list.append(el("div", { class: "listhead" }, "In progress"));
      drafts.forEach(i => list.append(row(i, `${i.kitchen} · ${i.brand}`, `${where(i)} · started ${fmtDate(i.date)} by ${i.by}` + (i.access_date ? ` · access ${fmtDate(i.access_date)}` : ""))));
    }
    // the kitchens a licensee moves into soon, from the contract list, each with its due date (14 days before access, or the kitchen's last
    // off-boarding when that is later; a kitchen already on-boarded is not listed) and the check made for it, or Start pre-filled
    const moves = (App.moves || []).filter(m => !App.site || m.site === App.site), near = App.site ? moves : moves.filter(m => m.dueDays <= 30), later = moves.length - near.length;
    list.append(el("div", { class: "listhead" }, "Pre-onboardings due"));
    if (App.movesError) list.append(el("div", { class: "note small" }, "Move-ins unavailable: " + App.movesError));
    else if (!near.length) list.append(el("p", { class: "empty" }, later ? `None due in the next 30 days. ${later} later: pick a site to see them.` : "No move-ins listed for this site in the next 90 days."));
    near.forEach(m => {
      const due = new Date(m.due + "T12:00:00"), dd = m.dueDays;
      const dueWhen = dd < 0 ? `${-dd} day${dd === -1 ? "" : "s"} overdue` : dd === 0 ? "due today" : dd === 1 ? "due tomorrow" : `due in ${dd} days`;
      const c = m.check, status = !c ? `${dueWhen} (${m.rule})` : c.status === "done" ? `Checked by ${c.by}` : `Check in progress by ${c.by}`;
      list.append(el("button", { class: "row", type: "button", onclick: () => guard(() => !c ? openNew({ site: m.site, kitchen: m.kitchen, brand: m.brand, access: m.date }) : c.status === "done" ? openDetail(TYPE, c.id) : resumeForm(TYPE, c.id)) },
        el("div", { class: "mv-date" }, el("span", { class: "d" }, String(due.getDate())), el("span", { class: "mo" }, due.toLocaleDateString("en-SG", { month: "short" }))),
        el("div", { class: "row-main" }, el("div", { class: "row-title" }, `${m.kitchen} · ${m.brand}`), el("div", { class: "row-sub" }, `${m.site} ${siteName(m.site)} · access ${fmtDate(m.date)} · ${status}`)),
        el("span", { class: "badge " + (!c ? (dd < 0 ? "late" : dd <= 7 ? "soon" : "") : c.status === "done" ? "done" : "draft") }, !c ? (dd < 0 ? "Overdue" : dd <= 7 ? "Due soon" : "Start") : c.status === "done" ? "Done" : "Draft")));
    });
    if (later > 0 && !App.site) list.append(el("p", { class: "muted small" }, `${later} more due after 30 days: pick a site above to see them.`));
    return;
  }
  const q = App.q.trim().toLowerCase();
  const done = inSite.filter(i => i.status === "done" && (!q || `${i.kitchen} ${i.brand} ${i.site} ${siteName(i.site)} ${i.by}`.toLowerCase().includes(q)));
  if (!done.length) { list.append(el("p", { class: "empty" }, q ? "Nothing matches." : "No finished pre-onboardings here yet.")); return; }
  const sub = i => `${fmtDate(i.date)} · ${i.by}` + (i.access_date ? ` · access ${fmtDate(i.access_date)}` : "") + (i.source ? " · from AppSheet" : "");
  if (q) { done.forEach(i => list.append(row(i, `${i.kitchen} · ${i.brand}`, `${where(i)} · ${sub(i)}`))); return; } // a search cuts across everything
  // finished checks: site, then kitchen; folded so two years of them do not make one long page
  [...new Set(done.map(i => i.site))].sort((a, b) => kNum(a) - kNum(b)).forEach(code => {
    const recs = done.filter(i => i.site === code).sort((x, y) => String(y.date).localeCompare(String(x.date)));
    const group = el("details", { class: "group", open: App.site ? "" : null }, el("summary", {}, `${code} ${siteName(code)}`, el("span", { class: "count" }, recs.length)));
    recs.forEach(i => group.append(row(i, `${i.kitchen} · ${i.brand}`, sub(i))));
    list.append(group);
  });
}
$("home-search").oninput = e => { App.q = e.target.value; renderHome(); };
$("btn-lock").onclick = () => { session.clear(); App.cur = null; guard(loadLogin); };
$("btn-new").onclick = () => openNew();

/* ---------- new pre-onboarding ---------- */
function openNew(prefill) { // prefill: a move-in tapped on the home screen, or a deep link ?new=1&site=S8&kitchen=K8&brand=X&access=YYYY-MM-DD&date=YYYY-MM-DD (e.g. from a CrewBASE card)
  show("scr-new");
  $("new-form").reset(); delete $("new-brand").dataset.auto; delete $("new-access").dataset.auto;
  $("new-site").replaceChildren(el("option", { value: "" }, "Choose site"), ...App.meta.sites.map(s => el("option", { value: s.code }, `${s.code} · ${s.name}`)));
  const p = prefill || {}, site = App.meta.sites.some(s => s.code === p.site) ? p.site : App.site;
  $("new-site").value = site || "";
  fillKitchens(site || "", p.kitchen || "");
  $("new-brand").value = p.brand || "";
  const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
  $("new-access").value = isDay(p.access) ? p.access : "";
  $("new-date").value = isDay(p.date) ? p.date : todayISO();
  syncNew();
}
function fillKitchens(site, keep) { // the dropdown names the licensee moving in and any check in progress, so the wrong kitchen is hard to pick
  const s = App.meta.sites.find(x => x.code === site), sel = $("new-kitchen");
  const ks = ((s && s.kitchens) || []).slice();
  if (keep && !ks.includes(keep)) ks.push(keep);
  sel.replaceChildren(el("option", { value: "" }, "Choose kitchen"), ...ks.map(k => {
    const open = App.items.find(i => i.status === "draft" && i.site === site && i.kitchen === k), m = moveFor(site, k);
    return el("option", { value: k }, open ? `${k} · in progress (${open.brand}, ${open.by})` : m ? `${k} · ${m.brand} moves in ${fmtDate(m.date)}` : k);
  }));
  sel.value = keep || ""; sel.dataset.site = site;
}
function syncNew() { // a licensee and access date filled in for you follow the kitchen picked; typed text stays
  const site = $("new-site").value, s = App.meta.sites.find(x => x.code === site);
  if ($("new-kitchen").dataset.site !== site) fillKitchens(site, "");
  $("new-address").textContent = s ? s.address : "";
  const k = $("new-kitchen").value, m = k ? moveFor(site, k) : null, brand = $("new-brand"), access = $("new-access");
  if (brand.dataset.auto) { brand.value = ""; delete brand.dataset.auto; }
  if (access.dataset.auto) { access.value = ""; delete access.dataset.auto; }
  if (m && !brand.value) { brand.value = m.brand; brand.dataset.auto = "1"; }
  if (m && !access.value) { access.value = m.date; access.dataset.auto = "1"; }
}
$("new-brand").oninput = () => delete $("new-brand").dataset.auto;
$("new-access").oninput = () => delete $("new-access").dataset.auto;
$("new-site").onchange = syncNew;
$("new-kitchen").onchange = syncNew;
$("new-back").onclick = () => guard(loadHome);
$("new-form").onsubmit = ev => {
  ev.preventDefault();
  busyBtn($("new-form").querySelector("button[type=submit]"), "Starting…", async () => {
    const { item, existing } = await api("create", { type: TYPE, site: $("new-site").value, kitchen: $("new-kitchen").value.trim(), brand: $("new-brand").value.trim(), access_date: $("new-access").value, date: $("new-date").value });
    if (existing) toast(`${item.kitchen} already has a pre-onboarding in progress, started by ${item.by}. Continuing that one.`); // one draft per kitchen
    App.cur = { type: TYPE, item, dirty: {} };
    openForm();
  });
};

/* ---------- form ---------- */
async function resumeForm(type, id) {
  const { item } = await api("get", { type, id });
  App.cur = { type, item, dirty: {} };
  openForm();
}
function openForm() {
  const { type, item } = App.cur;
  show("scr-form");
  $("form-title").textContent = `${item.kitchen} · ${item.brand}`;
  $("form-sub").textContent = `${formTitle(type)} · ${item.site} ${siteName(item.site)} · ${fmtDate(item.date)}`;
  setStatus("");
  const body = $("form-body"); body.replaceChildren(el("p", { class: "note", id: "form-note" }));
  App.meta.forms[type].sections.forEach(sec => {
    const card = el("section", { class: "card" }, el("h2", {}, sec.title));
    sec.fields.forEach(f => card.append(fieldEl(f)));
    if (card.children.length > 1) body.append(card);
  });
  body.append(discardBtn(type, item));
  syncWhen();
}
// only the person who started a check sees this; the row is deleted and its files go to the bin
function discardBtn(type, item) {
  if (item.by !== session.name) return "";
  return el("button", { class: "btn danger", type: "button", onclick: ev => {
    if (!sure(ev.currentTarget, "Tap again to discard it and its photos")) return;
    busyBtn(ev.currentTarget, "Discarding…", async () => { await api("discard", { type, id: item.id }); App.cur = null; toast("Discarded."); await loadHome(); });
  } }, "Discard this pre-onboarding");
}
function setStatus(s) { $("form-status").textContent = s; }

let saveTimer = null;
function queueSave(key, value) {
  const cur = App.cur;
  cur.dirty[key] = value; setStatus("Saving…");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => flushSave().catch(e => guard(() => { throw e; })), 800);
}
document.addEventListener("visibilitychange", () => { flushSave().catch(() => {}); }); // going to the background: save now, not in 0.8 s; coming back: retry anything the OS cut off
let saving = null; // the save in flight: Review and complete must not read the row before the last answer has landed
async function flushSave() {
  const cur = App.cur; clearTimeout(saveTimer);
  if (saving) await saving.catch(() => {});
  if (!cur || !Object.keys(cur.dirty).length) return;
  const data = cur.dirty; cur.dirty = {};
  saving = api("save", { type: cur.type, id: cur.item.id, data });
  try { await saving; setStatus("Saved"); }
  catch (e) { cur.dirty = Object.assign(data, cur.dirty); setStatus("Not saved"); throw e; }
  finally { saving = null; }
}

// the same rules as the backend: a photos cell holds one link per line; a field applies only while its conditions hold
const links = v => String(v == null ? "" : v).split(/\r?\n/).map(x => x.trim()).filter(Boolean);
const ansOf = (item, k) => String(item[k] == null ? "" : item[k]).trim().toUpperCase();
function activeField(f, item) { // `when`: one or several yes/no keys, all Yes; `whenNo`: that answer is No; `site`/`sites`: asked only there; `legacy`: never asked
  if (f.legacy || (f.site && String(item.site) !== f.site) || (f.sites && !f.sites.includes(String(item.site)))) return false;
  if (f.when && [].concat(f.when).some(k => ansOf(item, k) !== "Y")) return false;
  if (f.whenNo && ansOf(item, f.whenNo) !== "N") return false;
  if (f.anyOf && !f.anyOf.some(k => /\d/.test(ansOf(item, k)))) return false;
  return true;
}
const isMedia = f => ["photo", "sig", "photos", "video"].includes(f.type);
const fields = type => App.meta.forms[type].sections.flatMap(s => s.fields).filter(f => !["link", "note"].includes(f.type));
function missingFor(type, item) {
  return fields(type).filter(f => activeField(f, item)).filter(f => {
    const v = item[f.key], empty = v == null || String(v).trim() === "";
    const req = f.req || (f.reqWhenNo && ansOf(item, f.reqWhenNo) === "N"); // a No explains itself
    const min = f.minWhenNo && ansOf(item, f.minWhenNo) === "N" ? Math.max(1, f.min || 0) : f.min; // a No needs the photo of the problem
    return (req && empty) || (min && links(v).length < min);
  }).map(f => f.label);
}
const PROBLEM_KEY = /_(ready|ok|clean|done|match|dismantle)$/; // the same rule as the backend: "issued?", "needed?" and "repair needed?" are not problems
function notReady(type, item) { // every No that is a problem, with the remark that goes with it and whether a repair was raised
  const byKey = {}; fields(type).forEach(f => { byKey[f.key] = f; });
  const said = k => String(item[k] == null ? "" : item[k]).trim();
  return fields(type).filter(f => f.type === "yesno" && PROBLEM_KEY.test(f.key) && activeField(f, item) && said(f.key).toUpperCase() === "N").map(f => {
    const base = f.key.replace(PROBLEM_KEY, ""), note = ["_note", "_remarks", "_issue"].map(s => byKey[base + s]).find(n => n && said(n.key));
    const repair = byKey[base + "_repair"] ? said(base + "_repair").toUpperCase() : "";
    return { label: f.label, note: note ? said(note.key) : "", repair: repair === "Y" ? "repair needed, raised on Infraspeak" : repair === "N" ? "no repair needed" : "" };
  });
}
const badLine = b => b.label + (b.note ? ": " + b.note : "") + (b.repair ? " (" + b.repair + ")" : "");
function syncWhen() { // fields that depend on other answers show only while those answers allow; the note at the top counts what is not ready
  const item = App.cur.item;
  document.querySelectorAll("#form-body [data-cond]").forEach(w => { w.hidden = !activeField(w._field, item); });
  const n = $("form-note");
  if (n) { const bad = notReady(App.cur.type, item), left = missingFor(App.cur.type, item).length; n.textContent = (bad.length ? `${bad.length} not ready yet` : "Nothing marked not ready") + (left ? ` · ${left} still to answer` : " · everything answered"); }
}
function fieldEl(f) {
  const { item } = App.cur;
  if (f.legacy || (f.site && item.site !== f.site) || (f.sites && !f.sites.includes(item.site))) return "";
  const node = fieldNode(f), hint = f.hint && !isMedia(f) ? el("span", { class: "hint" }, f.hint) : null;
  if (hint) node.append(hint);
  if (!f.when && !f.whenNo && !f.anyOf) return node;
  const wrap = el("div", { "data-cond": "" }, node); wrap._field = f;
  return wrap;
}
const INPUT_TYPES = ["date", "url", "email", "tel", "number"];
function fieldNode(f) {
  const { item } = App.cur, v = item[f.key];
  if (f.type === "link") return el("div", { class: "field" }, linkBtn(f, item));
  if (f.type === "photos" || f.type === "video") return galleryTile(f);
  if (f.type === "yesno") {
    const seg = el("div", { class: "seg" });
    const mk = (val, text) => el("button", { type: "button", class: "seg-btn" + (v === val ? " on" : ""), onclick: () => {
      item[f.key] = val; [...seg.children].forEach(b => b.classList.toggle("on", b.textContent === text)); queueSave(f.key, val); syncWhen();
    } }, text);
    seg.append(mk("Y", "Yes"), mk("N", "No"));
    return el("div", { class: "field" }, el("span", { class: "label" }, f.label, f.req ? el("span", { class: "field-sub" }, " · required") : null), seg);
  }
  if (f.fixed) { // settled at Start: shown, never editable
    return el("div", { class: "field" }, el("span", { class: "label" }, f.label, el("span", { class: "field-sub" }, " · set at Start")), el("div", { class: "fixed", "aria-label": f.label }, v == null || v === "" ? "—" : String(v)));
  }
  const input = el("input", { type: INPUT_TYPES.includes(f.type) ? f.type : "text", value: v == null ? "" : String(v), placeholder: f.ph || "", autocomplete: "off", "aria-label": f.label });
  input.oninput = () => { item[f.key] = input.value.trim(); queueSave(f.key, item[f.key]); if (f.key === "access_date") syncWhen(); };
  const sub = f.req ? " · required" : f.reqWhenNo ? " · needed on a No" : "";
  return el("label", { class: "field" }, el("span", { class: "label" }, f.label, sub ? el("span", { class: "field-sub" }, sub) : null), input);
}

function linkBtn(f, item) { // a link on the form: the Ops Bot, Infraspeak, or this kitchen's floor plan fetched through the backend
  if (f.href !== "floorplan") return el("a", { class: "btn ghost", href: f.href, target: "_blank", rel: "noopener" }, f.label + " ↗");
  const btn = el("button", { class: "btn ghost", type: "button" }, f.label);
  btn.onclick = () => {
    btn.disabled = true; btn.textContent = "Loading floor plan…";
    guard(async () => {
      try {
        const r = await api("floorplan", { site: item.site, kitchen: item.kitchen });
        const bytes = Uint8Array.from(atob(r.b64), c => c.charCodeAt(0)), url = URL.createObjectURL(new Blob([bytes], { type: r.mime }));
        if (/^image\//.test(r.mime)) { // the plan as a picture: the app's own viewer, pinch to zoom
          const id = `floorplan-${item.site}-${item.kitchen}`.replace(/[^\w-]/g, "");
          mediaCache[id] = Promise.resolve(url);
          gallery(`Floor plan · ${item.site} ${item.kitchen}`, ["https://drive.google.com/open?id=" + id], false);
        } else if (!window.open(url, "_blank")) toast("The PDF is ready but the browser blocked the new tab. Allow pop-ups for this site and tap again.");
      } finally { btn.disabled = false; btn.textContent = f.label; }
    });
  };
  return btn;
}

/* photos and videos: resized on the phone, uploaded as they are taken */
// ponytail: quality knobs. 2048px @ 0.9 keeps detail legible (~1 MB); 1000px @ 0.8 is the copy the lists use.
const FULL_EDGE = 2048, FULL_Q = 0.9, SMALL_EDGE = 1000, SMALL_Q = 0.8;
async function shrink(file, maxEdge, quality) { // via <img>, which every browser draws with EXIF rotation applied
  const url = URL.createObjectURL(file);
  try {
    const im = await new Promise((ok, err) => { const i = new Image(); i.onload = () => ok(i); i.onerror = err; i.src = url; });
    const scale = Math.min(1, maxEdge / Math.max(im.naturalWidth, im.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(im.naturalWidth * scale); c.height = Math.round(im.naturalHeight * scale);
    c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
    return await new Promise(res => c.toBlob(res, "image/jpeg", quality));
  } finally { URL.revokeObjectURL(url); }
}
const b64 = blob => new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.readAsDataURL(blob); });
// photos come back through the API as base64 so the phone never needs a Google login; loaded when scrolled into view
const lazy = new IntersectionObserver(entries => entries.forEach(en => {
  if (!en.isIntersecting) return;
  lazy.unobserve(en.target); queue.push(en.target); pump();
}), { rootMargin: "300px" });
const queue = []; let loading = 0; // ponytail: three photo fetches at a time; each takes the backend seconds, a burst just stalls
function pump() {
  while (loading < 3 && queue.length) {
    const box = queue.shift(), img = box.querySelector("img[data-drive]");
    if (!img) continue; // the photo was deleted while the tile waited
    loading++; box.classList.add("loading");
    api("img", refOf(img.dataset.drive))
      .then(r => { img.src = `data:${r.mime};base64,${r.b64}`; img.hidden = false; })
      .catch(e => { box.classList.add("failed"); if (e.auth) guard(() => Promise.reject(e)); })
      .finally(() => { box.classList.remove("loading"); loading--; pump(); });
  }
}
// where a file is: a Drive link, or an AppSheet file still in its old folder ("Preonboarding_Images/<file name>")
const refOf = u => { const id = idFromUrl(u), p = String(u || "").trim(); return id ? { fileId: id } : /^[^\/]+\/[^\/]+\.\w+$/.test(p) ? { path: p } : null; };
function showDriveImage(img, url) { img.dataset.drive = url; requestAnimationFrame(() => lazy.observe(img.parentElement || img)); }
const VIDEO_MAX_BYTES = 20 * 1024 * 1024;
function galleryTile(f) { // first photo as the thumbnail, a count, Add while under the maximum; tap to browse, play or delete
  const { type, item } = App.cur, isVid = f.type === "video";
  const list = () => links(item[f.key]);
  const img = el("img", { alt: "", hidden: true }), count = el("span", { class: "count" });
  const state = el("div", { class: "tile-state" });
  const add = el("button", { class: "btn ghost small", type: "button" }, isVid ? "+ Record video" : "+ Take photo");
  const lib = el("button", { class: "linkbtn", type: "button" }, "Upload from gallery");
  const stop = ev => ev.stopPropagation(); // input.click() bubbles to the tile, which would open the viewer over the camera
  const input = el("input", { type: "file", accept: isVid ? "video/*" : "image/*", capture: "environment", hidden: true, onclick: stop }); // camera
  const libInput = el("input", { type: "file", accept: isVid ? "video/*" : "image/*", hidden: true, onclick: stop });                       // the phone's gallery
  const need = f.minWhenNo ? "needed on a No" : f.min ? "at least " + f.min : "optional";
  const tile = el("div", { class: "tile gallery" + (isVid ? " video" : "") },
    el("div", { class: "tile-img" }, img, el("span", { class: "tile-icon" }, isVid ? "🎥" : "📷"), count),
    el("div", { class: "tile-cap" }, f.label, el("span", { class: "field-sub" }, ` · ${need}, up to ${f.max}`)),
    state, f.hint ? el("span", { class: "hint" }, f.hint) : null, el("div", { class: "tile-actions" }, add, lib), input, libInput);
  const refresh = () => {
    const l = list(), n = l.length, what = isVid ? "video" : "photo";
    count.textContent = n ? `${n} / ${f.max}` : ""; add.hidden = lib.hidden = n >= f.max;
    state.textContent = n ? `${n} ${what}${n > 1 ? "s" : ""} · tap to ${isVid ? "play" : "view"}` : `No ${what} yet`;
    if (!n) { img.hidden = true; img.removeAttribute("src"); delete img.dataset.drive; }
    else if (!isVid && idFromUrl(l[0]) && img.dataset.drive !== l[0]) { img.hidden = true; img.removeAttribute("src"); showDriveImage(img, l[0]); }
    syncWhen();
  };
  refresh();
  add.onclick = ev => { ev.stopPropagation(); if (!tile.classList.contains("busy")) input.click(); };
  lib.onclick = ev => { ev.stopPropagation(); if (!tile.classList.contains("busy")) libInput.click(); };
  input.onchange = () => picked(input); libInput.onchange = () => picked(libInput);
  const picked = inp => guard(async () => {
    const file = inp.files[0]; inp.value = "";
    if (!file) return;
    let pending, first = !list().length;
    tile.classList.add("busy"); // from the first moment: a second tap while the photo is still being shrunk must not start a second upload
    try {
      if (isVid) {
        if (file.size > VIDEO_MAX_BYTES) { toast(`That video is ${(file.size / 1048576).toFixed(0)} MB. Keep clips under ${VIDEO_MAX_BYTES / 1048576} MB, about 15 seconds.`); return; }
        state.textContent = "Preparing video…";
        pending = { mime: file.type || "video/mp4", b64: await b64(file) };
      } else {
        state.textContent = "Preparing…";
        const [full, small] = await Promise.all([shrink(file, FULL_EDGE, FULL_Q), shrink(file, SMALL_EDGE, SMALL_Q)]);
        if (first) { img.src = URL.createObjectURL(small); img.hidden = false; }
        pending = { mime: "image/jpeg", b64: await b64(full), b64s: await b64(small) };
      }
      state.textContent = isVid ? "Uploading video… this can take a minute" : "Uploading…";
      try {
        const r = await api("upload", Object.assign({ type, id: item.id, key: f.key }, pending));
        item[f.key] = r.value;
        if (first && !isVid) img.dataset.drive = r.url; // the preview already shows it
      } catch (e) { if (e.auth) throw e; toast("Upload failed: " + e.message); }
    } finally { tile.classList.remove("busy"); refresh(); }
  });
  tile.onclick = () => {
    const l = list();
    if (l.length) gallery(f.label, l, isVid, async url => { const r = await api("unphoto", { type, id: item.id, key: f.key, url }); item[f.key] = r.value; refresh(); });
  };
  return tile;
}
const mediaCache = {}; // one fetch per file, then a local URL; works for photos and videos
function mediaSrc(url) {
  const id = url;
  if (!mediaCache[id]) mediaCache[id] = api("img", refOf(url)).then(r => {
    const bytes = Uint8Array.from(atob(r.b64), c => c.charCodeAt(0));
    return URL.createObjectURL(new Blob([bytes], { type: r.mime }));
  }).catch(e => { delete mediaCache[id]; throw e; });
  return mediaCache[id];
}
function gallery(label, urls, isVid, onDelete) { // full-screen viewer: buttons through the list, play videos, delete while editing
  let i = 0;
  const stage = el("div", { class: "stage" }), cap = el("div", { class: "lightbox-cap" });
  const box = el("div", { class: "lightbox gallery" });
  const btn = (text, cls, fn) => el("button", { type: "button", class: "lb-btn " + cls, onclick: ev => { ev.stopPropagation(); fn(ev); } }, text);
  const close = () => { box.remove(); document.body.classList.remove("noscroll"); };
  const showAt = async n => {
    i = (n + urls.length) % urls.length;
    const u = urls[i];
    cap.textContent = `${label} · ${i + 1} of ${urls.length}`;
    stage.replaceChildren(el("div", { class: "lb-msg" }, "Loading…"));
    if (!refOf(u)) { stage.replaceChildren(el("div", { class: "lb-msg" }, isVid ? "Video not available" : "Photo not available")); return; }
    try {
      const src = await mediaSrc(u);
      if (urls[i] !== u) return;
      stage.replaceChildren(isVid ? el("video", { src, controls: true, playsinline: true, autoplay: true }) : el("img", { src, alt: label }));
    } catch (e) { stage.replaceChildren(el("div", { class: "lb-msg" }, "Could not load")); }
  };
  box.append(...[stage, cap, btn("✕", "lb-close", close),
    urls.length > 1 ? btn("‹", "lb-prev", () => showAt(i - 1)) : null,
    urls.length > 1 ? btn("›", "lb-next", () => showAt(i + 1)) : null,
    onDelete ? btn("Delete", "lb-del", ev => {
      if (!sure(ev.currentTarget, "Tap again to delete")) return;
      const u = urls[i];
      guard(async () => { await onDelete(u); urls.splice(i, 1); if (!urls.length) return close(); showAt(i); });
    }) : null].filter(Boolean)); // DOM append would print an absent button as "null"
  box.onclick = close; stage.onclick = ev => ev.stopPropagation();
  document.body.append(box); document.body.classList.add("noscroll");
  showAt(0);
}
$("form-back").onclick = () => guard(async () => {
  if (document.querySelector("#form-body .tile.busy")) { toast("Wait for the upload to finish."); return; } // leaving mid-upload would show the photo missing and invite a second one
  await flushSave(); await loadHome();
});
$("btn-complete").onclick = () => {
  const { type, item } = App.cur;
  if (document.querySelector("#form-body .tile.busy")) { toast("Wait for the upload to finish."); return; }
  const missing = missingFor(type, item);
  if (missing.length) { toast("Still needed: " + missing.slice(0, 4).join(", ") + (missing.length > 4 ? ` and ${missing.length - 4} more` : "")); return; }
  // the PDF is shown first; nothing is filed until "Complete pre-onboarding" on that page
  busyBtn($("btn-complete"), "Preparing preview…", async () => { await flushSave(); showPreview(type, item, await api("preview", { type, id: item.id })); });
};
async function finish(type, item) { // files the PDF and marks the check done
  await flushSave();
  const r = await api("complete", { type, id: item.id });
  toast(r.mailError ? "Completed and saved to Drive, but the copy to the ops inbox did not go out: " + r.mailError : "Completed. PDF saved to Drive.");
  await openDetail(type, item.id);
}
let previewFrom = 0; // where the form was scrolled to, for Back
function showPreview(type, item, r) { // the PDF's own page, to read through before it is filed; Back returns to the form untouched
  previewFrom = window.scrollY;
  show("scr-preview");
  $("preview-sub").textContent = `${item.kitchen} · ${item.brand}`;
  $("preview-note").textContent = `This is the PDF report. "Complete pre-onboarding" files it in the kitchen's Drive folder${r.cc ? " and emails a copy to " + r.cc : ""}. Nothing goes to the licensee.`;
  const host = el("div", { class: "paper" }); // a shadow root keeps the report's own styles inside it
  host.attachShadow({ mode: "open" }).innerHTML = r.html.replace("body {", ":host { font-size: 13px !important; ");
  $("preview-paper").replaceChildren(host);
}
$("preview-back").onclick = () => { show("scr-form"); window.scrollTo(0, previewFrom); };
$("btn-send").onclick = () => { const { type, item } = App.cur; busyBtn($("btn-send"), "Generating PDF…", () => finish(type, item)); };

/* ---------- record ---------- */
function display(f, v) {
  if (v == null || v === "") return "—";
  if (f.type === "yesno") return v === "Y" ? "Yes" : v === "N" ? "No" : String(v);
  if (f.type === "date") return fmtDate(String(v));
  return String(v);
}
async function openDetail(type, id) {
  show("scr-detail");
  const body = $("detail-body"); body.replaceChildren(el("p", { class: "empty" }, "Loading…"));
  const { item } = await api("get", { type, id });
  const done = item.status === "done";
  $("detail-title").textContent = `${item.kitchen} · ${item.brand}`;
  $("detail-sub").textContent = `${formTitle(type)} · ${item.site} ${siteName(item.site)} · ${fmtDate(item.date)} · ${item.by}` + (item.access_date ? ` · access ${fmtDate(item.access_date)}` : "");
  body.replaceChildren();
  const actions = el("div", { class: "actions" });
  if (!done) actions.append(el("button", { class: "btn primary", type: "button", onclick: () => guard(() => resumeForm(type, id)) }, "Continue pre-onboarding"));
  if (item.pdf) actions.append(el("a", { class: "btn dark", href: item.pdf, target: "_blank", rel: "noopener" }, "Open PDF"));
  if (done && !item.source) actions.append(el("button", { class: "btn ghost", type: "button", onclick: ev => { // a check imported from AppSheet stays as it was
    if (!sure(ev.currentTarget, "Tap again to reopen it: the PDF is replaced when it is completed again")) return;
    guard(async () => { await api("reopen", { type, id }); await resumeForm(type, id); });
  } }, "Reopen to correct it"));
  if (item.source) actions.append(el("p", { class: "muted small" }, "Recorded in the old AppSheet app; shown as it was filed there."));
  body.append(actions);
  const bad = notReady(type, item);
  body.append(el("section", { class: "card" }, el("h2", {}, "Not ready yet"), bad.length ? el("ul", { class: "bad" }, bad.map(b => el("li", {}, badLine(b)))) : el("p", { class: "muted" }, "Everything checked was ready.")));
  App.meta.forms[type].sections.forEach(sec => {
    const card = el("section", { class: "card" }, el("h2", {}, sec.title));
    const fs = sec.fields.filter(f => activeField(f, item) || (item[f.key] != null && String(item[f.key]).trim() !== ""));
    const rows = fs.filter(f => !isMedia(f)), pics = fs.filter(f => isMedia(f) && links(item[f.key]).length); // an empty photo field is not worth a tile
    if (!rows.length && !pics.length) return;
    if (rows.length) card.append(el("dl", {}, rows.map(f => [el("dt", {}, f.label), el("dd", { class: f.type === "yesno" && item[f.key] === "N" ? "no" : "" }, display(f, item[f.key]))])));
    if (pics.length) {
      const g = el("div", { class: "grid" });
      pics.forEach(f => {
        const urls = links(item[f.key]), n = urls.length, has = n && refOf(urls[0]), isVid = f.type === "video";
        const img = el("img", { alt: f.label, hidden: true });
        if (has && !isVid) showDriveImage(img, urls[0]);
        g.append(el("figure", { onclick: () => { if (has) gallery(f.label, urls, isVid); } },
          el("div", { class: "tile-img" + (isVid ? " video" : "") }, img, isVid ? el("span", { class: "tile-icon" }, "🎥") : has ? null : el("span", { class: "muted small" }, "not available"), n > 1 ? el("span", { class: "count" }, String(n)) : null),
          el("figcaption", {}, f.label)));
      });
      card.append(g);
    }
    body.append(card);
  });
  if (!done) body.append(discardBtn(type, item));
}
$("detail-back").onclick = () => guard(loadHome);

/* ---------- boot ---------- */
(async () => {
  if (!API_URL) $("demo-banner").hidden = false;
  // the demo and the real app share this origin's storage: switching between them starts clean, so demo rows never paint over real ones
  const mode = API_URL ? "live" : "demo";
  if (localStorage.getItem("kp.mode") !== mode) {
    Object.keys(localStorage).filter(k => k.startsWith("kp.") && k !== "kp.api").forEach(k => localStorage.removeItem(k));
    localStorage.setItem("kp.mode", mode);
  }
  // deep link (e.g. from a CrewBASE card): open the New screen pre-filled once logged in
  const q = new URLSearchParams(location.search);
  if (q.get("new")) { App.deepLink = { site: q.get("site"), kitchen: q.get("kitchen"), brand: q.get("brand"), access: q.get("access"), date: q.get("date") }; history.replaceState(null, "", location.pathname + (q.get("demo") ? "?demo=1" : "")); }
  if (session.token) { // stays signed in until Lock is tapped or the server session ends
    try { await enterApp(); return; }
    catch (e) {
      if (e.auth) session.clear();                 // the server no longer knows this session: sign in again
      else { toast(e.message); if (App.meta) return; } // a network blip: keep the session and whatever is on screen
    }
  }
  guard(loadLogin);
})();
