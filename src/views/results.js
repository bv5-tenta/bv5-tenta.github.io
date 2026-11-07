/* Resultatanalys (dashboard) och självbedömning av fritextsvar. */

import { esc, on, toast, ringSvg, timeChartSvg, setTitle, lightbox } from "../ui/dom.js";
import { formatDuration, formatDateTime, pct } from "../core/text.js";
import { META_LABELS, hasAnswer, gradeResponse, maxPoints } from "../core/grading.js";
import { exportAnkiDialog } from "./anki.js";

const LETTERS = "ABCDEFGHIJ";

const META_HELP = {
  sakerRatt: "Rätt utan flagga",
  gissatRatt: "🟨 men rätt – kan vara tur",
  osakerFel: "🟨 och fel",
  sakerFel: "Fel trots att du kände dig säker",
  kanEj: "🟥 markerade",
  obesvarad: "Inget svar",
  vantar: "Fritext som inte bedömts",
};

export function reviewItemHtml(store, q, r, opts = {}) {
  const g = gradeResponse(q, r);
  const lib = store.library;
  const link = lib.linkFor(q);
  const expl = lib.explanationFor(q);
  const exam = store.exams.get(q.exam_id);
  const chosen = r?.selected || [];
  const tags = [];
  if (!g.scored) tags.push(`<span class="chip">Struken</span>`);
  else if (g.pending) tags.push(`<span class="chip warn">Väntar på bedömning</span>`);
  else if (g.is_correct) tags.push(`<span class="chip ok">Rätt</span>`);
  else if (!hasAnswer(q, r)) tags.push(`<span class="chip">Obesvarad</span>`);
  else tags.push(`<span class="chip err">Fel</span>`);
  if (r?.flag_unsure) tags.push(`<span class="chip unsure">🟨 Osäker</span>`);
  if (r?.flag_cannot) tags.push(`<span class="chip cannot">🟥 Kan ej</span>`);
  if (r?.time_ms) tags.push(`<span class="chip">${formatDuration(r.time_ms)}</span>`);

  const optionLines = (q.options || [])
    .map((o, i) => {
      const isSel = chosen.includes(o.ordinal);
      const cls = o.is_correct ? "correct" : isSel ? "wrong" : "";
      return `<li><div class="option ${cls}" style="cursor:default;padding:9px 12px;font-size:15px"><span class="key">${LETTERS[i]}</span><span>${esc(o.text)}${isSel ? ` <b>· ditt svar</b>` : ""}${o.is_correct ? ` <b>· rätt</b>` : ""}</span></div></li>`;
    })
    .join("");
  const media = (q.media || []).map((m) => `<img src="${esc(m.data_url || m.url)}" alt="${esc(m.alt || "Figur")}" style="max-height:220px;border-radius:8px;border:1px solid var(--line);background:#fff;cursor:zoom-in" data-zoom loading="lazy">`).join(" ");
  const objective = link.objective;
  const theme = lib.theme(q.theme_id);
  return `<div class="review-item" id="q-${esc(q.id)}">
    <div class="head"><b>Fråga ${q.number}</b>${opts.showExam ? `<span class="muted small">${esc(exam?.code || q.exam_code || "")}</span>` : ""}${tags.join("")}<span class="muted small">${esc(lib.moduleName(q.modul))}</span></div>
    <p class="stem">${esc(q.stem)}</p>
    ${media ? `<div class="q-media" style="display:flex;gap:8px;flex-wrap:wrap">${media}</div>` : ""}
    ${q.type === "freetext"
      ? `<div class="side-by-side"><div><b class="small muted">Ditt svar</b><div class="explain" style="white-space:pre-wrap">${esc(r?.free_text || "–")}</div></div><div><b class="small muted">Bedömningsmall</b><div class="explain">${(q.rubric || []).map((x) => `${esc(x.criterion)} (${x.points} p)`).join("<br>") || esc(q.explanation || "–")}</div></div></div>`
      : `<ul class="options" style="gap:6px">${optionLines}</ul>`}
    ${expl.text ? `<div class="explain"><b>${expl.source === "fraga" ? "Förklaring" : "Ur kursbiblioteket"}:</b> ${esc(expl.text)}${q.key_points?.length ? `<ul>${q.key_points.map((k) => `<li>${esc(k)}</li>`).join("")}</ul>` : ""}</div>` : ""}
    ${q.correction_note ? `<div class="notice warn small" style="margin-top:8px">${esc(q.correction_note)}</div>` : ""}
    <a class="lib-link" href="${esc(link.url)}" target="_blank" rel="noopener">📖 ${link.level === "objective" ? "Lärandemål" : "Läs i"} ${esc(link.label)}${theme ? ` · ${esc(theme.tema)}` : ""} ↗</a>
    ${!objective && link.level === "module" ? `<span class="small muted"> (modulen saknar nedbrutna lärandemål i biblioteket)</span>` : ""}
  </div>`;
}

export async function resultsView(ctx, root, params) {
  const { store } = ctx;
  const data = await store.attemptSummary(params.id);
  if (!data) {
    root.innerHTML = `<div class="empty"><p>Försöket finns inte.</p><a class="btn" href="#/historik">Historik</a></div>`;
    return;
  }
  const { attempt: a, questions, responses, summary: s } = data;
  if (!a.submitted_at) {
    ctx.go(`#/forsok/${a.id}`, true);
    return;
  }
  if (!a.locked_at && s.pending) {
    ctx.go(`#/forsok/${a.id}/bedom`, true);
    return;
  }
  setTitle(`Resultat ${a.title}`);
  const lib = store.library;
  let tab = "wrong";
  let metaFilter = null;

  const answered = s.items.filter((i) => hasAnswer(i.question, i.response)).length;
  const timeItems = s.items.map((i) => ({
    n: i.question.number, ms: Number(i.response?.time_ms || 0),
    outcome: i.response?.flag_cannot ? "cannot" : i.response?.flag_unsure ? "unsure" : i.grade.is_correct ? "correct" : hasAnswer(i.question, i.response) ? "wrong" : "none",
  }));
  const slowest = [...s.items].sort((x, y) => (y.response?.time_ms || 0) - (x.response?.time_ms || 0)).slice(0, 5);

  const ankiItems = () => {
    const out = new Map();
    const add = (i, cat) => {
      const e = out.get(i.question.id) || { question: i.question, category: [] };
      e.category.push(cat);
      out.set(i.question.id, e);
    };
    s.wrong.forEach((i) => add(i, hasAnswer(i.question, i.response) ? "Fel" : "Obesvarad"));
    s.unsure.forEach((i) => add(i, "Osäker"));
    s.cannot.forEach((i) => add(i, "Kan ej"));
    return [...out.values()];
  };

  function listFor() {
    let items;
    if (metaFilter) items = s.items.filter((i) => i.category === metaFilter);
    else if (tab === "wrong") items = s.wrong;
    else if (tab === "unsure") items = s.unsure;
    else if (tab === "cannot") items = s.cannot;
    else items = s.items;
    return items;
  }

  function renderList() {
    const items = listFor();
    root.querySelector("#review-list").innerHTML = items.length
      ? items.map((i) => reviewItemHtml(store, i.question, i.response)).join("")
      : `<div class="empty"><div class="big">🎉</div><p>Inga frågor i den här listan.</p></div>`;
    for (const b of root.querySelectorAll("[data-tab]")) b.setAttribute("aria-selected", String(!metaFilter && b.dataset.tab === tab));
    root.querySelector("#meta-filter-note").innerHTML = metaFilter
      ? `<div class="notice small">Visar: <b>${esc(META_LABELS[metaFilter])}</b> · <button class="btn small ghost" data-act="clear-meta">Visa flikarna igen</button></div>`
      : "";
  }

  const passPct = s.max ? (s.pass_points / s.max) * 100 : 0;
  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>${esc(a.title)}</h1>
        <p class="lead">${formatDateTime(a.submitted_at)} · ${a.mode === "exam" ? "Tentamen" : "Träning"} · ${questions.length} frågor</p>
      </div>
      <div class="btn-row">
        <button class="btn" data-act="anki">Exportera till Anki</button>
        <button class="btn" data-act="practice" ${ankiItems().length ? "" : "disabled"}>Öva på dessa fel</button>
        ${a.exam_id ? `<button class="btn dark" data-act="retake">Gör om tentan</button>` : ""}
      </div>
    </div>

    <div class="card">
      <div class="score-hero">
        ${ringSvg(s.percent, s.passed, s.passed === null ? "väntar" : s.passed ? "godkänd" : "underkänd")}
        <div>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <span style="font-size:28px;font-weight:700">${s.score} / ${s.max} p</span>
            ${s.passed === null ? `<span class="chip warn">Väntar på bedömning</span>` : s.passed ? `<span class="chip ok">Godkänd</span>` : `<span class="chip err">Underkänd</span>`}
          </div>
          <div class="passbar" aria-hidden="true"><div class="fill" style="width:${Math.min(100, s.percent)}%"></div><div class="mark" style="left:${passPct}%"></div></div>
          <div class="passbar-legend"><span>0</span><span>Godkänt-gräns ${s.pass_points} p (${Math.round(passPct)} %)</span><span>${s.max}</span></div>
          <div class="grid cols-3" style="margin-top:16px">
            <div><div class="muted small">Total tid</div><b>${formatDuration(a.active_ms || s.total_ms)}</b></div>
            <div><div class="muted small">Snitt per fråga</div><b>${formatDuration(s.avg_ms)}</b></div>
            <div><div class="muted small">Besvarade</div><b>${answered} av ${questions.length}</b></div>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>Metakognition</h2>
      <p class="muted small" style="margin-top:-6px">Hur väl stämde din känsla med resultatet? Klicka på en ruta för att se frågorna.</p>
      <div class="meta-grid">
        ${["sakerRatt", "gissatRatt", "osakerFel", "sakerFel", "kanEj", "obesvarad"]
          .map((k) => `<button class="meta-tile ${k}" data-meta="${k}"><div class="n">${s.meta[k] || 0}</div><div class="t">${META_LABELS[k]}</div><div class="d">${META_HELP[k]}</div></button>`)
          .join("")}
      </div>
      ${s.meta.sakerFel ? `<div class="notice err small" style="margin-top:12px"><b>${s.meta.sakerFel} säkra fel</b> är de viktigaste att gå igenom – där tror du att du kan, men har fel bild.</div>` : ""}
      ${s.meta.gissatRatt ? `<div class="notice warn small"><b>${s.meta.gissatRatt} rätt på osäkerhet</b> räknas inte som bemästrade i "Öva på dina fel" förrän du svarar rätt utan flagga.</div>` : ""}
    </div>

    <div class="grid cols-2" style="margin-top:16px">
      <div class="card flat">
        <h2>Per modul</h2>
        <div class="bars">${s.by_module
          .map((m) => {
            const p = pct(m.score, m.max);
            return `<div class="bar-row"><span>${esc(lib.moduleName(m.modul))}</span><span class="track"><i class="${p < 50 ? "low" : p < 70 ? "mid" : ""}" style="width:${p}%"></i></span><span class="num">${m.score}/${m.max} · ${p}%</span></div>`;
          })
          .join("")}</div>
      </div>
      <div class="card flat">
        <h2>Tid per fråga</h2>
        ${timeChartSvg(timeItems)}
        <div class="small muted" style="display:flex;gap:12px;flex-wrap:wrap;margin:6px 0 10px">
          <span><i class="legend sw" style="display:inline-block;width:10px;height:10px;background:var(--teal);border-radius:2px"></i> rätt</span>
          <span><i style="display:inline-block;width:10px;height:10px;background:var(--err);border-radius:2px"></i> fel</span>
          <span><i style="display:inline-block;width:10px;height:10px;background:var(--unsure);border-radius:2px"></i> osäker</span>
          <span><i style="display:inline-block;width:10px;height:10px;background:var(--cannot);border-radius:2px"></i> kan ej</span>
        </div>
        <div class="small"><b>Längst tid:</b> ${slowest.map((i) => `<a href="#q-${esc(i.question.id)}" data-jump="${esc(i.question.id)}">#${i.question.number}</a> (${formatDuration(i.response?.time_ms || 0)})`).join(" · ")}</div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="tabs" role="tablist">
        <button data-tab="wrong" role="tab">Fel <span class="count">${s.wrong.length}</span></button>
        <button data-tab="unsure" role="tab">🟨 Osäkra <span class="count">${s.unsure.length}</span></button>
        <button data-tab="cannot" role="tab">🟥 Kan ej <span class="count">${s.cannot.length}</span></button>
        <button data-tab="all" role="tab">Alla <span class="count">${s.items.length}</span></button>
      </div>
      <div id="meta-filter-note"></div>
      <div id="review-list"></div>
    </div>`;
  renderList();

  const offs = [];
  offs.push(on(root, "click", "[data-tab]", (e, el) => { tab = el.dataset.tab; metaFilter = null; renderList(); }));
  offs.push(on(root, "click", "[data-meta]", (e, el) => {
    metaFilter = el.dataset.meta;
    renderList();
    root.querySelector("#review-list").scrollIntoView({ behavior: "smooth", block: "start" });
  }));
  offs.push(on(root, "click", "[data-zoom]", (e, el) => lightbox(el.src, el.alt)));
  offs.push(on(root, "click", "[data-jump]", (e, el) => {
    e.preventDefault();
    tab = "all";
    metaFilter = null;
    renderList();
    document.getElementById(`q-${el.dataset.jump}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }));
  offs.push(on(root, "click", "[data-act]", async (e, el) => {
    const act = el.dataset.act;
    if (act === "clear-meta") { metaFilter = null; renderList(); }
    else if (act === "anki") exportAnkiDialog(ctx, ankiItems(), `BV5-${a.title.replace(/[^\wåäöÅÄÖ-]+/g, "-")}`);
    else if (act === "practice") {
      const ids = ankiItems().map((i) => i.question.id);
      const n = await store.createAttempt({ mode: "practice", title: `Träning: fel från ${a.title}`, question_ids: ids });
      ctx.go(`#/forsok/${n.id}`);
    } else if (act === "retake") {
      const exam = store.exams.get(a.exam_id);
      const n = await store.createAttempt({ mode: "exam", title: exam?.title || a.title, exam_id: a.exam_id, question_ids: a.question_ids, duration_min: a.duration_min });
      ctx.go(`#/forsok/${n.id}`);
    }
  }));
  return () => offs.forEach((f) => f());
}

/* ---------- självbedömning av fritext ---------- */
export async function gradeView(ctx, root, params) {
  const { store } = ctx;
  const data = await store.attemptSummary(params.id);
  if (!data) {
    root.innerHTML = `<div class="empty"><p>Försöket finns inte.</p></div>`;
    return;
  }
  const { attempt: a, questions, responses } = data;
  if (a.locked_at) {
    ctx.go(`#/forsok/${a.id}/resultat`, true);
    return;
  }
  const free = questions.filter((q) => q.type === "freetext" && q.status !== "struken");
  setTitle(`Bedöm ${a.title}`);
  const aiOn = ctx.cloud.enabled && ctx.config.AI_GRADING;

  function rubricOf(q) {
    return q.rubric?.length ? q.rubric : [{ criterion: q.explanation ? `Svaret täcker: ${q.explanation}` : "Svaret är korrekt och fullständigt", points: Number(q.points || 1) }];
  }

  function render() {
    root.innerHTML = `
      <div class="page-head"><div><h1>Bedöm fritextsvaren</h1><p class="lead">Jämför ditt svar med bedömningsmallen och ge poäng per kriterium. Resultatet låses när du är klar.</p></div></div>
      ${free.map((q) => {
        const r = responses.get(q.id) || store.newResponse(a.id, q.id);
        const rub = rubricOf(q);
        const g = r.self_grade || {};
        return `<div class="card" data-q="${esc(q.id)}">
          <div class="q-head"><span class="q-num">Fråga ${q.number}</span><span class="chip">${maxPoints({ ...q, rubric: rub })} p</span></div>
          <p class="stem" style="font-weight:600">${esc(q.stem)}</p>
          <div class="side-by-side">
            <div><b class="small muted">Ditt svar</b><div class="explain" style="white-space:pre-wrap;min-height:120px">${esc(r.free_text || "– inget svar –")}</div></div>
            <div><b class="small muted">Bedömningsmall</b>
              ${rub.map((x, i) => `<div class="field" style="margin:8px 0">
                <div style="display:flex;justify-content:space-between;gap:10px"><span>${esc(x.criterion)}</span><span class="muted small">${x.points} p</span></div>
                <input type="range" min="0" max="${x.points}" step="${x.points >= 2 ? 0.5 : 0.5}" value="${Number(g[i] ?? 0)}" data-crit="${i}" aria-label="Poäng för kriterium ${i + 1}">
                <span class="small" data-crit-val="${i}">${Number(g[i] ?? 0)} p</span></div>`).join("")}
              ${r.ai_grade ? `<div class="notice small"><b>AI-förslag:</b> ${esc(r.ai_grade.feedback || "")} (${r.ai_grade.score} p)</div>` : ""}
              ${aiOn ? `<button class="btn small" data-ai="${esc(q.id)}">Föreslå poäng med AI</button>` : ""}
            </div>
          </div>
        </div>`;
      }).join("")}
      <div class="sticky-actions"><button class="btn primary" data-act="lock">Lås resultatet</button></div>`;
  }
  render();

  const offs = [];
  offs.push(on(root, "input", "[data-crit]", async (e, el) => {
    const card = el.closest("[data-q]");
    const qid = card.dataset.q;
    const grade = {};
    for (const inp of card.querySelectorAll("[data-crit]")) grade[inp.dataset.crit] = Number(inp.value);
    card.querySelector(`[data-crit-val="${el.dataset.crit}"]`).textContent = `${el.value} p`;
    const q = store.questions.get(qid);
    if (!q.rubric?.length) q.rubric = rubricOf(q);
    const r = await store.saveSelfGrade(a.id, qid, grade);
    responses.set(qid, r);
  }));
  offs.push(on(root, "click", "[data-ai]", async (e, el) => {
    const q = store.questions.get(el.dataset.ai);
    const r = responses.get(q.id);
    el.disabled = true;
    el.textContent = "Bedömer …";
    try {
      const res = await ctx.cloud.fn("ai-grade", { question: q.stem, rubric: rubricOf(q), answer: r?.free_text || "" });
      r.ai_grade = res;
      if (Array.isArray(res.per_criterion)) {
        const grade = {};
        res.per_criterion.forEach((p, i) => { grade[i] = Number(p) || 0; });
        r.self_grade = grade;
      }
      await store.saveResponses([r]);
      if (r.self_grade) await store.saveSelfGrade(a.id, q.id, r.self_grade);
      render();
      toast("AI-förslaget är ifyllt – justera vid behov innan du låser.");
    } catch (err) {
      toast(`AI-bedömningen misslyckades: ${err.message}`, "err", 7000);
      el.disabled = false;
      el.textContent = "Föreslå poäng med AI";
    }
  }));
  offs.push(on(root, "click", "[data-act=lock]", async () => {
    for (const q of free) {
      const r = responses.get(q.id);
      if (!r?.self_grade) await store.saveSelfGrade(a.id, q.id, {});
    }
    await store.lockAttempt(a.id);
    ctx.sync?.flush();
    ctx.go(`#/forsok/${a.id}/resultat`);
  }));
  return () => offs.forEach((f) => f());
}
