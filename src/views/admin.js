/* Adminpanel: översikt, ansökningar, användare, delningslänkar, tentor, inställningar och diagnostik. */

import { esc, on, toast, modal, setTitle, confirmDialog, download } from "../ui/dom.js";
import { formatDate, formatDateTime } from "../core/text.js";
import { runDiagnostics } from "../diagnostics.js";

const TABS = [
  ["oversikt", "Översikt"],
  ["ansokningar", "Ansökningar"],
  ["anvandare", "Användare"],
  ["lankar", "Delningslänkar"],
  ["tentor", "Tentor"],
  ["installningar", "Inställningar"],
  ["diagnostik", "Systemdiagnostik"],
];
const CLOUD_TABS = new Set(["ansokningar", "anvandare", "lankar"]);

const STATUS_CHIP = {
  active: ["ok", "Aktiv"], pending: ["warn", "Väntar"], paused: ["warn", "Pausad"],
  revoked: ["err", "Återkallad"], expired: ["err", "Utgången"],
};

function effectiveStatus(p) {
  if (p.role === "superadmin") return "active";
  if (p.access_status === "active" && p.access_expires_at && new Date(p.access_expires_at) <= new Date()) return "expired";
  return p.access_status;
}

function appBase() {
  return `${location.origin}${location.pathname}`;
}

export async function adminView(ctx, root, params) {
  const { store, cloud, auth } = ctx;
  if (!auth.isAdmin()) {
    root.innerHTML = `<div class="empty"><p>Den här sidan är bara för administratörer.</p></div>`;
    return;
  }
  const tab = TABS.some(([k]) => k === params.tab) ? params.tab : "oversikt";
  setTitle("Admin");
  root.innerHTML = `
    <div class="page-head"><div><h1>Admin</h1><p class="lead">${cloud.enabled ? `Molnläge · inloggad som ${esc(auth.profile?.email || "")} (${esc(auth.profile?.role || "")})` : "Lokalt läge · all data finns på den här datorn. Koppla Supabase i config.js för konton och ansökningar."}</p></div></div>
    <div class="tabs" role="tablist">${TABS.map(([k, label]) => `<button role="tab" aria-selected="${k === tab}" data-tab="${k}">${label}</button>`).join("")}</div>
    <div id="admin-body"><div class="skeleton" style="height:120px"></div></div>`;
  const body = root.querySelector("#admin-body");
  const offs = [on(root, "click", "[data-tab]", (e, el) => ctx.go(`#/admin/${el.dataset.tab}`))];

  if (CLOUD_TABS.has(tab) && !cloud.enabled) {
    body.innerHTML = `<div class="card"><h2>Kräver molnläge</h2><p>Ansökningar, användare och delningslänkar hanteras i Supabase. Följ installationsguiden (avsnitt "Supabase") och fyll i <span class="mono">SUPABASE_URL</span> och <span class="mono">SUPABASE_ANON_KEY</span> i <span class="mono">config.js</span>.</p></div>`;
    return () => offs.forEach((f) => f());
  }

  try {
    if (tab === "oversikt") await overview(ctx, body, offs);
    else if (tab === "ansokningar") await applications(ctx, body, offs);
    else if (tab === "anvandare") await users(ctx, body, offs);
    else if (tab === "lankar") await links(ctx, body, offs);
    else if (tab === "tentor") await exams(ctx, body, offs);
    else if (tab === "installningar") await settings(ctx, body, offs);
    else if (tab === "diagnostik") await diagnostics(ctx, body, offs);
  } catch (err) {
    body.innerHTML = `<div class="notice err">Kunde inte läsa data: ${esc(err.message)}</div>`;
  }
  return () => offs.forEach((f) => f());
}

/* ---------- översikt ---------- */
async function overview(ctx, body, offs) {
  const { store, cloud, sync } = ctx;
  const outbox = await store.outbox();
  const seed = await store.getMeta("seed");
  const attempts = await store.listAttempts();
  let cloudInfo = "";
  if (cloud.enabled) {
    try {
      const [pending, profiles] = await Promise.all([
        cloud.select("applications", "status=eq.pending&select=id"),
        cloud.select("profiles", "select=id,access_status,access_expires_at,role"),
      ]);
      const active = profiles.filter((p) => effectiveStatus(p) === "active").length;
      cloudInfo = `<div class="card stat"><div class="label">Väntande ansökningar</div><div class="value">${pending.length}</div><div class="sub"><a href="#/admin/ansokningar">Hantera</a></div></div>
        <div class="card stat"><div class="label">Aktiva användare</div><div class="value">${active}</div><div class="sub">av ${profiles.length} konton</div></div>`;
    } catch (err) {
      cloudInfo = `<div class="notice err">Molnet svarar inte: ${esc(err.message)}</div>`;
    }
  }
  body.innerHTML = `
    <div class="grid cols-4">
      <div class="card stat"><div class="label">Tentor</div><div class="value">${store.exams.size}</div><div class="sub">${store.listExams().length} publicerade</div></div>
      <div class="card stat"><div class="label">Frågor</div><div class="value">${store.questions.size.toLocaleString("sv-SE")}</div><div class="sub">bibliotekets bygge ${esc(store.libraryBuild || "–")}</div></div>
      ${cloudInfo || `<div class="card stat"><div class="label">Försök på enheten</div><div class="value">${attempts.length}</div></div>`}
      <div class="card stat"><div class="label">Osynkat</div><div class="value">${outbox.length}</div><div class="sub">${cloud.enabled ? (sync.lastSync ? `senast ${formatDateTime(sync.lastSync)}` : "inte synkat ännu") : "lokalt läge"}</div></div>
    </div>
    <div class="card" style="margin-top:16px">
      <h2>Datakällor</h2>
      <table class="table"><tbody>
        <tr><td>Kursbiblioteket</td><td><a href="${esc(store.library.base)}" target="_blank" rel="noopener">${esc(store.library.base)}</a> · ${store.library.objectives.size} lärandemål · ${store.library.themes.size} teman</td></tr>
        <tr><td>Frågebanken</td><td>${seed ? `${seed.counts?.exams} tentor, ${seed.counts?.questions} frågor, ${seed.counts?.mapped_to_objective} kopplade till lärandemål` : "–"}</td></tr>
        <tr><td>Molnet</td><td>${cloud.enabled ? `${esc(cloud.url)} ${sync.lastError ? `<span class="chip err">${esc(sync.lastError.message)}</span>` : `<span class="chip ok">OK</span>`}` : "Inte konfigurerat (lokalt läge)"}</td></tr>
      </tbody></table>
      ${cloud.enabled ? `<div class="btn-row" style="margin-top:12px"><button class="btn" data-act="sync">Synka nu</button></div>` : ""}
    </div>`;
  offs.push(on(body, "click", "[data-act=sync]", async (e, el) => {
    el.disabled = true;
    const r = await sync.flush();
    toast(r.skipped ? "Synk pågår redan eller är inte möjlig just nu." : `Synkat: ${r.pushed} skickade${r.failed ? `, ${r.failed} misslyckades` : ""}.`, r.failed ? "err" : "ok");
    el.disabled = false;
  }));
}

/* ---------- ansökningar ---------- */
function durationBody(isSuper) {
  const d = new Date(Date.now() + 120 * 864e5).toISOString().slice(0, 10);
  return `<div class="field"><label for="dur">Giltighetstid</label><select id="dur">
      <option value="30d">30 dagar</option><option value="90d" selected>90 dagar</option><option value="term">Hela terminen</option>
      <option value="date">Specifikt slutdatum</option>${isSuper ? `<option value="lifetime">Ingen slutdag</option>` : ""}</select></div>
    <div class="field" id="date-field" hidden><label for="until">Slutdatum</label><input type="date" id="until" value="${d}" min="${new Date().toISOString().slice(0, 10)}"></div>
    <p class="small muted">Ett bekräftelsemejl med inloggningslänk och giltighetstid skickas automatiskt.</p>`;
}
function bindDuration(d) {
  const sel = d.querySelector("#dur");
  sel.addEventListener("change", () => { d.querySelector("#date-field").hidden = sel.value !== "date"; });
}
function readDuration(d) {
  const duration = d.querySelector("#dur").value;
  let until = null;
  if (duration === "date") {
    const v = d.querySelector("#until").value;
    if (!v) throw new Error("Välj ett slutdatum");
    until = new Date(`${v}T23:59:59`).toISOString();
  }
  return { duration, until };
}

async function applications(ctx, body, offs) {
  const { cloud, auth } = ctx;
  const rows = await cloud.select("applications", "select=*&order=created_at.desc&limit=200");
  const pending = rows.filter((r) => r.status === "pending");
  const decided = rows.filter((r) => r.status !== "pending").slice(0, 50);
  const row = (a, actions) => `<tr><td><b>${esc(a.first_name)} ${esc(a.last_name)}</b><div class="small muted">${esc(a.email)}</div></td><td>${esc(a.termin)}</td><td>${formatDateTime(a.created_at)}</td><td>${actions}</td></tr>`;
  body.innerHTML = `
    <div class="card"><h2>Väntar på beslut <span class="chip">${pending.length}</span></h2>
      ${pending.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Namn</th><th>Termin</th><th>Ansökt</th><th></th></tr></thead><tbody>
        ${pending.map((a) => row(a, `<div class="btn-row"><button class="btn small primary" data-approve="${a.id}">Godkänn</button><button class="btn small danger" data-deny="${a.id}">Neka</button></div>`)).join("")}
      </tbody></table></div>` : `<p class="muted">Inga nya ansökningar.</p>`}
    </div>
    <div class="card"><h2>Senast behandlade</h2>
      ${decided.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Namn</th><th>Termin</th><th>Ansökt</th><th>Beslut</th></tr></thead><tbody>
        ${decided.map((a) => row(a, `${a.status === "approved" ? `<span class="chip ok">Godkänd</span> <span class="small muted">${a.expires_at ? `t.o.m. ${formatDate(a.expires_at)}` : "ingen slutdag"}</span>` : `<span class="chip err">Nekad</span>`}`)).join("")}
      </tbody></table></div>` : `<p class="muted">Inget ännu.</p>`}
    </div>`;
  offs.push(on(body, "click", "[data-approve]", async (e, el) => {
    const a = rows.find((r) => r.id === el.dataset.approve);
    const res = await modal({
      title: `Godkänn ${a.first_name} ${a.last_name}`,
      body: durationBody(auth.isSuperadmin()),
      onOpen: bindDuration,
      actions: [{ label: "Avbryt", value: null }, { label: "Godkänn och skicka mejl", value: "ok", kind: "primary" }],
      onSubmit: async (v, d) => {
        const { duration, until } = readDuration(d);
        return cloud.fn("approve-application", { application_id: a.id, duration, until });
      },
    });
    if (res) {
      toast(res.email_sent ? `Godkänd – mejl skickat till ${a.email}.` : `Godkänd, men mejlet kunde inte skickas: ${res.email_error || "okänt fel"}`, res.email_sent ? "ok" : "err", 7000);
      ctx.render();
    }
  }));
  offs.push(on(body, "click", "[data-deny]", async (e, el) => {
    const a = rows.find((r) => r.id === el.dataset.deny);
    const res = await modal({
      title: `Neka ${a.first_name} ${a.last_name}?`,
      body: `<div class="field"><label for="note">Intern anteckning (valfri)</label><input type="text" id="note"></div>`,
      actions: [{ label: "Avbryt", value: null }, { label: "Neka", value: "ok", kind: "danger" }],
      onSubmit: (v, d) => cloud.rpc("deny_application", { p_application_id: a.id, p_note: d.querySelector("#note").value }),
    });
    if (res) {
      toast("Ansökan nekad.");
      ctx.render();
    }
  }));
}

/* ---------- användare ---------- */
async function users(ctx, body, offs) {
  const { cloud, auth } = ctx;
  const rows = await cloud.select("profiles", "select=*&order=created_at.desc");
  body.innerHTML = `<div class="card"><h2>Användare <span class="chip">${rows.length}</span></h2>
    <div class="field" style="max-width:320px"><input type="search" id="u-q" placeholder="Sök namn eller e-post"></div>
    <div class="table-wrap"><table class="table"><thead><tr><th>Användare</th><th>Termin</th><th>Roll</th><th>Status</th><th>Giltig t.o.m.</th><th></th></tr></thead>
    <tbody id="u-rows">${rows.map((p) => {
      const st = effectiveStatus(p);
      const [cls, label] = STATUS_CHIP[st] || ["", st];
      const self = p.id === auth.profile?.id;
      const acts = p.role === "superadmin" ? `<span class="small muted">Livstid</span>` : `<div class="btn-row">
        ${st === "active" ? `<button class="btn small" data-ua="pause" data-id="${p.id}">Pausa</button>` : ""}
        ${st === "paused" ? `<button class="btn small" data-ua="resume" data-id="${p.id}">Återuppta</button>` : ""}
        <button class="btn small" data-ua="extend" data-id="${p.id}">${st === "expired" || st === "revoked" ? "Ge åtkomst" : "Förläng"}</button>
        ${st !== "revoked" ? `<button class="btn small danger" data-ua="revoke" data-id="${p.id}">Återkalla</button>` : ""}
        ${auth.isSuperadmin() && !self ? `<button class="btn small ghost" data-role="${p.role === "admin" ? "student" : "admin"}" data-id="${p.id}">${p.role === "admin" ? "Gör till student" : "Gör till admin"}</button>` : ""}
      </div>`;
      return `<tr data-search="${esc(`${p.first_name} ${p.last_name} ${p.email}`.toLowerCase())}"><td><b>${esc(`${p.first_name} ${p.last_name}`.trim() || "–")}</b><div class="small muted">${esc(p.email)}</div></td>
        <td>${esc(p.termin || "–")}</td><td>${esc(p.role)}</td><td><span class="chip ${cls}">${label}</span></td>
        <td>${p.role === "superadmin" ? "–" : p.access_expires_at ? formatDate(p.access_expires_at) : "Ingen slutdag"}</td><td>${acts}</td></tr>`;
    }).join("")}</tbody></table></div></div>`;
  offs.push(on(body, "input", "#u-q", (e, el) => {
    const q = el.value.trim().toLowerCase();
    for (const tr of body.querySelectorAll("#u-rows tr")) tr.hidden = q && !tr.dataset.search.includes(q);
  }));
  offs.push(on(body, "click", "[data-ua]", async (e, el) => {
    const p = rows.find((r) => r.id === el.dataset.id);
    const act = el.dataset.ua;
    try {
      if (act === "extend") {
        const res = await modal({
          title: `Giltighetstid för ${p.email}`,
          body: durationBody(false).replace("Ett bekräftelsemejl med inloggningslänk och giltighetstid skickas automatiskt.", "Kontot aktiveras direkt till det nya slutdatumet."),
          onOpen: bindDuration,
          actions: [{ label: "Avbryt", value: null }, { label: "Spara", value: "ok", kind: "primary" }],
          onSubmit: async (v, d) => {
            const { duration, until } = readDuration(d);
            const days = { "30d": 30, "90d": 90 }[duration];
            let end = until;
            if (days) end = new Date(Date.now() + days * 864e5).toISOString();
            if (duration === "term") end = await cloud.rpc("term_end_after", { ts: new Date().toISOString() });
            return cloud.rpc("set_user_access", { p_user_id: p.id, p_action: "extend", p_until: end });
          },
        });
        if (!res) return;
      } else {
        const words = { pause: ["Pausa åtkomsten?", "Användaren spärras tills du återupptar."], resume: ["Återuppta åtkomsten?", "Användaren får tillgång igen fram till sitt slutdatum."], revoke: ["Återkalla åtkomsten?", "Användaren spärras permanent tills du ger ny åtkomst."] }[act];
        if (!(await confirmDialog(words[0], words[1], "Bekräfta", act === "revoke"))) return;
        await cloud.rpc("set_user_access", { p_user_id: p.id, p_action: act });
      }
      toast("Åtkomsten är uppdaterad.", "ok");
      ctx.render();
    } catch (err) {
      toast(err.message, "err", 7000);
    }
  }));
  offs.push(on(body, "click", "[data-role]", async (e, el) => {
    try {
      await cloud.update("profiles", `id=eq.${el.dataset.id}`, { role: el.dataset.role });
      toast("Rollen är ändrad.", "ok");
      ctx.render();
    } catch (err) {
      toast(err.message, "err", 7000);
    }
  }));
}

/* ---------- delningslänkar ---------- */
async function links(ctx, body, offs) {
  const { cloud } = ctx;
  const rows = await cloud.select("share_links", "select=*&order=created_at.desc");
  const url = (code) => `${appBase()}#/ansok/${encodeURIComponent(code)}`;
  body.innerHTML = `<div class="card"><h2>Delningslänkar</h2>
    <p class="muted small" style="margin-top:-6px">Den som öppnar en länk kommer till ansökningssidan. Inaktivera en länk för att stoppa nya ansökningar via den.</p>
    <form id="new-link" class="btn-row" style="margin-bottom:14px"><input type="text" id="link-label" placeholder="Etikett, t.ex. T3 HT26" style="max-width:280px"><button class="btn primary">Skapa länk</button></form>
    ${rows.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Etikett</th><th>Länk</th><th class="num">Ansökningar</th><th>Status</th><th></th></tr></thead><tbody>
      ${rows.map((l) => `<tr><td>${esc(l.label || "–")}</td><td><span class="mono small">${esc(url(l.code))}</span></td><td class="num">${l.uses}</td>
        <td>${l.active ? `<span class="chip ok">Aktiv</span>` : `<span class="chip">Inaktiv</span>`}</td>
        <td><div class="btn-row"><button class="btn small" data-copy="${esc(url(l.code))}">Kopiera</button><button class="btn small ghost" data-toggle="${esc(l.code)}" data-active="${l.active}">${l.active ? "Inaktivera" : "Aktivera"}</button></div></td></tr>`).join("")}
    </tbody></table></div>` : `<p class="muted">Inga länkar ännu.</p>`}</div>`;
  offs.push(on(body, "submit", "#new-link", async (e) => {
    e.preventDefault();
    try {
      const [l] = await cloud.insert("share_links", [{ label: body.querySelector("#link-label").value.trim(), created_by: ctx.auth.profile.id }]);
      await navigator.clipboard?.writeText(url(l.code)).catch(() => {});
      toast("Länken är skapad och kopierad.", "ok");
      ctx.render();
    } catch (err) {
      toast(err.message, "err");
    }
  }));
  offs.push(on(body, "click", "[data-copy]", async (e, el) => {
    try {
      await navigator.clipboard.writeText(el.dataset.copy);
      toast("Kopierad.");
    } catch {
      prompt("Kopiera länken:", el.dataset.copy);
    }
  }));
  offs.push(on(body, "click", "[data-toggle]", async (e, el) => {
    await cloud.update("share_links", `code=eq.${encodeURIComponent(el.dataset.toggle)}`, { active: el.dataset.active !== "true" });
    ctx.render();
  }));
}

/* ---------- tentor ---------- */
async function exams(ctx, body, offs) {
  const { store, cloud, auth, sync } = ctx;
  const list = store.listExams({ includeDrafts: true });
  body.innerHTML = `
    <div class="card"><div class="page-head" style="margin-bottom:8px"><h2 style="margin:0">Tentor <span class="chip">${list.length}</span></h2>
      <div class="btn-row"><a class="btn primary" href="#/importera">Importera PDF</a>
      ${cloud.enabled && auth.isAdmin() ? `<button class="btn" data-act="publish-bank">Publicera frågebanken till molnet</button>` : ""}</div></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>Tenta</th><th>Källa</th><th class="num">Frågor</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map((e) => `<tr><td><b>${esc(e.code)}</b><div class="small muted">${e.duration_min || "–"} min${e.pass_points != null ? ` · gräns ${e.pass_points} p` : ""}</div></td>
        <td>${e.source === "bibliotek" ? "Kursbiblioteket" : e.source === "pdf" ? `PDF${e.source_file ? ` · <span class="small">${esc(e.source_file)}</span>` : ""}` : "Manuell"}</td>
        <td class="num">${e.question_count || store.examQuestions(e.id).length}</td>
        <td>${e.status === "published" ? `<span class="chip ok">Publicerad</span>` : `<span class="chip warn">Utkast</span>`}</td>
        <td><div class="btn-row">
          <button class="btn small" data-status="${e.status === "published" ? "draft" : "published"}" data-id="${e.id}">${e.status === "published" ? "Avpublicera" : "Publicera"}</button>
          <button class="btn small ghost" data-pass="${e.id}">Gräns</button>
          ${e.source !== "bibliotek" ? `<button class="btn small danger" data-del="${e.id}">Ta bort</button>` : ""}
        </div></td></tr>`).join("")}
      </tbody></table></div>
      <div id="bank-prog" hidden style="margin-top:12px"><div class="progress"><i style="width:0%"></i></div><div class="small muted"></div></div>
    </div>`;
  offs.push(on(body, "click", "[data-status]", async (e, el) => {
    await store.setExamStatus(el.dataset.id, el.dataset.status);
    sync.flush();
    ctx.render();
  }));
  offs.push(on(body, "click", "[data-pass]", async (e, el) => {
    const exam = store.exams.get(el.dataset.pass);
    const res = await modal({
      title: `Godkänt-gräns för ${exam.code}`,
      body: `<div class="field"><label for="pp">Poäng (tomt = ${Math.round(store.settings.pass_ratio * 100)} % av maxpoängen)</label><input type="number" id="pp" min="0" step="0.5" value="${exam.pass_points ?? ""}"></div>
        <div class="field"><label for="dd">Skrivtid (min)</label><input type="number" id="dd" min="10" value="${exam.duration_min || 240}"></div>`,
      actions: [{ label: "Avbryt", value: null }, { label: "Spara", value: "ok", kind: "primary" }],
      onSubmit: (v, d) => ({ pass: d.querySelector("#pp").value, dur: Number(d.querySelector("#dd").value) }),
    });
    if (!res) return;
    const next = { ...exam, pass_points: res.pass === "" ? null : Number(res.pass), duration_min: res.dur || exam.duration_min };
    await store.idb.put("exams", next);
    store.exams.set(exam.id, next);
    await store.enqueue({ kind: "exam", id: exam.id });
    toast("Sparat.", "ok");
    ctx.render();
  }));
  offs.push(on(body, "click", "[data-del]", async (e, el) => {
    const exam = store.exams.get(el.dataset.del);
    if (!(await confirmDialog(`Ta bort ${exam.code}?`, "Tentan och dess frågor tas bort från den här enheten.", "Ta bort", true))) return;
    await store.deleteExam(exam.id);
    if (cloud.enabled) await cloud.update("exams", `id=eq.${exam.id}`, { status: "archived" }).catch(() => {});
    ctx.render();
  }));
  offs.push(on(body, "click", "[data-act=publish-bank]", async (e, el) => {
    if (!(await confirmDialog("Publicera frågebanken?", "Lärandemål, teman och alla publicerade tentor skickas till Supabase så att studenternas svar kan synkas. Det tar någon minut.", "Publicera"))) return;
    el.disabled = true;
    const box = body.querySelector("#bank-prog");
    box.hidden = false;
    try {
      const n = await sync.publishBank((text, done, total) => {
        box.querySelector("i").style.width = `${total ? Math.round((done / total) * 100) : 10}%`;
        box.querySelector("div.small").textContent = text;
      });
      toast(`Frågebanken är publicerad (${n} tentor).`, "ok");
    } catch (err) {
      toast(`Publiceringen misslyckades: ${err.message}`, "err", 9000);
    }
    el.disabled = false;
  }));
}

/* ---------- inställningar ---------- */
async function settings(ctx, body, offs) {
  const { store } = ctx;
  const s = store.settings;
  body.innerHTML = `
    <div class="card"><h2>Studieinställningar</h2>
      <form id="set">
        <div class="field-row">
          <div class="field"><label for="ms">Rätt i rad för "Bemästrad"</label><input type="number" id="ms" min="1" max="10" value="${s.mastery_streak}"></div>
          <div class="field"><label for="pr">Standardgräns för godkänt (%)</label><input type="number" id="pr" min="1" max="100" value="${Math.round(s.pass_ratio * 100)}"></div>
        </div>
        <label class="check"><input type="checkbox" id="cs" ${s.confirm_submit !== false ? "checked" : ""}> Bekräfta innan inlämning</label>
        <div class="btn-row" style="margin-top:14px"><button class="btn primary">Spara</button></div>
      </form>
      ${ctx.cloud.enabled ? `<p class="small muted" style="margin-top:12px">I molnläget gäller "Bemästrad"-regeln i databasen (app_settings.mastery_streak) för synkade svar.</p>` : ""}
    </div>
    <div class="card"><h2>Säkerhetskopia</h2>
      <p class="muted small">Exportera alla försök, svar, träningsstatus och importerade tentor från den här enheten, t.ex. för att flytta till en annan dator i lokalt läge.</p>
      <div class="btn-row"><button class="btn" data-act="export">Exportera säkerhetskopia</button>
      <label class="btn">Importera säkerhetskopia<input type="file" id="imp" accept="application/json,.json" hidden></label></div>
    </div>
    <div class="card"><h2>Återställ</h2>
      <p class="muted small">Raderar all lokal data på den här enheten (försök, träningsstatus, importerade tentor). Frågebanken läses in igen.</p>
      <button class="btn danger" data-act="reset">Radera lokal data</button>
    </div>`;
  offs.push(on(body, "submit", "#set", async (e) => {
    e.preventDefault();
    await store.saveSettings({
      mastery_streak: Math.max(1, Number(body.querySelector("#ms").value) || 3),
      pass_ratio: Math.min(1, Math.max(0.01, (Number(body.querySelector("#pr").value) || 60) / 100)),
      confirm_submit: body.querySelector("#cs").checked,
    });
    if (ctx.cloud.enabled && ctx.auth.isSuperadmin()) {
      await ctx.cloud.upsert("app_settings", [{ key: "mastery_streak", value: store.settings.mastery_streak }, { key: "default_pass_ratio", value: store.settings.pass_ratio }], "key").catch((err) => toast(`Molnet: ${err.message}`, "err"));
    }
    toast("Inställningarna är sparade.", "ok");
  }));
  offs.push(on(body, "click", "[data-act=export]", async () => {
    const data = await store.exportAll();
    download(`bv5-sakerhetskopia-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data), "application/json");
  }));
  offs.push(on(body, "change", "#imp", async (e, el) => {
    try {
      const data = JSON.parse(await el.files[0].text());
      await store.importAll(data);
      toast("Säkerhetskopian är inläst.", "ok");
      ctx.render();
    } catch (err) {
      toast(err.message, "err", 7000);
    }
  }));
  offs.push(on(body, "click", "[data-act=reset]", async () => {
    if (!(await confirmDialog("Radera all lokal data?", "Det går inte att ångra. Synkad data i molnet påverkas inte.", "Radera", true))) return;
    store.idb.close();
    await new Promise((r) => {
      const req = indexedDB.deleteDatabase("bv5-tentasimulator");
      req.onsuccess = req.onerror = req.onblocked = () => r();
    });
    location.reload();
  }));
}

/* ---------- diagnostik ---------- */
async function diagnostics(ctx, body, offs) {
  body.innerHTML = `<div class="card"><div class="page-head" style="margin-bottom:6px"><div><h2 style="margin:0">Systemdiagnostik</h2>
    <p class="muted small" style="margin:4px 0 0">Testar PDF-tolken, rättningsmotorn, bibliotekslänkarna, Anki-exporten och databaserna med en inbyggd demotenta.</p></div>
    <button class="btn primary" data-act="run">Kör alla tester</button></div>
    <table class="table"><tbody id="diag-rows"><tr><td colspan="3" class="muted">Inte körd ännu.</td></tr></tbody></table>
    <div id="diag-sum" style="margin-top:10px"></div></div>`;
  offs.push(on(body, "click", "[data-act=run]", async (e, el) => {
    el.disabled = true;
    const rows = body.querySelector("#diag-rows");
    rows.innerHTML = "";
    const results = await runDiagnostics(ctx, (r) => {
      const ico = r.status === "ok" ? `<span class="ok-ico">✓</span>` : r.status === "skip" ? `<span class="muted">–</span>` : `<span class="err-ico">✕</span>`;
      rows.insertAdjacentHTML("beforeend", `<tr class="diag-row"><td>${ico}</td><td><b>${esc(r.name)}</b><div class="small ${r.status === "fail" ? "" : "muted"}" style="${r.status === "fail" ? "color:var(--err)" : ""}">${esc(r.detail)}</div></td><td class="num small muted">${r.ms} ms</td></tr>`);
    });
    const ok = results.filter((r) => r.status === "ok").length;
    const fail = results.filter((r) => r.status === "fail").length;
    body.querySelector("#diag-sum").innerHTML = `<div class="notice ${fail ? "err" : "ok"}"><b>${ok} av ${results.length} godkända</b>${fail ? ` · ${fail} fel` : ""}${results.some((r) => r.status === "skip") ? ` · ${results.filter((r) => r.status === "skip").length} hoppades över` : ""}</div>`;
    window.__diagnostics = results;
    el.disabled = false;
  }));
}
