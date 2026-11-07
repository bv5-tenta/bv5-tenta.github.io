/* Systemdiagnostik: testar PDF-tolken, rättningsmotorn, bibliotekslänkar, Anki-exporten och databasen. */

import { extractPdf } from "./pdf/extract.js";
import { parseInspera } from "./pdf/layout.js";
import { gradeAttempt, gradeResponse } from "./core/grading.js";
import { applyOutcome, emptyProgress } from "./core/mastery.js";
import { objectiveUrl } from "./core/library.js";
import { buildApkg, buildTsv, inspectApkg } from "./anki/apkg.js";
import { readZip } from "./anki/zip.js";
import { buildDeck, loadSql } from "./views/anki.js";
import { Idb } from "./data/idb.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const DEMO = [
  { n: 1, correct: 1, options: 5, images: 0, stemIncludes: "klopidogrel" },
  { n: 2, correct: 3, options: 5, images: 1, stemIncludes: "maximal koncentration" },
  { n: 3, correct: 0, options: 5, images: 0, stemIncludes: "repolariseringen", firstOption: "K⁺" },
];

export function diagnosticsTests(ctx) {
  const { store } = ctx;
  return [
    {
      name: "PDF-tolken (demotenta i Inspera-format)",
      run: async () => {
        const res = await fetch("data/demo/demo-tenta.pdf");
        assert(res.ok, `Demotentan kunde inte läsas (HTTP ${res.status})`);
        const ex = await extractPdf(await res.arrayBuffer(), { ocr: "off" });
        try {
          const { questions, warnings } = parseInspera(ex.pages);
          assert(questions.length === 3, `Förväntade 3 frågor, fick ${questions.length}`);
          for (const exp of DEMO) {
            const q = questions.find((x) => x.number === exp.n);
            assert(q, `Fråga ${exp.n} saknas`);
            assert(q.options.length === exp.options, `Fråga ${exp.n}: ${q.options.length} alternativ i stället för ${exp.options}`);
            const c = q.options.findIndex((o) => o.is_correct);
            assert(c === exp.correct, `Fråga ${exp.n}: facit blev ${c + 1}, väntat ${exp.correct + 1}`);
            assert(q.stem.includes(exp.stemIncludes), `Fråga ${exp.n}: frågetexten lästes fel`);
            assert(q.images.length === exp.images, `Fråga ${exp.n}: ${q.images.length} bilder i stället för ${exp.images}`);
            if (exp.firstOption) assert(q.options[0].text === exp.firstOption, `Fråga ${exp.n}: upphöjda tecken blev "${q.options[0].text}"`);
          }
          return `3 frågor, 3 facit (gröna bockar), 1 bild, upphöjda tecken (K⁺) korrekta${warnings.length ? ` · ${warnings.length} varningar` : ""}`;
        } finally {
          await ex.close();
        }
      },
    },
    {
      name: "Rättningsmotorn",
      run: async () => {
        const opts = (c) => [0, 1, 2, 3, 4].map((i) => ({ ordinal: i, text: `Alt ${i}`, is_correct: c.includes(i) }));
        const qs = [
          { id: "a", type: "single", points: 1, status: "ok", modul: 1, options: opts([2]) },
          { id: "b", type: "single", points: 1, status: "ok", modul: 1, options: opts([0]) },
          { id: "c", type: "multi", points: 2, status: "ok", modul: 2, options: opts([1, 3]) },
          { id: "d", type: "single", points: 1, status: "struken", modul: 2, options: opts([4]) },
          { id: "e", type: "freetext", points: 2, status: "ok", modul: 3, options: [], rubric: [{ criterion: "x", points: 2 }] },
        ];
        const resp = new Map([
          ["a", { selected: [2] }], ["b", { selected: [1], flag_unsure: true }], ["c", { selected: [3, 1] }],
          ["d", { selected: [0] }], ["e", { free_text: "svar", self_grade: { 0: 1.5 } }],
        ]);
        const s = gradeAttempt(qs, resp, { pass_ratio: 0.6 });
        assert(s.score === 4.5 && s.max === 6, `Poäng ${s.score}/${s.max}, väntat 4,5/6`);
        assert(s.pass_points === 4 && s.passed === true, "Godkänt-gränsen räknades fel");
        assert(s.meta.osakerFel === 1 && s.wrong.length === 2, "Metakognitiv klassning blev fel");
        assert(gradeResponse(qs[2], { selected: [1] }).is_correct === false, "Halvt svar på flervalsfråga gav rätt");
        let p = emptyProgress("a");
        const g = (r) => gradeResponse(qs[0], r);
        for (const r of [{ selected: [0] }, { selected: [2] }, { selected: [2] }, { selected: [2] }]) p = applyOutcome(p, { question_id: "a", ...r }, g(r), 3);
        assert(p.state === "mastered", `Bemästrad-regeln gav "${p.state}"`);
        return "Envals-, flervals-, fritext- och strukna frågor rättas rätt; godkänt-gräns och Bemästrad-regel stämmer";
      },
    },
    {
      name: "Bibliotekslänkar",
      run: async () => {
        const lib = store.library;
        assert(lib.objectives.size > 0, "Inga lärandemål inlästa");
        let bad = 0;
        for (const o of lib.objectives.values()) {
          const [m, s] = o.id.split(".").map(Number);
          if (o.modul !== m || o.sub !== s || o.url !== objectiveUrl(lib.base, m, s, o.id)) bad++;
        }
        assert(bad === 0, `${bad} lärandemål har fel länk`);
        const qs = [...store.questions.values()];
        const linked = qs.filter((q) => lib.linkFor(q).level === "objective").length;
        const modOnly = qs.filter((q) => lib.linkFor(q).level === "module").length;
        assert(linked > 0, "Inga frågor kopplade till lärandemål");
        return `${lib.objectives.size} lärandemål löses upp till rätt djuplänk · ${linked} frågor länkar till lärandemål, ${modOnly} till modul`;
      },
    },
    {
      name: "Anki-export (.apkg och TSV)",
      run: async () => {
        const qs = [...store.questions.values()];
        const picked = [...qs.filter((q) => q.media?.length).slice(0, 1), ...qs.filter((q) => q.objective_id && !q.media?.length).slice(0, 2)];
        assert(picked.length >= 2, "För få frågor i banken för testet");
        const { notes, media } = await buildDeck(store, picked.map((q) => ({ question: q, category: "Fel" })));
        const SQL = await loadSql();
        const bytes = await buildApkg(SQL, notes, media);
        const info = inspectApkg(SQL, readZip(bytes));
        assert(info.notes === picked.length && info.cards === picked.length, `Paketet har ${info.notes} noter/${info.cards} kort`);
        assert(info.fieldCount === 5, `Korten har ${info.fieldCount} fält i stället för 5`);
        assert(info.mediaCount === media.size, "Bilderna följde inte med");
        const tsv = buildTsv(notes).trim().split("\n").filter((l) => !l.startsWith("#"));
        assert(tsv.length === picked.length && tsv.every((l) => l.split("\t").length === 5), "TSV-raderna är felformaterade");
        assert(/Rätt svar:/.test(notes[0].fields[1]) && /ybgdon7\.github\.io\/bibliotek/.test(notes[0].fields[3]), "Kortens baksida saknar rätt svar eller bibliotekslänk");
        return `${info.cards} kort, ${info.mediaCount} bild, kortlek "${info.decks[0]}", ${(bytes.length / 1024).toFixed(0)} kB · TSV ${tsv.length} rader`;
      },
    },
    {
      name: "Lokal databas (IndexedDB)",
      run: async () => {
        const db = await Idb.open("bv5-diagnostik");
        try {
          const id = `diag-${Date.now()}`;
          await db.put("meta", { key: id, value: { ok: true, t: Date.now() } });
          const back = await db.get("meta", id);
          assert(back?.value?.ok === true, "Kunde inte läsa tillbaka det som skrevs");
          await db.delete("meta", id);
          assert(!(await db.get("meta", id)), "Kunde inte radera testposten");
        } finally {
          db.close();
          indexedDB.deleteDatabase("bv5-diagnostik");
        }
        const n = await store.idb.count("questions");
        let quota = "";
        if (navigator.storage?.estimate) {
          const e = await navigator.storage.estimate();
          quota = ` · ${(e.usage / 1048576).toFixed(1)} MB använt av ${(e.quota / 1073741824).toFixed(1)} GB`;
        }
        return `Skriv, läs och radera fungerar · ${n} frågor lagrade${quota}`;
      },
    },
    {
      name: "Molndatabasen (Supabase)",
      run: async () => {
        if (!ctx.cloud.enabled) return { skip: true, detail: "Lokalt läge – Supabase är inte konfigurerat i config.js" };
        const anon = await ctx.cloud.raw("/rest/v1/applications?select=id&limit=1", { auth: false }).catch((e) => e);
        assert(Array.isArray(anon) ? anon.length === 0 : anon.status >= 400, "Ansökningar är läsbara utan inloggning – kontrollera RLS!");
        const s = await ctx.cloud.select("app_settings", "select=key");
        assert(Array.isArray(s), "Kunde inte läsa inställningar");
        const access = await ctx.cloud.rpc("has_access");
        assert(access === true, "Ditt konto saknar åtkomst enligt databasen");
        const q = await ctx.cloud.select("questions", "select=id&limit=1");
        return `Anslutning OK · RLS spärrar oinloggade · åtkomst bekräftad · ${q.length ? "frågebanken finns i molnet" : "frågebanken är inte publicerad ännu"}`;
      },
    },
    {
      name: "Offline och installation (PWA)",
      run: async () => {
        const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : null;
        const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
        assert(document.querySelector('link[rel="manifest"]'), "Manifestet saknas");
        if (!reg) return { skip: true, detail: "Service workern är inte registrerad (kräver https eller localhost)" };
        const keys = await caches.keys();
        return `Service worker aktiv · ${keys.length} cache${keys.length === 1 ? "" : "r"} · ${standalone ? "körs som installerad app" : "körs i webbläsaren"}`;
      },
    },
  ];
}

export async function runDiagnostics(ctx, onStep) {
  const results = [];
  for (const t of diagnosticsTests(ctx)) {
    const t0 = performance.now();
    let r;
    try {
      const out = await t.run();
      if (out && typeof out === "object" && out.skip) r = { name: t.name, status: "skip", detail: out.detail };
      else r = { name: t.name, status: "ok", detail: out };
    } catch (err) {
      r = { name: t.name, status: "fail", detail: err.message || String(err) };
    }
    r.ms = Math.round(performance.now() - t0);
    results.push(r);
    onStep?.(r, results);
  }
  return results;
}
