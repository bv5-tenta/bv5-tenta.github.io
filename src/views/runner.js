/*
 * Tentasimulatorn i Inspera-stil:
 *  - överst: Kandidat-ID, tid kvar, anslutning och meny
 *  - vänsterkant: frågenummer, 🔖 Osäker (orange bokmärke) och 🚩 Kan ej (röd flagga)
 *  - nederst: sifferlist med översiktsknapp, besvarade frågor har en blå rand, flaggade ett hörn
 *  - stora pilknappar nere till höger
 * Autospar, tidloggning per fråga och kortkommandon som tidigare.
 */

import { esc, on, toast, lightbox, setTitle, confirmDialog } from "../ui/dom.js";
import { formatClock, formatDuration } from "../core/text.js";
import { hasAnswer } from "../core/grading.js";

const SAVE_DELAY = 300;
const HEARTBEAT = 5000;

const ICON = {
  bookmark: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4.5L6 21z"/></svg>`,
  flag: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>`,
  overview: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v16H4z"/><path d="M8 12l3 3 5-6"/></svg>`,
  check: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12.5l5 5L20 6.5"/></svg>`,
  prev: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 4l-8 8 8 8"/></svg>`,
  next: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4l8 8-8 8"/></svg>`,
  menu: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18"/></svg>`,
  wifi: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 8.5a15 15 0 0 1 20 0M5.5 12a10 10 0 0 1 13 0M9 15.5a5 5 0 0 1 6 0"/><circle cx="12" cy="19" r="1.4"/></svg>`,
  wifiOff: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 8.5a15 15 0 0 1 20 0M5.5 12a10 10 0 0 1 13 0M9 15.5a5 5 0 0 1 6 0"/><circle cx="12" cy="19" r="1.4"/><path d="M3 3l18 18"/></svg>`,
};

export async function runnerView(ctx, root, params) {
  const { store } = ctx;
  let attempt = await store.getAttempt(params.id);
  if (!attempt) {
    root.innerHTML = `<div class="empty"><div class="big">🔍</div><p>Försöket finns inte.</p><a class="btn" href="#/tentor">Till tentorna</a></div>`;
    return;
  }
  if (attempt.submitted_at) {
    ctx.go(attempt.locked_at ? `#/forsok/${attempt.id}/resultat` : `#/forsok/${attempt.id}/bedom`, true);
    return;
  }
  const questions = store.questionsByIds(attempt.question_ids);
  if (!questions.length) {
    root.innerHTML = `<div class="empty"><p>Frågorna i försöket finns inte längre i frågebanken.</p></div>`;
    return;
  }
  const responses = await store.getResponses(attempt.id);
  const resp = (q) => {
    let r = responses.get(q.id);
    if (!r) {
      r = store.newResponse(attempt.id, q.id);
      responses.set(q.id, r);
    }
    return r;
  };

  const total = questions.length;
  let idx = Math.max(0, Math.min(total - 1, attempt.current_index || 0));
  let view = "question";                 // "question" | "submit"
  let locked = false;
  let overviewOpen = false;
  const durationMs = attempt.duration_min ? attempt.duration_min * 60000 : null;
  setTitle(attempt.title);

  /* ---------- tid och autospar ---------- */
  let attemptClock = null;
  let questionClock = null;
  const dirty = new Set();
  let saveTimer = null;
  let attemptDirty = false;
  const visible = () => document.visibilityState === "visible";

  function startClocks() {
    if (!visible() || locked) return;
    const now = performance.now();
    if (attemptClock === null) attemptClock = now;
    if (view === "question" && questionClock === null) questionClock = now;
  }
  function stopClocks() {
    const now = performance.now();
    if (attemptClock !== null) {
      attempt.active_ms += now - attemptClock;
      attemptClock = null;
      attemptDirty = true;
    }
    if (questionClock !== null) {
      resp(questions[idx]).time_ms += now - questionClock;
      questionClock = null;
      dirty.add(questions[idx].id);
    }
  }
  const elapsed = () => attempt.active_ms + (attemptClock !== null ? performance.now() - attemptClock : 0);

  async function persist() {
    clearTimeout(saveTimer);
    saveTimer = null;
    const list = [...dirty].map((id) => responses.get(id)).filter(Boolean);
    dirty.clear();
    for (const r of list) r.updated_at = new Date().toISOString();
    try {
      if (list.length) await store.saveResponses(list);
      if (attemptDirty || list.length) {
        attempt.current_index = idx;
        attemptDirty = false;
        await store.saveAttempt(attempt);
      }
    } catch (err) {
      toast(`Kunde inte spara: ${err.message}`, "err", 6000);
    }
  }
  const scheduleSave = () => { if (!saveTimer) saveTimer = setTimeout(persist, SAVE_DELAY); };
  const checkpoint = () => { stopClocks(); startClocks(); scheduleSave(); };

  /* ---------- skal ---------- */
  const candidate = ctx.auth?.profile?.local ? "Kandidat-ID" : `Kandidat-ID · ${esc(ctx.auth?.displayName?.() || "")}`;
  root.innerHTML = `
    <div class="insp">
      <header class="insp-top">
        <div class="insp-id"><b>${candidate}</b><span class="insp-title">${esc(attempt.title)}</span></div>
        <div class="insp-top-right">
          <span class="insp-timer" id="r-timer" title="${durationMs ? "Tid kvar – klockan står still när tentan är stängd" : "Tid hittills"}">–</span>
          <span class="insp-icon" id="r-wifi"></span>
          <button class="insp-icon-btn" data-act="menu" aria-label="Meny" aria-expanded="false">${ICON.menu}</button>
        </div>
        <div class="insp-progress" aria-hidden="true"><i id="r-progress"></i></div>
        <div class="insp-menu" id="r-menu" hidden>
          <button data-act="pause">Pausa och spara</button>
          <button data-act="shortcuts">Kortkommandon</button>
          <button data-act="to-submit">Lämna in</button>
        </div>
      </header>
      <main class="insp-main" id="r-main" aria-live="polite"></main>
      <div class="insp-arrows" id="r-arrows">
        <button class="insp-prev" data-act="prev" aria-label="Föregående fråga">${ICON.prev}</button>
        <button class="insp-next" data-act="next" aria-label="Nästa fråga">${ICON.next}</button>
      </div>
      <section class="insp-overview" id="r-overview" hidden aria-label="Översikt"></section>
      <nav class="insp-nav" aria-label="Frågor">
        <button class="insp-nav-ov" data-act="overview" aria-label="Översikt" title="Översikt">${ICON.overview}</button>
        <div class="insp-strip" id="r-strip">${questions.map((q, i) => `<button class="insp-cell" data-go="${i}" aria-label="Fråga ${i + 1}">${i + 1}</button>`).join("")}</div>
        <button class="insp-nav-submit" data-act="to-submit" aria-label="Lämna in" title="Lämna in">${ICON.check}</button>
      </nav>
    </div>`;
  const main = root.querySelector("#r-main");
  const strip = root.querySelector("#r-strip");
  const overview = root.querySelector("#r-overview");
  const menu = root.querySelector("#r-menu");

  function counts() {
    let answered = 0, unsure = 0, cannot = 0;
    for (const q of questions) {
      const r = responses.get(q.id);
      if (r && hasAnswer(q, r)) answered++;
      if (r?.flag_unsure) unsure++;
      if (r?.flag_cannot) cannot++;
    }
    return { answered, unsure, cannot, open: total - answered };
  }

  function renderStrip(scroll = true) {
    const cells = strip.children;
    questions.forEach((q, i) => {
      const r = responses.get(q.id);
      const c = cells[i];
      c.className = "insp-cell" + (r && hasAnswer(q, r) ? " answered" : "") + (r?.flag_unsure ? " unsure" : "") + (r?.flag_cannot ? " cannot" : "") + (i === idx && view === "question" ? " current" : "");
      c.setAttribute("aria-current", i === idx && view === "question" ? "true" : "false");
    });
    if (scroll && view === "question") cells[idx]?.scrollIntoView({ block: "nearest", inline: "center" });
    root.querySelector("#r-progress").style.width = `${Math.round((counts().answered / total) * 100)}%`;
    root.querySelector(".insp-nav-submit").classList.toggle("current", view === "submit");
    if (overviewOpen) renderOverview();
  }

  function renderOverview() {
    const k = counts();
    overview.innerHTML = `
      <div class="insp-ov-head"><b>Översikt</b><span>${k.answered} av ${total} besvarade · ${k.unsure} osäkra · ${k.cannot} kan ej</span>
        <button class="insp-icon-btn" data-act="overview" aria-label="Stäng översikten">✕</button></div>
      <ol class="insp-ov-list">${questions.map((q, i) => {
        const r = responses.get(q.id);
        const ans = r && hasAnswer(q, r);
        const marks = `${r?.flag_unsure ? `<span class="insp-ov-mark unsure" title="Osäker">${ICON.bookmark}</span>` : ""}${r?.flag_cannot ? `<span class="insp-ov-mark cannot" title="Kan ej">${ICON.flag}</span>` : ""}`;
        const text = q.stem.length > 140 ? `${q.stem.slice(0, 140)}…` : q.stem;
        return `<li><button data-go="${i}" class="${i === idx ? "current" : ""}"><span class="n">${i + 1}</span><span class="t">${esc(text)}</span><span class="s">${marks}<span class="${ans ? "ans" : ""}">${ans ? "Besvarad" : "Ej besvarad"}</span></span></button></li>`;
      }).join("")}</ol>`;
    overview.querySelector("li button.current")?.scrollIntoView({ block: "center" });
  }

  function toggleOverview(force) {
    overviewOpen = force ?? !overviewOpen;
    overview.hidden = !overviewOpen;
    root.querySelector(".insp-nav-ov").classList.toggle("current", overviewOpen);
    if (overviewOpen) renderOverview();
  }

  function mediaHtml(q, placement) {
    const list = (q.media || []).filter((m) => (m.placement || "stem") === placement);
    return list.length ? `<div class="insp-media">${list.map((m) => `<img src="${esc(m.data_url || m.url)}" alt="${esc(m.alt || "Figur")}" loading="lazy" data-zoom>`).join("")}</div>` : "";
  }

  function renderQuestion() {
    const q = questions[idx];
    const r = resp(q);
    const multi = q.type === "multi";
    const section = q.section || (store.library ? store.library.moduleName(q.modul) : "");
    let body;
    if (q.type === "freetext") {
      body = `<div class="insp-instr">Skriv ditt svar:</div><textarea class="insp-free" data-free ${locked ? "disabled" : ""} placeholder="Skriv här …">${esc(r.free_text || "")}</textarea>
        <div class="insp-words" id="ft-count">Ord: ${(r.free_text || "").trim().split(/\s+/).filter(Boolean).length}</div>`;
    } else {
      body = `<div class="insp-instr">${multi ? "Välj ett eller flera alternativ:" : "Välj ett alternativ:"}</div>
        <div class="insp-options" role="${multi ? "group" : "radiogroup"}">${q.options.map((o) => {
          const sel = (r.selected || []).includes(o.ordinal);
          return `<button class="insp-opt ${multi ? "multi" : ""}" role="${multi ? "checkbox" : "radio"}" aria-checked="${sel}" data-opt="${o.ordinal}" ${locked ? "disabled" : ""}><span class="insp-radio"></span><span class="insp-opt-text">${esc(o.text)}</span></button>`;
        }).join("")}</div>${mediaHtml(q, "options")}`;
    }
    main.innerHTML = `
      <div class="insp-q">
        <div class="insp-gutter">
          <div class="insp-gnum">${idx + 1}</div>
          <button class="insp-mark unsure" data-flag="unsure" aria-pressed="${Boolean(r.flag_unsure)}" title="Markera som osäker (F)" ${locked ? "disabled" : ""}>${ICON.bookmark}</button>
          <button class="insp-mark cannot" data-flag="cannot" aria-pressed="${Boolean(r.flag_cannot)}" title="Kan ej överhuvudtaget (K)" ${locked ? "disabled" : ""}>${ICON.flag}</button>
        </div>
        <div class="insp-body">
          <h1 class="insp-h">Fråga ${idx + 1}${q.status === "struken" ? ` <span class="insp-struck">struken – räknas inte</span>` : ""}</h1>
          ${section ? `<div class="insp-section">${esc(section)}</div>` : ""}
          <p class="insp-stem">${q.stem_html || esc(q.stem)}</p>
          ${mediaHtml(q, "stem")}
          ${body}
          <hr class="insp-rule">
          <div class="insp-points">Totalpoäng: ${q.points}</div>
        </div>
      </div>`;
    root.querySelector("[data-act=prev]").disabled = idx === 0;
    main.scrollTop = 0;
    window.scrollTo({ top: 0 });
  }

  function renderSubmit(timeUp = false) {
    const k = counts();
    main.innerHTML = `
      <div class="insp-submit">
        ${timeUp ? `<div class="insp-alert">Tiden är slut. Svaren är låsta – lämna in för att se resultatet.</div>` : ""}
        <h1 class="insp-h">Lämna in</h1>
        <p class="insp-sub">Här ser du en sammanställning av alla frågor. Besvarade frågor har en blå markering, osäkra ett orange bokmärke och "kan ej" en röd flagga.</p>
        <div class="insp-sum">
          <div><b>${k.answered}</b><span>besvarade</span></div>
          <div><b>${k.open}</b><span>obesvarade</span></div>
          <div class="unsure"><b>${k.unsure}</b><span>osäkra</span></div>
          <div class="cannot"><b>${k.cannot}</b><span>kan ej</span></div>
        </div>
        <div class="insp-grid">${questions.map((q, i) => {
          const r = responses.get(q.id);
          return `<button class="insp-cell${r && hasAnswer(q, r) ? " answered" : ""}${r?.flag_unsure ? " unsure" : ""}${r?.flag_cannot ? " cannot" : ""}" data-go="${i}" ${timeUp ? "disabled" : ""}>${i + 1}</button>`;
        }).join("")}</div>
        <div class="insp-submit-actions">
          <button class="insp-btn ghost" data-act="back" ${timeUp ? "disabled" : ""}>Tillbaka till frågorna</button>
          <button class="insp-btn primary" data-act="submit">Lämna in nu</button>
        </div>
        <p class="insp-sub small">Total tid hittills: ${formatDuration(elapsed())}</p>
      </div>`;
  }

  function show(i) {
    stopClocks();
    view = "question";
    idx = Math.max(0, Math.min(total - 1, i));
    const r = resp(questions[idx]);
    r.visits = (r.visits || 0) + 1;
    dirty.add(questions[idx].id);
    attemptDirty = true;
    startClocks();
    root.querySelector("#r-arrows").hidden = false;
    renderQuestion();
    renderStrip();
    scheduleSave();
  }

  function toSubmit(timeUp = false) {
    stopClocks();
    view = "submit";
    startClocks();
    toggleOverview(false);
    root.querySelector("#r-arrows").hidden = true;
    renderSubmit(timeUp);
    renderStrip(false);
    persist();
  }

  function select(ordinal) {
    if (locked || view !== "question") return;
    const q = questions[idx];
    if (q.type === "freetext") return;
    const r = resp(q);
    const prev = [...(r.selected || [])];
    const next = q.type === "multi"
      ? (prev.includes(ordinal) ? prev.filter((x) => x !== ordinal) : [...prev, ordinal].sort((a, b) => a - b))
      : (prev.length === 1 && prev[0] === ordinal ? [] : [ordinal]);
    if (prev.length && JSON.stringify(prev) !== JSON.stringify(next)) r.answer_changes = (r.answer_changes || 0) + 1;
    r.selected = next;
    dirty.add(q.id);
    for (const b of main.querySelectorAll("[data-opt]")) b.setAttribute("aria-checked", String(next.includes(Number(b.dataset.opt))));
    renderStrip(false);
    checkpoint();
  }

  function toggleFlag(kind) {
    if (locked || view !== "question") return;
    const q = questions[idx];
    const r = resp(q);
    if (kind === "unsure") r.flag_unsure = !r.flag_unsure;
    else r.flag_cannot = !r.flag_cannot;
    dirty.add(q.id);
    const b = main.querySelector(`[data-flag="${kind}"]`);
    if (b) b.setAttribute("aria-pressed", String(kind === "unsure" ? r.flag_unsure : r.flag_cannot));
    renderStrip(false);
    checkpoint();
  }

  async function doSubmit() {
    const k = counts();
    if (!locked && store.settings.confirm_submit !== false) {
      const text = k.open ? `Du har ${k.open} obesvarade frågor. Efter inlämning går svaren inte att ändra.` : "Efter inlämning går svaren inte att ändra.";
      if (!(await confirmDialog("Lämna in tentan?", text, "Lämna in"))) return;
    }
    stopClocks();
    await persist();
    cleanup();
    try {
      const a = await store.submitAttempt(attempt.id);
      ctx.sync?.flush();
      ctx.go(a.locked_at ? `#/forsok/${a.id}/resultat` : `#/forsok/${a.id}/bedom`);
    } catch (err) {
      toast(`Inlämningen misslyckades: ${err.message}`, "err", 8000);
    }
  }

  function setMenu(open) {
    menu.hidden = !open;
    root.querySelector("[data-act=menu]").setAttribute("aria-expanded", String(open));
  }

  /* ---------- händelser ---------- */
  const offs = [];
  offs.push(on(root, "click", "[data-opt]", (e, el) => select(Number(el.dataset.opt))));
  offs.push(on(root, "click", "[data-flag]", (e, el) => toggleFlag(el.dataset.flag)));
  offs.push(on(root, "click", "[data-go]", (e, el) => {
    if (locked) return;
    toggleOverview(false);
    show(Number(el.dataset.go));
  }));
  offs.push(on(root, "click", "[data-zoom]", (e, el) => lightbox(el.src, el.alt)));
  offs.push(on(root, "click", "[data-act]", async (e, el) => {
    const act = el.dataset.act;
    if (act !== "menu") setMenu(false);
    if (act === "prev") { if (idx > 0) show(idx - 1); }
    else if (act === "next") { if (idx < total - 1) show(idx + 1); else toSubmit(); }
    else if (act === "to-submit") toSubmit();
    else if (act === "back") show(idx);
    else if (act === "submit") doSubmit();
    else if (act === "overview") toggleOverview();
    else if (act === "menu") setMenu(menu.hidden);
    else if (act === "shortcuts") ctx.showShortcuts();
    else if (act === "pause") {
      stopClocks();
      await persist();
      toast("Försöket är sparat. Fortsätt när du vill från startsidan.");
      ctx.go("#/");
    }
  }));
  offs.push(on(root, "input", "[data-free]", (e, el) => {
    const q = questions[idx];
    const r = resp(q);
    r.free_text = el.value;
    dirty.add(q.id);
    const c = root.querySelector("#ft-count");
    if (c) c.textContent = `Ord: ${el.value.trim().split(/\s+/).filter(Boolean).length}`;
    renderStrip(false);
    scheduleSave();
  }));

  function onKey(e) {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = e.target?.tagName;
    if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT" || document.querySelector("dialog[open]")) return;
    if (e.key === "Escape") {
      if (overviewOpen) toggleOverview(false);
      else if (!menu.hidden) setMenu(false);
      else if (view === "submit" && !locked) show(idx);
      return;
    }
    if (view === "submit") return;
    const q = questions[idx];
    if (e.key === "ArrowRight") {
      e.preventDefault();
      if (idx < total - 1) show(idx + 1);
      else toSubmit();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (idx > 0) show(idx - 1);
    } else if (/^[1-9]$/.test(e.key)) {
      const opt = q.options?.[Number(e.key) - 1];
      if (opt) {
        e.preventDefault();
        select(opt.ordinal);
      }
    } else if (e.key === "f" || e.key === "F") {
      e.preventDefault();
      toggleFlag("unsure");
    } else if (e.key === "k" || e.key === "K") {
      e.preventDefault();
      toggleFlag("cannot");
    } else if (e.key === "o" || e.key === "O") {
      e.preventDefault();
      toggleOverview();
    } else if (e.key === "?") {
      e.preventDefault();
      ctx.showShortcuts();
    }
  }
  document.addEventListener("keydown", onKey);

  const onVisibility = () => { if (visible()) startClocks(); else { stopClocks(); persist(); } };
  const onPageHide = () => { stopClocks(); persist(); };
  const wifiEl = root.querySelector("#r-wifi");
  const onNet = () => {
    const online = navigator.onLine !== false;
    wifiEl.innerHTML = online ? ICON.wifi : ICON.wifiOff;
    wifiEl.title = online ? "Ansluten – svaren sparas lokalt direkt" : "Offline – svaren sparas lokalt och synkas senare";
    wifiEl.classList.toggle("off", !online);
  };
  onNet();
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("online", onNet);
  window.addEventListener("offline", onNet);

  const heartbeat = setInterval(() => { if (!locked && visible()) checkpoint(); }, HEARTBEAT);
  const timerEl = root.querySelector("#r-timer");
  function tick() {
    const el = elapsed();
    if (durationMs) {
      const left = durationMs - el;
      timerEl.textContent = formatClock(Math.max(0, left));
      timerEl.classList.toggle("low", left < 10 * 60000 && left > 0);
      timerEl.classList.toggle("over", left <= 0);
      if (left <= 0 && !locked) {
        locked = true;
        stopClocks();
        persist();
        toSubmit(true);
      }
    } else {
      timerEl.textContent = formatClock(el);
    }
  }
  const ticker = setInterval(tick, 1000);

  function cleanup() {
    clearInterval(heartbeat);
    clearInterval(ticker);
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("online", onNet);
    window.removeEventListener("offline", onNet);
    offs.forEach((f) => f());
  }

  if (durationMs && elapsed() >= durationMs) {
    locked = true;
    toSubmit(true);
  } else {
    show(idx);
  }
  tick();

  return async () => {
    stopClocks();
    await persist();
    cleanup();
    setTitle("");
  };
}
