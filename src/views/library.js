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
    cache = Promise.all([get("data/bibliotek-del1.json"), get("data/bibliotek-del2.json"), get("data/tentaanalys.json"), get("data/fran-tentorna.json"), get("data/bibliotek-lektioner.json")])
      .then(([d1, d2, ta, ft, lek]) => buildModel(ctx, d1, d2, ta, ft, lek));
    cache.catch(() => (cache = null));
  }
  return cache;
}

function buildModel(ctx, d1, d2, ta, ft, lek) {
  lek = lek || { moduler: {}, submoduler: {}, lektioner: {}, fragor_extra: {}, instudering: [] };
  SIZES = lek.storlek || {};
  const kompl = new Map();
  const modules = new Map();
  const objectives = [];
  const byId = new Map();
  const subs = new Map();
  const bilder = { ...(d1?.bilder || {}) };
  const add = (src, del, format) => {
    for (const m of src?.modules || []) {
      const mod = { nr: m.nr, titel: m.titel, beskrivning: m.beskrivning || "", del, submoduler: [], komplettering: m.komplettering || "", komplMal: m.komplettering_mal || [] };
      for (const s of m.submoduler || []) {
        const sid = s.id || `${m.nr}.${s.nr}`;
        const sub = { id: sid, nr: s.nr, titel: s.titel, modul: m.nr, del, mal: [], beskrivning: lek.submoduler?.[sid] || "" };
        for (const o of s.mal || []) {
          const item = {
            id: o.id, titel: o.titel, delmal: o.delmal || [], modul: m.nr, modul_titel: m.titel, sub: sid, sub_titel: s.titel, del,
            format: o.format || format, body: o.innehall ?? o.sammanfattning ?? "", quiz: o.quiz || [],
            slides: o.slides || [], franTentorna: ft?.mal?.[o.id] || [], lek: lek.lektioner?.[o.id] || {},
          };
          sub.mal.push(item);
          objectives.push(item);
          byId.set(item.id, item);
        }
        if (!sub.beskrivning && sub.mal.length) sub.beskrivning = autoDescription(sub.mal);
        mod.submoduler.push(sub);
        subs.set(sid, sub);
      }
      if (mod.komplettering) kompl.set(m.nr, splitKompl(mod.komplettering));
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
  const extra = { d1: d1?.komplettering || {}, d2: d2?.komplettering || {} };
  return { modules, objectives, byId, subs, bilder, ta, extra, lek, kompl, ok: { d1: Boolean(d1), d2: Boolean(d2), ta: Boolean(ta) } };
}

/** Kort beskrivning av en submodul ur dess lektionstitlar, när ingen handskriven finns. */
function autoDescription(mal) {
  const lower = (x, i) => (i ? x.charAt(0).toLowerCase() + x.slice(1) : x);
  const t = mal.map((o) => o.titel.replace(/\s+/g, " ").split(/\s[—–-]\s|:\s/)[0].trim());
  const take = [];
  for (const x of t) {
    if (take.length >= 2 && take.join(", ").length + x.length > 150) break;
    take.push(x);
  }
  const rest = t.length - take.length;
  if (!rest) return `${take.length > 1 ? `${take.slice(0, -1).map(lower).join(", ")} och ${lower(take[take.length - 1], 1)}` : take[0]}.`;
  return `${take.map(lower).join(", ")} – och ${rest} ${rest === 1 ? "lektion" : "lektioner"} till.`;
}

function cmpId(a, b) {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
}

/** Officiella tentafrågor för ett mål, ur frågebanken (samma id:n som simulatorn). */
function examQuestions(ctx, objectiveId) {
  const out = [];
  for (const q of ctx.store.questions.values()) if (q.objective_id === objectiveId && q.status !== "struken" && ctx.store.isOfficial(q)) out.push(q);
  const exams = ctx.store.exams;
  return out.sort((a, b) => String(exams.get(a.exam_id)?.code).localeCompare(String(exams.get(b.exam_id)?.code)) || a.number - b.number);
}

function examLabel(ctx, q) {
  const e = ctx.store.exams.get(q.exam_id);
  return `${(e?.code || q.exam_code || "Tenta").replace(/^Del 2 /, "")} · fråga ${q.number}`;
}

/** Quizposter: hälften genererade frågor (kursquiz i del 1, övningsfrågor i tentastil i del 2) och hälften
    officiella tentafrågor. Bara den "synliga" halvan av målets officiella frågor används – resten hålls dolda
    i biblioteket och finns kvar i tentasimulatorn, så att studenten kan testa sig på okända tentafrågor senare. */
function quizItems(ctx, M, o) {
  const gen = (o.quiz || []).map((q) => ({
    id: q.id, q: q.q, options: q.options, right: [q.svar], forklaring: q.forklaring, kalla: q.kalla || "kursquiz",
    src: q.kalla === "ovning" ? "Övningsfråga i tentastil (genererad)" : "Kursquiz", objective: o.id,
  }));
  const vis = new Set(M.ta?.delar?.[o.del]?.mal?.[o.id]?.synliga || []);
  const off = examQuestions(ctx, o.id)
    .filter((q) => vis.has(q.id) && q.options?.length)
    .map((q) => ({
      id: q.id, q: q.stem.replace(/^Fråga\s+\d+\s*[:.]?\s*/i, ""), options: q.options.map((x) => x.text), right: q.options.filter((x) => x.is_correct).map((x) => x.ordinal),
      forklaring: q.explanation || "", kalla: "tenta", src: `Officiell tentafråga · ${examLabel(ctx, q)}`, objective: o.id,
    }))
    .slice(0, Math.max(gen.length, 0) || 6);
  const out = [];
  for (let i = 0; i < Math.max(gen.length, off.length); i++) {
    if (off[i]) out.push(off[i]);
    if (gen[i]) out.push(gen[i]);
  }
  return out;
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

/** Viktighetsnivå utifrån hur många tidigare tentor målet har examinerats på. */
export function importance(M, o) {
  const a = M.ta?.delar?.[o.del];
  const n = Number(a?.mal?.[o.id]?.antal_tentor || 0);
  const tot = Number(a?.antal_tentor || 0);
  if (n >= 3) return { k: "hot", icon: "🔥", label: "Återkommande", text: `${n} av ${tot} tentor`, n };
  if (n >= 1) return { k: "once", icon: "★", label: "Har kommit på tenta", text: `${n} av ${tot} tentor`, n };
  return { k: "none", icon: "○", label: "Ej examinerat – bra att känna till", text: `0 av ${tot} tentor`, n };
}
function impBadge(n, tot) {
  if (n >= 2) return `<span class="imp hot" title="Har kommit på ${n} tentor">🔥 ${n} tentor</span>`;
  if (n === 1) return `<span class="imp once" title="Har kommit på 1 tenta">★ 1 tenta</span>`;
  return `<span class="imp none" title="Inte examinerat på de ${tot} tentorna – bra att känna till">○ bra att känna till</span>`;
}

function examFreq(M, o) {
  const a = M.ta?.delar?.[o.del];
  const m = a?.mal?.[o.id];
  if (!a) return "";
  const imp = importance(M, o);
  return m ? `<span class="chip freq ${imp.k}" title="${m.fragor} frågor på ${m.antal_tentor} av ${a.antal_tentor} tentor ${a.period}">${imp.icon} ${m.antal_tentor}/${a.antal_tentor} tentor</span>` : `<span class="chip freq none" title="Ingen koppling till de ${a.antal_tentor} tentorna ${a.period}">ej på tenta</span>`;
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
        <span class="lib-mod2-meta">${ids.length ? `${m.submoduler.length} submoduler · ${ids.length} lektioner` : "Innehåll saknas – källmaterial behövs"}</span>
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

/* ---------- hjälpare för kapitel och lektioner ---------- */
let SIZES = {};
const dims = (f) => (SIZES[f] ? ` width="${SIZES[f][0]}" height="${SIZES[f][1]}"` : "");
const P = (id) => `l-${String(id).replace(/\./g, "-")}`;
const KH = { aterg: "återgivning", mekanism: "mekanistisk förståelse", jamforelse: "jämförelse", berakning: "beräkning", figur_fall: "figur- eller falltolkning" };
const VERBS = [
  [/^redogör/i, "redogöra för", "beskriva ett område sammanhängande och med egna ord – vad som händer, i vilken ordning och varför"],
  [/^förklara/i, "förklara", "visa orsakskedjan: vilken mekanism som ger vilken effekt"],
  [/^integrera/i, "integrera", "koppla ihop flera organsystem till en sammanhängande förklaring"],
  [/^analysera/i, "analysera", "tolka data eller ett fall och dra en motiverad slutsats"],
  [/^tillämpa/i, "tillämpa", "använda principen på ett nytt fall eller mätvärde"],
  [/^jämföra/i, "jämföra", "skilja snarlika begrepp åt på de egenskaper som avgör"],
  [/^beskriva/i, "beskriva", "återge hur något är uppbyggt eller går till"],
  [/^diskutera/i, "diskutera", "väga orsaker och förklaringar mot varandra"],
  [/^definiera/i, "definiera", "ange vad ett begrepp betyder och avgränsa det"],
  [/^känna till/i, "känna till", "känna igen och kunna nämna – mindre djup krävs"],
];
function goalDepth(o) {
  const text = (o.lek?.officiellt || [])[0] || o.delmal[0] || o.titel;
  const v = VERBS.find(([re]) => re.test(text.trim()));
  return v ? { verb: v[1], what: v[2] } : null;
}

function hash32(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Kompletterande material per mål ur modulens kompletteringsfil (#### <mål-id>-block + gemensamma källor). */
function splitKompl(txt) {
  const parts = String(txt || "").split(/^#### (\d+\.\d+\.\d+)[^\n]*$/m);
  const per = {};
  let kallor = "";
  for (let i = 1; i < parts.length; i += 2) {
    let body = parts[i + 1] || "";
    const k = body.search(/^\*\*Källor\*\*/m);
    if (k >= 0) {
      kallor = body.slice(k).replace(/^\*\*Källor\*\*\s*/, "").trim();
      body = body.slice(0, k);
    }
    per[parts[i]] = body.trim();
  }
  return { per, kallor };
}

function lessonsOf(M, sid) {
  return M.subs.get(sid)?.mal || [];
}

/* ---------- modulöversikt ---------- */
function modulePage(ctx, M, nr, rat = null) {
  const m = M.modules.get(nr);
  if (!m) return notFound();
  const ids = m.submoduler.flatMap((s) => s.mal.map((o) => o.id));
  const read = progress.readCount(ids);
  const pct = ids.length ? Math.round((read / ids.length) * 100) : 0;
  const intro = M.lek.moduler?.[nr];
  const last = progress.last();
  const cards = m.submoduler
    .map((s) => {
      const sids = s.mal.map((o) => o.id);
      const r = progress.readCount(sids);
      const w = sids.length ? Math.round((r / sids.length) * 100) : 0;
      const st = sids.map((id) => progress.objectiveStats(id)).reduce((a, b) => ({ sure: a.sure + b.sure, guessed: a.guessed + b.guessed, wrong: a.wrong + b.wrong, answered: a.answered + b.answered }), { sure: 0, guessed: 0, wrong: 0, answered: 0 });
      const mins = s.mal.reduce((n, o) => n + readingMinutes(o.body.replace(/<[^>]+>/g, " ")), 0);
      const resume = last?.hash && s.mal.some((o) => last.hash.startsWith(`#/bibliotek/${encodeURIComponent(o.id)}`));
      return `<li><a class="sub-card" href="#/bibliotek/sub/${encodeURIComponent(s.id)}">
        <span class="sub-card-id">${esc(s.id)}</span>
        <span class="sub-card-body"><span class="sub-card-title">${esc(s.titel)}</span>
          <span class="sub-card-desc">${esc(s.beskrivning)}</span>
          <span class="sub-card-meta">${s.mal.length} ${s.mal.length === 1 ? "lektion" : "lektioner"} · ≈${mins} min läsning${st.answered ? ` · visad förståelse: ${st.sure} säkert rätt, ${st.guessed} gissat, ${st.wrong} fel` : ""}</span>
          <span class="lib-bar" aria-label="${r} av ${sids.length} lektioner genomgångna"><i style="width:${w}%"></i></span>
          <span class="sub-card-prog">${r}/${sids.length} genomgångna${resume ? " · du slutade här" : ""}</span></span>
        <span class="sub-card-go" aria-hidden="true">${r ? (r === sids.length ? "✓" : "Fortsätt →") : "Börja →"}</span></a></li>`;
    })
    .join("");
  return `<article class="lib2" style="--mh:${hue(nr)}">
    <header class="lib-hero"><div class="lib-hero-inner">
      ${crumbs([["Bibliotek", `#/bibliotek?del=${m.del}`], [`Del ${m.del}`, `#/bibliotek?del=${m.del}`], [`Modul ${nr}`, null]])}
      <p class="lib-hero-kicker">Modul ${nr} · Del ${m.del}</p>
      <h1>${esc(m.titel)}</h1>
      <div class="mod-prog"><span class="lib-bar"><i style="width:${pct}%"></i></span><span>${read} av ${ids.length} lektioner genomgångna i ${m.submoduler.length} submoduler</span></div>
      <div class="lib-hero-meta">
        ${ids.length ? `<a href="#/bibliotek/modul/${nr}/tentor">📊 Så har modulen examinerats</a>` : ""}
        ${rat ? `<a href="#/rat/${nr}">🧪 RAT inför modulen</a>` : ""}${ids.length ? `<a href="#/bibliotek/modul/${nr}/quiz">✓ Blandat modulquiz</a>` : ""}</div>
    </div></header>
    <div class="lib-layout single"><div class="lib-main">
      ${intro?.intro ? `<section class="mod-intro"><p>${inlineMd(intro.intro)}</p>${intro.intro_kalla ? `<p class="small muted">Förankrat i: ${esc(intro.intro_kalla)}</p>` : ""}</section>` : m.beskrivning ? `<section class="mod-intro"><p>${esc(m.beskrivning)}</p></section>` : ""}
      ${cards ? `<h2 class="sub-h">Submoduler</h2><ol class="sub-list">${cards}</ol>` : `<div class="card"><h2>Innehåll saknas</h2><p>Modulens lärandemål är inte inlagda. Det som behövs är modulens <b>nedbrutna lärandemål</b> och <b>föreläsnings-PDF:er</b>.</p></div>`}
      <p class="small muted">Lärandemålen finns inne i varje submodul, i den ordning de lärs ut. Gå in i en submodul för att läsa.</p>
    </div></div>
  </article>`;
}

/** Inline-markdown för korta texter (fet och kursiv). */
function inlineMd(t) {
  return slideMd(t);
}

/* ---------- lektion ---------- */
function figCard(f, id, pre) {
  const src = f.sida ? `${f.kalla || "Föreläsning"}, s. ${f.sida}` : f.kalla || "Kursmaterial";
  const extras = [...(f.steg || []).map((x) => ({ ...x, typ: "Uppbyggnadssteg" })), ...(f.dubbletter || []).map((x) => ({ ...x, typ: "Samma figur" }))];
  return `<figure class="tfig" id="${pre}--fig-${esc(id)}">
    ${f.intro ? `<p class="tfig-intro">${slideMd(f.intro)}</p>` : ""}
    <button type="button" class="tfig-img" data-zoom="${esc(f.bild)}" data-caption="${esc(`${f.titel} – ${src}`)}" aria-label="Förstora: ${esc(f.titel)}"><img src="${esc(f.bild)}"${dims(f.bild)} alt="${esc(`${f.titel} (${src})`)}" loading="lazy" decoding="async"><span class="tfig-zoom" aria-hidden="true">⤢</span></button>
    <figcaption>
      <p class="tfig-title"><b>${esc(f.titel)}</b> <span class="tfig-src">${esc(src)}${f.helsida ? ` · <button type="button" class="linklike" data-zoom="${esc(f.helsida)}" data-caption="${esc(src)} – hela sidan">visa hela sidan</button>` : ""}</span></p>
      ${f.las ? `<div class="tfig-read"><b>Så läser du figuren.</b> ${slideMd(f.las)}</div>` : ""}
      ${f.fraga ? `<details class="tfig-q"><summary><span class="tfig-q-label">Tolka själv</span> ${slideMd(f.fraga)}</summary><p>${slideMd(f.svar || "")}</p></details>` : ""}
      ${extras.length ? `<div class="tfig-steps"><span class="small muted">Också på föreläsningen:</span>${extras
        .map((x) => (x.bild || x.fil)
          ? `<button type="button" class="tfig-step" data-zoom="${esc(x.bild || x.fil)}" data-caption="${esc(`${x.typ}: ${x.text || ""}`)}"><img src="${esc(x.bild || x.fil)}" alt="" loading="lazy"><span>${esc(x.typ)} · ${esc(x.kalla || f.kalla || "")} s. ${esc(String(x.sida || (x.nyckel || "").split("#")[1] || ""))}</span></button>`
          : `<span class="tfig-step note">${esc(x.text || x.typ)}</span>`)
        .join("")}</div>` : ""}
    </figcaption></figure>`;
}

function autoFigCard(x, pre, links) {
  const src = `${x.kalla}, s. ${x.sida}`;
  const L = links?.[x.fil] || [];
  return `<figure class="tfig auto" id="${pre}--fig-${esc(x.fil.split("/").pop().replace(/\.\w+$/, ""))}">
    <button type="button" class="tfig-img" data-zoom="${esc(x.fil)}" data-caption="${esc(src)}" aria-label="Förstora ${esc(src)}"><img src="${esc(x.fil)}"${dims(x.fil)} alt="${esc(`${src}${x.rubrik ? ` – ${x.rubrik}` : ""}`)}" loading="lazy" decoding="async"><span class="tfig-zoom" aria-hidden="true">⤢</span></button>
    <figcaption><p class="tfig-title"><span class="tfig-src">${esc(src)}</span></p>
      ${x.text ? `<div class="tfig-read">${slideMd(x.text)}</div>` : ""}
      ${L.length ? `<div class="tfig-steps"><span class="small muted">Också på föreläsningen:</span>${L.map((y) => `<button type="button" class="tfig-step" data-zoom="${esc(y.fil)}" data-caption="${esc(`${y.kalla}, s. ${y.sida}`)}"><img src="${esc(y.fil)}" alt="" loading="lazy"><span>${esc(y.text)}</span></button>`).join("")}</div>` : ""}
    </figcaption></figure>`;
}

/** Renderar lektionens text med figurer på plats. Returnerar { html, toc, key, nfig }. */
function lessonBody(M, o) {
  const pre = P(o.id);
  const L = o.lek || {};
  const r = o.format === "md" ? renderMarkdown(o.body, { prefix: `${pre}--`, numbers: false }) : o.format === "html" ? renderHtmlBody(o.body, M.bilder, `${pre}--`) : renderPlainSummary(o.body);
  const tpl = document.createElement("template");
  tpl.innerHTML = r.html;
  let nfig = r.figures || 0;
  if (L.figurer) {
    tpl.content.querySelectorAll(".fig-slot").forEach((slot) => {
      const f = L.figurer[slot.dataset.fig];
      if (f) {
        slot.outerHTML = figCard(f, slot.dataset.fig, pre);
        nfig++;
      } else slot.remove();
    });
  } else if (L.auto_figurer && o.slides?.length) {
    const byFil = new Map(o.slides.map((x) => [x.fil, x]));
    for (const [sec, fils] of Object.entries(L.auto_figurer)) {
      const el = sec === "_sist" ? null : tpl.content.getElementById(`${pre}--${sec}`);
      const html = fils.map((f) => byFil.get(f)).filter(Boolean).map((x) => autoFigCard(x, pre, L.figurlankar)).join("");
      if (!html) continue;
      nfig += fils.length;
      if (el) el.insertAdjacentHTML("beforeend", `<div class="tfig-group">${html}</div>`);
      else tpl.content.appendChild(Object.assign(document.createElement("section"), { className: "md-sec", id: `${pre}--fler-bilder`, innerHTML: `<h3>Fler föreläsningsbilder</h3><p class="small muted">Sidor som inte kunde placeras automatiskt i något avsnitt.</p><div class="tfig-group">${html}</div>` }));
    }
  }
  const div = document.createElement("div");
  div.appendChild(tpl.content);
  const toc = [...div.querySelectorAll(":scope > section.md-sec")].map((s) => ({ id: s.id, text: s.querySelector("h3")?.textContent.trim() || "", mal: (s.dataset.mal || "").split(",").filter(Boolean).map(Number) }));
  return { html: div.innerHTML, toc, key: r.key, nfig };
}

function komplBox(M, o) {
  const k = M.kompl.get(o.modul);
  const body = k?.per[o.id];
  if (!body) return "";
  return `<aside class="md-callout kalla lesson-kompl" id="${P(o.id)}--kompletterande"><div class="md-callout-head"><span class="md-callout-icon" aria-hidden="true">📚</span><span><span class="md-callout-kicker">Kompletterande källa</span>Det föreläsningarna inte förklarar fullt ut</span></div>
    <p class="small">Texten bygger på källorna nedan, inte på kursens egna föreläsningar.</p>
    ${renderMarkdown(body).html}
    ${k.kallor ? `<div class="kompl-src"><b>Källor</b>${renderMarkdown(k.kallor).html}</div>` : ""}</aside>`;
}

function franTentornaHtml(o) {
  const L = o.franTentorna || [];
  if (!L.length) return "";
  return `<section class="md-sec lib-fran" id="${P(o.id)}--ocksa-examinerat"><h3>Också examinerat på tentorna</h3>
    <p class="small muted">Begrepp som har kommit på tidigare tentor inom det här målet men inte förklaras ovan, ett i taget. Det som kommit flest gånger står först.</p>
    <div class="ft-list">${L.map((x) => `<div class="ft-item" data-n="${x.tentor.length}">
      <div class="ft-head">${impBadge(x.tentor.length)}${x.svar ? `<b>${esc(x.svar)}</b>` : ""}</div>
      <p>${esc(x.text)}</p>
      <p class="ft-src small muted">${esc(x.tentor.map((t) => t.replace(/^Del 2 /, "")).join(" · "))}</p>
    </div>`).join("")}</div></section>`;
}

function lessonEndHtml(o, nQuiz) {
  const read = progress.isRead(o.id);
  const s = progress.objectiveStats(o.id);
  return `<div class="lesson-end" data-prog="${esc(o.id)}">
    <div class="lesson-end-col"><span class="lib-prog-label">Läst klart?</span>
      <button class="btn ${read ? "done" : "primary"}" data-act="read" data-oid="${esc(o.id)}" aria-pressed="${read}">${read ? "✓ Genomgånget" : "Markera som genomgånget"}</button></div>
    <div class="lesson-end-col"><span class="lib-prog-label">Visad förståelse <span class="muted">(eget mått)</span></span>
      <span class="lib-prog-val">${s.answered ? `<b>${s.sure}</b> säkert rätt · ${s.guessed} gissat · ${s.wrong} fel` : `<span class="muted">Inga frågor besvarade än</span>`}</span></div>
    <div class="lesson-end-next"><a href="#" data-goto="examinerats" data-filter="${esc(o.id)}">📊 Så har ${esc(o.id)} examinerats</a><a href="#" data-goto="ova" data-filter="${esc(o.id)}">✎ Öva på ${esc(o.id)}${nQuiz ? ` (${nQuiz})` : ""}</a></div>
  </div>`;
}

function registerHtml(M, o, toc) {
  const L = o.lek || {};
  const reg = L.register || [];
  if (!reg.length) return "";
  const pre = P(o.id);
  const title = new Map(toc.map((t) => [t.id, t.text]));
  const figTitle = (id) => L.figurer?.[id]?.titel || id;
  const where = (r) => {
    if (!r.plats) return `<span class="muted">Visas inte</span>`;
    if (L.figurer) return r.plats.split(" ").map((id) => `<a href="#" data-jump="${pre}--fig-${esc(id)}">${esc(figTitle(id))}</a>`).join("<br>");
    return `<a href="#" data-jump="${pre}--${esc(r.plats)}">${esc(title.get(`${pre}--${r.plats}`) || r.plats)}</a>`;
  };
  const rest = (r) => (r.orsak ? esc(r.orsak) : r.auto ? "Placerad automatiskt efter textlikhet; läsguide och tolkningsfråga saknas." : L.figurer?.[r.plats?.split(" ")[0]]?.fraga ? "Klar: läsguide och tolkningsfråga." : "Klar");
  const done = reg.filter((r) => r.plats && !r.auto).length;
  return `<details class="fig-reg" id="${pre}--figurregister"><summary>Figurregister · ${reg.length} föreläsningssidor${L.figurer ? ` · alla placerade för hand` : ` · ${reg.filter((r) => r.plats).length} placerade automatiskt`}</summary>
    <p class="small muted">En rad per föreläsningssida som hör till lektionen: var den visas och vad som eventuellt återstår.${done ? "" : ""}</p>
    <div class="md-table"><table><thead><tr><th>Föreläsning och sida</th><th>Vad bilden lär ut</th><th>Var den visas</th><th>Status</th></tr></thead><tbody>${reg
      .map((r) => `<tr><td data-label="Föreläsning och sida">${r.bild || r.fil ? `<button type="button" class="linklike" data-zoom="${esc(r.bild || r.fil)}" data-caption="${esc(`${r.kalla}, s. ${r.sida}`)}">${esc(r.kalla)}, s. ${r.sida}</button>` : `${esc(r.kalla)}, s. ${r.sida}`}</td><td data-label="Vad bilden lär ut">${esc(r.larut || "")}</td><td data-label="Var den visas">${where(r)}</td><td data-label="Status">${rest(r)}</td></tr>`)
      .join("")}</tbody></table></div></details>`;
}

function lessonHtml(ctx, M, o, idx, total) {
  const pre = P(o.id);
  const b = lessonBody(M, o);
  const L = o.lek || {};
  const imp = importance(M, o);
  const nq = practiceCounts(ctx, M, [o.id]);
  const mins = readingMinutes(o.body.replace(/<[^>]+>/g, " "));
  const read = progress.isRead(o.id);
  const goals = o.delmal.map((d, k) => {
    const sec = b.toc.find((t) => t.mal.includes(k + 1));
    return `<li><a href="#" ${sec ? `data-jump="${esc(sec.id)}"` : ""} data-goal-link="${k + 1}" data-lesson="${esc(o.id)}">${esc(d)}</a></li>`;
  });
  const sum = b.key.length
    ? `<section class="lesson-sum" id="${pre}--sammanfattning"><h3>Sammanfattning</h3><ul>${b.key.map((k) => `<li>${k}</li>`).join("")}</ul></section>`
    : "";
  const html = `<section class="lesson" id="${pre}" data-lesson="${esc(o.id)}">
    <header class="lesson-head">
      <p class="lesson-kicker">Lektion ${idx + 1} av ${total} · <span class="lib-hero-id">${esc(o.id)}</span></p>
      <h2>${esc(o.titel)}</h2>
      <div class="lesson-meta"><span class="imp-chip ${imp.k}" title="${esc(imp.text)}">${imp.icon} ${esc(imp.label)} · ${esc(imp.text)}</span><span>⏱ ${mins} min</span>${b.nfig ? `<span>🖼 ${b.nfig} figurer</span>` : ""}${read ? `<span class="lesson-done">✓ genomgånget</span>` : ""}</div>
    </header>
    <details class="lesson-goals" ${idx === 0 ? "open" : ""}><summary>Lärandemål i lektionen</summary>
      ${L.officiellt?.length ? `<div class="official">${L.officiellt.map((t) => `<p>”${esc(t)}”</p>`).join("")}<p class="small muted">Officiell formulering · ${esc(L.officiellt_kalla || "")}</p></div>` : ""}
      ${goals.length ? `<p class="small muted">Nedbrutet i biblioteket – klicka på ett mål för att gå till stycket där det förklaras:</p><ol class="goal-links">${goals.join("")}</ol>` : ""}
    </details>
    ${L.oppning ? `<div class="lesson-q"><span class="lesson-q-label">Frågan lektionen besvarar</span><p>${esc(L.oppning)}</p>${L.oppning_vag ? `<p class="small">${esc(L.oppning_vag)}</p>` : ""}</div>` : ""}
    <div class="lib-text2 lesson-body">${b.html || `<p class="muted">Texten är inte skriven än.</p>`}${franTentornaHtml(o)}</div>
    ${komplBox(M, o)}
    ${sum}
    ${lessonEndHtml(o, nq.ovning + nq.tenta)}
    ${registerHtml(M, o, b.toc)}
  </section>`;
  return { html, toc: [...b.toc, ...(o.franTentorna?.length ? [{ id: `${pre}--ocksa-examinerat`, text: "Också examinerat" }] : []), ...(sum ? [{ id: `${pre}--sammanfattning`, text: "Sammanfattning" }] : [])] };
}

/* ---------- tentafrågor: verifierade och preliminära kopplingar ---------- */
function qStatus(q) {
  if (q.tag_source === "manuell granskning") return "verifierad";
  if (q.tag_source === "bibliotek") return "kalla";
  return "preliminar";
}
const ST_LABEL = { verifierad: "Verifierad", kalla: "Kopplad i källbiblioteket", preliminar: "Preliminär", ocksa: "Berör även målet" };

function examOrder(ctx) {
  const o = new Map();
  [...ctx.store.exams.values()].forEach((e) => o.set(e.id, `${e.del || 1}-${String(e.term || "").replace(/^(VT|HT)(\d+)/, (m, a, b) => `${b}${a === "HT" ? 1 : 0}`)}-${e.kind}`));
  return o;
}

/** Alla officiella frågor för målen: primära (målet är frågans huvudmål) och sekundära (målet är en byggsten). */
function examPool(ctx, ids) {
  const set = new Set(ids);
  const prim = [];
  const also = [];
  for (const q of ctx.store.questions.values()) {
    if (q.status === "struken" || !ctx.store.isOfficial(q)) continue;
    if (set.has(q.objective_id)) prim.push({ q, mal: q.objective_id, st: qStatus(q) });
    else {
      const m = (q.also_objectives || []).find((x) => set.has(x));
      if (m) also.push({ q, mal: m, st: "ocksa" });
    }
  }
  const ord = examOrder(ctx);
  const cmp = (a, b) => String(ord.get(a.q.exam_id)).localeCompare(String(ord.get(b.q.exam_id))) || a.q.number - b.q.number;
  return { prim: prim.sort(cmp), also: also.sort(cmp) };
}

function examTerm(ctx, q) {
  const e = ctx.store.exams.get(q.exam_id);
  return (e?.code || q.exam_code || "Tenta").replace(/^Del 2 /, "").replace(/^Omtenta 2026-08-27$/, "Omtenta aug 2026");
}

function sectionTitleFor(M, oid, sec) {
  return sec ? `${oid} · ${sec.replace(/-/g, " ")}` : oid;
}

function originalHtml(ctx, M, r) {
  const q = r.q;
  const type = q.type === "freetext" ? `Essä ${q.points} p` : q.type === "multi" ? "Flerval, flera rätt" : "Flerval";
  const sec = q.review_sections?.[r.mal];
  const rubric = (q.rubric || []).map((x) => x.criterion).join("\n\n");
  const facit = q.explanation || rubric;
  return `<details class="exq" id="fq-${esc(q.id)}" data-mal="${esc(r.mal)}">
    <summary><span class="exq-term">${esc(examTerm(ctx, q))}</span><span class="exq-nr">fråga ${q.number}</span><span class="chip">${esc(type)}</span>${q.kunskapshandling ? `<span class="chip k">${esc(KH[q.kunskapshandling] || "")}</span>` : ""}<span class="chip st ${r.st}">${esc(ST_LABEL[r.st])}</span><span class="exq-mal">${esc(r.mal)}</span><span class="exq-open">Öppna originalet</span></summary>
    <div class="exq-body">
      <p class="exq-stem">${esc(q.stem.replace(/^Fråga\s+\d+\s*[:.]?\s*/i, ""))}</p>
      ${(q.media || []).map((m) => `<img class="exq-img" src="${esc(m.url)}" alt="Bild till frågan" loading="lazy">`).join("")}
      ${q.options?.length ? `<ol class="lib-exq-opts" type="A">${q.options.map((x) => `<li class="${x.is_correct ? "right" : ""}">${esc(x.text)}${x.is_correct ? " <b>· rätt enligt facit</b>" : ""}</li>`).join("")}</ol>` : ""}
      ${facit ? `<div class="lq-why"><b>${q.type === "freetext" ? "Svarsförslag" : "Förklaring"}:</b> <span class="pre">${esc(facit)}</span></div>` : q.type === "freetext" ? `<p class="muted small">Ingen bedömningsmall finns för den här tentan.</p>` : ""}
      ${q.review_note ? `<p class="small"><b>Därför hör frågan hit:</b> ${esc(q.review_note)}.</p>` : r.st === "preliminar" ? `<p class="small muted">Kopplingen är gjord automatiskt efter textlikhet och är inte granskad.</p>` : ""}
      <p class="exq-links small"><a href="#" data-read="${esc(r.mal)}" ${sec ? `data-sec="${esc(sec)}"` : ""} data-qtext="${esc(q.stem.slice(0, 400))}">📖 Läs i lektionen ${esc(r.mal)}</a></p>
    </div></details>`;
}

function examSectionHtml(ctx, M, objs, filter, { id = "examinerats", select = false } = {}) {
  const ids = objs.map((o) => o.id);
  const scope = filter && ids.includes(filter) ? [filter] : ids;
  const del = objs[0]?.del || 2;
  const a = M.ta?.delar?.[del];
  const all = examPool(ctx, ids);
  const pool = examPool(ctx, scope);
  const sure = pool.prim.filter((r) => r.st !== "preliminar");
  const prel = pool.prim.filter((r) => r.st === "preliminar");
  const head = sure.length ? sure : prel;
  const label = sure.length ? (sure.some((r) => r.st === "verifierad") ? "verifierade" : "kopplade i källbiblioteket") : "preliminärt kopplade";
  const occasions = new Set(head.map((r) => r.q.exam_id)).size;
  const k = {};
  head.forEach((r) => (k[r.q.kunskapshandling] = (k[r.q.kunskapshandling] || 0) + 1));
  const kTot = head.length || 1;
  const bars = Object.entries(k).sort((x, y) => y[1] - x[1]).map(([kk, n]) => `<div class="kbar"><span class="kbar-label">${esc(K_LABELS[kk] || kk)}</span><span class="kbar-track"><i style="width:${Math.round((n / kTot) * 100)}%"></i></span><span class="kbar-n">${n}</span></div>`).join("");
  const counts = Object.fromEntries(ids.map((x) => [x, all.prim.filter((r) => r.mal === x && r.st !== "preliminar").length || all.prim.filter((r) => r.mal === x).length]));
  const filt = select
    ? `<label class="ex-filter">Visa mål <select data-exselect><option value="">Hela modulen (${ids.length} mål)</option>${objs.map((o) => `<option value="${esc(o.id)}" ${filter === o.id ? "selected" : ""}>${esc(o.id)} ${esc(o.titel)} (${counts[o.id]})</option>`).join("")}</select></label>`
    : objs.length < 2 ? "" : `<div class="ex-chips" role="group" aria-label="Filtrera på lektion"><button type="button" data-exfilter="" aria-pressed="${!filter}">Alla lektioner</button>${objs.map((o) => `<button type="button" data-exfilter="${esc(o.id)}" aria-pressed="${filter === o.id}" title="${esc(o.titel)}">${esc(o.id)} <span class="count">${counts[o.id]}</span></button>`).join("")}</div>`;
  const depth = scope.length === 1 ? goalDepth(objs.find((o) => o.id === scope[0])) : null;
  const domK = Object.entries(k).sort((x, y) => y[1] - x[1]).map(([kk]) => KH[kk]).filter(Boolean);
  return `<section class="lib-exam ex2" id="${id}">
    <h2>Så har ${scope.length === 1 ? `${esc(scope[0])}` : "området"} examinerats</h2>
    ${filt}
    ${a ? `<div class="lib-exam-stats">
      <div><b>${head.length}</b><span>${label} frågor</span></div>
      <div><b>${occasions}</b><span>separata tentatillfällen</span></div>
      <div><b>${a.antal_tentor}</b><span>jämförbara del ${del}-tentor ${esc(a.period)}</span></div>
    </div>` : ""}
    ${head.length ? `<div class="kbars">${bars}</div>` : `<p class="lib-exam-none"><b>Inga ${sure.length || !prel.length ? "" : "verifierade "}frågor.</b> Ingen fråga på de ${a?.antal_tentor || ""} tentorna har kopplats till ${scope.length === 1 ? "målet" : "de här målen"}. Målet ingår ändå i kursen och kan examineras.</p>`}
    ${depth ? `<p class="lib-depth"><b>Hur djupt?</b> Målet säger <i>${esc(depth.verb)}</i>: du ska kunna ${esc(depth.what)}.${domK.length ? ` Tentafrågorna har hittills krävt ${esc(domK.join(" och "))}.` : ""} Det är målformuleringen som sätter nivån – inte att tidigare frågor råkat vara enkla.</p>` : ""}
    <p class="small muted">Frågorna är stängda tills du öppnar dem – vill du spara en fråga osedd till tentasimulatorn, låt den vara stängd.</p>
    ${sure.length ? `<h3 class="lib-exam-h">${sure.some((r) => r.st === "verifierad") ? "Verifierade kopplingar" : "Kopplingar från källbiblioteket"} (${sure.length})</h3>${sure.map((r) => originalHtml(ctx, M, r)).join("")}` : ""}
    ${pool.also.length ? `<h3 class="lib-exam-h">Frågor där ${scope.length === 1 ? "målet" : "området"} är en byggsten (${pool.also.length})</h3><p class="small muted">Huvudmålet är ett annat, men svaret bygger på det här. Räknas inte i siffrorna ovan.</p>${pool.also.map((r) => originalHtml(ctx, M, r)).join("")}` : ""}
    ${prel.length ? `<h3 class="lib-exam-h">${sure.length ? "Preliminära kopplingar, ej granskade" : "Preliminära kopplingar – inte granskade"} (${prel.length})</h3><p class="small muted">Kopplade automatiskt efter textlikhet. ${sure.length ? "Räknas inte i siffrorna ovan." : "Siffrorna ovan bygger på dessa och kan ändras när kopplingarna granskas."} Ett gemensamt nyckelord räcker inte för att en fråga ska räknas som verifierad.</p>${prel.map((r) => originalHtml(ctx, M, r)).join("")}` : ""}
  </section>`;
}

/* ---------- övningslägen ---------- */
function examItem(r) {
  const q = r.q;
  const base = { id: q.id, objective: r.mal, src: `${q.exam_code ? "" : ""}`, prelim: r.st === "preliminar", sektion: q.review_sections?.[r.mal] || "", kalla: "tenta", princip: "" };
  if (q.options?.length) {
    return { ...base, kind: "mcq", q: q.stem.replace(/^Fråga\s+\d+\s*[:.]?\s*/i, ""), options: q.options.map((x) => x.text), right: q.options.filter((x) => x.is_correct).map((x) => x.ordinal), forklaring: q.explanation || "", q0: q };
  }
  return { ...base, kind: "open", q: q.stem.replace(/^Fråga\s+\d+\s*[:.]?\s*/i, ""), svar: q.explanation || (q.rubric || []).map((x) => x.criterion).join("\n\n"), points: q.points, q0: q };
}

function oldExamPool(ctx, M, ids, saveUnseen) {
  const { prim } = examPool(ctx, ids);
  const sure = prim.filter((r) => r.st !== "preliminar");
  const use = sure.length ? sure : prim;
  // stabil uppdelning: ungefär hälften hålls undan till simulatorn, men minst en fråga per mål visas
  const byObj = new Map();
  use.forEach((r) => {
    if (!byObj.has(r.mal)) byObj.set(r.mal, []);
    byObj.get(r.mal).push(r);
  });
  const vis = [];
  const held = [];
  for (const L of byObj.values()) {
    const sorted = L.slice().sort((x, y) => hash32(x.q.id) - hash32(y.q.id));
    sorted.forEach((r, i) => {
      const seen = Boolean(progress.answer(r.q.id));
      if (!saveUnseen || seen || i % 2 === 0) vis.push(r);
      else held.push(r);
    });
  }
  return { items: vis.map(examItem), held: held.length, total: use.length, prelim: !sure.length && prim.length > 0, mcq: use.filter((r) => r.q.options?.length).length };
}

function ovningPool(M, ids) {
  const set = new Set(ids);
  const items = [];
  let instud = 0, nya = 0, kursquiz = 0;
  for (const x of M.lek.instudering || []) {
    const mal = set.has(x.mal) ? x.mal : (x.ocksa || []).find((m) => set.has(m));
    if (!mal) continue;
    instud++;
    items.push({ id: x.id, kind: "open", objective: mal, q: x.q, svar: x.svar, svar_kalla: x.svar_kalla, bild: x.bild, kalla: "instudering", src: x.kalla, sektion: "", princip: "" });
  }
  for (const id of ids) {
    const o = M.byId.get(id);
    for (const q of o?.quiz || []) {
      const fx = M.lek.fragor_extra?.[q.id] || {};
      if (q.kalla === "ovning") nya++;
      else kursquiz++;
      items.push({ id: q.id, kind: "mcq", objective: id, q: q.q, options: q.options, right: [q.svar], forklaring: q.forklaring, kalla: q.kalla === "ovning" ? "ny" : "kursquiz", src: q.kalla === "ovning" ? "Ny övningsfråga, skapad för biblioteket" : "Kursquiz ur det tidigare biblioteket", sektion: fx.sektion || "", princip: fx.princip || "", distraktor: fx.distraktor || "" });
    }
  }
  return { items, instud, nya, kursquiz };
}

function practiceCounts(ctx, M, ids) {
  const t = oldExamPool(ctx, M, ids, false);
  const o = ovningPool(M, ids);
  return { tenta: t.total, ovning: o.items.length };
}

const OVNING_RUN = 10;
const SRC_CHIP = { tenta: ["official", "Gammal tentafråga"], ny: ["practice", "Ny övningsfråga"], kursquiz: ["", "Kursquiz"], instudering: ["teal", "Instuderingsfråga ur kursen"] };

function practiceItemHtml(ctx, M, it, i) {
  const prev = progress.answer(it.id);
  const [cls, lab] = SRC_CHIP[it.kalla] || ["", ""];
  const src = it.kalla === "tenta" ? `${examTerm(ctx, it.q0)} · fråga ${it.q0.number}` : it.src;
  const o = M.byId.get(it.objective);
  const head = `<div class="lq-head"><span class="lq-nr">${i + 1}</span><span class="chip ${cls}">${esc(lab)}</span>${it.prelim ? `<span class="chip warn" title="Kopplingen till målet är inte granskad">preliminär koppling</span>` : ""}
      <span class="lq-src">${esc(src || "")} · <a href="#" data-read="${esc(it.objective)}">${esc(it.objective)} ${esc(o?.titel || "")}</a></span>
      ${prev ? `<span class="lq-prev ${prev.c ? (prev.g ? "mid" : "good") : "bad"}" title="Senaste försöket">${prev.c ? (prev.g ? "Gissat rätt senast" : "Rätt senast") : "Fel senast"}</span>` : ""}</div>`;
  const back = `<p class="lq-back"><a href="#" data-read="${esc(it.objective)}" ${it.sektion ? `data-sec="${esc(it.sektion)}"` : ""} data-qtext="${esc(`${it.q} ${it.forklaring || it.svar || ""}`.slice(0, 600))}">📖 Läs i lektionen</a><button type="button" class="linklike" data-act="same" data-qid="${esc(it.id)}" hidden>↻ Ny fråga på samma princip</button></p>`;
  if (it.kind === "open") {
    return `<li class="lq open" data-qid="${esc(it.id)}" data-obj="${esc(it.objective)}">${head}
      <p class="lq-stem pre">${esc(it.q)}</p>${it.bild ? `<button type="button" class="tfig-img inq" data-zoom="${esc(it.bild)}" data-caption="Figur till frågan"><img src="${esc(it.bild)}"${dims(it.bild)} alt="Figur till frågan" loading="lazy"></button>` : ""}
      <textarea class="lq-text" rows="4" placeholder="Skriv ditt svar (sparas inte) – eller tänk igenom det innan du tittar."></textarea>
      <p><button type="button" class="btn small" data-act="reveal">Visa svarsaspekter</button></p>
      <div class="lq-feedback" hidden><div class="lq-why"><b>Svarsaspekter:</b> <span class="pre">${esc(it.svar || "Inget svarsförslag finns.")}</span></div>${it.svar_kalla ? `<p class="small muted">${esc(it.svar_kalla)}</p>` : ""}
        <p class="lq-self"><span class="small">Hur gick det?</span> <button type="button" class="btn small" data-self="ok">Jag hade med det viktigaste</button> <button type="button" class="btn small" data-self="mid">Delvis</button> <button type="button" class="btn small" data-self="bad">Nej</button></p>${back}</div></li>`;
  }
  return `<li class="lq" data-qid="${esc(it.id)}" data-obj="${esc(it.objective)}" data-right="${esc(it.right.join(","))}">${head}
    <p class="lq-stem">${esc(it.q)}</p>
    <ol class="lq-opts">${it.options.map((a, k) => `<li><button type="button" class="lq-opt" data-k="${k}"><span class="lq-letter">${LETTERS[k]}</span><span>${esc(a)}</span></button></li>`).join("")}</ol>
    <div class="lq-tools"><button type="button" class="guess-toggle" data-act="guess" aria-pressed="false">🤔 Jag gissar</button></div>
    <div class="lq-feedback" hidden><p class="lq-verdict" aria-live="polite"></p>
      ${it.forklaring ? `<div class="lq-why"><b>Varför:</b> ${esc(it.forklaring)}</div>` : `<div class="lq-why muted">Facit kommer från tentans rättningsmall; en motiverad förklaring är inte skriven för den här frågan än.</div>`}
      ${it.distraktor ? `<div class="lq-dist"><b>Fällan:</b> ${esc(it.distraktor)}</div>` : ""}
      <div class="lq-chosen" hidden></div>${back}</div></li>`;
}

function practiceSectionHtml(ctx, M, objs, filter, saveUnseen) {
  const ids = objs.map((o) => o.id);
  const scope = filter && ids.includes(filter) ? [filter] : ids;
  const t = oldExamPool(ctx, M, scope, saveUnseen);
  const tAll = oldExamPool(ctx, M, scope, false);
  const o = ovningPool(M, scope);
  const short = Math.min(5, t.items.length);
  return `<section class="practice" id="ova">
    <h2>Öva${scope.length === 1 ? ` på ${esc(scope[0])}` : ""}</h2>
    ${objs.length < 2 ? "" : `<div class="ex-chips" role="group" aria-label="Filtrera på lektion"><button type="button" data-exfilter="" aria-pressed="${!filter}">Alla lektioner</button>${objs.map((x) => `<button type="button" data-exfilter="${esc(x.id)}" aria-pressed="${filter === x.id}" title="${esc(x.titel)}">${esc(x.id)}</button>`).join("")}</div>`}
    <div class="pm-grid">
      <article class="pm-card">
        <h3>Gamla tentafrågor</h3>
        <p class="pm-counts"><b>${tAll.total}</b> ${tAll.prelim ? "preliminärt kopplade" : "verifierade"} original: ${tAll.mcq} flerval · ${tAll.total - tAll.mcq} essä</p>
        <label class="pm-save"><input type="checkbox" data-save-unseen ${saveUnseen ? "checked" : ""}><span>Spara osedda frågor till tentasimulatorn${saveUnseen && t.held ? ` <span class="muted">– ${t.held} hålls undan</span>` : ""}</span></label>
        <div class="btn-row">${t.items.length ? `<button type="button" class="btn" data-start="tenta-kort">Kort genomgång (${short})</button><button type="button" class="btn primary" data-start="tenta-alla">Hela uppsättningen (${t.items.length})</button>` : `<span class="muted small">Inga tentafrågor att öva på här.</span>`}</div>
      </article>
      <article class="pm-card">
        <h3>Instuderingsfrågor och nya övningsfrågor</h3>
        <p class="pm-counts">Instuderingsfrågor ur kursen: <b>${o.instud}</b> · Nya övningsfrågor: <b>${o.nya}</b>${o.kursquiz ? ` · Kursquiz ur tidigare bibliotek: <b>${o.kursquiz}</b>` : ""}</p>
        <p class="small muted">Varje fråga är märkt med sin källa. Nya frågor är skapade för biblioteket i tentans stil – inte officiella.</p>
        <div class="btn-row">${o.items.length ? `<button type="button" class="btn primary" data-start="ovning">Starta (${Math.min(OVNING_RUN, o.items.length)}${o.items.length > OVNING_RUN ? ` av ${o.items.length}` : ""})</button>` : `<span class="muted small">Inga frågor ännu.</span>`}</div>
        ${o.items.length > OVNING_RUN ? `<p class="small muted">En omgång är ${OVNING_RUN} frågor; resten dyker upp när du ber om en ny fråga på samma princip eller startar en ny omgång.</p>` : ""}
      </article>
    </div>
    <div class="pm-run" data-run></div>
  </section>`;
}

/* ---------- submodulkapitel: en lektion per sida ---------- */
/** Alla lektioner i modulens ordning (för föregående/nästa över submodulgränser). */
function moduleLessons(M, nr) {
  return (M.modules.get(nr)?.submoduler || []).flatMap((s) => s.mal);
}
function lessonPager(M, s, cur) {
  const all = moduleLessons(M, s.modul);
  const i = all.indexOf(cur);
  const prev = all[i - 1];
  const next = all[i + 1];
  const lab = (o) => (o.sub === s.id ? "" : ` · submodul ${esc(o.sub)}`);
  return `<nav class="lib-pager2 lesson-pager" aria-label="Föregående och nästa lektion">
    ${prev ? `<a href="#/bibliotek/${encodeURIComponent(prev.id)}"><small>← Föregående lektion${lab(prev)}</small><span>${esc(prev.id)} ${esc(prev.titel)}</span></a>` : `<a href="#/bibliotek/modul/${s.modul}"><small>← Tillbaka</small><span>Modul ${s.modul}</span></a>`}
    ${next ? `<a class="next" href="#/bibliotek/${encodeURIComponent(next.id)}"><small>Nästa lektion${lab(next)} →</small><span>${esc(next.id)} ${esc(next.titel)}</span></a>` : `<a class="next" href="#/bibliotek/modul/${s.modul}/tentor"><small>Avslutning →</small><span>Så har modul ${s.modul} examinerats</span></a>`}
  </nav>`;
}
/** Submodulens översikt: en rad per lektion (öppnas på egen sida). */
function subListPage(ctx, M, sid) {
  const s = M.subs.get(sid);
  if (!s) return { html: notFound() };
  const m = M.modules.get(s.modul);
  const lessons = s.mal;
  const ids = lessons.map((o) => o.id);
  const read = progress.readCount(ids);
  const pct = lessons.length ? Math.round((read / lessons.length) * 100) : 0;
  const mins = lessons.reduce((n, o) => n + readingMinutes(o.body.replace(/<[^>]+>/g, " ")), 0);
  const idx = m.submoduler.indexOf(s);
  const prev = m.submoduler[idx - 1];
  const next = m.submoduler[idx + 1];
  const last = progress.last();
  const resume = last?.hash && lessons.find((o) => last.hash.startsWith(`#/bibliotek/${encodeURIComponent(o.id)}`));
  const rows = lessons.map((o) => {
    const done = progress.isRead(o.id);
    const c = practiceCounts(ctx, M, [o.id]);
    const st = progress.objectiveStats(o.id);
    const nq = c.ovning + c.tenta;
    const meta = [`${o.delmal.length} delmål`, `${nq} frågor`, st.answered ? `senaste: ${st.sure} säkert rätt av ${st.answered}` : ""].filter(Boolean).join(" · ");
    return `<li><a class="sl-row ${done ? "done" : ""}" href="#/bibliotek/${encodeURIComponent(o.id)}">
      <span class="sl-check" aria-label="${done ? "genomgånget" : "inte genomgånget"}">${done ? "✓" : ""}</span>
      <span class="sl-id">${esc(o.id)}</span>
      <span class="sl-body"><span class="sl-title">${esc(o.titel)}</span><span class="sl-meta">${esc(meta)}</span></span>
      <span class="sl-arrow" aria-hidden="true">→</span></a></li>`;
  }).join("");
  const html = `<article class="lib2 sublist" style="--mh:${hue(s.modul)}">
    <header class="lib-hero slim"><div class="lib-hero-inner">
      ${crumbs([["Bibliotek", `#/bibliotek?del=${s.del}`], [`Modul ${s.modul} · ${m.titel}`, `#/bibliotek/modul/${s.modul}`], [s.id, null]])}
      <p class="lib-hero-kicker">Modul ${s.modul} · Submodul ${esc(s.id)}</p>
      <h1>${esc(s.titel)}</h1>
      ${s.beskrivning ? `<p class="lib-hero-lead">${esc(s.beskrivning)}</p>` : ""}
      <div class="lib-hero-meta"><span>${lessons.length} ${lessons.length === 1 ? "lektion" : "lektioner"}</span><span>≈${mins} min läsning</span>
        ${resume ? `<a href="${esc(last.hash)}">↩ Fortsätt: ${esc(resume.id)}</a>` : ""}<a href="#/bibliotek/sub/${encodeURIComponent(s.id)}/quiz">✓ Slutquiz för ${esc(s.id)}</a></div>
    </div></header>
    <div class="lib-layout single"><div class="lib-main">
      <div class="sl-prog"><span class="sl-bar"><i style="width:${pct}%"></i></span><span>${read}/${lessons.length} klara · ${pct}%</span></div>
      <ol class="sl-list">${rows}</ol>
      <nav class="lib-pager2">
        ${prev ? `<a href="#/bibliotek/sub/${encodeURIComponent(prev.id)}"><small>← Föregående submodul</small><span>${esc(prev.id)} ${esc(prev.titel)}</span></a>` : `<a href="#/bibliotek/modul/${s.modul}"><small>← Tillbaka</small><span>Modul ${s.modul}</span></a>`}
        ${next ? `<a class="next" href="#/bibliotek/sub/${encodeURIComponent(next.id)}"><small>Nästa submodul →</small><span>${esc(next.id)} ${esc(next.titel)}</span></a>` : `<a class="next" href="#/bibliotek/modul/${s.modul}/tentor"><small>Avslutning →</small><span>Så har modul ${s.modul} examinerats</span></a>`}
      </nav>
    </div></div>
  </article>`;
  return { html, sub: s };
}

function chapterPage(ctx, M, sid, focus = null) {
  const s = M.subs.get(sid);
  if (!s) return { html: notFound() };
  const m = M.modules.get(s.modul);
  const lessons = s.mal;
  const cur = focus && lessons.includes(focus) ? focus : lessons[0];
  if (!cur) return { html: notFound() };
  const idx = lessons.indexOf(cur);
  const b = lessonHtml(ctx, M, cur, idx, lessons.length);
  const ids = lessons.map((o) => o.id);
  const read = progress.readCount(ids);
  const mins = readingMinutes(cur.body.replace(/<[^>]+>/g, " "));
  const toc = `<ol>${lessons
    .map((o) => o === cur
      ? `<li class="toc-lesson cur" data-tl="${P(o.id)}"><a href="#" data-jump="${P(o.id)}" data-toc="${P(o.id)}" aria-current="page"><span class="toc-check ${progress.isRead(o.id) ? "on" : ""}">${progress.isRead(o.id) ? "✓" : ""}</span><span class="toc-id">${esc(o.id)}</span> ${esc(o.titel)}</a>
      <ol class="toc-secs">${b.toc.map((x) => `<li><a href="#" data-jump="${esc(x.id)}" data-toc="${esc(x.id)}">${esc(x.text)}</a></li>`).join("")}
        <li><a href="#" data-jump="examinerats" data-toc="examinerats">📊 Så har ${esc(o.id)} examinerats</a></li>
        <li><a href="#" data-jump="ova" data-toc="ova">✎ Öva på ${esc(o.id)}</a></li></ol></li>`
      : `<li class="toc-lesson" data-tl="${P(o.id)}"><a href="#/bibliotek/${encodeURIComponent(o.id)}"><span class="toc-check ${progress.isRead(o.id) ? "on" : ""}">${progress.isRead(o.id) ? "✓" : ""}</span><span class="toc-id">${esc(o.id)}</span> ${esc(o.titel)}</a></li>`)
    .join("")}
    <li class="toc-end"><a href="#/bibliotek/sub/${encodeURIComponent(s.id)}/quiz">✓ Slutquiz för hela ${esc(s.id)}</a></li></ol>`;
  const html = `<article class="lib2 chapter" style="--mh:${hue(s.modul)}">
    <header class="lib-hero slim"><div class="lib-hero-inner">
      ${crumbs([["Bibliotek", `#/bibliotek?del=${s.del}`], [`Modul ${s.modul} · ${m.titel}`, `#/bibliotek/modul/${s.modul}`], [`${s.id} ${s.titel}`, `#/bibliotek/sub/${encodeURIComponent(s.id)}`], [cur.id, null]])}
      <p class="lib-hero-kicker">Modul ${s.modul} · Submodul ${esc(s.id)} ${esc(s.titel)} · lektion ${idx + 1} av ${lessons.length}</p>
      <div class="lib-hero-meta"><span>≈${mins} min läsning</span><span>${read}/${lessons.length} lektioner genomgångna i submodulen</span>
        <a href="#" data-jump="examinerats">📊 Tentor</a><a href="#" data-jump="ova">✎ Öva på ${esc(cur.id)}</a></div>
    </div></header>
    <div class="lib-layout">
      <aside class="lib-side"><nav class="lib-toc2 ch-toc" aria-label="Submodulens lektioner"><b>Submodul ${esc(s.id)}</b>${toc}</nav></aside>
      <div class="lib-main">
        <details class="toc-m"><summary>Submodul ${esc(s.id)} · ${lessons.length} ${lessons.length === 1 ? "lektion" : "lektioner"}</summary><nav class="lib-toc2 ch-toc" aria-label="Submodulens lektioner (mobil)">${toc}</nav></details>
        ${b.html}
        <div data-exam-slot>${examSectionHtml(ctx, M, [cur], cur.id)}</div>
        <div data-practice-slot>${practiceSectionHtml(ctx, M, [cur], cur.id, true)}</div>
        ${lessonPager(M, s, cur)}
      </div>
    </div>
  </article>`;
  return { html, sub: s, lessons: [cur], cur };
}

function moduleExamPage(ctx, M, nr, filter) {
  const m = M.modules.get(nr);
  if (!m) return notFound();
  const objs = m.submoduler.flatMap((s) => s.mal);
  return `<article class="lib2" style="--mh:${hue(nr)}">
    <header class="lib-hero slim"><div class="lib-hero-inner">${crumbs([["Bibliotek", "#/bibliotek"], [`Modul ${nr}`, `#/bibliotek/modul/${nr}`], ["Tentor", null]])}
      <h1>Så har modul ${nr} examinerats</h1><p class="lib-hero-lead">${esc(m.titel)} – alla mål i modulen. Filtrera på ett mål för att se dess frågor, och öppna originalen en i taget.</p></div></header>
    <div class="lib-layout single"><div class="lib-main" data-exam-slot>${examSectionHtml(ctx, M, objs, filter, { select: true })}</div></div></article>`;
}

function quizPage(ctx, M, scope, key) {
  let title, back, pool, hueNr;
  if (scope === "sub") {
    const s = M.subs.get(key);
    if (!s) return notFound();
    title = `Slutquiz · ${s.id} ${s.titel}`;
    back = [[`Modul ${s.modul}`, `#/bibliotek/modul/${s.modul}`], [s.id, null]];
    pool = s.mal.flatMap((o) => quizItems(ctx, M, o));
    hueNr = s.modul;
  } else {
    const m = M.modules.get(key);
    if (!m) return notFound();
    title = `Blandat modulquiz · Modul ${m.nr} ${m.titel}`;
    back = [[`Modul ${m.nr}`, `#/bibliotek/modul/${m.nr}`], ["Modulquiz", null]];
    pool = m.submoduler.flatMap((s) => s.mal.flatMap((o) => quizItems(ctx, M, o)));
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
          <span class="chip ${it.kalla === "tenta" ? "official" : it.kalla === "ovning" ? "practice" : ""}" title="${esc(it.src)}">${it.kalla === "tenta" ? "Officiell tentafråga" : it.kalla === "ovning" ? "Övningsfråga" : "Kursquiz"}</span>
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
      <p class="muted small">${intro || `${n} frågor: ungefär hälften officiella tentafrågor och hälften övningsfrågor i samma stil. Övriga tentafrågor på målet sparas till tentasimulatorn. Tryck på "Jag gissar" innan du svarar om du inte är säker – då räknas ett rätt svar som gissning, inte som visad förståelse.`}</p></div>
      <div class="lib-score" data-score><b>0</b> / ${n} rätt<span class="small" data-guesses></span></div></header>
    <ol class="lq-list">${list}</ol></section>`;
}


/* ---------- figurer ---------- */
function figureHtml(b, key) {
  if (!b) return "";
  const src = [b.forelasning, b.sida ? `PDF-sida ${b.sida}` : ""].filter(Boolean).join(" · ");
  return `<figure class="md-fig" id="fig-${esc(key)}"><button type="button" class="md-fig-btn" data-zoom="${esc(b.src)}" data-caption="${esc(b.titel)}${src ? ` – ${esc(src)}` : ""}" aria-label="Förstora: ${esc(b.titel)}"><img src="${esc(b.src)}" alt="${esc(b.titel)}" loading="lazy" decoding="async"></button>
    <figcaption><b>${esc(b.titel)}.</b> ${esc(b.text || "")}<span class="md-fig-src">${src ? `Källa: ${esc(src)}` : "Bild ur kursens föreläsningsmaterial"} · klicka för att förstora</span></figcaption></figure>`;
}

/** Del 1-HTML: delar upp i numrerade avsnitt vid varje h3 och ersätter figurplatshållare. */
function renderHtmlBody(src, bilder, prefix = "") {
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
      const id = `${prefix}s-${toc.length + 1}-${text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`;
      toc.push({ id, text });
      out.push(`<section class="md-sec" id="${id}"><h3>${prefix ? "" : `<span class="md-sec-nr">${toc.length}</span>`}${node.innerHTML}</h3>`);
      open = true;
    } else if (open) out.push(html);
    else pre.push(html);
  }
  if (open) out.push("</section>");
  return { html: (pre.length ? `<div class="md-intro">${pre.join("")}</div>` : "") + out.join(""), toc, key: [], figures };
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
      // landa på avsnittet där träffen står
      let till = "";
      if (o.format === "md" && pos >= 0) {
        const rawPos = o.body.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").indexOf(terms[0]);
        const before = o.body.slice(0, rawPos >= 0 ? rawPos : 0);
        const hs = [...before.matchAll(/^##\s+(.+)$/gm)].pop();
        if (hs) {
          const raw = hs[1];
          const idm = raw.match(/\{[^}]*#([\w-]+)[^}]*\}\s*$/);
          till = idm ? idm[1] : raw.replace(/\s*\{[^}]*\}\s*$/, "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        }
      }
      scored.push({ o, score, snippet, till });
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
      .map(({ o, snippet, till }) => `<li class="card flat"><a href="#/bibliotek/${encodeURIComponent(o.id)}${till ? `?till=${encodeURIComponent(till)}` : ""}"><span class="lib-id">${esc(o.id)}</span> <b>${esc(o.titel)}</b></a>
          <div class="small muted">Del ${o.del} · Modul ${o.modul} ${esc(o.modul_titel)}</div>${snippet ? `<p class="small">…${esc(snippet)}…</p>` : ""}</li>`)
      .join("")}</ol>
    ${figs.length ? `<h2>Figurer</h2><div class="lib-figresults">${figs.map(([k, b]) => `<button type="button" class="md-fig-btn" data-zoom="${esc(b.src)}" data-caption="${esc(b.titel)}"><img src="${esc(b.src)}" alt="${esc(b.titel)}" loading="lazy"><span>${esc(b.titel)}</span></button>`).join("")}</div>` : ""}
  </section>`;
}

function notFound() {
  return `<section class="lib"><div class="card"><h2>Hittades inte</h2><p>Det lärandemålet finns inte i biblioteket.</p><a class="btn primary" href="#/bibliotek">Till biblioteket</a></div></section>`;
}

/** Kort inline-formatering för bildförklaringar och figurtexter: **fet** och *kursiv*. */
function slideMd(t) {
  return esc(t || "").replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s.,;:)!?]|$)/g, "$1<i>$2</i>");
}

/** Kopplar delmål till avsnitt där kopplingen inte är handskriven (ordlikhet), och visar diskret vilka mål varje avsnitt täcker. */
function annotateGoals(root, M, lessons) {
  for (const o of lessons) {
    const el = root.querySelector(`#${CSS.escape(P(o.id))}`);
    if (!el) continue;
    const secs = [...el.querySelectorAll(".lesson-body > .md-sec")];
    if (!secs.length) continue;
    const hand = secs.some((s) => s.dataset.mal);
    if (!hand) {
      const T = secs.map((s) => new Set(tokenize(s.textContent)));
      o.delmal.forEach((d, k) => {
        const q = tokenize(d);
        let best = -1, bs = 0;
        T.forEach((t, i) => {
          const sc = q.filter((w) => t.has(w)).length / Math.sqrt(t.size + 40);
          if (sc > bs) [best, bs] = [i, sc];
        });
        if (best >= 0 && bs > 0) {
          const s = secs[best];
          s.dataset.mal = [...new Set([...(s.dataset.mal || "").split(",").filter(Boolean), String(k + 1)])].join(",");
          el.querySelector(`[data-goal-link="${k + 1}"]`)?.setAttribute("data-jump", s.id);
        }
      });
    }
    secs.forEach((s) => {
      const nums = (s.dataset.mal || "").split(",").filter(Boolean);
      const h = s.querySelector("h3");
      if (nums.length && h && !h.querySelector(".sec-goals")) h.insertAdjacentHTML("beforeend", `<span class="sec-goals" title="${esc(nums.map((n) => o.delmal[n - 1] || "").join(" · "))}">mål ${nums.join(" · ")}</span>`);
    });
  }
}

/** Det avsnitt i lektionen som bäst förklarar en text (fråga + facit). */
function bestSection(root, oid, text, sec) {
  if (sec) {
    const el = document.getElementById(`${P(oid)}--${sec}`);
    if (el) return el.id;
  }
  const lesson = root.querySelector(`#${CSS.escape(P(oid))}`);
  if (!lesson) return null;
  const q = tokenize(text || "");
  let best = null, bs = 0;
  lesson.querySelectorAll(".lesson-body > .md-sec, .lesson-sum").forEach((s) => {
    const t = new Set(tokenize(s.textContent));
    const sc = q.filter((w) => t.has(w)).length / Math.sqrt(t.size + 20);
    if (sc > bs) [best, bs] = [s.id, sc];
  });
  return bs > 0.08 ? best : lesson.id;
}

/* ---------- vy ---------- */
export async function libraryView(ctx, root, route) {
  root.innerHTML = `<div class="loading-screen"><div><span class="spinner"></span><p>Öppnar biblioteket …</p></div></div>`;
  const M = await loadLibrary(ctx);
  const p = route.parts || [];
  const q = route.query || {};
  let html;
  let page = { kind: "other" };
  if (q.q) {
    setTitle(`Sök: ${q.q} – Bibliotek`);
    html = searchPage(M, q.q);
  } else if (p[0] === "modul" && p[1] && p[2] === "quiz") {
    setTitle(`Modulquiz ${p[1]} – Bibliotek`);
    html = quizPage(ctx, M, "mod", Number(p[1]));
  } else if (p[0] === "modul" && p[1] && p[2] === "tentor") {
    const nr = Number(p[1]);
    setTitle(`Tentor modul ${nr} – Bibliotek`);
    html = moduleExamPage(ctx, M, nr, q.mal || null);
    page = { kind: "modexam", nr, objs: M.modules.get(nr)?.submoduler.flatMap((s) => s.mal) || [] };
  } else if (p[0] === "modul" && p[1]) {
    const nr = Number(p[1]);
    setTitle(`Modul ${nr} – Bibliotek`);
    html = modulePage(ctx, M, nr, ctx.store.ratFor(nr));
    progress.setLast(`#/bibliotek/modul/${nr}`, `Modul ${nr} ${M.modules.get(nr)?.titel || ""}`);
  } else if (p[0] === "sub" && p[1] && p[2] === "quiz") {
    setTitle(`Slutquiz ${p[1]} – Bibliotek`);
    html = quizPage(ctx, M, "sub", p[1]);
  } else if (p[0] === "sub" && p[1]) {
    const r = subListPage(ctx, M, p[1]);
    html = r.html;
    setTitle(r.sub ? `${r.sub.id} ${r.sub.titel}` : "Bibliotek");
    if (r.sub) progress.setLast(`#/bibliotek/sub/${encodeURIComponent(p[1])}`, `${r.sub.id} ${r.sub.titel}`);
  } else if (p[0] && M.byId.has(p[0])) {
    const focus = M.byId.get(p[0]);
    const sid = focus ? focus.sub : p[1];
    const r = chapterPage(ctx, M, sid, focus);
    html = r.html;
    if (r.sub) {
      page = { kind: "chapter", sub: r.sub, lessons: r.lessons, focus };
      setTitle(`${r.cur.id} ${r.cur.titel}`);
      progress.setLast(`#/bibliotek/${encodeURIComponent(r.cur.id)}${q.till ? `?till=${encodeURIComponent(q.till)}` : ""}`, `${r.cur.id} ${r.cur.titel}`);
    } else setTitle("Bibliotek");
  } else if (p[0]) {
    html = notFound();
    setTitle("Bibliotek");
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
  if (page.kind === "chapter") annotateGoals(root, M, page.lessons);

  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  /* Hopp till ett avsnitt. Bilder som laddas in under hoppet flyttar innehållet, så hoppet görs direkt
     och upprepas några gånger tills layouten är stilla – om studenten inte själv börjar scrolla. */
  let jumpGen = 0;
  let alive = true;
  const jump = (id, flash = false) => {
    const el = id && document.getElementById(id);
    if (!el) return false;
    for (let d = el; d; d = d.parentElement) if (d.tagName === "DETAILS") d.open = true;
    const gen = ++jumpGen;
    let moved = false;
    const stop = () => (moved = true);
    ["wheel", "touchstart", "keydown"].forEach((ev) => addEventListener(ev, stop, { once: true, passive: true }));
    const go = () => {
      if (moved || gen !== jumpGen || !alive) return;
      const t = document.getElementById(id);
      if (t) t.scrollIntoView({ behavior: "auto", block: "start" });
    };
    go();
    [120, 400, 900, 1600].forEach((ms) => setTimeout(go, ms));
    if (flash) {
      el.classList.remove("flash");
      void el.offsetWidth;
      el.classList.add("flash");
    }
    return true;
  };

  /* --- filter för tentaanalys och övning (kapitel och modulnivå) --- */
  const state = { filter: null, saveUnseen: true, run: null };
  const objsForPage = () => (page.kind === "chapter" ? page.lessons : page.objs || []);
  const renderExam = () => {
    const slot = root.querySelector("[data-exam-slot]");
    if (slot) slot.innerHTML = examSectionHtml(ctx, M, objsForPage(), state.filter, page.kind === "modexam" ? { select: true } : {});
  };
  const renderPractice = () => {
    const slot = root.querySelector("[data-practice-slot]");
    if (slot) slot.innerHTML = practiceSectionHtml(ctx, M, objsForPage(), state.filter, state.saveUnseen);
    state.run = null;
  };
  const setFilter = (f) => {
    state.filter = f || null;
    renderExam();
    renderPractice();
  };
  if (page.kind === "modexam" && q.mal) state.filter = q.mal;
  if (page.kind === "chapter") state.filter = page.lessons[0]?.id || null;

  /* --- landning: gamla länkar, sökträffar, tentafrågor och "fortsätt där du slutade" --- */
  const LEGACY = { "testa-dig": "ova", "tidigare-tentor": "examinerats", "du-ska-kunna": "goals", "det-viktigaste": "sammanfattning", "alla-bilder": "figurregister", kompletterande: "kompletterande" };
  const target = () => {
    if (page.kind !== "chapter") return null;
    const o = page.focus;
    if (o && (q.ova || q.till === "testa-dig")) {
      setFilter(o.id);
      return "ova";
    }
    if (o && q.fraga) {
      setFilter(o.id);
      const d = document.getElementById(`fq-${q.fraga}`);
      if (d) d.open = true;
      return d ? d.id : "examinerats";
    }
    if (o && q.till === "tidigare-tentor") {
      setFilter(o.id);
      return "examinerats";
    }
    if (q.till) {
      const t = LEGACY[q.till] || q.till;
      if (o && t === "goals") {
        const g = document.querySelector(`#${CSS.escape(P(o.id))} .lesson-goals`);
        if (g) g.open = true;
        return P(o.id);
      }
      if (o && document.getElementById(`${P(o.id)}--${t}`)) return `${P(o.id)}--${t}`;
      if (document.getElementById(t)) return t;
    }
    return null;
  };
  /* Stabil landning: hoppa direkt, och hoppa igen när bilder ovanför har laddats – om studenten inte själv har börjat scrolla. */
  const land = () => {
    const id = target();
    if (!id) return;
    let moved = false;
    const stop = () => (moved = true);
    ["wheel", "touchstart", "keydown", "mousedown"].forEach((ev) => addEventListener(ev, stop, { once: true, passive: true }));
    const go = (flash) => {
      if (moved || !alive) return;
      const el = document.getElementById(id);
      if (!el) return;
      for (let d = el; d; d = d.parentElement) if (d.tagName === "DETAILS") d.open = true;
      el.scrollIntoView({ behavior: "auto", block: "start" });
      if (flash) {
        el.classList.remove("flash");
        void el.offsetWidth;
        el.classList.add("flash");
      }
    };
    go(true);
    [350, 900, 1800].forEach((t) => setTimeout(() => go(false), t));
  };
  setTimeout(land, 60);

  /* --- övningsomgångar --- */
  const startRun = (mode) => {
    const ids = state.filter ? [state.filter] : objsForPage().map((o) => o.id);
    let items, pool, title;
    if (mode.startsWith("tenta")) {
      const t = oldExamPool(ctx, M, ids, state.saveUnseen);
      pool = t.items;
      items = mode === "tenta-kort" ? shuffle(pool).slice(0, 5) : pool.slice();
      title = mode === "tenta-kort" ? "Gamla tentafrågor · kort genomgång" : "Gamla tentafrågor · hela uppsättningen";
    } else {
      const o = ovningPool(M, ids);
      pool = o.items;
      items = [...pool.filter((x) => x.kind === "open"), ...shuffle(pool.filter((x) => x.kind !== "open"))].slice(0, OVNING_RUN);
      title = "Instuderingsfrågor och nya övningsfrågor";
    }
    state.run = { pool, shown: new Set(items.map((x) => x.id)), mode, n: items.length };
    const run = root.querySelector("[data-run]");
    run.innerHTML = `<section class="lib-quiz" data-quiz><header class="lib-quiz-head"><div><h3>${esc(title)}</h3>
        <p class="muted small">Tryck på "Jag gissar" innan du svarar om du inte är säker – då räknas ett rätt svar som gissning, inte som visad förståelse. Efter varje svar kan du gå tillbaka till stycket som förklarar frågan.</p></div>
        <div class="lib-score" data-score><b>0</b> / <span data-n>${items.filter((x) => x.kind === "mcq").length}</span> rätt<span class="small" data-guesses></span></div></header>
      <ol class="lq-list">${items.map((it, i) => practiceItemHtml(ctx, M, it, i)).join("")}</ol>
      <p class="btn-row"><button type="button" class="btn" data-start="${esc(mode)}">↻ Ny omgång</button></p></section>`;
    jump("ova");
  };
  const sameCandidate = (qid) => {
    const r = state.run;
    if (!r) return null;
    const it = r.pool.find((x) => x.id === qid);
    if (!it) return null;
    const rest = r.pool.filter((x) => !r.shown.has(x.id) && x.objective === it.objective);
    return (it.princip && rest.find((x) => x.princip === it.princip)) || (it.sektion && rest.find((x) => x.sektion === it.sektion)) || rest.find((x) => x.kind === it.kind) || null;
  };
  const afterAnswer = (li) => {
    const b = li.querySelector("[data-act=same]");
    if (b) b.hidden = !sameCandidate(li.dataset.qid);
    const panel = root.querySelector(`.lesson-end[data-prog="${CSS.escape(li.dataset.obj)}"]`);
    const o = M.byId.get(li.dataset.obj);
    if (panel && o) panel.outerHTML = lessonEndHtml(o, practiceCounts(ctx, M, [o.id]).ovning + practiceCounts(ctx, M, [o.id]).tenta);
  };
  const score = (quiz) => {
    if (!quiz) return;
    const ok = quiz.querySelectorAll(".lq.answered.ok:not(.open)").length;
    const guessed = quiz.querySelectorAll(".lq.answered.ok.guessed").length;
    const b = quiz.querySelector("[data-score] b");
    if (b) b.textContent = String(ok);
    const n = quiz.querySelector("[data-n]");
    if (n) n.textContent = String(quiz.querySelectorAll(".lq:not(.open)").length);
    const g = quiz.querySelector("[data-guesses]");
    if (g) g.textContent = guessed ? ` · ${guessed} gissade` : "";
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
    on(root, "click", "[data-exfilter]", (e, el) => {
      const y = el.closest("section")?.id;
      setFilter(el.dataset.exfilter);
      if (y) document.getElementById(y)?.scrollIntoView({ block: "start" });
    }),
    on(root, "change", "[data-exselect]", (e, el) => {
      state.filter = el.value || null;
      renderExam();
      history.replaceState(null, "", `#/bibliotek/modul/${page.nr}/tentor${el.value ? `?mal=${encodeURIComponent(el.value)}` : ""}`);
    }),
    on(root, "change", "[data-save-unseen]", (e, el) => {
      state.saveUnseen = el.checked;
      renderPractice();
    }),
    on(root, "click", "[data-goto]", (e, el) => {
      e.preventDefault();
      setFilter(el.dataset.filter);
      jump(el.dataset.goto, true);
    }),
    on(root, "click", "[data-start]", (e, el) => startRun(el.dataset.start)),
    on(root, "click", "[data-act=same]", (e, el) => {
      const c = sameCandidate(el.dataset.qid);
      if (!c) return;
      state.run.shown.add(c.id);
      const list = el.closest(".lq-list");
      list.insertAdjacentHTML("beforeend", practiceItemHtml(ctx, M, c, list.children.length));
      el.hidden = true;
      score(el.closest("[data-quiz]"));
      list.lastElementChild.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
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
      li.querySelector(".lq-feedback").hidden = false;
      li.querySelector(".lq-verdict").textContent = ok
        ? guessed ? "Rätt – men du gissade, så frågan räknas inte som visad förståelse än." : "Rätt!"
        : `Fel – rätt svar är ${right.map((n) => LETTERS[n]).join(", ")}. Du valde ${LETTERS[k]}.`;
      const ch = li.querySelector(".lq-chosen");
      if (ch && !ok && !li.querySelector(".lq-dist")) {
        ch.hidden = false;
        ch.innerHTML = `<b>Ditt val:</b> ”${esc(el.querySelector("span:last-child").textContent)}” – jämför med förklaringen ovan och läs stycket nedan.`;
      }
      const g = li.querySelector("[data-act=guess]");
      if (g) g.textContent = guessed ? "🤔 Markerad som gissning" : "🤔 Jag gissade";
      progress.record(li.dataset.qid, { objective: li.dataset.obj, correct: ok, guessed });
      score(li.closest("[data-quiz]"));
      afterAnswer(li);
    }),
    on(root, "click", "[data-act=reveal]", (e, el) => {
      const li = el.closest(".lq");
      li.querySelector(".lq-feedback").hidden = false;
      el.remove();
    }),
    on(root, "click", "[data-self]", (e, el) => {
      const li = el.closest(".lq");
      const v = el.dataset.self;
      li.classList.add("answered", v === "bad" ? "fail" : "ok");
      if (v === "mid") li.classList.add("guessed");
      li.querySelectorAll("[data-self]").forEach((b) => b.setAttribute("aria-pressed", String(b === el)));
      progress.record(li.dataset.qid, { objective: li.dataset.obj, correct: v !== "bad", guessed: v === "mid" });
      afterAnswer(li);
    }),
    on(root, "click", "[data-read]", (e, el) => {
      e.preventDefault();
      const oid = el.dataset.read;
      const id = bestSection(root, oid, el.dataset.qtext, el.dataset.sec);
      if (id) jump(id, true);
      else {
        const sec = el.dataset.sec;
        ctx.go(`#/bibliotek/${encodeURIComponent(oid)}${sec ? `?till=${encodeURIComponent(sec)}` : ""}`);
      }
    }),
    on(root, "click", "[data-act=read]", (e, el) => {
      const o = M.byId.get(el.dataset.oid);
      if (!o) return;
      const now = !progress.isRead(o.id);
      progress.setRead(o.id, now);
      const panel = el.closest(".lesson-end");
      const c = practiceCounts(ctx, M, [o.id]);
      panel.outerHTML = lessonEndHtml(o, c.ovning + c.tenta);
      root.querySelector(`.lesson-end[data-prog="${CSS.escape(o.id)}"]`)?.classList.add("just-done");
      root.querySelectorAll(`.toc-lesson[data-tl="${P(o.id)}"] .toc-check`).forEach((x) => {
        x.classList.toggle("on", now);
        x.textContent = now ? "✓" : "";
      });
    }),
    on(root, "change", "[data-goal]", (e, el) => progress.setGoal(el.dataset.goal, el.checked)),
    on(root, "click", "[data-act=reroll]", () => ctx.render()),
    on(root, "click", "[data-zoom]", (e, el) => {
      if (el.closest("summary")) return;
      openLightbox(el.dataset.zoom, el.dataset.caption, el);
    }),
    on(root, "click", "[data-jump]", (e, el) => {
      e.preventDefault();
      jump(el.dataset.jump, true);
      el.closest("details.toc-m")?.removeAttribute("open");
    }),
    on(root, "toggle", "details.exq", () => {}),
  ];
  // gamla quizvyer (modul- och submodulquiz) använder samma knappar som tidigare
  const stopSpy = page.kind === "chapter" ? chapterSpy(root, page) : () => {};
  return () => {
    alive = false;
    offs.forEach((off) => typeof off === "function" && off());
    stopSpy();
    document.querySelector(".lightbox")?.remove();
  };
}

/** Markerar aktuellt avsnitt i innehållsförteckningen och sparar exakt läsposition för "Fortsätt där du slutade". */
function chapterSpy(root, page) {
  const links = [...root.querySelectorAll("[data-toc]")];
  if (!links.length || !("IntersectionObserver" in window)) return () => {};
  const targets = [...new Set(links.map((a) => a.dataset.toc))].map((id) => document.getElementById(id)).filter(Boolean);
  const visible = new Set();
  let saveT = 0;
  const save = (id) => {
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      const lesson = document.getElementById(id)?.closest(".lesson");
      const oid = lesson?.dataset.lesson;
      if (!oid) return;
      const o = page.lessons.find((x) => x.id === oid);
      const sec = id.startsWith(`${P(oid)}--`) ? id.slice(P(oid).length + 2) : "";
      const t = document.getElementById(id)?.querySelector("h3")?.textContent.replace(/mål [\d ·]+$/, "").trim();
      progress.setLast(`#/bibliotek/${encodeURIComponent(oid)}${sec ? `?till=${encodeURIComponent(sec)}` : ""}`, `${oid} ${o?.titel || ""}${t && sec ? ` – ${t}` : ""}`);
    }, 900);
  };
  const order = new Map(targets.map((t, i) => [t.id, i]));
  const io = new IntersectionObserver(
    (entries) => {
      for (const en of entries) (en.isIntersecting ? visible.add : visible.delete).call(visible, en.target.id);
      const cur = [...visible].sort((a, b) => order.get(a) - order.get(b)).pop();
      if (!cur) return;
      links.forEach((a) => a.classList.toggle("on", a.dataset.toc === cur));
      const lesson = document.getElementById(cur)?.closest(".lesson");
      root.querySelectorAll(".toc-lesson").forEach((li) => li.classList.toggle("cur", li.dataset.tl === lesson?.id));
      save(cur);
    },
    { rootMargin: "-90px 0px -60% 0px" }
  );
  targets.forEach((t) => io.observe(t));
  return () => {
    io.disconnect();
    clearTimeout(saveT);
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

