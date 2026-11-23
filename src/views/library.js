/* Lärandemålsbiblioteket för BV5: del 1 (modul 1–8, ur prototypen) och del 2 (modul 9–12).
   Rutter:
     #/bibliotek                      översikt (?del=1|2)
     #/bibliotek/modul/N              modul med submoduler och blandat modulquiz
     #/bibliotek/sub/N.S              submodul med slutquiz
     #/bibliotek/<mål-id>             målsida (?ova=1 hoppar till quizen, ?fraga=<id> visar en tentafråga)
     #/bibliotek?q=…                  sök
   Samma identifierare (mål-id, fråge-id) används i simulatorn, tentaanalysen och här. */

import { esc, setTitle, on } from "../ui/dom.js";
import { renderMarkdown, renderPlainSummary, readingMinutes } from "../core/markdown.js";
import { progress } from "../core/progress.js";
import { tokenize } from "../core/text.js";

const HUES = { 1: 265, 2: 200, 3: 160, 4: 25, 5: 330, 6: 290, 7: 45, 8: 190, 9: 175, 10: 38, 11: 335, 12: 355 };
export const hue = (nr) => HUES[nr] ?? 325;
const LETTERS = "ABCDEFGH";
const K_LABELS = { aterg: "Återgivning", mekanism: "Mekanistisk förståelse", jamforelse: "Jämförelse", berakning: "Beräkning", figur_fall: "Figur- eller falltolkning" };
const K_HELP = {
  aterg: "Det räcker ofta att känna igen eller återge ett faktum.",
  mekanism: "Du behöver kunna förklara orsakskedjan – varför något händer.",
  jamforelse: "Du behöver kunna skilja snarlika begrepp åt på de egenskaper som avgör svaret.",
  berakning: "Du behöver kunna räkna med enheter.",
  figur_fall: "Du behöver kunna tolka en figur, ett provsvar eller ett patientfall.",
};

/* ---------- data ---------- */
let cache = null;
export function loadLibrary(ctx) {
  if (!cache) {
    const get = (p) => ctx.store.fetchJson(p).catch(() => null);
    cache = Promise.all([get("data/bibliotek-del1.json"), get("data/bibliotek-del2.json"), get("data/tentaanalys.json")]).then(([d1, d2, ta]) => buildModel(ctx, d1, d2, ta));
    cache.catch(() => (cache = null));
  }
  return cache;
}

function buildModel(ctx, d1, d2, ta) {
  const modules = new Map();
  const objectives = [];
  const byId = new Map();
  const subs = new Map();
  const bilder = { ...(d1?.bilder || {}) };
  const add = (src, del, format) => {
    for (const m of src?.modules || []) {
      const mod = { nr: m.nr, titel: m.titel, beskrivning: m.beskrivning || "", del, submoduler: [] };
      for (const s of m.submoduler || []) {
        const sid = s.id || `${m.nr}.${s.nr}`;
        const sub = { id: sid, nr: s.nr, titel: s.titel, modul: m.nr, del, mal: [] };
        for (const o of s.mal || []) {
          const item = {
            id: o.id, titel: o.titel, delmal: o.delmal || [], modul: m.nr, modul_titel: m.titel, sub: sid, sub_titel: s.titel, del,
            format: o.format || format, body: o.innehall ?? o.sammanfattning ?? "", quiz: o.quiz || [],
          };
          sub.mal.push(item);
          objectives.push(item);
          byId.set(item.id, item);
        }
        mod.submoduler.push(sub);
        subs.set(sid, sub);
      }
      modules.set(m.nr, mod);
    }
  };
  add(d1, 1, "html");
  add(d2, 2, "md");
  if (!d1) {
    // reserv: det äldre indexet (bara text) om del 1-filen inte kunde laddas
    const idx = ctx.store.library?.index;
    if (idx) add({ modules: idx.modules.filter((m) => m.nr <= 8) }, 1, "plain");
  }
  for (const nr of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) if (!modules.has(nr)) modules.set(nr, { nr, titel: `Modul ${nr}`, del: nr <= 8 ? 1 : 2, submoduler: [] });
  objectives.sort((a, b) => cmpId(a.id, b.id));
  return { modules, objectives, byId, subs, bilder, ta, ok: { d1: Boolean(d1), d2: Boolean(d2), ta: Boolean(ta) } };
}

function cmpId(a, b) {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
}

/** Officiella tentafrågor för ett mål, ur frågebanken (samma id:n som simulatorn). */
function examQuestions(ctx, objectiveId) {
  const out = [];
  for (const q of ctx.store.questions.values()) if (q.objective_id === objectiveId && q.status !== "struken") out.push(q);
  const exams = ctx.store.exams;
  return out.sort((a, b) => String(exams.get(a.exam_id)?.code).localeCompare(String(exams.get(b.exam_id)?.code)) || a.number - b.number);
}

function examLabel(ctx, q) {
  const e = ctx.store.exams.get(q.exam_id);
  return `${(e?.code || q.exam_code || "Tenta").replace(/^Del 2 /, "")} · fråga ${q.number}`;
}

/** Quizposter: kursquiz (del 1) eller officiella flervalsfrågor (del 2) – tydligt märkta. */
function quizItems(ctx, o) {
  if (o.quiz?.length) {
    return o.quiz.map((q) => ({ id: q.id, q: q.q, options: q.options, right: [q.svar], forklaring: q.forklaring, kalla: "kursquiz", src: "Kursquiz (prototypens frågebank)", objective: o.id }));
  }
  return examQuestions(ctx, o.id)
    .filter((q) => q.options?.length)
    .map((q) => ({
      id: q.id, q: q.stem.replace(/^Fråga\s+\d+\s*[:.]?\s*/i, ""), options: q.options.map((x) => x.text), right: q.options.filter((x) => x.is_correct).map((x) => x.ordinal),
      forklaring: q.explanation || "", kalla: "tenta", src: `Officiell tentafråga · ${examLabel(ctx, q)}`, objective: o.id,
    }));
}

/* ---------- gemensamma byggblock ---------- */
function crumbs(parts) {
  return `<nav class="lib-crumbs" aria-label="Var du är">${parts
    .map(([label, href], i) => (href && i < parts.length - 1 ? `<a href="${href}">${esc(label)}</a>` : `<span>${esc(label)}</span>`))
    .join('<span class="sep">›</span>')}</nav>`;
}

function searchBox(value = "") {
  return `<form class="lib-search" data-act="search" role="search">
    <input type="search" name="q" value="${esc(value)}" placeholder="Sök lärandemål, begrepp, läkemedel eller figur …" aria-label="Sök i biblioteket" autocomplete="off">
    <button class="btn primary" type="submit">Sök</button></form>`;
}

function understandingDot(id) {
  const s = progress.objectiveStats(id);
  if (!s.answered) return `<span class="u-dot none" title="Inget quiz gjort ännu"></span>`;
  const cls = s.wrong ? "bad" : s.guessed ? "mid" : "good";
  return `<span class="u-dot ${cls}" title="Visad förståelse: ${s.sure} säkert rätt, ${s.guessed} gissat rätt, ${s.wrong} fel"></span>`;
}

function examFreq(M, o) {
  const a = M.ta?.delar?.[o.del];
  const m = a?.mal?.[o.id];
  if (!a) return "";
  return m ? `<span class="chip freq" title="${m.fragor} frågor på ${m.antal_tentor} av ${a.antal_tentor} tentor ${a.period}">${m.antal_tentor}/${a.antal_tentor} tentor</span>` : `<span class="chip freq none" title="Ingen koppling till de ${a.antal_tentor} tentorna ${a.period}">ej på tenta</span>`;
}

/* ---------- översikt ---------- */
function overview(M, del) {
  const nrs = del === 2 ? [9, 10, 11, 12] : [1, 2, 3, 4, 5, 6, 7, 8];
  const last = progress.last();
  const cards = nrs
    .map((nr) => {
      const m = M.modules.get(nr);
      const ids = m.submoduler.flatMap((s) => s.mal.map((o) => o.id));
      const read = progress.readCount(ids);
      const w = ids.length ? Math.round((read / ids.length) * 100) : 0;
      return `<a class="lib-mod2 ${ids.length ? "" : "empty"}" href="#/bibliotek/modul/${nr}" style="--mh:${hue(nr)}">
        <span class="lib-mod2-nr">${String(nr).padStart(2, "0")}</span>
        <span class="lib-mod2-title">${esc(m.titel)}</span>
        <span class="lib-mod2-meta">${ids.length ? `${m.submoduler.length} submoduler · ${ids.length} lärandemål` : "Innehåll saknas – källmaterial behövs"}</span>
        ${ids.length ? `<span class="lib-bar" aria-label="${read} av ${ids.length} genomgångna"><i style="width:${w}%"></i></span><span class="lib-mod2-prog">${read}/${ids.length} genomgångna</span>` : ""}
      </a>`;
    })
    .join("");
  return `<section class="lib lib-over">
    <header class="lib-head">
      <p class="welcome-kicker">Basvetenskap 5 · Plugga under kursen</p>
      <h1>Lärandemålsbiblioteket</h1>
      <p class="muted">Varje lärandemål med förklaring, föreläsningsfigurer, hur det har examinerats och ett quiz att kontrollera dig med.</p>
      ${searchBox()}
      ${last?.kind === "bibliotek" ? `<p class="lib-resume"><a class="btn" href="${esc(last.hash)}">↩ Fortsätt där du slutade: ${esc(last.label)}</a></p>` : ""}
    </header>
    <div class="tabs" role="tablist">
      <button role="tab" data-del="1" aria-selected="${del === 1}">Del 1 <span class="count">modul 1–8</span></button>
      <button role="tab" data-del="2" aria-selected="${del === 2}">Del 2 <span class="count">modul 9–12</span></button>
    </div>
    <div class="lib-grid2">${cards}</div>
    <p class="small muted lib-note">${del === 2
      ? "Del 2 – tillämpning och integrering. Texterna är skrivna ur kursens föreläsningar och lärandemål; figurerna är hämtade ur föreläsnings-PDF:erna."
      : "Del 1 – innehållet kommer från det tidigare lärandemålsbiblioteket (prototypen), med figurer ur föreläsningarna."}
      <a href="#/tidigare-tentor?del=${del}">Se hur tentorna har examinerat del ${del} →</a></p>
  </section>`;
}

/* ---------- modul och submodul ---------- */
function objectiveRow(M, o) {
  const read = progress.isRead(o.id);
  return `<li><a href="#/bibliotek/${encodeURIComponent(o.id)}">
    <span class="lib-check ${read ? "on" : ""}" title="${read ? "Genomgånget" : "Inte genomgånget"}">${read ? "✓" : ""}</span>
    <span class="lib-id">${esc(o.id)}</span><span class="lib-otitle">${esc(o.titel)}</span>
    ${understandingDot(o.id)}${examFreq(M, o)}</a></li>`;
}

function modulePage(M, nr) {
  const m = M.modules.get(nr);
  if (!m) return notFound();
  const ids = m.submoduler.flatMap((s) => s.mal.map((o) => o.id));
  const subs = m.submoduler
    .map((s) => `<section class="lib-sub2">
        <header><h2><span class="muted">${esc(s.id)}</span> ${esc(s.titel)}</h2>
          ${s.mal.length ? `<a class="btn small" href="#/bibliotek/sub/${encodeURIComponent(s.id)}">Slutquiz för submodulen →</a>` : ""}</header>
        <ol class="lib-objlist2">${s.mal.map((o) => objectiveRow(M, o)).join("")}</ol>
      </section>`)
    .join("");
  return `<article class="lib2" style="--mh:${hue(nr)}">
    <header class="lib-hero"><div class="lib-hero-inner">
      ${crumbs([["Bibliotek", `#/bibliotek?del=${m.del}`], [`Del ${m.del}`, `#/bibliotek?del=${m.del}`], [`Modul ${nr}`, null]])}
      <p class="lib-hero-kicker">Modul ${nr} · Del ${m.del}</p>
      <h1>${esc(m.titel)}</h1>
      ${m.beskrivning ? `<p class="lib-hero-lead">${esc(m.beskrivning)}</p>` : ""}
      <div class="lib-hero-meta"><span>${ids.length} lärandemål</span><span>${progress.readCount(ids)} genomgångna</span>
        ${ids.length ? `<a href="#/bibliotek/modul/${nr}/quiz">✓ Blandat modulquiz</a>` : ""}<a href="#/tidigare-tentor?del=${m.del}&modul=${nr}">📊 Tidigare tentor</a></div>
    </div></header>
    <div class="lib-layout single"><div class="lib-main wide">
      <p class="small muted lib-legend"><span class="lib-check on">✓</span> genomgånget · <span class="u-dot good"></span> säkert rätt · <span class="u-dot mid"></span> gissat · <span class="u-dot bad"></span> fel på quiz · <span class="chip freq">x/y tentor</span> förekomst på tidigare tentor</p>
      ${subs || `<div class="card"><h2>Innehåll saknas</h2><p>Modulens lärandemål är inte inlagda. Det som behövs är modulens <b>nedbrutna lärandemål</b> och <b>föreläsnings-PDF:er</b>.</p></div>`}
    </div></div>
  </article>`;
}

function quizPage(ctx, M, scope, key) {
  let title, back, pool, hueNr;
  if (scope === "sub") {
    const s = M.subs.get(key);
    if (!s) return notFound();
    title = `Slutquiz · ${s.id} ${s.titel}`;
    back = [[`Modul ${s.modul}`, `#/bibliotek/modul/${s.modul}`], [s.id, null]];
    pool = s.mal.flatMap((o) => quizItems(ctx, o));
    hueNr = s.modul;
  } else {
    const m = M.modules.get(key);
    if (!m) return notFound();
    title = `Blandat modulquiz · Modul ${m.nr} ${m.titel}`;
    back = [[`Modul ${m.nr}`, `#/bibliotek/modul/${m.nr}`], ["Modulquiz", null]];
    pool = m.submoduler.flatMap((s) => s.mal.flatMap((o) => quizItems(ctx, o)));
    hueNr = m.nr;
  }
  const n = scope === "sub" ? 12 : 20;
  const pick = shuffle(pool).slice(0, n);
  return `<article class="lib2" style="--mh:${hue(hueNr)}">
    <header class="lib-hero slim"><div class="lib-hero-inner">${crumbs([["Bibliotek", "#/bibliotek"], ...back])}<h1>${esc(title)}</h1>
      <div class="lib-hero-meta"><span>${pick.length} av ${pool.length} frågor, slumpvis</span><span>Ett rätt svar per fråga</span></div></div></header>
    <div class="lib-layout single"><div class="lib-main">
      ${pick.length ? quizHtml(pick, { title: "Frågor", id: "quiz", showObjective: true, M }) : `<div class="card"><p>Det finns inga quizfrågor här ännu.</p></div>`}
      <p><button class="btn" data-act="reroll">↻ Ny omgång</button></p>
    </div></div></article>`;
}

function shuffle(a) {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

/* ---------- quiz ---------- */
function quizHtml(items, { title = "Testa dig själv", id = "testa-dig", intro = "", showObjective = false, M = null } = {}) {
  const list = items
    .map((it, i) => {
      const prev = progress.answer(it.id);
      const o = showObjective && M ? M.byId.get(it.objective) : null;
      return `<li class="lq" data-qid="${esc(it.id)}" data-obj="${esc(it.objective || "")}" data-right="${esc(it.right.join(","))}">
        <div class="lq-head"><span class="lq-nr">${i + 1}</span>
          <span class="chip ${it.kalla === "tenta" ? "official" : ""}">${it.kalla === "tenta" ? "Officiell tentafråga" : "Kursquiz"}</span>
          <span class="lq-src">${esc(it.kalla === "tenta" ? it.src.replace(/^Officiell tentafråga · /, "") : "")}${o ? ` <a href="#/bibliotek/${encodeURIComponent(o.id)}">${esc(o.id)} ${esc(o.titel)}</a>` : ""}</span>
          ${prev ? `<span class="lq-prev ${prev.c ? (prev.g ? "mid" : "good") : "bad"}" title="Senaste försöket">${prev.c ? (prev.g ? "Gissat rätt senast" : "Rätt senast") : "Fel senast"}</span>` : ""}</div>
        <p class="lq-stem">${esc(it.q)}</p>
        <ol class="lq-opts">${it.options.map((a, k) => `<li><button type="button" class="lq-opt" data-k="${k}"><span class="lq-letter">${LETTERS[k]}</span><span>${esc(a)}</span></button></li>`).join("")}</ol>
        <div class="lq-tools"><button type="button" class="guess-toggle" data-act="guess" aria-pressed="false">🤔 Jag gissar</button></div>
        <div class="lq-feedback" hidden>
          <p class="lq-verdict" aria-live="polite"></p>
          ${it.forklaring ? `<div class="lq-why"><b>Varför:</b> ${esc(it.forklaring)}</div>` : `<div class="lq-why muted">Facit kommer från tentans rättningsmall; en motiverad förklaring är inte skriven för den här frågan än.</div>`}
          <p class="lq-back"></p>
        </div></li>`;
    })
    .join("");
  const n = items.length;
  return `<section class="lib-quiz" id="${esc(id)}" data-quiz>
    <header class="lib-quiz-head"><div><h2>${esc(title)}</h2>
      <p class="muted small">${intro || `${n} frågor. Tryck på "Jag gissar" innan du svarar om du inte är säker – då räknas ett rätt svar som gissning, inte som visad förståelse.`}</p></div>
      <div class="lib-score" data-score><b>0</b> / ${n} rätt<span class="small" data-guesses></span></div></header>
    <ol class="lq-list">${list}</ol></section>`;
}

/** Kopplar varje quizfråga till det stycke i texten som bäst förklarar den. */
function linkQuizToSections(root) {
  const secs = [...root.querySelectorAll(".lib-text2 .md-sec")].map((s) => ({ id: s.id, title: s.querySelector("h3")?.textContent.replace(/^\d+/, "").trim() || "", toks: new Set(tokenize(s.textContent)) }));
  if (!secs.length) return;
  root.querySelectorAll(".lq").forEach((li) => {
    const right = (li.dataset.right || "").split(",").map(Number);
    const opts = [...li.querySelectorAll(".lq-opt span:last-child")].map((x) => x.textContent);
    const text = `${li.querySelector(".lq-stem")?.textContent || ""} ${right.map((k) => opts[k] || "").join(" ")} ${li.querySelector(".lq-why")?.textContent || ""}`;
    const q = tokenize(text);
    let best = null, bestScore = 0;
    for (const s of secs) {
      const hits = q.filter((t) => s.toks.has(t)).length;
      const score = hits / Math.sqrt(s.toks.size + 20);
      if (score > bestScore) [best, bestScore] = [s, score];
    }
    if (best && bestScore > 0.08) li.querySelector(".lq-back").innerHTML = `<a href="#" data-jump="${esc(best.id)}">📖 Läs i texten: ${esc(best.title)} →</a>`;
  });
}

/* ---------- figurer ---------- */
function figureHtml(b, key) {
  if (!b) return "";
  const src = [b.forelasning, b.sida ? `PDF-sida ${b.sida}` : ""].filter(Boolean).join(" · ");
  return `<figure class="md-fig" id="fig-${esc(key)}"><button type="button" class="md-fig-btn" data-zoom="${esc(b.src)}" data-caption="${esc(b.titel)}${src ? ` – ${esc(src)}` : ""}" aria-label="Förstora: ${esc(b.titel)}"><img src="${esc(b.src)}" alt="${esc(b.titel)}" loading="lazy" decoding="async"></button>
    <figcaption><b>${esc(b.titel)}.</b> ${esc(b.text || "")}<span class="md-fig-src">${src ? `Källa: ${esc(src)}` : "Bild ur kursens föreläsningsmaterial"} · klicka för att förstora</span></figcaption></figure>`;
}

/** Del 1-HTML: delar upp i numrerade avsnitt vid varje h3 och ersätter figurplatshållare. */
function renderHtmlBody(src, bilder) {
  const tpl = document.createElement("template");
  tpl.innerHTML = String(src || "");
  tpl.content.querySelectorAll("script,style,iframe,object,embed,link,meta").forEach((n) => n.remove());
  tpl.content.querySelectorAll("*").forEach((n) => [...n.attributes].forEach((a) => /^on|^style$|^src$|^href$/i.test(a.name) && n.removeAttribute(a.name)));
  let figures = 0;
  tpl.content.querySelectorAll("figure[data-bild]").forEach((f) => {
    const html = figureHtml(bilder[f.dataset.bild], f.dataset.bild);
    if (html) {
      figures++;
      f.outerHTML = html;
    } else f.remove();
  });
  const out = [];
  const toc = [];
  let open = false;
  let pre = [];
  for (const node of [...tpl.content.childNodes]) {
    const html = node.nodeType === 1 ? node.outerHTML : node.nodeType === 3 && node.textContent.trim() ? `<p>${esc(node.textContent.trim())}</p>` : "";
    if (!html) continue;
    if (node.nodeType === 1 && node.tagName === "H3") {
      if (open) out.push("</section>");
      const text = node.textContent.trim();
      const id = `s-${toc.length + 1}-${text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`;
      toc.push({ id, text });
      out.push(`<section class="md-sec" id="${id}"><h3><span class="md-sec-nr">${toc.length}</span>${node.innerHTML}</h3>`);
      open = true;
    } else if (open) out.push(html);
    else pre.push(html);
  }
  if (open) out.push("</section>");
  return { html: (pre.length ? `<div class="md-intro">${pre.join("")}</div>` : "") + out.join(""), toc, key: [], figures };
}

/* ---------- målsida ---------- */
function examHistoryHtml(ctx, M, o) {
  const a = M.ta?.delar?.[o.del];
  const qs = examQuestions(ctx, o.id);
  if (!a) return "";
  const m = a.mal?.[o.id];
  const per = `${a.antal_tentor} jämförbara del ${o.del}-tentor ${a.period}`;
  if (!m) {
    return `<section class="lib-exam" id="tidigare-tentor"><h2>Så har målet examinerats</h2>
      <p class="lib-exam-none"><b>Saknar tillräckligt historiskt underlag.</b> Ingen fråga på de ${per} har kunnat kopplas till det här målet. Målet ingår ändå i kursen och kan examineras – läs det utifrån delmålen ovan.</p>
      <p class="small"><a href="#/tidigare-tentor?del=${o.del}&modul=${o.modul}">Se hela modulens examinationsmönster →</a></p></section>`;
  }
  const total = Object.values(m.kunskapshandling).reduce((x, y) => x + y, 0);
  const bars = Object.entries(m.kunskapshandling)
    .sort((x, y) => y[1] - x[1])
    .map(([k, n]) => `<div class="kbar"><span class="kbar-label">${esc(K_LABELS[k] || k)}</span><span class="kbar-track"><i style="width:${Math.round((n / total) * 100)}%"></i></span><span class="kbar-n">${n}</span></div>`)
    .join("");
  const exampleIds = (m.exempel || []).slice(0, 4);
  const byId = new Map(qs.map((q) => [q.id, q]));
  const examples = exampleIds
    .map((id) => byId.get(id) || ctx.store.questions.get(id))
    .filter(Boolean)
    .map((q) => {
      const meta = M.ta.fragor?.[q.id] || {};
      const right = (q.options || []).filter((x) => x.is_correct);
      return `<details class="lib-exq" id="fraga-${esc(q.id)}"><summary><span class="chip">${esc(examLabel(ctx, q))}</span>${q.type === "freetext" ? `<span class="chip teal">Essä ${q.points} p</span>` : ""}
          <span class="chip k">${esc(K_LABELS[meta.k] || "")}</span>${(q.tag_confidence ?? 1) < 0.8 ? `<span class="chip warn" title="Kopplingen till målet är gjord automatiskt och bör granskas">osäker koppling</span>` : ""}
          <span class="lib-exq-stem">${esc(q.stem.replace(/^Fråga\s+\d+\s*[:.]?\s*/i, ""))}</span></summary>
        <div class="lib-exq-body">
          ${q.options?.length ? `<ol class="lib-exq-opts" type="A">${q.options.map((x) => `<li class="${x.is_correct ? "right" : ""}">${esc(x.text)}${x.is_correct ? " <b>· rätt enligt facit</b>" : ""}</li>`).join("")}</ol>` : ""}
          ${q.explanation ? `<div class="lq-why"><b>${q.type === "freetext" ? "Svarsförslag från tentan" : "Förklaring"}:</b> <span class="pre">${esc(q.explanation)}</span></div>` : q.type === "freetext" ? `<p class="muted small">Ingen officiell bedömningsmall finns för den här tentan.</p>` : ""}
          <p class="small muted">Klassad som <b>${esc(K_LABELS[meta.k] || "–")}</b> eftersom ${esc(meta.k_varfor || "–")} (säkerhet: ${esc(meta.k_sakerhet || "–")}).${right.length ? "" : ""}</p>
        </div></details>`;
    })
    .join("");
  return `<section class="lib-exam" id="tidigare-tentor"><h2>Så har målet examinerats</h2>
    <div class="lib-exam-stats">
      <div><b>${m.antal_tentor}</b><span>av ${a.antal_tentor} tentor</span></div>
      <div><b>${m.fragor}</b><span>frågor${m.unika !== m.fragor ? ` (${m.unika} unika)` : ""}</span></div>
      <div><b>${esc(K_LABELS[m.dominerande] || "")}</b><span>vanligast krävda kunskapshandling</span></div>
    </div>
    <p class="small muted">Underlag: ${esc(per)}. Förekomst: ${m.tentor.map((t) => esc(t.replace(/^Del 2 /, ""))).join(", ")}.${m.osakra_kopplingar ? ` ${m.osakra_kopplingar} av kopplingarna är automatiska och markerade för granskning.` : ""}</p>
    <div class="kbars">${bars}</div>
    <p class="lib-depth"><b>Hur djupt?</b> ${esc(K_HELP[m.dominerande] || "")}</p>
    ${examples ? `<h3 class="lib-exam-h">Riktiga tentafrågor som belägger bedömningen</h3>${examples}` : ""}
    <p class="small"><a href="#/tidigare-tentor?del=${o.del}&mal=${encodeURIComponent(o.id)}">Öppna i Tidigare tentor →</a></p>
  </section>`;
}

function progressPanel(o, nQuiz) {
  const read = progress.isRead(o.id);
  const s = progress.objectiveStats(o.id);
  return `<section class="lib-prog" data-prog>
    <div class="lib-prog-col"><span class="lib-prog-label">Genomgånget</span>
      <button class="btn ${read ? "done" : "primary"}" data-act="read" aria-pressed="${read}">${read ? "✓ Genomgånget" : "Markera som genomgånget"}</button></div>
    <div class="lib-prog-col"><span class="lib-prog-label">Visad förståelse</span>
      <span class="lib-prog-val">${s.answered ? `<b>${s.sure}</b> säkert rätt · ${s.guessed} gissat · ${s.wrong} fel <span class="muted">av ${nQuiz}</span>` : `<span class="muted">Inget quiz gjort ännu – ${nQuiz ? `<a href="#" data-jump="testa-dig">testa dig</a>` : "inga frågor finns"}</span>`}</span></div>
  </section>`;
}

function objectivePage(ctx, M, id) {
  const o = M.byId.get(id);
  if (!o) return { html: notFound() };
  const i = M.objectives.indexOf(o);
  const prev = M.objectives[i - 1];
  const next = M.objectives[i + 1];
  const r = o.format === "md" ? renderMarkdown(o.body) : o.format === "html" ? renderHtmlBody(o.body, M.bilder) : renderPlainSummary(o.body);
  const items = quizItems(ctx, o);
  const mins = readingMinutes(o.body.replace(/<[^>]+>/g, " "));
  const hist = examHistoryHtml(ctx, M, o);
  const toc = [
    ...(r.key.length ? [{ id: "det-viktigaste", text: "Det viktigaste" }] : []),
    ...(o.delmal.length ? [{ id: "du-ska-kunna", text: "Du ska kunna" }] : []),
    ...r.toc,
    ...(hist ? [{ id: "tidigare-tentor", text: "Så har det examinerats" }] : []),
    ...(items.length ? [{ id: "testa-dig", text: `Testa dig själv (${items.length})` }] : []),
  ];
  const goals = o.delmal.length
    ? `<section class="lib-goals" id="du-ska-kunna"><h2>Du ska kunna</h2><p class="small muted">Bocka av delmålen när du kan förklara dem utan att titta.</p>
      <ul>${o.delmal.map((d, k) => `<li><label><input type="checkbox" data-goal="${esc(`${o.id}:${k}`)}" ${progress.goalDone(`${o.id}:${k}`) ? "checked" : ""}><span>${esc(d)}</span></label></li>`).join("")}</ul></section>`
    : "";
  const html = `<article class="lib2" style="--mh:${hue(o.modul)}">
    <header class="lib-hero"><div class="lib-hero-inner">
      ${crumbs([["Bibliotek", `#/bibliotek?del=${o.del}`], [`Modul ${o.modul} · ${o.modul_titel}`, `#/bibliotek/modul/${o.modul}`], [o.sub, `#/bibliotek/sub/${encodeURIComponent(o.sub)}`], [o.id, null]])}
      <p class="lib-hero-kicker">Del ${o.del} · ${esc(o.sub)} ${esc(o.sub_titel)}</p>
      <h1><span class="lib-hero-id">${esc(o.id)}</span>${esc(o.titel)}</h1>
      <div class="lib-hero-meta">
        <span>⏱ ${mins} min läsning</span>
        ${r.figures ? `<span>🖼 ${r.figures} föreläsningsfigurer</span>` : o.del === 2 ? `<span class="missing" title="Figurerna ur föreläsnings-PDF:erna är inte inlagda för det här målet än">🖼 Figurer ej inlagda än</span>` : ""}
        ${hist ? `<a href="#" data-jump="tidigare-tentor">📊 Så har det examinerats</a>` : ""}
        ${items.length ? `<a href="#" data-jump="testa-dig">✓ ${items.length} kontrollfrågor</a>` : ""}
      </div></div></header>
    <div class="lib-layout">
      <aside class="lib-side"><nav class="lib-toc2" aria-label="Innehåll"><b>Innehåll</b><ol>${toc
        .map((t) => `<li><a href="#" data-jump="${esc(t.id)}" data-toc="${esc(t.id)}">${esc(t.text)}</a></li>`)
        .join("")}</ol></nav></aside>
      <div class="lib-main">
        ${r.key.length ? `<section class="lib-key" id="det-viktigaste"><h2><span aria-hidden="true">⚡</span> Det viktigaste</h2><ol>${r.key.map((k) => `<li>${k}</li>`).join("")}</ol></section>` : ""}
        ${progressPanel(o, items.length)}
        ${goals}
        <div class="lib-text2">${r.html || `<p class="muted">Sammanfattningen är inte skriven än.</p>`}</div>
        ${hist}
        ${items.length ? quizHtml(items) : ""}
        <nav class="lib-pager2">
          ${prev ? `<a href="#/bibliotek/${encodeURIComponent(prev.id)}"><small>← Föregående</small><span>${esc(prev.id)} ${esc(prev.titel)}</span></a>` : "<span></span>"}
          ${next ? `<a class="next" href="#/bibliotek/${encodeURIComponent(next.id)}"><small>Nästa →</small><span>${esc(next.id)} ${esc(next.titel)}</span></a>` : "<span></span>"}
        </nav>
      </div>
    </div>
  </article>`;
  return { html, o };
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
    const goals = norm(o.delmal.join(" "));
    const plain = o.body.replace(/<[^>]+>/g, " ").replace(/[#*|`>]/g, " ");
    const text = norm(plain);
    let score = 0;
    let all = true;
    for (const t of terms) {
      const s = (title.includes(t) ? 8 : 0) + (goals.includes(t) ? 3 : 0) + Math.min(5, text.split(t).length - 1);
      if (!s) all = false;
      score += s;
    }
    if (score && all) {
      const pos = text.indexOf(terms[0] || "");
      const snippet = pos >= 0 ? plain.slice(Math.max(0, pos - 70), pos + 160).replace(/\s+/g, " ") : "";
      scored.push({ o, score, snippet });
    }
  }
  const figs = Object.entries(M.bilder).filter(([, b]) => terms.every((t) => norm(`${b.titel} ${b.text}`).includes(t))).slice(0, 8);
  scored.sort((a, b) => b.score - a.score);
  return `<section class="lib">
    ${crumbs([["Bibliotek", "#/bibliotek"], ["Sök", null]])}
    <h1 class="lib-title">Sökresultat</h1>
    ${searchBox(q)}
    <p class="muted">${scored.length ? `${scored.length} lärandemål matchar "${esc(q)}".` : `Inga lärandemål matchar "${esc(q)}".`}</p>
    <ol class="lib-results">${scored
      .slice(0, 40)
      .map(({ o, snippet }) => `<li class="card flat"><a href="#/bibliotek/${encodeURIComponent(o.id)}"><span class="lib-id">${esc(o.id)}</span> <b>${esc(o.titel)}</b></a>
          <div class="small muted">Del ${o.del} · Modul ${o.modul} ${esc(o.modul_titel)}</div>${snippet ? `<p class="small">…${esc(snippet)}…</p>` : ""}</li>`)
      .join("")}</ol>
    ${figs.length ? `<h2>Figurer</h2><div class="lib-figresults">${figs.map(([k, b]) => `<button type="button" class="md-fig-btn" data-zoom="${esc(b.src)}" data-caption="${esc(b.titel)}"><img src="${esc(b.src)}" alt="${esc(b.titel)}" loading="lazy"><span>${esc(b.titel)}</span></button>`).join("")}</div>` : ""}
  </section>`;
}

function notFound() {
  return `<section class="lib"><div class="card"><h2>Hittades inte</h2><p>Det lärandemålet finns inte i biblioteket.</p><a class="btn primary" href="#/bibliotek">Till biblioteket</a></div></section>`;
}

/* ---------- vy ---------- */
export async function libraryView(ctx, root, route) {
  root.innerHTML = `<div class="loading-screen"><div><span class="spinner"></span><p>Öppnar biblioteket …</p></div></div>`;
  const M = await loadLibrary(ctx);
  const p = route.parts || [];
  const q = route.query || {};
  let html;
  let objective = null;
  if (q.q) {
    setTitle(`Sök: ${q.q} – Bibliotek`);
    html = searchPage(M, q.q);
  } else if (p[0] === "modul" && p[1] && p[2] === "quiz") {
    setTitle(`Modulquiz ${p[1]} – Bibliotek`);
    html = quizPage(ctx, M, "mod", Number(p[1]));
  } else if (p[0] === "modul" && p[1]) {
    const nr = Number(p[1]);
    setTitle(`Modul ${nr} – Bibliotek`);
    html = modulePage(M, nr);
    progress.setLast(`#/bibliotek/modul/${nr}`, `Modul ${nr} ${M.modules.get(nr)?.titel || ""}`);
  } else if (p[0] === "sub" && p[1]) {
    setTitle(`Slutquiz ${p[1]} – Bibliotek`);
    html = quizPage(ctx, M, "sub", p[1]);
  } else if (p[0]) {
    const r = objectivePage(ctx, M, p[0]);
    html = r.html;
    objective = r.o || null;
    setTitle(objective ? `${objective.id} ${objective.titel}` : "Bibliotek");
    if (objective) progress.setLast(`#/bibliotek/${encodeURIComponent(objective.id)}`, `${objective.id} ${objective.titel}`);
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
  if (!M.ok.d2 || !M.ok.d1) root.insertAdjacentHTML("afterbegin", `<div class="notice warn">Delar av biblioteket kunde inte laddas (${[!M.ok.d1 && "del 1", !M.ok.d2 && "del 2"].filter(Boolean).join(", ")}). Kontrollera nätet och ladda om.</div>`);
  linkQuizToSections(root);

  const jump = (id, flash = false) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.tagName === "DETAILS") el.open = true;
    el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    if (flash) {
      el.classList.remove("flash");
      void el.offsetWidth;
      el.classList.add("flash");
    }
  };
  if (q.ova) setTimeout(() => jump("testa-dig", true), 60);
  if (q.fraga) setTimeout(() => jump(document.getElementById(`fraga-${q.fraga}`) ? `fraga-${q.fraga}` : "tidigare-tentor", true), 60);

  const score = (quiz) => {
    const done = quiz.querySelectorAll(".lq.answered");
    const ok = quiz.querySelectorAll(".lq.answered.ok").length;
    const guessed = quiz.querySelectorAll(".lq.answered.ok.guessed").length;
    const b = quiz.querySelector("[data-score] b");
    if (b) b.textContent = String(ok);
    const g = quiz.querySelector("[data-guesses]");
    if (g) g.textContent = guessed ? ` · ${guessed} gissade` : done.length ? "" : "";
  };

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
    on(root, "click", "[data-act=guess]", (e, el) => {
      const li = el.closest(".lq");
      const on2 = el.getAttribute("aria-pressed") !== "true";
      el.setAttribute("aria-pressed", String(on2));
      li.classList.toggle("guessing", on2);
      if (li.classList.contains("answered")) {
        li.classList.toggle("guessed", on2);
        progress.record(li.dataset.qid, { objective: li.dataset.obj, correct: li.classList.contains("ok"), guessed: on2 });
        el.textContent = on2 ? "🤔 Markerad som gissning" : "🤔 Jag gissade";
        score(li.closest("[data-quiz]"));
      }
    }),
    on(root, "click", ".lq-opt", (e, el) => {
      const li = el.closest(".lq");
      if (li.classList.contains("answered")) return;
      const right = (li.dataset.right || "").split(",").filter(Boolean).map(Number);
      const k = Number(el.dataset.k);
      const ok = right.includes(k);
      const guessed = li.querySelector("[data-act=guess]")?.getAttribute("aria-pressed") === "true";
      li.classList.add("answered", ok ? "ok" : "fail");
      if (guessed) li.classList.add("guessed");
      li.querySelectorAll(".lq-opt").forEach((b) => {
        const n = Number(b.dataset.k);
        if (right.includes(n)) b.classList.add("right");
        else if (n === k) b.classList.add("wrong");
        b.setAttribute("aria-disabled", "true");
      });
      const fb = li.querySelector(".lq-feedback");
      fb.hidden = false;
      li.querySelector(".lq-verdict").textContent = ok
        ? guessed ? "Rätt – men du gissade, så målet räknas inte som visad förståelse än." : "Rätt!"
        : `Fel – rätt svar är ${right.map((n) => LETTERS[n]).join(", ")}. Du valde ${LETTERS[k]}.`;
      const g = li.querySelector("[data-act=guess]");
      if (g) g.textContent = guessed ? "🤔 Markerad som gissning" : "🤔 Jag gissade";
      progress.record(li.dataset.qid, { objective: li.dataset.obj, correct: ok, guessed });
      score(li.closest("[data-quiz]"));
      const panel = root.querySelector("[data-prog]");
      if (panel && objective) panel.outerHTML = progressPanel(objective, root.querySelectorAll("#testa-dig .lq").length);
    }),
    on(root, "change", "[data-goal]", (e, el) => progress.setGoal(el.dataset.goal, el.checked)),
    on(root, "click", "[data-act=read]", (e, el) => {
      if (!objective) return;
      const now = !progress.isRead(objective.id);
      progress.setRead(objective.id, now);
      const panel = root.querySelector("[data-prog]");
      panel.outerHTML = progressPanel(objective, root.querySelectorAll("#testa-dig .lq").length);
      root.querySelector("[data-prog]")?.classList.add("just-done");
    }),
    on(root, "click", "[data-act=reroll]", () => ctx.render()),
    on(root, "click", "[data-zoom]", (e, el) => openLightbox(el.dataset.zoom, el.dataset.caption, el)),
    on(root, "click", "[data-jump]", (e, el) => {
      e.preventDefault();
      jump(el.dataset.jump, true);
    }),
  ];
  const stopSpy = scrollSpy(root);
  return () => {
    offs.forEach((off) => typeof off === "function" && off());
    stopSpy();
    document.querySelector(".lightbox")?.remove();
  };
}

/* ---------- bildförstoring och innehållsmarkering ---------- */
function openLightbox(src, caption, opener) {
  document.querySelector(".lightbox")?.remove();
  const box = document.createElement("div");
  box.className = "lightbox";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.setAttribute("aria-label", caption || "Bild");
  box.innerHTML = `<figure><img src="${esc(src)}" alt="${esc(caption || "")}"><figcaption>${esc(caption || "")}</figcaption></figure><button type="button" class="lightbox-close" aria-label="Stäng">×</button>`;
  const close = () => {
    box.remove();
    document.removeEventListener("keydown", onKey);
    opener?.focus?.();
  };
  const onKey = (e) => {
    if (e.key === "Escape") close();
  };
  box.addEventListener("click", (e) => {
    if (e.target === box || e.target.closest(".lightbox-close")) close();
  });
  document.addEventListener("keydown", onKey);
  document.body.appendChild(box);
  box.querySelector(".lightbox-close").focus();
}

function scrollSpy(root) {
  const links = [...root.querySelectorAll("[data-toc]")];
  if (!links.length || !("IntersectionObserver" in window)) return () => {};
  const visible = new Set();
  const io = new IntersectionObserver(
    (entries) => {
      for (const en of entries) (en.isIntersecting ? visible.add : visible.delete).call(visible, en.target.id);
      const first = links.find((a) => visible.has(a.dataset.toc));
      if (first) links.forEach((a) => a.classList.toggle("on", a === first));
    },
    { rootMargin: "-80px 0px -55% 0px" }
  );
  for (const a of links) {
    const el = root.querySelector(`#${CSS.escape(a.dataset.toc)}`);
    if (el) io.observe(el);
  }
  return () => io.disconnect();
}
