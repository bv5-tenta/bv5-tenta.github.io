/* Import av tentor: uppladdning → tolkning → "Förhandsvisning av tolkad tenta" → spara. */

import { esc, on, toast, setTitle, lightbox, confirmDialog } from "../ui/dom.js";
import { importExamPdf } from "../pdf/import.js";

const LETTERS = "ABCDEFGHIJ";
let draft = null;          // överlever vynbyte så att ett pågående utkast inte tappas

export async function importView(ctx, root) {
  setTitle("Importera tenta");
  if (!ctx.auth.isAdmin()) {
    root.innerHTML = `<div class="empty"><p>Endast administratörer kan importera tentor.</p></div>`;
    return;
  }
  if (draft) return verifyView(ctx, root);

  root.innerHTML = `
    <div class="page-head"><div><h1>Importera tenta</h1>
    <p class="lead">Ladda upp en tentamens-PDF. Inspera-utskrifter "med svar" läses helt automatiskt – facit hittas via den gröna bocken. Inskannade sidor tolkas med OCR.</p></div></div>
    <div class="grid cols-2">
      <div>
        <label>Tentamen (PDF)</label>
        <div class="dropzone" id="dz-exam" tabindex="0" role="button" aria-label="Välj tentamens-PDF">
          <div class="big">📄</div><div><b>Släpp PDF här</b> eller klicka för att välja</div><div class="small muted" id="dz-exam-name">Ingen fil vald</div>
        </div>
        <input type="file" id="f-exam" accept="application/pdf,.pdf" hidden>
      </div>
      <div>
        <label>Separat facit eller bedömningsmall (valfritt)</label>
        <div class="dropzone" id="dz-facit" tabindex="0" role="button" aria-label="Välj facit">
          <div class="big">✅</div><div>PDF eller textfil, t.ex. rader som <span class="mono">12 B</span></div><div class="small muted" id="dz-facit-name">Behövs inte för Inspera "med svar"</div>
        </div>
        <input type="file" id="f-facit" accept="application/pdf,.pdf,.txt,text/plain" hidden>
      </div>
    </div>
    <div class="card flat" style="margin-top:16px">
      <div class="field-row">
        <div class="field"><label for="ocr">Textigenkänning (OCR)</label><select id="ocr">
          <option value="auto">Automatiskt – bara sidor utan läsbar text</option>
          <option value="force">Alltid – för inskannade tentor</option>
          <option value="off">Av</option></select></div>
      </div>
      <div class="btn-row"><button class="btn primary" id="go" disabled>Tolka tentan</button></div>
      <div id="prog" style="margin-top:14px" hidden>
        <div class="progress"><i id="prog-bar" style="width:0%"></i></div>
        <div class="small muted" id="prog-text" style="margin-top:6px">Startar …</div>
      </div>
    </div>`;

  let examFile = null;
  let facitFile = null;
  const pick = (zone, input, setter, nameEl) => {
    const z = root.querySelector(zone);
    const i = root.querySelector(input);
    const set = (f) => {
      setter(f);
      root.querySelector(nameEl).textContent = f ? `${f.name} · ${(f.size / 1048576).toFixed(1)} MB` : "Ingen fil vald";
      root.querySelector("#go").disabled = !examFile;
    };
    z.addEventListener("click", () => i.click());
    z.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); i.click(); } });
    i.addEventListener("change", () => set(i.files[0] || null));
    z.addEventListener("dragover", (e) => { e.preventDefault(); z.classList.add("drag"); });
    z.addEventListener("dragleave", () => z.classList.remove("drag"));
    z.addEventListener("drop", (e) => {
      e.preventDefault();
      z.classList.remove("drag");
      const f = e.dataTransfer.files[0];
      if (f) set(f);
    });
  };
  pick("#dz-exam", "#f-exam", (f) => { examFile = f; }, "#dz-exam-name");
  pick("#dz-facit", "#f-facit", (f) => { facitFile = f; }, "#dz-facit-name");

  root.querySelector("#go").addEventListener("click", async () => {
    if (!examFile) return;
    if (!/\.pdf$/i.test(examFile.name) && examFile.type !== "application/pdf") {
      toast("Tentan måste vara en PDF.", "err");
      return;
    }
    const btn = root.querySelector("#go");
    btn.disabled = true;
    root.querySelector("#prog").hidden = false;
    const bar = root.querySelector("#prog-bar");
    const txt = root.querySelector("#prog-text");
    try {
      const t0 = performance.now();
      const result = await importExamPdf(examFile, {
        store: ctx.store,
        facitFile,
        ocr: root.querySelector("#ocr").value,
        onProgress: ({ phase, done, total, extra }) => {
          bar.style.width = `${total ? Math.round((done / total) * 100) : 5}%`;
          txt.textContent = `${phase}${total ? ` – ${done}/${total}` : ""}${extra ? ` · ${extra}` : ""}`;
        },
      });
      result.seconds = Math.round((performance.now() - t0) / 100) / 10;
      draft = result;
      verifyView(ctx, root);
    } catch (err) {
      console.error(err);
      toast(`Tolkningen misslyckades: ${err.message}`, "err", 9000);
      btn.disabled = false;
      txt.textContent = `Fel: ${err.message}`;
    }
  });
}

function objectiveOptions(store) {
  return [...store.library.objectives.values()]
    .map((o) => `<option value="${esc(o.id)}">${esc(o.id)} ${esc(o.titel)}</option>`)
    .join("");
}

function problemsOf(q) {
  const p = [];
  if (q.options.length && !q.options.some((o) => o.is_correct)) p.push({ level: "err", text: "Inget rätt svar markerat" });
  if (!q.stem.trim()) p.push({ level: "err", text: "Frågetexten saknas" });
  if (q.options.length === 1) p.push({ level: "warn", text: "Bara ett alternativ" });
  if (q.type !== "freetext" && q.options.some((o) => !o.text.trim())) p.push({ level: "err", text: "Tomt alternativ" });
  if (!q.objective_id && q.tag_confidence < 0.35) p.push({ level: "warn", text: "Inget lärandemål valt" });
  return p;
}

function verifyView(ctx, root) {
  const { store } = ctx;
  const { exam, questions, report } = draft;
  setTitle(`Förhandsvisning ${exam.code}`);
  let filter = "all";

  function card(q, i) {
    const probs = problemsOf(q);
    const err = probs.some((p) => p.level === "err");
    const warn = probs.some((p) => p.level === "warn");
    const conf = q.tag_confidence ?? 0;
    const confChip = conf >= 0.85 ? "ok" : conf >= 0.35 ? "warn" : "err";
    const multi = q.type === "multi";
    const obj = store.library.objective(q.objective_id);
    return `<div class="verify-q ${err ? "has-error" : warn ? "has-warn" : ""}" data-i="${i}">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
        <b>Fråga ${q.number}</b>
        <select data-f="type" aria-label="Frågetyp" style="width:auto">
          <option value="single" ${q.type === "single" ? "selected" : ""}>Envalsfråga</option>
          <option value="multi" ${q.type === "multi" ? "selected" : ""}>Flervalsfråga</option>
          <option value="freetext" ${q.type === "freetext" ? "selected" : ""}>Fritext</option>
        </select>
        <label class="check" style="margin:0">Poäng <input type="number" step="0.5" min="0" value="${q.points}" data-f="points" style="width:80px"></label>
        <span class="chip ${confChip} conf" title="Säkerhet i kopplingen till lärandemål">Taggning ${Math.round(conf * 100)} %</span>
        ${q.tag_match ? `<span class="chip teal">${q.tag_match.kind === "exact" ? "Finns i banken" : "Liknar"} ${esc(q.tag_match.label)}</span>` : ""}
        ${q.section ? `<span class="chip">${esc(q.section)}</span>` : ""}
        <span style="margin-left:auto" class="btn-row">
          <button class="btn small ghost" data-preview="${i}">Visa PDF-sidan</button>
          <label class="check small" style="margin:0"><input type="checkbox" data-f="struken" ${q.status === "struken" ? "checked" : ""}> Struken</label>
        </span>
      </div>
      ${probs.map((p) => `<div class="notice ${p.level} small">${esc(p.text)}</div>`).join("")}
      <textarea data-f="stem" rows="3" aria-label="Frågetext">${esc(q.stem)}</textarea>
      ${q.media.length ? `<div class="thumbs">${q.media.map((m, mi) => `<span style="position:relative"><img src="${esc(m.data_url)}" alt="${esc(m.alt)}" data-zoom><button class="btn small ghost" data-rm-media="${mi}" title="Ta bort bild" style="position:absolute;top:2px;right:2px;padding:2px 6px">✕</button></span>`).join("")}</div>` : ""}
      ${q.type === "freetext"
        ? `<div class="field" style="margin-top:8px"><label>Bedömningskriterier (ett per rad, poäng i slutet: "Nämner X (1 p)")</label><textarea data-f="rubric" rows="3">${esc((q.rubric || []).map((r) => `${r.criterion} (${r.points} p)`).join("\n"))}</textarea></div>`
        : `<div style="margin-top:8px">${q.options.map((o, oi) => `<div class="opt-edit">
            <input type="${multi ? "checkbox" : "radio"}" name="c-${i}" data-correct="${oi}" ${o.is_correct ? "checked" : ""} aria-label="Rätt svar ${LETTERS[oi]}" style="width:18px;height:18px;accent-color:var(--ok)">
            <input type="text" value="${esc(o.text)}" data-opt="${oi}" aria-label="Alternativ ${LETTERS[oi]}"></div>`).join("")}
            <button class="btn small ghost" data-add-opt="${i}">+ Lägg till alternativ</button></div>`}
      <div class="field-row" style="margin-top:8px">
        <div class="field" style="flex:2 1 320px"><label>Lärandemål</label>
          <input type="text" list="lo-list" value="${obj ? `${esc(obj.id)} ${esc(obj.titel)}` : ""}" data-f="objective" placeholder="Sök lärandemål, t.ex. 1.5.9 eller trombocyt">
          ${q.tag_suggestions?.length && !q.tag_match ? `<div class="small muted" style="margin-top:4px">Förslag: ${q.tag_suggestions.map((s) => {
            const o = store.library.objective(s.objective_id);
            return o ? `<button class="btn small ghost" data-suggest="${esc(o.id)}">${esc(o.id)} ${esc(o.titel.slice(0, 40))} (${Math.round(s.confidence * 100)} %)</button>` : "";
          }).join(" ")}</div>` : ""}
        </div>
        <div class="field"><label>Modul</label><select data-f="modul"><option value="">–</option>${[...store.library.modules.values()].map((m) => `<option value="${m.nr}" ${Number(q.modul) === m.nr ? "selected" : ""}>${esc(`${m.nr}. ${m.titel}`)}</option>`).join("")}</select></div>
      </div>
      <details><summary class="small" style="cursor:pointer">Förklaring</summary><textarea data-f="explanation" rows="2" placeholder="Valfri pedagogisk förklaring (visas i resultatet och på Anki-kortet)">${esc(q.explanation || "")}</textarea></details>
      <div class="page-preview" id="pv-${i}"></div>
    </div>`;
  }

  function visible() {
    return questions.map((q, i) => ({ q, i })).filter(({ q }) => {
      if (filter === "problems") return problemsOf(q).length > 0;
      if (filter === "lowtag") return (q.tag_confidence ?? 0) < 0.85;
      if (filter === "dupes") return Boolean(q.tag_match);
      return true;
    });
  }

  function renderList() {
    const v = visible();
    root.querySelector("#vq").innerHTML = v.length ? v.map(({ q, i }) => card(q, i)).join("") : `<div class="empty"><p>Inga frågor i det här filtret.</p></div>`;
    for (const b of root.querySelectorAll("[data-filter]")) b.setAttribute("aria-pressed", String(b.dataset.filter === filter));
    const errs = questions.filter((q) => problemsOf(q).some((p) => p.level === "err")).length;
    root.querySelector("#v-errs").innerHTML = errs ? `<span class="chip err">${errs} frågor med fel</span>` : `<span class="chip ok">Inga blockerande fel</span>`;
  }

  root.innerHTML = `
    <datalist id="lo-list">${objectiveOptions(store)}</datalist>
    <div class="page-head"><div><h1>Förhandsvisning av tolkad tenta</h1>
      <p class="lead">Kontrollera att frågor, facit och taggar blev rätt innan tentan sparas. ${esc(exam.source_file || "")} tolkades på ${draft.seconds ?? "–"} s.</p></div>
      <button class="btn ghost" data-act="cancel">Avbryt import</button></div>

    <div class="grid cols-4">
      <div class="card stat"><div class="label">Frågor</div><div class="value">${report.questions}</div><div class="sub">${report.mcq} flerval · ${report.freetext} fritext</div></div>
      <div class="card stat"><div class="label">Med facit</div><div class="value">${report.with_answer}</div><div class="sub">av ${report.mcq} flervalsfrågor</div></div>
      <div class="card stat"><div class="label">Bilder/tabeller</div><div class="value">${report.images}</div><div class="sub">${report.pages} sidor${report.ocr_pages.length ? ` · OCR på ${report.ocr_pages.length}` : ""}</div></div>
      <div class="card stat"><div class="label">Kända frågor</div><div class="value">${report.exact_duplicates + report.similar}</div><div class="sub">${report.exact_duplicates} identiska · ${report.similar} liknande</div></div>
    </div>
    ${report.errors.map((e) => `<div class="notice err" style="margin-top:12px">${esc(e)}</div>`).join("")}
    ${report.warnings.slice(0, 8).map((w) => `<div class="notice warn" style="margin-top:8px">${esc(w)}</div>`).join("")}

    <div class="card" style="margin-top:16px">
      <h2>Uppgifter om tentan</h2>
      <div class="field-row">
        <div class="field"><label for="m-kind">Typ</label><select id="m-kind">${["Ordinarie", "Rest", "Övrig"].map((k) => `<option ${exam.kind === k ? "selected" : ""}>${k}</option>`).join("")}</select></div>
        <div class="field"><label for="m-term">Termin (HT24, VT25 …)</label><input id="m-term" type="text" value="${esc(exam.term || "")}" pattern="(HT|VT)[0-9]{2}" placeholder="HT24"></div>
        <div class="field"><label for="m-date">Datum</label><input id="m-date" type="date" value="${esc(exam.exam_date || "")}"></div>
        <div class="field"><label for="m-dur">Skrivtid (min)</label><input id="m-dur" type="number" min="10" value="${exam.duration_min}"></div>
        <div class="field"><label for="m-pass">Godkänt-gräns (p, tomt = ${Math.round(store.settings.pass_ratio * 100)} %)</label><input id="m-pass" type="number" min="0" step="0.5" value="${exam.pass_points ?? ""}"></div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
        <button class="chip" data-filter="all">Alla</button>
        <button class="chip" data-filter="problems">Behöver åtgärd</button>
        <button class="chip" data-filter="lowtag">Osäker taggning</button>
        <button class="chip" data-filter="dupes">Finns i banken</button>
        <span id="v-errs" style="margin-left:auto"></span>
      </div>
      <div id="vq"></div>
    </div>
    <div class="sticky-actions">
      <button class="btn" data-act="save-draft">Spara som utkast</button>
      <button class="btn primary" data-act="publish">Publicera tentan</button>
    </div>`;
  renderList();

  const qAt = (el) => questions[Number(el.closest("[data-i]").dataset.i)];
  const refreshCard = (i) => {
    const el = root.querySelector(`[data-i="${i}"]`);
    if (el) el.outerHTML = card(questions[i], i);
    renderList();
  };
  const parseObjective = (val) => {
    const id = /^(\d+\.\d+\.\d+)/.exec(String(val).trim())?.[1];
    return id && store.library.objective(id) ? id : null;
  };

  const offs = [];
  offs.push(on(root, "change", "[data-f]", (e, el) => {
    const q = qAt(el);
    const f = el.dataset.f;
    if (f === "type") {
      q.type = el.value;
      if (q.type === "single" && q.options.filter((o) => o.is_correct).length > 1) q.options.forEach((o, k) => { o.is_correct = k === q.options.findIndex((x) => x.is_correct); });
      refreshCard(questions.indexOf(q));
    } else if (f === "points") q.points = Number(el.value) || 0;
    else if (f === "struken") q.status = el.checked ? "struken" : "ok";
    else if (f === "stem") q.stem = el.value;
    else if (f === "explanation") q.explanation = el.value;
    else if (f === "modul") q.modul = el.value ? Number(el.value) : null;
    else if (f === "rubric") {
      q.rubric = el.value.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
        const m = /\((\d+(?:[.,]\d+)?)\s*p\)\s*$/i.exec(l);
        return { criterion: l.replace(/\((\d+(?:[.,]\d+)?)\s*p\)\s*$/i, "").trim(), points: m ? Number(m[1].replace(",", ".")) : 1 };
      });
    } else if (f === "objective") {
      const id = parseObjective(el.value);
      q.objective_id = id;
      if (id) {
        q.modul = store.library.objective(id).modul;
        q.tag_source = "manual";
        q.tag_confidence = 1;
      }
      refreshCard(questions.indexOf(q));
    }
  }));
  offs.push(on(root, "change", "[data-correct]", (e, el) => {
    const q = qAt(el);
    const oi = Number(el.dataset.correct);
    if (q.type === "multi") q.options[oi].is_correct = el.checked;
    else q.options.forEach((o, k) => { o.is_correct = k === oi; });
    refreshCard(questions.indexOf(q));
  }));
  offs.push(on(root, "change", "input[data-opt]", (e, el) => {
    const q = qAt(el);
    q.options[Number(el.dataset.opt)].text = el.value;
  }));
  offs.push(on(root, "click", "[data-add-opt]", (e, el) => {
    const q = questions[Number(el.dataset.addOpt)];
    q.options.push({ ordinal: q.options.length, text: "", is_correct: false });
    refreshCard(Number(el.dataset.addOpt));
  }));
  offs.push(on(root, "click", "[data-rm-media]", (e, el) => {
    const q = qAt(el);
    q.media.splice(Number(el.dataset.rmMedia), 1);
    refreshCard(questions.indexOf(q));
  }));
  offs.push(on(root, "click", "[data-suggest]", (e, el) => {
    const q = qAt(el);
    const o = store.library.objective(el.dataset.suggest);
    q.objective_id = o.id;
    q.modul = o.modul;
    q.tag_source = "manual";
    q.tag_confidence = 1;
    refreshCard(questions.indexOf(q));
  }));
  offs.push(on(root, "click", "[data-zoom]", (e, el) => lightbox(el.src, el.alt)));
  offs.push(on(root, "click", "[data-filter]", (e, el) => { filter = el.dataset.filter; renderList(); }));
  offs.push(on(root, "click", "[data-preview]", async (e, el) => {
    const i = Number(el.dataset.preview);
    const q = questions[i];
    const box = root.querySelector(`#pv-${i}`);
    if (box.innerHTML) {
      box.innerHTML = "";
      return;
    }
    box.innerHTML = `<span class="spinner"></span>`;
    try {
      const r = q.source_region;
      const c = await draft.extracted.crop(r.page, { x0: 20, y0: Math.max(0, r.y0 - 10), x1: 580, y1: r.y1 > r.y0 + 20 ? r.y1 + 10 : r.y0 + 420 }, 0);
      box.innerHTML = `<img src="${c.data_url}" alt="Fråga ${q.number} i PDF:en" data-zoom>`;
    } catch (err) {
      box.innerHTML = `<div class="notice err small">Kunde inte visa sidan: ${esc(err.message)}</div>`;
    }
  }));

  async function save(status) {
    exam.kind = root.querySelector("#m-kind").value;
    exam.term = root.querySelector("#m-term").value.trim().toUpperCase();
    exam.exam_date = root.querySelector("#m-date").value || null;
    exam.duration_min = Number(root.querySelector("#m-dur").value) || exam.duration_min;
    const pass = root.querySelector("#m-pass").value;
    exam.pass_points = pass === "" ? null : Number(pass);
    if (!/^(HT|VT)\d{2}$/.test(exam.term)) {
      toast("Ange termin som HT24 eller VT25.", "err");
      root.querySelector("#m-term").focus();
      return;
    }
    const errs = questions.filter((q) => q.status !== "struken" && problemsOf(q).some((p) => p.level === "err"));
    if (status === "published" && errs.length) {
      filter = "problems";
      renderList();
      toast(`${errs.length} frågor har fel som måste rättas (eller markeras som strukna) innan publicering.`, "err", 7000);
      return;
    }
    exam.code = `${exam.kind === "Övrig" ? "Tenta" : exam.kind} ${exam.term}`;
    exam.title = `BV5 ${exam.code}`;
    const clash = [...store.exams.values()].find((x) => x.code === exam.code && x.id !== exam.id);
    if (clash && !(await confirmDialog("Det finns redan en tenta med samma namn", `${exam.code} finns redan (${clash.source === "bibliotek" ? "från kursbiblioteket" : "importerad"}). Spara ändå som en separat tenta?`, "Spara ändå"))) return;
    exam.status = status;
    exam.published_at = status === "published" ? new Date().toISOString() : null;
    exam.question_count = questions.length;
    exam.total_points = questions.reduce((n, q) => n + (q.status === "struken" ? 0 : Number(q.points || 0)), 0);
    const clean = questions.map((q) => {
      const { tag_suggestions, source_region, ...rest } = q;
      return {
        ...rest, exam_code: exam.code,
        options: q.type === "freetext" ? [] : q.options.filter((o) => o.text.trim()).map((o, k) => ({ ordinal: k, text: o.text.trim(), is_correct: Boolean(o.is_correct) })),
        source_region,
      };
    });
    await store.saveExam(exam, clean);
    await draft.extracted.close().catch(() => {});
    draft = null;
    ctx.sync?.flush();
    toast(status === "published" ? `${exam.code} är publicerad.` : `${exam.code} är sparad som utkast.`, "ok");
    ctx.go("#/admin/tentor");
  }

  offs.push(on(root, "click", "[data-act]", async (e, el) => {
    const act = el.dataset.act;
    if (act === "cancel") {
      if (await confirmDialog("Avbryta importen?", "Den tolkade tentan kastas.", "Avbryt import", true)) {
        await draft.extracted.close().catch(() => {});
        draft = null;
        ctx.render();
      }
    } else if (act === "save-draft") save("draft");
    else if (act === "publish") save("published");
  }));
  return () => offs.forEach((f) => f());
}
