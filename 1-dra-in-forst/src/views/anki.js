/* Anki-export från resultat och "Öva på dina fel": .apkg (med bilder) och TSV. */

import { modal, toast, download, esc } from "../ui/dom.js";
import { buildNote, CARD_VERSION } from "../anki/cards.js";
import { buildApkg, buildTsv } from "../anki/apkg.js";

let sqlPromise = null;
export function loadSql(base = "./vendor/") {
  if (!sqlPromise) {
    sqlPromise = new Promise((resolve, reject) => {
      const done = () => globalThis.initSqlJs({ locateFile: (f) => `${base}${f}` }).then(resolve, reject);
      if (globalThis.initSqlJs) return done();
      const s = document.createElement("script");
      s.src = `${base}sql-wasm.js`;
      s.onload = done;
      s.onerror = () => {
        sqlPromise = null;
        reject(new Error("sql.js kunde inte laddas"));
      };
      document.head.appendChild(s);
    });
  }
  return sqlPromise;
}

function dataUrlBytes(url) {
  const b64 = url.split(",")[1] || "";
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function mediaFileName(q, m, i) {
  if (m.path) return `bv5_${m.path.split("/").pop()}`;
  const ext = String(m.data_url || "").startsWith("data:image/png") ? "png" : "webp";
  return `bv5_${q.id.slice(0, 8)}_${i}.${ext}`;
}

/** Bygger noter + mediafiler. items: [{question, category}] */
export async function buildDeck(store, items) {
  const notes = [];
  const media = new Map();
  for (const { question: q, category } of items) {
    const exam = store.exams.get(q.exam_id);
    let mi = 0;
    const note = buildNote(q, { library: store.library, exam, category, mediaName: (m) => mediaFileName(q, m, mi++) });
    for (const m of note.media) {
      if (media.has(m.name)) continue;
      try {
        if (m.data_url) media.set(m.name, dataUrlBytes(m.data_url));
        else if (m.url) {
          const res = await fetch(m.url);
          if (res.ok) media.set(m.name, new Uint8Array(await res.arrayBuffer()));
        }
      } catch {
        /* bilden utelämnas, kortet fungerar ändå */
      }
    }
    notes.push(note);
  }
  return { notes, media };
}

export async function exportAnkiDialog(ctx, items, baseName = "BV5-fel") {
  if (!items.length) {
    toast("Det finns inga frågor att exportera i det här urvalet.");
    return;
  }
  const counts = items.reduce((m, i) => {
    for (const c of [].concat(i.category)) m[c] = (m[c] || 0) + 1;
    return m;
  }, {});
  const cats = Object.entries(counts).map(([c, n]) => `<label class="check"><input type="checkbox" name="cat" value="${esc(c)}" ${c === "Obesvarad" ? "" : "checked"}> ${esc(c)} (${n})</label>`).join("");
  const choice = await modal({
    title: "Exportera till Anki",
    body: `<p>${items.length} frågor. Framsidan har frågan och alternativen; baksidan rätt svar, förklaring, lärandemål med länk till kursbiblioteket och källa.</p>
      <div class="field">${cats}</div>
      <div class="notice small"><b>.apkg</b> öppnas direkt i Anki (dubbelklicka) och innehåller bilderna. <b>TSV</b> importeras via Arkiv → Importera och passar Ankis grundläggande korttyp.</div>`,
    actions: [
      { label: "Avbryt", value: null },
      { label: "Ladda ner TSV", value: "tsv" },
      { label: "Ladda ner .apkg", value: "apkg", kind: "primary" },
    ],
    onSubmit: (value, d) => {
      const chosen = [...d.querySelectorAll('input[name="cat"]:checked')].map((x) => x.value);
      if (!chosen.length) {
        toast("Välj minst en kategori.");
        return false;
      }
      return { format: value, cats: chosen };
    },
  });
  if (!choice) return;
  const picked = items.filter((i) => [].concat(i.category).some((c) => choice.cats.includes(c)));
  const stamp = new Date().toISOString().slice(0, 10);
  try {
    toast("Bygger kortleken …");
    const { notes, media } = await buildDeck(ctx.store, picked);
    if (choice.format === "tsv") {
      download(`${baseName}-${stamp}.txt`, buildTsv(notes), "text/tab-separated-values;charset=utf-8");
    } else {
      const SQL = await loadSql();
      const bytes = await buildApkg(SQL, notes, media);
      download(`${baseName}-${stamp}-${CARD_VERSION}.apkg`, new Blob([bytes], { type: "application/octet-stream" }));
    }
    toast(`${notes.length} kort exporterade.`, "ok");
  } catch (err) {
    toast(`Exporten misslyckades: ${err.message}`, "err", 8000);
  }
}
