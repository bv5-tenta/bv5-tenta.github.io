/* Startsida, tentor + eget quiz, "Öva på dina fel" och historik. */

import { esc, on, toast, modal, setTitle, confirmDialog } from "../ui/dom.js";
import { formatDateTime, formatDuration, pct } from "../core/text.js";
import { buildWeakQuiz, buildBankQuiz, filterWeakBank, inCategory } from "../core/quiz.js";
import { STATE_LABELS } from "../core/mastery.js";
import { exportAnkiDialog } from "./anki.js";
import { reviewItemHtml } from "./results.js";

function moduleOptions(store, selected = []) {
  const mods = [...new Set([...store.questions.values()].map((q) => Number(q.modul ?? 0)))].sort((a, b) => a - b);
  return mods
    .map((m) => `<label class="check"><input type="checkbox" name="mod" value="${m}" ${selected.includes(m) ? "checked" : ""}> ${esc(m ? store.library.moduleName(m) : "Utan modul")}</label>`)
    .join("");
}

/* ---------- startsida ---------- */
export async function homeView(ctx, root) {
  const { store } = ctx;
  setTitle("");
  const attempts = await store.listAttempts();
  const progress = await store.allProgress();
  const open = attempts.filter((a) => !a.submitted_at);
  const done = attempts.filter((a) => a.locked_at);
  const weak = progress.filter((p) => p.in_weak_bank && p.state !== "mastered").length;
  const mastered = progress.filter((p) => p.state === "mastered").length;
  const last = done[0];
  const exams = store.listExams();
  const totalQ = [...store.questions.values()].length;
  const name = ctx.auth.displayName().split(" ")[0];

  root.innerHTML = `
    <div class="page-head"><div>
      <h1>${name && !ctx.auth.profile?.local ? `Hej ${esc(name)}!` : "BV5 Tentasimulator"}</h1>
      <p class="lead">${exams.length} gamla tentor och ${totalQ.toLocaleString("sv-SE")} frågor, kopplade till kursbibliotekets lärandemål.</p>
    </div>
    <div class="btn-row"><a class="btn primary" href="#/tentor">Starta en tenta</a><a class="btn" href="#/ova">Öva på dina fel</a></div></div>

    ${open.length ? `<div class="card" style="border-color:var(--accent-line)"><h2>Fortsätt där du slutade</h2>${open.slice(0, 3).map((a) => `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding:8px 0;border-top:1px solid var(--line)">
        <div><b>${esc(a.title)}</b><div class="small muted">Påbörjad ${formatDateTime(a.started_at)} · ${a.question_ids.length} frågor · ${formatDuration(a.active_ms)}</div></div>
        <div class="btn-row"><a class="btn small primary" href="#/forsok/${a.id}">Fortsätt</a><button class="btn small ghost" data-del="${a.id}">Ta bort</button></div>
      </div>`).join("")}</div>` : ""}

    <div class="grid cols-4" style="margin-top:16px">
      <div class="card stat"><div class="label">Genomförda</div><div class="value">${done.length}</div><div class="sub">tentor och quiz</div></div>
      <div class="card stat"><div class="label">Senaste resultat</div><div class="value">${last ? `${pct(last.score, last.max_score)}%` : "–"}</div><div class="sub">${last ? esc(last.title) : "Inget ännu"}</div></div>
      <div class="card stat"><div class="label">Att öva på</div><div class="value">${weak}</div><div class="sub">fel, osäkra och kan ej</div></div>
      <div class="card stat"><div class="label">Bemästrade</div><div class="value">${mastered}</div><div class="sub">${store.settings.mastery_streak} rätt i rad utan flagga</div></div>
    </div>

    <div class="grid cols-3" style="margin-top:16px">
      <a class="card" href="#/tentor" style="text-decoration:none;color:inherit"><h3>📝 Tentamen</h3><p class="muted small">Hela tentor med riktig tidsgräns, som i Inspera.</p></a>
      <a class="card" href="#/tentor?quiz=1" style="text-decoration:none;color:inherit"><h3>🎯 Eget quiz</h3><p class="muted small">Välj moduler och antal frågor ur hela frågebanken.</p></a>
      <a class="card" href="#/ova" style="text-decoration:none;color:inherit"><h3>🔁 Öva på dina fel</h3><p class="muted small">Allt du svarat fel på eller flaggat, tills det sitter.</p></a>
    </div>`;

  return on(root, "click", "[data-del]", async (e, el) => {
    if (await confirmDialog("Ta bort försöket?", "Svaren i det påbörjade försöket raderas.", "Ta bort", true)) {
      await store.deleteAttempt(el.dataset.del);
      ctx.render();
    }
  });
}

/* ---------- tentor ---------- */
export async function examsView(ctx, root, params) {
  const { store } = ctx;
  setTitle("Tentor");
  const attempts = await store.listAttempts();
  const best = new Map();
  for (const a of attempts) {
    if (!a.locked_at || !a.exam_id) continue;
    const p = pct(a.score, a.max_score);
    if (!best.has(a.exam_id) || p > best.get(a.exam_id)) best.set(a.exam_id, p);
  }
  const exams = store.listExams();
  const groups = new Map();
  for (const e of exams) {
    const y = e.term ? `20${e.term.slice(2)}` : "Övriga";
    if (!groups.has(y)) groups.set(y, []);
    groups.get(y).push(e);
  }

  root.innerHTML = `
    <div class="page-head"><div><h1>Tentor</h1><p class="lead">Välj en gammal tenta att skriva under tidsgräns, eller bygg ett eget quiz.</p></div>
    <button class="btn primary" data-act="quiz">🎯 Eget quiz</button></div>
    ${[...groups].map(([y, list]) => `<div class="year-head">${esc(y)}</div><div class="exam-list">${list.map((e) => {
      const qn = e.question_count || store.examQuestions(e.id).length;
      const b = best.get(e.id);
      return `<div class="card exam-card">
        <div><div class="title">${esc(e.code)}</div><div class="meta">${qn} frågor · ${e.duration_min || "–"} min${e.source === "pdf" ? " · importerad" : ""}</div></div>
        <div class="best">${b != null ? `Bästa resultat: <b>${b} %</b>` : `<span class="muted">Inte gjord ännu</span>`}</div>
        <div class="actions"><button class="btn small primary" data-start="${e.id}">Starta tenta</button><button class="btn small" data-practice="${e.id}">Öva utan tid</button></div>
      </div>`;
    }).join("")}</div>`).join("")}
    ${exams.length ? "" : `<div class="empty"><div class="big">📭</div><p>Inga publicerade tentor ännu.</p></div>`}`;

  async function quizDialog() {
    const total = [...store.questions.values()].filter((q) => q.status !== "struken" && q.options?.length).length;
    const res = await modal({
      title: "Eget quiz ur frågebanken",
      body: `<p class="muted small">${total} frågor att välja bland.</p>
        <div class="field"><label>Moduler (inget val = alla)</label><div style="columns:2;column-gap:16px">${moduleOptions(store)}</div></div>
        <div class="field-row">
          <div class="field"><label for="qz-n">Antal frågor</label><input id="qz-n" type="number" min="1" max="300" value="30"></div>
          <div class="field"><label for="qz-t">Tidsgräns (min, 0 = ingen)</label><input id="qz-t" type="number" min="0" max="600" value="0"></div>
        </div>`,
      actions: [{ label: "Avbryt", value: null }, { label: "Starta quiz", value: "go", kind: "primary" }],
      onSubmit: (v, d) => {
        const modules = [...d.querySelectorAll('input[name="mod"]:checked')].map((x) => Number(x.value));
        const count = Number(d.querySelector("#qz-n").value) || 30;
        const minutes = Number(d.querySelector("#qz-t").value) || 0;
        const ids = buildBankQuiz([...store.questions.values()], { modules, count });
        if (!ids.length) {
          toast("Inga frågor matchar urvalet.");
          return false;
        }
        return { ids, minutes, modules };
      },
    });
    if (!res) return;
    const label = res.modules.length ? res.modules.map((m) => `M${m}`).join("+") : "alla moduler";
    const a = await store.createAttempt({ mode: "custom", title: `Eget quiz · ${label} · ${res.ids.length} frågor`, question_ids: res.ids, duration_min: res.minutes || null });
    ctx.go(`#/forsok/${a.id}`);
  }

  const offs = [];
  offs.push(on(root, "click", "[data-start]", async (e, el) => {
    const exam = store.exams.get(el.dataset.start);
    const ids = store.examQuestions(exam.id).map((q) => q.id);
    const a = await store.createAttempt({ mode: "exam", title: exam.title || `BV5 ${exam.code}`, exam_id: exam.id, question_ids: ids, duration_min: exam.duration_min });
    ctx.go(`#/forsok/${a.id}`);
  }));
  offs.push(on(root, "click", "[data-practice]", async (e, el) => {
    const exam = store.exams.get(el.dataset.practice);
    const ids = store.examQuestions(exam.id).map((q) => q.id);
    const a = await store.createAttempt({ mode: "practice", title: `${exam.title || exam.code} (utan tid)`, exam_id: exam.id, question_ids: ids, duration_min: null });
    ctx.go(`#/forsok/${a.id}`);
  }));
  offs.push(on(root, "click", "[data-act=quiz]", quizDialog));
  if (params?.query?.quiz) setTimeout(quizDialog, 50);
  return () => offs.forEach((f) => f());
}

/* ---------- Öva på dina fel ---------- */
export async function practiceView(ctx, root) {
  const { store } = ctx;
  setTitle("Öva på dina fel");
  const progress = await store.allProgress();
  const qmap = store.questions;
  const bank = progress.filter((p) => p.in_weak_bank && qmap.has(p.question_id));
  const active = bank.filter((p) => p.state !== "mastered");
  const mastered = bank.filter((p) => p.state === "mastered");
  const goal = store.settings.mastery_streak;
  const count = (c) => active.filter((p) => inCategory(p, c)).length;
  let tab = "active";
  let filters = { categories: ["wrong", "unsure", "cannot"], modules: [] };

  function listHtml() {
    const list = tab === "active"
      ? filterWeakBank(bank, qmap, { ...filters, states: ["weak", "learning"] })
      : mastered;
    if (!list.length) return `<div class="empty"><div class="big">${tab === "active" ? "✨" : "🌱"}</div><p>${tab === "active" ? (bank.length ? "Inga frågor matchar filtret." : "Inga fel ännu. Gör en tenta så samlas felen här automatiskt.") : "Inga bemästrade frågor ännu."}</p></div>`;
    const rows = list.slice(0, 400).map((p) => {
      const q = qmap.get(p.question_id);
      const link = store.library.linkFor(q);
      const exam = store.exams.get(q.exam_id);
      const cats = [p.times_wrong ? `<span class="chip err">Fel ×${p.times_wrong}</span>` : "", p.times_unsure ? `<span class="chip unsure">🟨 ×${p.times_unsure}</span>` : "", p.times_cannot ? `<span class="chip cannot">🟥 ×${p.times_cannot}</span>` : ""].join(" ");
      return `<tr>
        <td><b>${esc(exam?.code || q.exam_code || "")} #${q.number}</b><div class="small">${esc(q.stem.length > 150 ? `${q.stem.slice(0, 150)}…` : q.stem)}</div>
          <a class="small" href="${esc(link.url)}" target="_blank" rel="noopener">📖 ${esc(link.label)} ↗</a></td>
        <td>${cats}</td>
        <td><span class="chip ${p.state === "mastered" ? "ok" : p.state === "learning" ? "teal" : "warn"}">${STATE_LABELS[p.state]}</span><div class="small muted" style="margin-top:4px">${p.correct_streak}/${goal} i rad</div></td>
        <td class="num"><button class="btn small ghost" data-show="${esc(q.id)}">Visa</button></td>
      </tr>`;
    }).join("");
    return `<div class="table-wrap"><table class="table"><thead><tr><th>Fråga</th><th>Historik</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      ${list.length > 400 ? `<p class="small muted">Visar 400 av ${list.length}.</p>` : ""}`;
  }

  function render() {
    root.innerHTML = `
      <div class="page-head"><div><h1>Öva på dina fel</h1>
        <p class="lead">Här samlas alla frågor du svarat fel på, markerat som osäkra eller som du inte kunde. En fråga blir bemästrad efter ${goal} rätt i rad utan flagga.</p></div>
        <button class="btn" data-act="anki" ${bank.length ? "" : "disabled"}>Exportera till Anki</button></div>
      <div class="grid cols-4">
        <div class="card stat"><div class="label">Fel</div><div class="value">${count("wrong")}</div></div>
        <div class="card stat"><div class="label">🟨 Osäkra</div><div class="value">${count("unsure")}</div></div>
        <div class="card stat"><div class="label">🟥 Kan ej</div><div class="value">${count("cannot")}</div></div>
        <div class="card stat"><div class="label">Bemästrade</div><div class="value">${mastered.length}</div><div class="sub">av ${bank.length} i banken</div></div>
      </div>
      <div class="card" style="margin-top:16px">
        <h2>Starta ett träningsquiz</h2>
        <form id="pq">
          <div class="field"><label>Kategorier</label><div class="btn-row">
            <label class="check"><input type="checkbox" name="cat" value="wrong" ${filters.categories.includes("wrong") ? "checked" : ""}> Fel</label>
            <label class="check"><input type="checkbox" name="cat" value="unsure" ${filters.categories.includes("unsure") ? "checked" : ""}> 🟨 Osäkra</label>
            <label class="check"><input type="checkbox" name="cat" value="cannot" ${filters.categories.includes("cannot") ? "checked" : ""}> 🟥 Kan ej</label>
          </div></div>
          <details class="field"><summary style="cursor:pointer;font-weight:600">Moduler ${filters.modules.length ? `(${filters.modules.length} valda)` : "(alla)"}</summary><div style="columns:2;column-gap:16px;margin-top:8px">${moduleOptions(store, filters.modules)}</div></details>
          <div class="field-row">
            <div class="field"><label for="pq-n">Antal frågor</label><input id="pq-n" type="number" min="1" max="300" value="20"></div>
            <div class="field"><label for="pq-o">Ordning</label><select id="pq-o"><option value="weakest">Svagast först</option><option value="oldest">Längst sedan senast</option><option value="random">Blandat</option></select></div>
          </div>
          <div class="btn-row"><button class="btn primary" type="submit" ${active.length ? "" : "disabled"}>Starta quiz</button><span class="small muted" id="pq-count"></span></div>
        </form>
      </div>
      <div class="card" style="margin-top:16px">
        <div class="tabs" role="tablist">
          <button data-tab="active" role="tab" aria-selected="${tab === "active"}">Att öva på <span class="count">${active.length}</span></button>
          <button data-tab="mastered" role="tab" aria-selected="${tab === "mastered"}">Bemästrade <span class="count">${mastered.length}</span></button>
        </div>
        <div id="pl">${listHtml()}</div>
      </div>`;
    updateCount();
  }

  function readFilters() {
    const f = root.querySelector("#pq");
    filters = {
      categories: [...f.querySelectorAll('input[name="cat"]:checked')].map((x) => x.value),
      modules: [...f.querySelectorAll('input[name="mod"]:checked')].map((x) => Number(x.value)),
    };
  }
  function updateCount() {
    const n = filterWeakBank(bank, qmap, { ...filters, states: ["weak", "learning"] }).length;
    const el = root.querySelector("#pq-count");
    if (el) el.textContent = `${n} frågor matchar`;
  }

  render();
  const offs = [];
  offs.push(on(root, "change", "#pq input", () => {
    readFilters();
    updateCount();
    root.querySelector("#pl").innerHTML = listHtml();
  }));
  offs.push(on(root, "submit", "#pq", async (e) => {
    e.preventDefault();
    readFilters();
    const ids = buildWeakQuiz(bank, qmap, { ...filters, count: Number(root.querySelector("#pq-n").value) || 20, order: root.querySelector("#pq-o").value });
    if (!ids.length) {
      toast("Inga frågor matchar urvalet.");
      return;
    }
    const a = await store.createAttempt({ mode: "practice", title: `Öva på dina fel · ${ids.length} frågor`, question_ids: ids });
    ctx.go(`#/forsok/${a.id}`);
  }));
  offs.push(on(root, "click", "[data-tab]", (e, el) => {
    tab = el.dataset.tab;
    for (const b of root.querySelectorAll("[data-tab]")) b.setAttribute("aria-selected", String(b === el));
    root.querySelector("#pl").innerHTML = listHtml();
  }));
  offs.push(on(root, "click", "[data-show]", async (e, el) => {
    const q = qmap.get(el.dataset.show);
    await modal({ title: `Fråga ${q.number}`, wide: true, body: reviewItemHtml(store, q, null, { showExam: true }), actions: [{ label: "Stäng", value: null }] });
  }));
  offs.push(on(root, "click", "[data-act=anki]", () => {
    const items = active.map((p) => {
      const cat = [];
      if (p.times_wrong) cat.push("Fel");
      if (p.times_unsure) cat.push("Osäker");
      if (p.times_cannot) cat.push("Kan ej");
      return { question: qmap.get(p.question_id), category: cat.length ? cat : ["Fel"] };
    });
    exportAnkiDialog(ctx, items, "BV5-ova-pa-dina-fel");
  }));
  return () => offs.forEach((f) => f());
}

/* ---------- historik ---------- */
export async function historyView(ctx, root) {
  const { store } = ctx;
  setTitle("Historik");
  const attempts = await store.listAttempts();
  root.innerHTML = `
    <div class="page-head"><div><h1>Historik</h1><p class="lead">Alla tentor och quiz du har gjort på den här enheten${ctx.cloud.enabled ? " och synkat" : ""}.</p></div></div>
    ${attempts.length ? `<div class="card"><div class="table-wrap"><table class="table">
      <thead><tr><th>Försök</th><th>Datum</th><th class="num">Resultat</th><th class="num">Tid</th><th></th></tr></thead>
      <tbody>${attempts.map((a) => {
        const status = !a.submitted_at ? `<span class="chip accent">Pågår</span>` : !a.locked_at ? `<span class="chip warn">Ska bedömas</span>` : a.passed ? `<span class="chip ok">Godkänd</span>` : a.passed === false ? `<span class="chip err">Underkänd</span>` : "";
        const href = !a.submitted_at ? `#/forsok/${a.id}` : !a.locked_at ? `#/forsok/${a.id}/bedom` : `#/forsok/${a.id}/resultat`;
        return `<tr><td><a href="${href}"><b>${esc(a.title)}</b></a><div class="small muted">${a.question_ids.length} frågor · ${a.mode === "exam" ? "tentamen" : "träning"}</div></td>
          <td>${formatDateTime(a.started_at)}</td>
          <td class="num">${a.locked_at ? `${a.score}/${a.max_score} · ${pct(a.score, a.max_score)}%` : "–"} ${status}</td>
          <td class="num">${formatDuration(a.active_ms)}</td>
          <td class="num"><button class="btn small ghost" data-del="${a.id}" aria-label="Ta bort">✕</button></td></tr>`;
      }).join("")}</tbody></table></div></div>` : `<div class="empty"><div class="big">🗂️</div><p>Ingen historik ännu.</p><a class="btn primary" href="#/tentor">Starta en tenta</a></div>`}`;
  return on(root, "click", "[data-del]", async (e, el) => {
    if (await confirmDialog("Ta bort försöket?", "Resultatet raderas från historiken. Det som redan förts in i Öva på dina fel ligger kvar.", "Ta bort", true)) {
      await store.deleteAttempt(el.dataset.del);
      ctx.render();
    }
  });
}
