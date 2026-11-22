/* Lärandemålsbiblioteket för BV5: del 1 (modul 1–8) och del 2 (modul 9–12).
   Del 1 kommer från data/bibliotek-index.json (samma innehåll som det tidigare biblioteket),
   del 2 från data/bibliotek-del2.json (byggt av scripts/del2/build_library.py). */

import { esc, setTitle, on } from "../ui/dom.js";
import { renderMarkdown, renderPlainSummary } from "../core/markdown.js";

let del2Promise = null;
function loadDel2(ctx) {
  if (!del2Promise) {
    del2Promise = ctx.store.fetchJson("data/bibliotek-del2.json").catch((err) => {
      del2Promise = null;
      throw err;
    });
  }
  return del2Promise;
}

const DEL1_MODULES = [1, 2, 3, 4, 5, 6, 7, 8];
const DEL2_MODULES = [9, 10, 11, 12];

/** Gemensam modell över båda delarna: moduler, mål i ordning, teman (del 1) och tentafrågor (del 2). */
async function model(ctx) {
  const idx = ctx.store.library?.index || { modules: [], themes: [] };
  let d2 = null;
  try {
    d2 = await loadDel2(ctx);
  } catch {
    d2 = null;
  }
  const modules = new Map();
  for (const m of idx.modules || []) {
    if (!DEL1_MODULES.includes(m.nr)) continue;
    modules.set(m.nr, { ...m, del: 1, format: "plain" });
  }
  for (const nr of DEL1_MODULES) if (!modules.has(nr)) modules.set(nr, { nr, titel: nr === 8 ? "Andning" : `Modul ${nr}`, submoduler: [], del: 1, format: "plain" });
  for (const m of d2?.modules || []) modules.set(m.nr, { ...m, del: 2, format: "md" });
  for (const nr of DEL2_MODULES) if (!modules.has(nr)) modules.set(nr, { nr, titel: `Modul ${nr}`, submoduler: [], del: 2, format: "md" });

  const objectives = [];
  const byId = new Map();
  for (const m of [...modules.values()].sort((a, b) => a.nr - b.nr)) {
    for (const s of m.submoduler || []) {
      for (const o of s.mal || []) {
        const item = { ...o, modul: m.nr, modul_titel: m.titel, sub: s.nr, sub_titel: s.titel, del: m.del, format: m.format };
        objectives.push(item);
        byId.set(o.id, item);
      }
    }
  }
  const themesByObjective = new Map();
  for (const t of idx.themes || []) {
    if (!t.objective_id) continue;
    if (!themesByObjective.has(t.objective_id)) themesByObjective.set(t.objective_id, []);
    themesByObjective.get(t.objective_id).push(t);
  }
  return { modules, objectives, byId, themesByObjective, d2 };
}

function countQuestions(m, M) {
  let n = 0;
  for (const s of m.submoduler || []) for (const o of s.mal || []) n += M.byId.get(o.id)?.antal_fragor || 0;
  return n;
}
function countObjectives(m) {
  return (m.submoduler || []).reduce((n, s) => n + (s.mal || []).length, 0);
}

function crumbs(parts) {
  return `<nav class="lib-crumbs" aria-label="Var du är">${parts
    .map(([label, href], i) => (href && i < parts.length - 1 ? `<a href="${href}">${esc(label)}</a>` : `<span>${esc(label)}</span>`))
    .join('<span class="sep">›</span>')}</nav>`;
}

function searchBox(value = "") {
  return `<form class="lib-search" data-act="search" role="search">
    <input type="search" name="q" value="${esc(value)}" placeholder="Sök lärandemål, begrepp eller läkemedel …" aria-label="Sök i biblioteket" autocomplete="off">
    <button class="btn primary" type="submit">Sök</button></form>`;
}

/* ---------- startsida ---------- */
function overview(M, del) {
  const nrs = del === 2 ? DEL2_MODULES : DEL1_MODULES;
  const cards = nrs
    .map((nr) => {
      const m = M.modules.get(nr);
      const no = countObjectives(m);
      const nq = countQuestions(m, M);
      return `<a class="card lib-mod ${no ? "" : "empty"}" href="#/bibliotek/modul/${nr}">
        <span class="lib-mod-nr">Modul ${nr}</span>
        <span class="lib-mod-title">${esc(m.titel)}</span>
        <span class="lib-mod-meta">${no ? `${no} lärandemål${nq ? ` · ${nq} tentafrågor` : ""}` : "Innehåll saknas än"}</span>
      </a>`;
    })
    .join("");
  return `<section class="lib">
    <header class="lib-head">
      <p class="welcome-kicker">BV5 · Basvetenskap 5</p>
      <h1>Lärandemålsbibliotek</h1>
      <p class="muted">Nedbrutna lärandemål med sammanfattningar och kopplade tentafrågor för hela kursen.</p>
      ${searchBox()}
    </header>
    <div class="tabs" role="tablist">
      <button role="tab" data-del="1" aria-selected="${del === 1}">Del 1 <span class="count">modul 1–8</span></button>
      <button role="tab" data-del="2" aria-selected="${del === 2}">Del 2 <span class="count">modul 9–12</span></button>
    </div>
    ${del === 2 ? `<p class="small muted lib-note">Del 2 – Tillämpning och integrering. Tentan har 10 flervalsfrågor och 8 essäpoäng per modul (max 72, godkänt 48).</p>` : ""}
    <div class="grid cols-2 lib-grid">${cards}</div>
  </section>`;
}

/* ---------- modulsida ---------- */
function modulePage(M, nr) {
  const m = M.modules.get(nr);
  if (!m) return notFound();
  const subs = (m.submoduler || [])
    .map(
      (s) => `<section class="card lib-sub">
        <h2><span class="muted">${esc(String(s.id || `${m.nr}.${s.nr}`))}</span> ${esc(s.titel)}</h2>
        <ol class="lib-objlist">${(s.mal || [])
          .map((o) => {
            const n = M.byId.get(o.id)?.antal_fragor || 0;
            return `<li><a href="#/bibliotek/${encodeURIComponent(o.id)}"><span class="lib-id">${esc(o.id)}</span><span class="lib-otitle">${esc(o.titel)}</span>${
              n ? `<span class="chip accent">${n} frågor</span>` : ""
            }</a></li>`;
          })
          .join("")}</ol>
      </section>`
    )
    .join("");
  return `<section class="lib">
    ${crumbs([["Bibliotek", `#/bibliotek?del=${m.del}`], [`Del ${m.del}`, `#/bibliotek?del=${m.del}`], [`Modul ${m.nr}`, null]])}
    <h1 class="lib-title">Modul ${m.nr} · ${esc(m.titel)}</h1>
    ${m.beskrivning ? `<p class="lib-lead">${esc(m.beskrivning)}</p>` : ""}
    ${subs || `<div class="card"><p>Innehållet för den här modulen är inte inlagt än.</p></div>`}
  </section>`;
}

/* ---------- målsida ---------- */
function questionsHtml(M, o) {
  const ids = M.d2?.questions_by_objective?.[o.id] || [];
  if (!ids.length) return "";
  const items = ids
    .map((id) => M.d2.fragor[id])
    .filter(Boolean)
    .map((q, i) => {
      const opts = (q.alternativ || []).length
        ? `<ol class="lib-q-opts" type="A">${q.alternativ.map((a, k) => `<li class="${q.ratt.includes(k) ? "right" : ""}">${esc(a)}</li>`).join("")}</ol>`
        : "";
      const answer = q.typ === "essay"
        ? q.svar
          ? `<div class="lib-q-answer"><b>Svarsförslag från tentan</b><pre>${esc(q.svar)}</pre></div>`
          : `<div class="lib-q-answer"><span class="muted">Inget officiellt svarsförslag finns för den här tentan – använd sammanfattningen ovan.</span></div>`
        : "";
      return `<details class="lib-q">
        <summary><span class="chip ${q.typ === "essay" ? "teal" : ""}">${q.typ === "essay" ? `Essä ${q.poang ?? ""} p` : "SBA"}</span>
          <span class="lib-q-src">${esc(q.tenta)} – fråga ${q.nr}</span><span class="lib-q-stem">${esc(q.fraga)}</span></summary>
        <div class="lib-q-body ${q.typ === "essay" ? "" : "mcq"}">${opts}${answer}
          ${q.typ === "essay" ? "" : `<button class="btn small" type="button" data-act="reveal">Visa rätt svar</button>`}</div>
      </details>`;
    })
    .join("");
  return `<section class="card lib-questions"><h2>Tentafrågor på det här målet <span class="count muted">(${ids.length})</span></h2>
    <p class="small muted">Från gamla del 2-tentor. Tryck på en fråga för att se alternativen och sedan rätt svar.</p>${items}</section>`;
}

function themesHtml(M, o) {
  const list = M.themesByObjective.get(o.id) || [];
  if (!list.length) return "";
  return `<section class="card lib-themes"><h2>Tentateman</h2>${list
    .map(
      (t) => `<details class="lib-theme" ${list.length === 1 ? "open" : ""}><summary><b>${esc(t.tema)}</b>${
        t.antal_fragor ? ` <span class="chip accent">${t.antal_fragor} frågor</span>` : ""
      }<span class="small muted lib-theme-desc">${esc(t.beskrivning || "")}</span></summary>
        <div class="lib-theme-body">${t.fordjupning_html || ""}</div></details>`
    )
    .join("")}</section>`;
}

function objectivePage(M, id) {
  const o = M.byId.get(id);
  if (!o) return notFound();
  const i = M.objectives.indexOf(o);
  const prev = M.objectives[i - 1];
  const next = M.objectives[i + 1];
  const { html, toc } = o.format === "md" ? renderMarkdown(o.sammanfattning) : renderPlainSummary(o.sammanfattning);
  return `<article class="lib lib-article">
    ${crumbs([["Bibliotek", `#/bibliotek?del=${o.del}`], [`Modul ${o.modul}`, `#/bibliotek/modul/${o.modul}`], [o.id, null]])}
    <p class="welcome-kicker">Modul ${o.modul} · ${esc(o.modul_titel)} · ${esc(o.sub_titel)}</p>
    <h1 class="lib-title"><span class="lib-id big">${esc(o.id)}</span> ${esc(o.titel)}</h1>
    ${o.antal_fragor ? `<p><span class="chip accent">${o.antal_fragor} tentafrågor kopplade</span></p>` : ""}
    ${(o.delmal || []).length ? `<section class="card lib-goals"><h2>Du ska kunna</h2><ul>${o.delmal.map((d) => `<li>${esc(d)}</li>`).join("")}</ul></section>` : ""}
    ${toc.length > 3 ? `<nav class="lib-toc card flat" aria-label="Innehåll"><b>Innehåll</b><ol>${toc.map((t) => `<li><a href="#" data-jump="${esc(t.id)}">${esc(t.text)}</a></li>`).join("")}</ol></nav>` : ""}
    <section class="lib-text">${html || `<p class="muted">Sammanfattningen är inte skriven än.</p>`}</section>
    ${themesHtml(M, o)}
    ${questionsHtml(M, o)}
    <nav class="lib-pager">
      ${prev ? `<a class="btn" href="#/bibliotek/${encodeURIComponent(prev.id)}">← ${esc(prev.id)} ${esc(prev.titel)}</a>` : "<span></span>"}
      ${next ? `<a class="btn" href="#/bibliotek/${encodeURIComponent(next.id)}">${esc(next.id)} ${esc(next.titel)} →</a>` : "<span></span>"}
    </nav>
  </article>`;
}

/* ---------- sök ---------- */
function norm(s) {
  return String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
}
function searchPage(M, q) {
  const terms = norm(q).split(/\s+/).filter((t) => t.length > 1);
  const scored = [];
  for (const o of M.objectives) {
    const title = norm(`${o.id} ${o.titel}`);
    const goals = norm((o.delmal || []).join(" "));
    const text = norm(o.sammanfattning);
    let score = 0;
    let all = true;
    for (const t of terms) {
      const s = (title.includes(t) ? 8 : 0) + (goals.includes(t) ? 3 : 0) + Math.min(5, text.split(t).length - 1);
      if (!s) all = false;
      score += s;
    }
    if (score && all) {
      const pos = text.indexOf(terms[0] || "");
      const raw = String(o.sammanfattning || "").replace(/[#*|`]/g, " ");
      const snippet = pos >= 0 ? raw.slice(Math.max(0, pos - 70), pos + 160).replace(/\s+/g, " ") : "";
      scored.push({ o, score, snippet });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return `<section class="lib">
    ${crumbs([["Bibliotek", "#/bibliotek"], ["Sök", null]])}
    <h1 class="lib-title">Sökresultat</h1>
    ${searchBox(q)}
    <p class="muted">${scored.length ? `${scored.length} lärandemål matchar "${esc(q)}".` : `Inga lärandemål matchar "${esc(q)}".`}</p>
    <ol class="lib-results">${scored
      .slice(0, 40)
      .map(
        ({ o, snippet }) => `<li class="card flat"><a href="#/bibliotek/${encodeURIComponent(o.id)}"><span class="lib-id">${esc(o.id)}</span> <b>${esc(o.titel)}</b></a>
          <div class="small muted">Del ${o.del} · Modul ${o.modul} ${esc(o.modul_titel)}</div>${snippet ? `<p class="small">…${esc(snippet)}…</p>` : ""}</li>`
      )
      .join("")}</ol>
  </section>`;
}

function notFound() {
  return `<section class="lib"><div class="card"><h2>Hittades inte</h2><p>Det lärandemålet finns inte i biblioteket.</p><a class="btn primary" href="#/bibliotek">Till biblioteket</a></div></section>`;
}

/* ---------- vy ---------- */
export async function libraryView(ctx, root, route) {
  root.innerHTML = `<div class="loading-screen"><div><span class="spinner"></span><p>Öppnar biblioteket …</p></div></div>`;
  const M = await model(ctx);
  const p = route.parts || [];
  const q = route.query || {};
  let html;
  if (q.q) {
    setTitle(`Sök: ${q.q} – Bibliotek`);
    html = searchPage(M, q.q);
  } else if (p[0] === "modul" && p[1]) {
    const nr = Number(p[1]);
    setTitle(`Modul ${nr} – Bibliotek`);
    html = modulePage(M, nr);
  } else if (p[0]) {
    setTitle(`${p[0]} – Bibliotek`);
    html = objectivePage(M, p[0]);
  } else {
    let del = Number(q.del) || 0;
    if (!del) {
      try {
        del = Number(localStorage.getItem("bv5.lib.del")) || 1;
      } catch {
        del = 1;
      }
    }
    setTitle("Bibliotek");
    html = overview(M, del === 2 ? 2 : 1);
  }
  root.innerHTML = html;
  if (!M.d2 && !p[0] && Number(q.del) === 2) root.insertAdjacentHTML("afterbegin", `<div class="notice">Del 2-biblioteket kunde inte laddas. Kontrollera nätet och ladda om.</div>`);

  const offs = [
    on(root, "submit", "[data-act=search]", (e, form) => {
      e.preventDefault();
      const v = form.q.value.trim();
      if (v) ctx.go(`#/bibliotek?q=${encodeURIComponent(v)}`);
    }),
    on(root, "click", "[data-del]", (e, el) => {
      try {
        localStorage.setItem("bv5.lib.del", el.dataset.del);
      } catch {
        /* bara bekvämlighet */
      }
      ctx.go(`#/bibliotek?del=${el.dataset.del}`);
    }),
    on(root, "click", "[data-act=reveal]", (e, el) => {
      el.closest(".lib-q-body").classList.add("revealed");
      el.remove();
    }),
    on(root, "click", "[data-jump]", (e, el) => {
      e.preventDefault();
      document.getElementById(el.dataset.jump)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }),
  ];
  return () => offs.forEach((off) => typeof off === "function" && off());
}
