/* Simulerad RAT (iRAT/tRAT) per modul – samma uppbyggnad som InteDashboard:
   mörk toppbalk med Back, ljusblå rubrikrad, "Question Status" till vänster och en fråga i taget.
   Efter inlämning: Correct/Incorrect/Missed per fråga, facit med förklaring och en analys
   per delmodul och lärandemål med länkar tillbaka till biblioteket + Anki-export som för tentorna. */

import { esc, on, toast, setTitle, confirmDialog, lightbox } from "../ui/dom.js";
import { formatDuration, pct } from "../core/text.js";
import { gradeResponse, hasAnswer } from "../core/grading.js";
import { exportAnkiDialog } from "./anki.js";

const LETTERS = "ABCDEFGH";

function utcLabel(d) {
  const off = -d.getTimezoneOffset() / 60;
  return `UTC ${off >= 0 ? "+" : "−"}${Math.abs(off)}`;
}
function selectedAt(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${date}, ${time} (${utcLabel(d)})`;
}
function clock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
const objUrl = (id) => `#/bibliotek/${encodeURIComponent(id)}`;

/* ---------- översikt: alla RAT ---------- */
async function hub(ctx, root) {
  const { store } = ctx;
  setTitle("RAT inför modulerna");
  const rats = store.listRats();
  const attempts = (await store.listAttempts()).filter((a) => a.mode === "rat");
  root.innerHTML = `
    <div class="page-head"><div>
      <p class="welcome-kicker">Basvetenskap 5 · Del 2</p>
      <h1>RAT inför modulerna</h1>
      <p class="lead">Simulerade iRAT/tRAT i samma format som InteDashboard: en fråga i taget, fem alternativ och inlämning av hela testet.
      Frågorna följer modulens delmoduler och lärandemål och går ibland lite över kursnivå – precis som riktiga RAT.</p>
    </div></div>
    <div class="grid cols-2">
      ${rats.map((r) => {
        const mine = attempts.filter((a) => a.exam_id === r.id);
        const open = mine.find((a) => !a.submitted_at);
        const done = mine.filter((a) => a.locked_at);
        const best = done.length ? Math.max(...done.map((a) => pct(a.score, a.max_score))) : null;
        return `<div class="card rat-hubcard">
          <div class="rat-hubkicker">Modul ${r.modul}</div>
          <h2>${esc(r.title.replace(/^BV5 RAT modul \d+ /, ""))}</h2>
          <p class="muted small">${r.question_count} frågor · ${r.submoduler.length} delmoduler · ca ${r.duration_min} min</p>
          <p class="small">${r.submoduler.map(([id, t]) => `<span class="chip">${esc(id)} ${esc(t)}</span>`).join(" ")}</p>
          <div class="btn-row">
            ${open ? `<a class="btn primary" href="#/rat/${r.modul}/${open.id}">Fortsätt</a>` : `<a class="btn primary" href="#/rat/${r.modul}?ny=1">Starta RAT</a>`}
            ${done[0] ? `<a class="btn" href="#/rat/${r.modul}/${done[0].id}?vy=analys">Senaste analys · ${pct(done[0].score, done[0].max_score)} %</a>` : ""}
          </div>
          ${best !== null ? `<p class="small muted" style="margin:8px 0 0">Bästa resultat: <b>${best} %</b> · ${done.length} genomförda</p>` : ""}
        </div>`;
      }).join("")}
    </div>
    <div class="notice small" style="margin-top:16px">Frågorna är simulerade utifrån lärandemålen och hur tidigare RAT i del 1 har formulerats – de är inte officiella RAT-frågor.
    Fel och obesvarade frågor hamnar i <a href="#/ova">Öva på dina fel</a> och kan exporteras till Anki.</div>`;
}

/* ---------- start/återuppta ---------- */
async function startOrResume(ctx, modul, query) {
  const { store } = ctx;
  const exam = store.ratFor(modul);
  if (!exam) return null;
  const mine = (await store.listAttempts()).filter((a) => a.mode === "rat" && a.exam_id === exam.id);
  const open = mine.find((a) => !a.submitted_at);
  if (open) return open;                      // ett påbörjat försök åt gången – fortsätt det
  const ids = store.examQuestions(exam.id).map((q) => q.id);
  return store.createAttempt({ mode: "rat", title: exam.title, exam_id: exam.id, question_ids: ids, duration_min: exam.duration_min });
}

/* ---------- själva testet ---------- */
export async function ratView(ctx, root, params) {
  const { store } = ctx;
  if (!params.modul) return hub(ctx, root);
  if (!params.attempt) {
    const a = await startOrResume(ctx, params.modul, params.query || {});
    if (!a) {
      root.innerHTML = `<div class="empty"><p>Det finns ingen RAT för modul ${esc(params.modul)} ännu.</p><a class="btn" href="#/rat">Alla RAT</a></div>`;
      return;
    }
    ctx.go(`#/rat/${params.modul}/${a.id}`, true);
    return;
  }

  let attempt = await store.getAttempt(params.attempt);
  if (!attempt || attempt.mode !== "rat") {
    root.innerHTML = `<div class="empty"><p>RAT-försöket finns inte.</p><a class="btn" href="#/rat">Alla RAT</a></div>`;
    return;
  }
  const exam = store.exams.get(attempt.exam_id) || { rubrik: attempt.title, modul: params.modul };
  const qs = store.questionsByIds(attempt.question_ids);
  const responses = await store.getResponses(attempt.id);
  const resp = (q) => {
    let r = responses.get(q.id);
    if (!r) {
      r = store.newResponse(attempt.id, q.id);
      responses.set(q.id, r);
    }
    return r;
  };
  const N = qs.length;
  let idx = Math.max(0, Math.min(N - 1, attempt.current_index || 0));
  let vy = attempt.submitted_at && params.query?.vy !== "fragor" ? (params.query?.vy === "fraga" ? "q" : "analys") : "q";
  if (params.query?.q) {
    idx = Math.max(0, Math.min(N - 1, Number(params.query.q) - 1));
    vy = "q";
  }
  let filter = "all";
  setTitle(`${attempt.title}`);

  const submitted = () => !!attempt.submitted_at;
  const status = (q) => {
    const r = responses.get(q.id);
    if (!submitted()) return hasAnswer(q, r) ? "answered" : "unanswered";
    if (!hasAnswer(q, r)) return "missed";
    return gradeResponse(q, r).is_correct ? "correct" : "incorrect";
  };
  const LABEL = { answered: "Answered", unanswered: "Unanswered", correct: "Correct", incorrect: "Incorrect", missed: "Missed" };

  /* tid: räknas bara när fliken är synlig och testet inte är inlämnat */
  let t0 = performance.now();
  const flushTime = () => {
    if (submitted()) return;
    const now = performance.now();
    const dt = now - t0;
    t0 = now;
    if (dt <= 0 || dt > 10 * 60000) return;
    const r = resp(qs[idx]);
    r.time_ms = Number(r.time_ms || 0) + dt;
    attempt.active_ms = Number(attempt.active_ms || 0) + dt;
  };
  const persist = async (rs = []) => {
    flushTime();
    attempt.current_index = idx;
    await store.saveResponses([resp(qs[idx]), ...rs]);
    await store.saveAttempt(attempt);
  };

  root.innerHTML = `<div class="rat">
    <header class="rat-top">
      <button class="rat-back" data-act="back" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>Back</button>
      <div class="rat-logo"><span class="rat-logo-mark">BV5</span> RAT</div>
      <div class="rat-top-right"><span class="rat-clock" title="Tid i testet"></span><span class="rat-user">${esc(ctx.auth.displayName() || "Student")}</span></div>
    </header>
    <div class="rat-sub"><b>IRAT</b><span class="rat-sep">|</span><span>${esc(String(exam.rubrik || attempt.title).replace(/^IRAT\s*\|\s*/i, ""))}</span><span class="rat-simtag">simulerad</span></div>
    <div class="rat-body">
      <aside class="rat-side" aria-label="Question Status"></aside>
      <main class="rat-main" tabindex="-1"></main>
    </div>
  </div>`;
  const side = root.querySelector(".rat-side");
  const main = root.querySelector(".rat-main");
  const clockEl = root.querySelector(".rat-clock");
  const tick = () => {
    const live = submitted() ? 0 : document.visibilityState === "visible" ? performance.now() - t0 : 0;
    clockEl.textContent = clock(Number(attempt.active_ms || 0) + live);
  };
  tick();
  const timer = setInterval(tick, 1000);

  function renderSide() {
    const opts = submitted()
      ? [["all", "All"], ["correct", "Correct"], ["incorrect", "Incorrect"], ["missed", "Missed"]]
      : [["all", "All"], ["answered", "Answered"], ["unanswered", "Unanswered"]];
    if (!opts.some(([k]) => k === filter)) filter = "all";
    const answered = qs.filter((q) => hasAnswer(q, responses.get(q.id))).length;
    const rows = qs
      .map((q, i) => ({ q, i, st: status(q) }))
      .filter((x) => filter === "all" || x.st === filter)
      .map(({ q, i, st }) => `<li><button type="button" class="rat-qrow st-${st} ${i === idx && vy === "q" ? "cur" : ""}" data-go="${i}" aria-current="${i === idx && vy === "q"}">
        <span class="rat-qn">Q${i + 1}</span><span class="rat-pill ${st}">${LABEL[st]}</span></button></li>`)
      .join("");
    side.innerHTML = `
      <div class="rat-side-h">Question Status</div>
      <label class="rat-filter"><span class="sr-only">Filtrera</span>
        <select data-filter>${opts.map(([k, l]) => `<option value="${k}" ${k === filter ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <ol class="rat-qlist">${rows || `<li class="muted small" style="padding:10px 4px">Inga frågor i filtret.</li>`}</ol>
      <div class="rat-side-foot">
        ${submitted()
          ? `<button class="rat-btn ${vy === "analys" ? "primary" : ""}" data-vy="analys" type="button">📊 Analys och prioriteringar</button>
             <div class="small muted" style="margin-top:6px">Inlämnad ${esc(selectedAt(attempt.submitted_at))}</div>`
          : `<div class="rat-progress"><span style="width:${(answered / N) * 100}%"></span></div>
             <div class="small muted">${answered} av ${N} besvarade</div>
             <button class="rat-btn primary" data-act="submit" type="button">Submit Test</button>`}
      </div>`;
    const list = side.querySelector(".rat-qlist");
    const cur = side.querySelector(".rat-qrow.cur");
    if (list && cur) {
      const top = cur.offsetTop - list.offsetTop;
      if (top < list.scrollTop || top > list.scrollTop + list.clientHeight - cur.offsetHeight) list.scrollTop = top - list.clientHeight / 2;
      if (list.scrollWidth > list.clientWidth) list.scrollLeft = cur.offsetLeft - list.offsetLeft - list.clientWidth / 2;
    }
  }

  function choiceHtml(q, r, i) {
    const o = q.options[i];
    const chosen = (r?.selected || []).includes(o.ordinal);
    let cls = chosen ? "selected" : "";
    if (submitted()) cls += o.is_correct ? " correct" : chosen ? " wrong" : "";
    const mark = submitted() ? (o.is_correct ? `<span class="rat-mark ok" aria-label="Rätt svar">✓</span>` : chosen ? `<span class="rat-mark bad" aria-label="Ditt svar">✗</span>` : "") : "";
    return `<label class="rat-choice ${cls}">
      <input type="radio" name="rat-choice" value="${o.ordinal}" ${chosen ? "checked" : ""} ${submitted() ? "disabled" : ""}>
      <span class="rat-radio" aria-hidden="true"></span>
      <span class="rat-letter">${LETTERS[i]}.</span>
      <span class="rat-text">${esc(o.text)}${chosen && r.selected_at ? `<span class="rat-selat">Selected this answer at ${esc(selectedAt(r.selected_at))}</span>` : ""}</span>
      ${mark}
    </label>`;
  }

  function renderQuestion() {
    const q = qs[idx];
    const r = responses.get(q.id);
    const st = status(q);
    const figs = (q.media || []).map((m) => `<figure class="rat-fig"><img src="${esc(m.url)}" alt="${esc(m.alt || "Figur")}" data-zoom loading="lazy"><figcaption>Klicka för att förstora</figcaption></figure>`).join("");
    const after = submitted()
      ? `<section class="rat-card rat-feedback ${st}">
          <div class="rat-fb-h"><span class="rat-pill ${st}">${LABEL[st]}</span>
            ${st === "missed" ? `<span>Du svarade inte på frågan.</span>` : st === "incorrect" ? `<span>Rätt svar: <b>${LETTERS[q.options.findIndex((o) => o.is_correct)]}</b></span>` : `<span>Rätt!</span>`}
            <span class="muted small" style="margin-left:auto">${formatDuration(r?.time_ms || 0)} på frågan</span></div>
          <p class="rat-expl"><b>Varför:</b> ${esc(q.explanation || "")}</p>
          <div class="rat-obj">
            <span class="chip">${esc(q.sub_id || "")} ${esc(q.sub_titel || "")}</span>
            <a class="btn small" href="${objUrl(q.objective_id)}">📖 ${esc(q.objective_id)} ${esc(q.objective_titel || "")}</a>
            <a class="btn small ghost" href="${objUrl(q.objective_id)}?ova=1">Testa dig på målet</a>
          </div>
        </section>`
      : "";
    main.innerHTML = `
      <section class="rat-card">
        <h2 class="rat-qtitle">Question ${idx + 1}</h2>
        <div class="rat-label">Question Stem</div>
        ${figs}
        <div class="rat-stem">${esc(q.stem)}</div>
      </section>
      <section class="rat-card">
        <div class="rat-label">Question ${idx + 1} answer choices</div>
        <div class="rat-choices" role="radiogroup" aria-label="Svarsalternativ">${q.options.map((_, i) => choiceHtml(q, r, i)).join("")}</div>
        ${!submitted() && hasAnswer(q, r) ? `<button class="rat-clear" type="button" data-act="clear">Rensa svar</button>` : ""}
      </section>
      ${after}
      <nav class="rat-nav">
        <button class="rat-btn" type="button" data-nav="-1" ${idx === 0 ? "disabled" : ""}>‹ Previous</button>
        <span class="muted small">${idx + 1} / ${N}</span>
        ${idx < N - 1 ? `<button class="rat-btn primary" type="button" data-nav="1">Next ›</button>`
          : submitted() ? `<button class="rat-btn primary" type="button" data-vy="analys">Till analysen ›</button>`
          : `<button class="rat-btn primary" type="button" data-act="submit">Submit Test</button>`}
      </nav>`;
  }

  /* ---------- analys efter inlämning ---------- */
  function analysis() {
    const items = qs.map((q, i) => ({ q, i, r: responses.get(q.id), st: status(q) }));
    const n = (st) => items.filter((x) => x.st === st).length;
    const correct = n("correct");
    const subs = new Map();
    for (const it of items) {
      const k = it.q.sub_id || "–";
      if (!subs.has(k)) subs.set(k, { id: k, titel: it.q.sub_titel || "", items: [], objs: new Map() });
      const s = subs.get(k);
      s.items.push(it);
      if (!s.objs.has(it.q.objective_id)) s.objs.set(it.q.objective_id, { id: it.q.objective_id, titel: it.q.objective_titel || "", items: [] });
      s.objs.get(it.q.objective_id).items.push(it);
    }
    const subList = [...subs.values()].map((s) => {
      const ok = s.items.filter((x) => x.st === "correct").length;
      return { ...s, ok, miss: s.items.length - ok, p: pct(ok, s.items.length) };
    }).sort((a, b) => a.p - b.p || b.miss - a.miss || a.id.localeCompare(b.id, "sv", { numeric: true }));
    const prio = (s) => (s.p < 50 ? ["hog", "Hög prioritet"] : s.p < 80 ? ["mel", "Repetera"] : ["lag", "Sitter bra"]);
    const top = subList.filter((s) => s.miss > 0).slice(0, 3);
    const qchip = (it) => `<button type="button" class="rat-qchip ${it.st}" data-go="${it.i}" title="${LABEL[it.st]}">Q${it.i + 1}</button>`;
    const errors = items.filter((x) => x.st !== "correct");

    return `
      <section class="rat-card rat-score">
        <div class="rat-score-main">
          <div class="rat-score-n">${correct}<small> / ${N}</small></div>
          <div><div class="rat-score-p">${pct(correct, N)} % rätt</div>
            <div class="rat-score-chips"><span class="rat-pill correct">Correct ${correct}</span><span class="rat-pill incorrect">Incorrect ${n("incorrect")}</span><span class="rat-pill missed">Missed ${n("missed")}</span></div>
            <div class="small muted">Tid ${formatDuration(attempt.active_ms || 0)} · snitt ${formatDuration((attempt.active_ms || 0) / N)} per fråga</div></div>
        </div>
        <div class="rat-actions">
          <button class="rat-btn primary" type="button" data-act="anki" ${errors.length ? "" : "disabled"}>⬇ Anki-kortlek med dina fel</button>
          <button class="rat-btn" type="button" data-act="practice" ${errors.length ? "" : "disabled"}>Öva på dessa fel</button>
          <button class="rat-btn" type="button" data-act="retake">Gör om RAT</button>
          <a class="rat-btn" href="#/forsok/${attempt.id}/resultat">Full resultatanalys</a>
        </div>
      </section>

      ${top.length ? `<section class="rat-card rat-top3">
        <h2>Prioritera först</h2>
        <ol>${top.map((s) => {
          const worst = [...s.objs.values()].filter((o) => o.items.some((x) => x.st !== "correct")).sort((a, b) => b.items.filter((x) => x.st !== "correct").length - a.items.filter((x) => x.st !== "correct").length)[0];
          return `<li><b>${esc(s.id)} ${esc(s.titel)}</b> – ${s.ok} av ${s.items.length} rätt.
            ${worst ? `Börja med <a href="${objUrl(worst.id)}">${esc(worst.id)} ${esc(worst.titel)}</a>.` : ""}</li>`;
        }).join("")}</ol>
      </section>` : `<section class="rat-card"><h2>Allt rätt 🎉</h2><p class="muted">Inga fel och inga missade frågor. Gör om RAT om ett par dagar eller testa dig på tentafrågorna i biblioteket.</p></section>`}

      <section class="rat-card">
        <h2>Delmoduler och lärandemål</h2>
        <p class="muted small" style="margin-top:-4px">Sorterat från svagast till starkast. Klicka på en fråga för att se facit och förklaring, eller på målet för att läsa i biblioteket.</p>
        <div class="rat-subs">${subList.map((s) => {
          const [pc, pl] = prio(s);
          return `<div class="rat-sub-row">
            <div class="rat-sub-head"><b>${esc(s.id)} ${esc(s.titel)}</b><span class="rat-prio ${pc}">${pl}</span><span class="num">${s.ok}/${s.items.length}</span></div>
            <div class="rat-bar"><i class="${pc}" style="width:${s.p}%"></i></div>
            <ul class="rat-objs">${[...s.objs.values()].map((o) => {
              const bad = o.items.filter((x) => x.st !== "correct").length;
              return `<li class="${bad ? "bad" : "ok"}"><a href="${objUrl(o.id)}">${esc(o.id)} ${esc(o.titel)}</a>
                <span class="rat-objq">${o.items.map(qchip).join("")}</span>
                ${bad ? `<a class="small" href="${objUrl(o.id)}?ova=1">Testa dig →</a>` : ""}</li>`;
            }).join("")}</ul>
          </div>`;
        }).join("")}</div>
      </section>

      ${errors.length ? `<section class="rat-card">
        <h2>Koncept att repetera</h2>
        <div class="table-wrap"><table class="table rat-errtable"><thead><tr><th>Fråga</th><th>Ditt svar</th><th>Rätt svar</th><th>Lärandemål</th></tr></thead><tbody>
        ${errors.map((it) => {
          const mine = it.q.options.find((o) => (it.r?.selected || []).includes(o.ordinal));
          const right = it.q.options.find((o) => o.is_correct);
          return `<tr><td>${qchip(it)}</td><td>${mine ? esc(mine.text) : `<span class="rat-pill missed">Missed</span>`}</td><td><b>${esc(right?.text || "")}</b></td>
            <td><a href="${objUrl(it.q.objective_id)}">${esc(it.q.objective_id)}</a></td></tr>`;
        }).join("")}</tbody></table></div>
      </section>` : ""}`;
  }

  function render() {
    renderSide();
    if (vy === "analys" && submitted()) main.innerHTML = analysis();
    else renderQuestion();
  }
  render();

  const go = async (i, focus = true) => {
    await persist();
    idx = Math.max(0, Math.min(N - 1, i));
    vy = "q";
    render();
    if (focus) main.scrollTo?.({ top: 0 });
    window.scrollTo({ top: 0 });
  };

  const choose = async (ordinal) => {
    if (submitted()) return;
    const q = qs[idx];
    const r = resp(q);
    const prev = r.selected?.[0];
    if (prev === ordinal) return;
    if (prev !== undefined) r.answer_changes = Number(r.answer_changes || 0) + 1;
    r.selected = [ordinal];
    r.selected_at = new Date().toISOString();
    r.updated_at = r.selected_at;
    await persist();
    render();
  };

  const submit = async () => {
    const left = qs.filter((q) => !hasAnswer(q, responses.get(q.id))).length;
    const ok = await confirmDialog(
      "Lämna in RAT?",
      left ? `${left} ${left === 1 ? "fråga är" : "frågor är"} obesvarade och räknas som Missed. Du kan inte ändra svaren efter inlämning.` : "Alla frågor är besvarade. Du kan inte ändra svaren efter inlämning.",
      "Submit Test"
    );
    if (!ok) return;
    await persist();
    attempt = await store.submitAttempt(attempt.id);
    if (!attempt.locked_at) attempt = await store.lockAttempt(attempt.id);
    for (const [k, v] of await store.getResponses(attempt.id)) responses.set(k, v);
    vy = "analys";
    history.replaceState(null, "", `#/rat/${params.modul}/${attempt.id}?vy=analys`);
    render();
    window.scrollTo({ top: 0 });
    toast("RAT inlämnad – här är din analys.");
  };

  const ankiItems = () => qs
    .map((q) => ({ q, st: status(q) }))
    .filter((x) => x.st !== "correct")
    .map((x) => ({ question: x.q, category: [x.st === "missed" ? "Obesvarad" : "Fel", "RAT"] }));

  const offs = [];
  offs.push(on(root, "click", "[data-go]", (e, el) => go(Number(el.dataset.go))));
  offs.push(on(root, "click", "[data-nav]", (e, el) => go(idx + Number(el.dataset.nav))));
  offs.push(on(root, "click", "[data-vy]", async (e, el) => {
    await persist();
    vy = el.dataset.vy;
    render();
    window.scrollTo({ top: 0 });
  }));
  offs.push(on(root, "change", "[data-filter]", (e, el) => { filter = el.value; renderSide(); }));
  offs.push(on(root, "change", "input[name=rat-choice]", (e, el) => choose(Number(el.value))));
  offs.push(on(root, "click", "[data-zoom]", (e, el) => lightbox(el.src, el.alt)));
  offs.push(on(root, "click", "[data-act]", async (e, el) => {
    const act = el.dataset.act;
    if (act === "back") {
      await persist();
      if (history.length > 1) history.back();
      else ctx.go("#/rat");
    } else if (act === "submit") submit();
    else if (act === "clear") {
      const r = resp(qs[idx]);
      r.selected = [];
      r.selected_at = null;
      await persist();
      render();
    } else if (act === "anki") {
      exportAnkiDialog(ctx, ankiItems(), `BV5-RAT-modul-${exam.modul || params.modul}`);
    } else if (act === "practice") {
      const ids = ankiItems().map((i) => i.question.id);
      const n = await store.createAttempt({ mode: "practice", title: `Träning: fel från ${attempt.title}`, question_ids: ids });
      ctx.go(`#/forsok/${n.id}`);
    } else if (act === "retake") {
      ctx.go(`#/rat/${params.modul}?ny=1`);
    }
  }));
  const onKey = (e) => {
    if (e.altKey || e.metaKey || e.ctrlKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "") && document.activeElement.type !== "radio") return;
    if (document.querySelector(".modal-backdrop, dialog[open]")) return;
    if (e.key === "ArrowRight") { e.preventDefault(); if (vy === "q") go(idx + 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); if (vy === "q") go(idx - 1); }
    else if (/^[1-8]$/.test(e.key) && vy === "q" && !submitted()) {
      const o = qs[idx].options[Number(e.key) - 1];
      if (o) { e.preventDefault(); choose(o.ordinal); }
    }
  };
  document.addEventListener("keydown", onKey);
  const onVis = () => {
    if (document.visibilityState === "hidden") persist();
    else t0 = performance.now();
  };
  document.addEventListener("visibilitychange", onVis);

  return async () => {
    clearInterval(timer);
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("visibilitychange", onVis);
    offs.forEach((f) => f());
    if (!submitted()) await persist();
  };
}
