/* Bygger Anki-kortens innehåll (gemensamt för .apkg och TSV). */

import { esc } from "../core/text.js";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
/* Syns i filnamnet på exporten så att man ser vilken kortmall filen har. */
export const CARD_VERSION = "v7";

export const FIELD_NAMES = ["Framsida", "Baksida", "Lärandemål", "Länk", "Källa"];

function b64(text) {
  if (typeof btoa === "function") return btoa(text);
  return Buffer.from(text, "binary").toString("base64");
}

export function sourceLabel(q, exam) {
  const term = exam?.term || "";
  const kind = exam?.kind && exam.kind !== "Övrig" ? ` ${exam.kind.toLowerCase()}` : "";
  const date = exam?.exam_date ? ` (${exam.exam_date})` : "";
  const name = term ? `BV5 ${term}${kind}${date}` : `BV5 ${exam?.code || q.exam_code || "tenta"}`;
  return `${name} – Fråga ${q.number}`;
}

/** Huvudkortlek per tenta, t.ex. "BV5 HT23 Rest" – modulerna ligger som underkortlekar. */
export function examDeckName(q, exam) {
  const clean = (t) => String(t || "").replace(/::/g, " ").replace(/\s+/g, " ").trim();
  if (exam?.term && exam?.kind && exam.kind !== "Övrig") return `BV5 ${clean(exam.term)} ${clean(exam.kind)}`;
  if (exam?.term) return `BV5 ${clean(exam.term)}`;
  const name = clean(exam?.title || exam?.code || q.exam_code);
  if (!name) return "BV5 Övriga frågor";
  return /\bBV5\b/i.test(name) ? name : `BV5 ${name}`;
}

function slug(text) {
  return String(text || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9.]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

/**
 * @param q        fråga
 * @param ctx      {library, exam, category, mediaName(path) → filnamn i kortleken}
 * @returns        {guid, fields[5], tags[], deck, media[]}
 */
export function buildNote(q, ctx) {
  const { library, exam, category } = ctx;
  const media = [];
  const imgTag = (m) => {
    const name = ctx.mediaName ? ctx.mediaName(m) : m.path;
    media.push({ ...m, name });
    return `<div class="bv5-fig"><img src="${esc(name)}" alt="${esc(m.alt || "Figur")}"></div>`;
  };

  const stemImgs = (q.media || []).filter((m) => m.placement !== "options").map(imgTag).join("");
  const optImgs = (q.media || []).filter((m) => m.placement === "options").map(imgTag).join("");
  const optionsHtml = (q.options || [])
    .map((o, i) => `<li data-i="${i}" role="button"><span class="bv5-letter">${LETTERS[i]}</span> <span class="bv5-opt-text">${esc(o.text)}</span></li>`)
    .join("");
  // data-k = rätt alternativ (index), base64-kodat så att svaret inte syns i klartext i kortkällan.
  const keyIdx = (q.options || []).map((o, i) => (o.is_correct ? i : -1)).filter((i) => i >= 0).join(",");
  const multi = (q.options || []).filter((o) => o.is_correct).length > 1 || q.type === "multi";
  const optionsAttrs = `data-qid="${esc(q.id)}" data-k="${b64(keyIdx)}" data-multi="${multi ? 1 : 0}"`;
  const front =
    `<div class="bv5-stem">${q.stem_html || esc(q.stem)}</div>${stemImgs}` +
    (optionsHtml ? `<ol class="bv5-options" ${optionsAttrs}>${optionsHtml}</ol>` : "") + optImgs;

  const correct = (q.options || []).map((o, i) => ({ ...o, letter: LETTERS[i] })).filter((o) => o.is_correct);
  const wrong = (q.options || []).map((o, i) => ({ ...o, letter: LETTERS[i] })).filter((o) => !o.is_correct);
  const expl = library ? library.explanationFor(q) : { text: q.explanation || "", source: "fraga" };
  const link = library ? library.linkFor(q) : { url: "https://ybgdon7.github.io/bibliotek/", label: "Lärandemålsbiblioteket", level: "library" };
  const objective = link.objective;
  const theme = library?.theme(q.theme_id);

  let back = "";
  if (q.status === "struken") back += `<div class="bv5-warn">Frågan är struken av examinator.</div>`;
  if (correct.length) {
    back += `<div class="bv5-correct"><b>Rätt svar:</b> ${correct.map((o) => esc(o.text)).join("<br>")}</div>`;
  } else if (q.type === "freetext" && q.rubric?.length) {
    back += `<div class="bv5-correct"><b>Bedömningsmall:</b><ul>${q.rubric.map((r) => `<li>${esc(r.criterion)} (${r.points} p)</li>`).join("")}</ul></div>`;
  }
  if (expl.text) {
    back += `<div class="bv5-expl"><b>Varför:</b> ${esc(expl.text)}</div>`;
  }
  if (wrong.length && correct.length) {
    back += `<div class="bv5-wrong"><b>Övriga alternativ:</b> ${wrong.map((o) => esc(o.text)).join(" · ")}</div>`;
  }
  if (q.key_points?.length) {
    back += `<div class="bv5-keys"><b>Kärnpunkter</b><ul>${q.key_points.map((k) => `<li>${esc(k)}</li>`).join("")}</ul></div>`;
  }
  if (q.correction_note) back += `<div class="bv5-note">${esc(q.correction_note)}</div>`;

  const moduleName = library ? library.moduleName(q.modul) : `Modul ${q.modul ?? "?"}`;
  const loField = objective
    ? `${esc(objective.id)} ${esc(objective.titel)}<br><span class="bv5-sub">${esc(moduleName)}${theme ? ` · ${esc(theme.tema)}` : ""}</span>`
    : esc(moduleName);
  const linkField = `<a href="${esc(link.url)}">Läs i kursbiblioteket: ${esc(link.label)}</a>`;
  const source = esc(sourceLabel(q, exam));

  const tags = ["BV5", `Modul_${q.modul ?? "okand"}`];
  if (objective) tags.push(`LM_${slug(objective.id)}`);
  if (exam?.term) tags.push(`Tenta_${slug(exam.code || exam.term)}`);
  if (category) tags.push(...[].concat(category).map((c) => `Kategori_${slug(c)}`));

  const deckModule = library?.module(q.modul);
  const deck = `${examDeckName(q, exam)}::${deckModule ? `Modul ${deckModule.nr} ${deckModule.titel}` : "Övrigt"}`;

  return {
    guid: `bv5l-${q.id}`,          // nytt prefix → nya kort med den lila mallen, oberoende av gamla kort
    fields: [front, back, loField, linkField, source],
    tags,
    deck,
    media,
    sortText: q.stem,
  };
}

export const CARD_CSS = `.card{font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;font-size:19px;line-height:1.45;color:#1d1b20;background:#f4f4f2;text-align:left;margin:0;padding:0}
.nightMode .card,.card.nightMode{color:#ececec;background:#202124}
.bv5-wrap{max-width:860px;margin:0 auto;padding:18px 16px 28px}
.bv5-stem{background:#8f1d5f;color:#fff;text-align:center;font-size:22px;font-weight:500;line-height:1.4;padding:18px 22px;border-radius:6px;box-shadow:0 1px 3px rgba(0,0,0,.2);margin:6px 0 28px}
.nightMode .bv5-stem{background:#7a1951;color:#fff}
.bv5-fig{text-align:center}
.bv5-fig img{max-width:100%;height:auto;border-radius:6px;margin:0 0 20px;background:#fff}
.bv5-options{list-style:none;padding:0;margin:0}
.bv5-options li{background:#fff;color:#111;text-align:center;font-size:21px;padding:14px 18px;margin:0 0 18px;border-radius:4px;border:2px solid transparent;box-shadow:0 1px 3px rgba(0,0,0,.22);transition:background .12s,border-color .12s,box-shadow .12s,transform .06s}
.nightMode .bv5-options li{background:#2e3033;color:#ececec;box-shadow:0 1px 3px rgba(0,0,0,.6)}
.bv5-options.bv5-live li{cursor:pointer;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent}
.bv5-options.bv5-live li:hover{box-shadow:0 3px 10px rgba(0,0,0,.22)}
.bv5-options.bv5-live li:active{transform:scale(.99)}
.bv5-options li.bv5-chosen{border-color:#8f1d5f;background:#f6e6ee;box-shadow:0 0 0 2px #8f1d5f}
.nightMode .bv5-options li.bv5-chosen{background:#3a1a2c;border-color:#d27aa9;box-shadow:0 0 0 2px #d27aa9}
.bv5-options li.bv5-is-correct{background:#9bf598;border-color:#43a047;color:#0d2a0c}
.bv5-options li.bv5-is-wrong{background:#f7a8a2;border-color:#d93b30;color:#3a0b08}
.nightMode .bv5-options li.bv5-is-correct{background:#1f6b2c;border-color:#5ec46b;color:#f0fff1}
.nightMode .bv5-options li.bv5-is-wrong{background:#7a2620;border-color:#ef6b61;color:#fff0ef}
.bv5-letter{display:none}
.bv5-chosen .bv5-letter,.bv5-picked .bv5-letter{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;background:#8f1d5f;color:#fff;font-size:16px;font-weight:700;margin-right:10px;vertical-align:2px}
.nightMode .bv5-chosen .bv5-letter,.nightMode .bv5-picked .bv5-letter{background:#b8327e}
.bv5-hint{text-align:center;font-size:15px;color:#7d7d7d;margin:2px 0 10px;min-height:22px}
.bv5-hint.ok{color:#2e7d32;font-weight:700}
.bv5-hint.bad{color:#c62828;font-weight:700}
.nightMode .bv5-hint.ok{color:#7fd88a}
.nightMode .bv5-hint.bad{color:#f28b82}
@keyframes bv5ok{from{background:#fff;border-color:transparent}}
@keyframes bv5bad{from{background:#f6e6ee;border-color:#8f1d5f}}
.bv5-options li.bv5-is-correct{animation:bv5ok .35s ease}
.bv5-options li.bv5-is-wrong{animation:bv5bad .35s ease}
.bv5-options li.bv5-is-correct.bv5-picked{animation-name:bv5bad}
.bv5-sep{border:0;border-top:1px solid #d6d6d2;margin:6px auto 0;max-width:860px}
.nightMode .bv5-sep{border-top-color:#3a3c40}
.bv5-correct{background:#e7f4ec;border-left:4px solid #2e7d51;padding:9px 12px;border-radius:6px;margin:8px 0}
.nightMode .bv5-correct{background:#173323}
.bv5-expl,.bv5-keys,.bv5-wrong,.bv5-note{margin:10px 0}
.bv5-wrong{color:#5b5560}
.nightMode .bv5-wrong{color:#bdb6ad}
.bv5-warn{color:#b3261e;font-weight:600}
.bv5-meta{margin-top:16px;padding-top:10px;border-top:1px solid #d6d6d2;font-size:16px;color:#5b5560}
.nightMode .bv5-meta{color:#bdb6ad;border-top-color:#3a3c40}
.bv5-sub{font-size:14px;color:#8a838e}
.bv5-meta a{color:#9c1f66}
.nightMode .bv5-meta a{color:#e07ab0}`;

const CARD_SCRIPT = `<script>
(function () {
function bv5Run() {
  var lists = document.querySelectorAll(".bv5-options[data-qid]");
  var ol = lists[lists.length - 1];
  var hint = document.getElementById("bv5-hint");
  if (!ol) return;
  var qid = ol.getAttribute("data-qid");
  var multi = ol.getAttribute("data-multi") === "1";
  var key = "bv5-val-" + qid;
  var correct = [];
  try { correct = atob(ol.getAttribute("data-k") || "").split(",").filter(function (x) { return x !== ""; }).map(Number); } catch (e) { correct = []; }
  function load() {
    try { var v = sessionStorage.getItem(key); if (v !== null) return JSON.parse(v); } catch (e) {}
    return (window.__bv5sel || {})[qid] || [];
  }
  function save(v) {
    try { sessionStorage.setItem(key, JSON.stringify(v)); } catch (e) {}
    window.__bv5sel = window.__bv5sel || {};
    window.__bv5sel[qid] = v;
  }
  var items = ol.querySelectorAll("li[data-i]");
  var isBack = !!document.getElementById("bv5-back");
  if (!isBack) {
    var sel = [];
    save(sel);
    ol.classList.add("bv5-live");
    var paint = function () {
      for (var i = 0; i < items.length; i++) {
        var on = sel.indexOf(Number(items[i].getAttribute("data-i"))) >= 0;
        items[i].className = on ? "bv5-chosen" : "";
        items[i].setAttribute("aria-pressed", on ? "true" : "false");
      }
    };
    var pick = function (i) {
      /* Klick markerar alternativet (bokstaven visas) – svaret lämnas in med mellanslag (Ankis "Visa svar"). */
      if (multi) {
        var at = sel.indexOf(i);
        if (at >= 0) sel.splice(at, 1); else sel.push(i);
        sel.sort();
      } else {
        sel = sel.length === 1 && sel[0] === i ? [] : [i];
      }
      save(sel);
      paint();
    };
    for (var j = 0; j < items.length; j++) {
      (function (li) {
        var i = Number(li.getAttribute("data-i"));
        li.addEventListener("click", function (e) { e.stopPropagation(); pick(i); try { li.blur(); } catch (x) {} });
      })(items[j]);
    }
    if (hint) hint.textContent = multi
      ? "Flera alternativ kan vara rätt – markera alla och tryck sedan på mellanslag för att svara."
      : "Klicka på ett alternativ och tryck sedan på mellanslag för att svara.";
  } else {
    var chosen = load();
    for (var k = 0; k < items.length; k++) {
      var idx = Number(items[k].getAttribute("data-i"));
      var isC = correct.indexOf(idx) >= 0;
      var picked = chosen.indexOf(idx) >= 0;
      items[k].className = (isC ? "bv5-is-correct" : picked ? "bv5-is-wrong" : "") + (picked ? " bv5-picked" : "");
    }
    var same = chosen.length === correct.length && chosen.every(function (c) { return correct.indexOf(c) >= 0; });
    /* Resultatet visas på raden under alternativen (samma plats som tipset) – inget flyttar sig. */
    if (hint) {
      hint.style.display = "";
      if (!chosen.length) { hint.className = "bv5-hint"; hint.textContent = "Inget svar valt – rätt svar är grönt."; }
      else if (same) { hint.className = "bv5-hint ok"; hint.textContent = "✓ Rätt"; }
      else { hint.className = "bv5-hint bad"; hint.textContent = "✗ Fel – rätt svar är grönt."; }
    }
  }
}
/* Mobilapparna läser in kortet som en ny sida (vänta tills hela kortet finns, inkl. #bv5-back);
   Anki för dator lägger in hela kortet på en gång och kör skriptet efteråt. */
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bv5Run);
else bv5Run();
})();
</script>`;

export const FRONT_TEMPLATE =
  '<div class="bv5-wrap">{{Framsida}}<div class="bv5-hint" id="bv5-hint"></div></div>\n' + CARD_SCRIPT;
export const BACK_TEMPLATE =
  '{{FrontSide}}<div id="bv5-back"><hr class="bv5-sep"><div class="bv5-wrap">{{Baksida}}<div class="bv5-meta"><div><b>Lärandemål:</b> {{Lärandemål}}</div><div>{{Länk}}</div><div><b>Källa:</b> {{Källa}}</div></div></div></div>';
