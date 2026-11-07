/* Kursbiblioteket: uppslag, djuplänkar, förklaringar och automatisk taggning av frågor. */

import { tokenize, trigrams, jaccard, normalizeForHash } from "./text.js";

export const LIBRARY_BASE = "https://ybgdon7.github.io/bibliotek/";

export function objectiveUrl(base, modul, sub, id) {
  return `${base}#/kurs/bv5/modul/${modul}/sub/${sub}/mal/${encodeURIComponent(id)}`;
}
export function moduleUrl(base, modul) {
  return `${base}#/kurs/bv5/modul/${modul}`;
}

/* ---------- BM25 ---------- */
class Bm25 {
  constructor(k1 = 1.4, b = 0.72) {
    this.k1 = k1;
    this.b = b;
    this.docs = [];
    this.df = new Map();
    this.avgLen = 0;
  }
  add(tokens, payload) {
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    for (const t of tf.keys()) this.df.set(t, (this.df.get(t) || 0) + 1);
    this.docs.push({ tf, len: tokens.length, payload });
  }
  finish() {
    this.avgLen = this.docs.reduce((n, d) => n + d.len, 0) / Math.max(1, this.docs.length);
    const N = this.docs.length;
    this.idf = new Map();
    for (const [t, df] of this.df) this.idf.set(t, Math.log(1 + (N - df + 0.5) / (df + 0.5)));
  }
  search(tokens, limit = 5) {
    const q = [...new Set(tokens)];
    const scored = [];
    for (const d of this.docs) {
      let s = 0;
      for (const t of q) {
        const f = d.tf.get(t);
        if (!f) continue;
        const idf = this.idf.get(t) || 0;
        s += idf * ((f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + (this.b * d.len) / this.avgLen)));
      }
      if (s > 0) scored.push({ score: s, payload: d.payload });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }
}

function repeat(text, n) {
  const toks = tokenize(text);
  const out = [];
  for (let i = 0; i < n; i++) out.push(...toks);
  return out;
}

export class Library {
  constructor(index) {
    this.index = index;
    this.base = index.base_url || LIBRARY_BASE;
    this.objectives = new Map();
    this.themes = new Map();
    this.modules = new Map();
    for (const m of index.modules || []) {
      this.modules.set(m.nr, { nr: m.nr, titel: m.titel, url: m.url || moduleUrl(this.base, m.nr) });
      for (const s of m.submoduler || []) {
        for (const o of s.mal || []) {
          this.objectives.set(o.id, { ...o, modul: m.nr, sub: s.nr, sub_titel: s.titel, modul_titel: m.titel });
        }
      }
    }
    for (const tm of index.ta_modules || []) {
      if (!this.modules.has(tm.nr)) this.modules.set(tm.nr, { nr: tm.nr, titel: tm.namn, url: tm.url || moduleUrl(this.base, tm.nr) });
    }
    for (const t of index.themes || []) this.themes.set(t.id, t);
    this._bm25 = null;
  }

  objective(id) {
    return id ? this.objectives.get(id) || null : null;
  }
  theme(id) {
    return id ? this.themes.get(id) || null : null;
  }
  module(nr) {
    return nr != null ? this.modules.get(Number(nr)) || null : null;
  }
  moduleName(nr) {
    const m = this.module(nr);
    return m ? `Modul ${m.nr} · ${m.titel}` : "Okänd modul";
  }

  /** Bästa länk för en fråga: lärandemål > modul > bibliotekets startsida. */
  linkFor(q) {
    const o = this.objective(q.objective_id);
    if (o) return { url: o.url || objectiveUrl(this.base, o.modul, o.sub, o.id), label: `${o.id} ${o.titel}`, level: "objective", objective: o };
    const m = this.module(q.modul);
    if (m) return { url: m.url, label: `Modul ${m.nr} · ${m.titel}`, level: "module", objective: null };
    return { url: this.base, label: "Lärandemålsbiblioteket", level: "library", objective: null };
  }

  /** Förklaring: frågans egen, annars det stycke i lärandemålet som bäst matchar frågan. */
  explanationFor(q) {
    if (q.explanation && q.explanation.trim()) return { text: q.explanation.trim(), source: "fraga" };
    const o = this.objective(q.objective_id);
    const t = this.theme(q.theme_id);
    const pool = [];
    if (o) pool.push(...String(o.sammanfattning || "").split(/\n+/));
    if (t) pool.push(t.beskrivning || "");
    const qTokens = new Set(tokenize(`${q.stem} ${(q.options || []).filter((x) => x.is_correct).map((x) => x.text).join(" ")}`));
    let best = "";
    let bestScore = 0;
    for (const para of pool) {
      if (para.length < 40) continue;
      const toks = tokenize(para);
      const hits = toks.filter((x) => qTokens.has(x)).length;
      const score = hits / Math.sqrt(toks.length + 4);
      if (score > bestScore) {
        bestScore = score;
        best = para;
      }
    }
    if (best) return { text: best.length > 700 ? `${best.slice(0, 700)}…` : best, source: "bibliotek" };
    return { text: "", source: "saknas" };
  }

  _buildBm25() {
    const bm = new Bm25();
    for (const o of this.objectives.values()) {
      bm.add([...repeat(o.titel, 3), ...repeat((o.delmal || []).join(" "), 2), ...tokenize(o.sammanfattning || "")], {
        kind: "objective", objective_id: o.id, modul: o.modul, theme_id: null,
      });
    }
    for (const t of this.themes.values()) {
      bm.add([...repeat(t.tema, 3), ...repeat(t.objective_titel || "", 1), ...tokenize(t.beskrivning || "")], {
        kind: "theme", objective_id: t.objective_id, modul: t.modul, theme_id: t.id,
      });
    }
    bm.finish();
    this._bm25 = bm;
  }

  /** Textsökning mot lärandemål och teman. Returnerar förslag med konfidens 0.2–0.85. */
  suggest(stem, options = [], limit = 3) {
    if (!this._bm25) this._buildBm25();
    const tokens = tokenize(`${stem} ${stem} ${options.join(" ")}`);
    const hits = this._bm25.search(tokens, 12);
    const seen = new Set();
    const out = [];
    for (const h of hits) {
      const key = h.payload.objective_id || `m${h.payload.modul}:${h.payload.theme_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...h.payload, score: h.score });
      if (out.length >= limit) break;
    }
    if (!out.length) return [];
    const top = out[0].score;
    const second = out[1]?.score || 0;
    const ratio = top / (top + second + 1e-9);
    const base = top < 4 ? 0.2 : Math.min(0.85, 0.35 + (ratio - 0.5));
    return out.map((s, i) => ({ ...s, confidence: Math.max(0.05, Math.round((i === 0 ? base : base * (s.score / top) * 0.8) * 100) / 100) }));
  }
}

/* ---------- Frågebanksindex för dubbletter och nästan-dubbletter ---------- */
export class BankIndex {
  constructor(questions) {
    this.byHash = new Map();
    this.items = [];
    for (const q of questions) {
      if (q.content_hash) {
        if (!this.byHash.has(q.content_hash)) this.byHash.set(q.content_hash, []);
        this.byHash.get(q.content_hash).push(q);
      }
      this.items.push({ q, grams: null });
    }
  }
  exact(hash) {
    return this.byHash.get(hash) || [];
  }
  similar(stem, options = [], minScore = 0.6) {
    const text = `${stem} ${options.join(" ")}`;
    const grams = trigrams(text);
    const norm = normalizeForHash(stem);
    let best = null;
    for (const it of this.items) {
      if (!it.grams) it.grams = trigrams(`${it.q.stem} ${(it.q.options || []).map((o) => o.text).join(" ")}`);
      const s = jaccard(grams, it.grams);
      if (s >= minScore && (!best || s > best.score)) best = { q: it.q, score: s };
    }
    if (best && normalizeForHash(best.q.stem) === norm) best.score = Math.max(best.score, 0.97);
    return best;
  }
}

/**
 * Taggar en (ny) fråga i fyra steg: exakt dubblett → nästan-dubblett → textsökning → manuell.
 * Returnerar fält som kan läggas direkt på frågan + förslag för verifieringsvyn.
 */
export async function tagQuestion({ stem, options, hash }, library, bank) {
  const optionTexts = options.map((o) => (typeof o === "string" ? o : o.text));
  if (bank && hash) {
    const exact = bank.exact(hash).find((q) => q.objective_id || q.modul);
    if (exact) {
      return {
        modul: exact.modul, objective_id: exact.objective_id, theme_id: exact.theme_id,
        tag_source: "auto", tag_confidence: 1, explanation: exact.explanation || "", key_points: exact.key_points || [],
        match: { kind: "exact", question_id: exact.id, label: `${exact.exam_code || ""} #${exact.number}`.trim(), score: 1 },
        suggestions: [],
      };
    }
  }
  if (bank) {
    const sim = bank.similar(stem, optionTexts, 0.6);
    if (sim && sim.score >= 0.6 && (sim.q.objective_id || sim.q.modul)) {
      const conf = Math.round(Math.min(0.99, 0.85 + (sim.score - 0.6) * 0.35) * 100) / 100;
      return {
        modul: sim.q.modul, objective_id: sim.q.objective_id, theme_id: sim.q.theme_id,
        tag_source: "auto", tag_confidence: conf, explanation: sim.q.explanation || "", key_points: sim.q.key_points || [],
        match: { kind: "similar", question_id: sim.q.id, label: `${sim.q.exam_code || ""} #${sim.q.number}`.trim(), score: sim.score },
        suggestions: [],
      };
    }
  }
  const suggestions = library ? library.suggest(stem, optionTexts, 3) : [];
  const top = suggestions[0];
  if (top && top.confidence >= 0.35) {
    return {
      modul: top.modul, objective_id: top.objective_id, theme_id: top.theme_id,
      tag_source: "auto", tag_confidence: top.confidence, explanation: "", key_points: [],
      match: null, suggestions,
    };
  }
  return {
    modul: top?.modul ?? null, objective_id: null, theme_id: null,
    tag_source: "auto", tag_confidence: top ? top.confidence : 0, explanation: "", key_points: [],
    match: null, suggestions,
  };
}
