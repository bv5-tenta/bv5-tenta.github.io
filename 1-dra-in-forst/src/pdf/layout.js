/*
 * Tolkning av Inspera-utskrifter ("med svar") från sidlayout.
 * Ingen PDF-kod här: indata är, per sida, textrader med position samt radioknappar,
 * gröna bockar och bilder som hittats i den renderade sidan. Allt i punkter, origo uppe till vänster.
 *
 *   page = { index, width, height, lines:[{text, x0, x1, y0, y1, size, bold}],
 *            radios:[{x0,x1,y0,y1}], checks:[{x0,x1,y0,y1}], images:[{x0,x1,y0,y1}] }
 */

const SUP = { 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹", "+": "⁺", "-": "⁻", "−": "⁻" };
const SUB = { 0: "₀", 1: "₁", 2: "₂", 3: "₃", 4: "₄", 5: "₅", 6: "₆", 7: "₇", 8: "₈", 9: "₉", "+": "₊", "-": "₋", "−": "₋" };

export function toSuper(s) {
  return [...s].every((c) => SUP[c]) ? [...s].map((c) => SUP[c]).join("") : s;
}
export function toSub(s) {
  return [...s].every((c) => SUB[c]) ? [...s].map((c) => SUB[c]).join("") : s;
}

/**
 * Bygger rader av textfragment {str, x0, x1, y (baslinje), size, bold}.
 * Små fragment ovanför/under baslinjen blir upphöjt/nedsänkt (Ca²⁺, pCO₂).
 */
export function buildLines(items) {
  const clean = items.filter((it) => it.str && it.str.trim() !== "");
  if (!clean.length) return [];
  const sizes = clean.map((i) => i.size).sort((a, b) => a - b);
  const bodySize = sizes[Math.floor(sizes.length / 2)] || 10;
  const main = [];
  const small = [];
  for (const it of clean) (it.size < bodySize * 0.8 && it.str.trim().length <= 4 ? small : main).push(it);

  main.sort((a, b) => a.y - b.y || a.x0 - b.x0);
  const rows = [];
  for (const it of main) {
    const row = rows.find((r) => Math.abs(r.y - it.y) <= Math.max(2, it.size * 0.3));
    if (row) row.items.push(it);
    else rows.push({ y: it.y, size: it.size, items: [it] });
  }
  for (const it of small) {
    let best = null;
    for (const r of rows) {
      const dy = it.y - r.y;
      if (Math.abs(dy) > r.size * 0.75) continue;
      const before = r.items.some((m) => m.x0 < it.x0 && it.x0 - m.x1 < r.size);
      if (!before) continue;
      if (!best || Math.abs(dy) < Math.abs(best.dy)) best = { r, dy };
    }
    if (best) best.r.items.push({ ...it, script: best.dy < -0.5 ? "sup" : best.dy > 0.5 ? "sub" : null });
    else rows.push({ y: it.y, size: it.size, items: [it] });
  }

  const lines = rows.map((r) => {
    // Ett upphöjt/nedsänkt fragment som hamnar mitt i ett längre fragment (t.ex. "Lägre O -innehåll"
    // där tvåan ligger i mellanrummet) delar upp det längre fragmentet vid närmaste mellanslag.
    const scripts = r.items.filter((i) => i.script);
    for (const sc of scripts) {
      const host = r.items.find((m) => !m.script && m.x0 + 0.5 < sc.x0 && sc.x0 < m.x1 - 0.5 && m.str.length > 1);
      if (!host) continue;
      const frac = (sc.x0 - host.x0) / Math.max(1, host.x1 - host.x0);
      let cut = Math.round(frac * host.str.length);
      let best = -1;
      for (let d = 0; d <= 3; d++) {
        if (host.str[cut - d] === " ") { best = cut - d; break; }
        if (host.str[cut + d] === " ") { best = cut + d; break; }
      }
      const at = best >= 0 ? best : Math.max(1, Math.min(host.str.length - 1, cut));
      const left = host.str.slice(0, at);
      const right = host.str.slice(best >= 0 ? at + 1 : at);
      const idx = r.items.indexOf(host);
      r.items.splice(idx, 1,
        { ...host, str: left, x1: sc.x0, glue: true },
        { ...host, str: right, x0: sc.x1 ?? sc.x0 + 1, glueLeft: true });
    }
    r.items.sort((a, b) => a.x0 - b.x0);
    let text = "";
    let prev = null;
    for (const it of r.items) {
      let s = it.str;
      if (it.script === "sup") s = toSuper(s.trim());
      else if (it.script === "sub") s = toSub(s.trim());
      if (prev) {
        const gap = it.x0 - prev.x1;
        const glued = it.script || prev.glue || it.glueLeft;
        const needSpace = !glued && gap > r.size * 0.18 && !text.endsWith(" ") && !s.startsWith(" ");
        if (needSpace) text += " ";
      }
      text += s;
      prev = it;
    }
    const x0 = Math.min(...r.items.map((i) => i.x0));
    const x1 = Math.max(...r.items.map((i) => i.x1));
    return {
      text: text.replace(/\s+/g, " ").trim(),
      x0, x1,
      y0: r.y - r.size * 0.85,
      y1: r.y + r.size * 0.25,
      y: r.y,
      size: r.size,
      bold: r.items.some((i) => i.bold),
      items: r.items,
    };
  });
  lines.sort((a, b) => a.y - b.y || a.x0 - b.x0);
  return lines;
}

const RE_TOTAL = /^Totalpo(ä|a)ng:\s*([\d.,]+)/i;
const RE_CHOOSE = /^V(ä|a)lj\s+(ett|ett eller flera|flera)\s+alternativ:?$/i;
const RE_MODULE = /^Modul\s+\d+\b/i;

/* Sidhuvud/sidfot = text som återkommer i samma zon på många sidor (siffror bortsedda), eller sidnummer. */
function headerKey(text) {
  return text.replace(/\d+/g, "#").replace(/\s+/g, " ").trim().toLowerCase();
}

export function findRepeatedMargins(pages) {
  const counts = new Map();
  for (const p of pages) {
    const seen = new Set();
    for (const l of p.lines) {
      if (l.y1 > p.height * 0.12 && l.y0 < p.height * 0.88) continue;
      const k = headerKey(l.text);
      if (k.length < 3 || seen.has(k)) continue;
      seen.add(k);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
  }
  const min = Math.max(3, Math.ceil(pages.length * 0.3));
  return new Set([...counts].filter(([, n]) => n >= min).map(([k]) => k));
}

function isHeaderFooter(line, page, repeated) {
  if (/^\d+\s*\/\s*\d+$/.test(line.text)) return true;
  if (line.y1 < page.height * 0.025 || line.y0 > page.height * 0.975) return true;
  if (repeated && (line.y1 < page.height * 0.12 || line.y0 > page.height * 0.88) && repeated.has(headerKey(line.text))) return true;
  return false;
}

/** Är dokumentet en Inspera-export? */
export function looksLikeInspera(pages) {
  let totals = 0;
  for (const p of pages) for (const l of p.lines) if (RE_TOTAL.test(l.text)) totals++;
  return totals >= 2;
}

function centerY(b) {
  return (b.y0 + b.y1) / 2;
}

/**
 * Huvudfunktion: sidor → { questions, sections, warnings }.
 * Varje fråga: { number, stem, points, type, options:[{ordinal,text,is_correct}], section, page, region }
 */
export function parseInspera(pages) {
  const warnings = [];
  const questions = [];
  const sections = [];
  let current = null;
  let expected = 1;
  let section = null;
  let started = false;
  const repeated = findRepeatedMargins(pages);

  const flush = (reason) => {
    if (!current) return;
    questions.push(current);
    current = null;
    if (reason) warnings.push(reason);
  };

  for (const page of pages) {
    // Radioknapp → raden till höger om den, på samma höjd.
    // Ett alternativ på flera rader har knappen centrerad på blocket, så alternativets första rad
    // är den översta raden i blocket – men aldrig en rad ovanför föregående knapp.
    const radioLine = new Map();
    let prevCy = -Infinity;
    for (const r of [...page.radios].sort((a, b) => a.y0 - b.y0)) {
      const cy = centerY(r);
      const cands = page.lines.filter((l) => l.x0 >= r.x1 - 1 && l.x0 - r.x1 <= 30 && !radioLine.has(l) &&
        centerY(l) > prevCy + 2 && centerY(l) - cy <= Math.max(5, l.size * 0.9) && cy - centerY(l) <= Math.max(5, l.size * 2.2));
      prevCy = cy;
      if (!cands.length) continue;
      cands.sort((a, b) => a.y0 - b.y0);
      // Översta raden, men bara om raderna ner till knappen hänger ihop (tätt radavstånd).
      let pick = cands[cands.length - 1];
      for (let i = cands.length - 1; i > 0; i--) {
        if (cands[i].y0 - cands[i - 1].y1 < cands[i].size * 0.6) pick = cands[i - 1];
        else break;
      }
      const nearest = cands.reduce((b, l) => (Math.abs(centerY(l) - cy) < Math.abs(centerY(b) - cy) ? l : b));
      if (Math.abs(centerY(nearest) - cy) <= nearest.size * 0.6 && nearest.y0 < pick.y0) pick = nearest;
      radioLine.set(pick, r);
    }

    for (const line of page.lines) {
      if (isHeaderFooter(line, page, repeated)) continue;
      const text = line.text;

      // Ny fråga: löpnumret först på raden, i vänstermarginalen.
      const m = /^(\d{1,3})(?:\s+(.*))?$/.exec(text);
      const firstItem = line.items?.[0];
      const numberIsOwnItem = firstItem ? /^\d{1,3}$/.test(firstItem.str.trim()) : true;
      if (m && Number(m[1]) === expected && line.x0 < page.width * 0.12 && numberIsOwnItem && !radioLine.has(line)) {
        flush(current && !current.points_found ? `Fråga ${current.number}: hittade inte "Totalpoäng" före fråga ${expected}` : null);
        started = true;
        current = {
          number: expected,
          stemLines: [],
          options: [],
          points: 1,
          points_found: false,
          section,
          page: page.index,
          region: { page: page.index, x0: line.x0, y0: line.y0, x1: page.width - 30, y1: line.y1 },
          pages: new Set([page.index]),
          checks: [],
          images: [],
          bodyX: null,
        };
        expected++;
        const rest = (m[2] || "").trim();
        if (rest) current.stemLines.push({ text: rest, bold: line.bold, line });
        continue;
      }
      if (!started || !current) continue;
      if (!current.points_found) current.pages.add(page.index);

      const tot = RE_TOTAL.exec(text);
      if (tot) {
        current.points = Number(tot[2].replace(",", ".")) || 1;
        current.points_found = true;
        current.region.y1 = Math.max(current.region.y1, line.y1);
        current.endPage = page.index;
        continue;
      }
      if (current.points_found) continue;        // text efter Totalpoäng hör inte till frågan

      if (RE_CHOOSE.test(text)) {
        if (/flera/i.test(text)) current.multiHint = true;
        continue;
      }
      if (radioLine.has(line)) {
        current.options.push({ text, y0: line.y0, y1: line.y1, page: page.index, radio: radioLine.get(line) });
        continue;
      }
      if (current.options.length) {
        const last = current.options[current.options.length - 1];
        // Radbrutet alternativ: samma vänsterkant och tätt under föregående rad.
        if (last.page === page.index && Math.abs(line.x0 - (last.textX ?? line.x0)) < 4 && line.y0 - last.y1 < line.size * 0.9) {
          last.text += ` ${text}`;
          last.y1 = line.y1;
          continue;
        }
        if (!last.textX) last.textX = line.x0;
        current.trailing = (current.trailing || []).concat(text);
        continue;
      }
      if (current.stemLines.length === 0 && RE_MODULE.test(text) && line.bold) {
        section = text;
        current.section = section;
        if (!sections.includes(section)) sections.push(section);
        continue;
      }
      if (RE_MODULE.test(text) && current.stemLines.length && current.stemLines.every((s) => s.bold && RE_MODULE.test(s.text))) {
        current.stemLines[current.stemLines.length - 1].text += ` ${text}`;
        continue;
      }
      if (current.stemLines.length && current.stemLines.every((s) => s.bold) && line.bold && RE_MODULE.test(current.stemLines[0].text)) {
        current.stemLines[current.stemLines.length - 1].text += ` ${text}`;
        continue;
      }
      current.stemLines.push({ text, bold: line.bold, line });
    }

    // Bockar och bilder kopplas efter att sidans rader är fördelade.
    for (const q of questions.concat(current ? [current] : [])) {
      if (!q.pages.has(page.index)) continue;
      const pageOptions = q.options.filter((o) => o.page === page.index);
      for (const c of page.checks) {
        if (!pageOptions.length) continue;
        const cy = centerY(c);
        const opt = pageOptions.reduce((best, o) => {
          const d = Math.abs(centerY(o.radio || o) - cy);
          return !best || d < best.d ? { o, d } : best;
        }, null);
        if (opt && opt.d < 14) q.checks.push(opt.o);
      }
      for (const img of page.images) {
        const stemLines = q.stemLines.filter((s) => s.line && page.lines.includes(s.line));
        const top = stemLines.length ? Math.min(...stemLines.map((s) => s.line.y0)) : q.region.y0;
        const firstOpt = pageOptions[0];
        const bottom = firstOpt ? firstOpt.y0 : page.height;
        const cy = centerY(img);
        if (q.page === page.index ? cy > top - 4 && cy < bottom + 4 : cy < bottom + 4) {
          q.images.push({ ...img, page: page.index, placement: firstOpt && cy > firstOpt.y0 ? "options" : "stem" });
        }
      }
    }
    // Varje bild bara till en fråga: den senast påbörjade som täcker bilden.
  }
  flush(current && !current.points_found ? `Fråga ${current.number}: hittade inte "Totalpoäng"` : null);

  // Ta bort bilder som tilldelats flera frågor (behåll den fråga vars text ligger närmast ovanför).
  const owner = new Map();
  for (const q of questions) {
    for (const img of q.images) {
      const key = `${img.page}:${Math.round(img.x0)}:${Math.round(img.y0)}`;
      const prev = owner.get(key);
      if (!prev || q.number > prev.number) owner.set(key, q);
    }
  }
  for (const q of questions) {
    q.images = q.images.filter((img) => owner.get(`${img.page}:${Math.round(img.x0)}:${Math.round(img.y0)}`) === q);
    delete q.pages;
    finalize(q, warnings);
  }
  return { questions, sections, warnings };
}

function finalize(q, warnings) {
  q.stem = q.stemLines.map((s) => s.text).join(" ").replace(/\s+/g, " ").trim();
  q.stem_lines = q.stemLines.map((s) => s.text);
  q.table_like = q.stemLines.filter((s) => (s.text.match(/\s/g) || []).length >= 4 && s.text.split(" ").every((w) => w.length <= 12)).length >= 3;
  delete q.stemLines;
  const checked = new Set(q.checks);
  q.options = q.options.map((o, i) => ({
    ordinal: i,
    text: o.text.replace(/\s+/g, " ").trim(),
    is_correct: checked.has(o),
    y0: o.y0, y1: o.y1, page: o.page,
  }));
  delete q.checks;
  const nCorrect = q.options.filter((o) => o.is_correct).length;
  q.type = q.options.length === 0 ? "freetext" : nCorrect > 1 || q.multiHint ? "multi" : "single";
  delete q.multiHint;
  if (q.options.length && nCorrect === 0) warnings.push(`Fråga ${q.number}: inget rätt svar markerat (grön bock saknas)`);
  if (q.options.length === 1) warnings.push(`Fråga ${q.number}: bara ett svarsalternativ hittades`);
  if (!q.stem) warnings.push(`Fråga ${q.number}: frågetexten är tom`);
  if (q.trailing?.length) q.trailing_text = q.trailing.join(" ");
  delete q.trailing;
}

/* ---------- Reserv: numrerade frågor med a) b) c) och separat facit ---------- */

const RE_Q = /^(\d{1,3})[.)]\s+(.+)$/;
const RE_OPT = /^([a-fA-F])[.)]\s+(.+)$/;

/** Enkel tolkning för icke-Inspera-dokument. answerKey: Map nummer → bokstäver ("B" eller "AC"). */
export function parseNumbered(pages, answerKey = new Map()) {
  const questions = [];
  const warnings = [];
  let cur = null;
  const repeated = findRepeatedMargins(pages);
  for (const page of pages) {
    for (const line of page.lines) {
      if (isHeaderFooter(line, page, repeated)) continue;
      const q = RE_Q.exec(line.text);
      const o = RE_OPT.exec(line.text);
      if (q && (!cur || Number(q[1]) === cur.number + 1)) {
        if (cur) questions.push(cur);
        cur = { number: Number(q[1]), stem: q[2], options: [], points: 1, page: page.index, images: [], region: { page: page.index, x0: line.x0, y0: line.y0, x1: page.width - 30, y1: line.y1 } };
        continue;
      }
      if (!cur) continue;
      if (o) {
        cur.options.push({ letter: o[1].toUpperCase(), text: o[2] });
        continue;
      }
      const pts = /\((\d+(?:[.,]\d+)?)\s*p\)/i.exec(line.text);
      if (pts) cur.points = Number(pts[1].replace(",", "."));
      if (cur.options.length) cur.options[cur.options.length - 1].text += ` ${line.text}`;
      else cur.stem += ` ${line.text}`;
    }
  }
  if (cur) questions.push(cur);
  for (const q of questions) {
    const key = String(answerKey.get(q.number) || "").toUpperCase();
    q.options = q.options.map((o, i) => ({ ordinal: i, text: o.text.trim(), is_correct: key.includes(o.letter) }));
    const n = q.options.filter((o) => o.is_correct).length;
    q.type = q.options.length ? (n > 1 ? "multi" : "single") : "freetext";
    if (q.options.length && !n) warnings.push(`Fråga ${q.number}: inget facit`);
  }
  return { questions, sections: [], warnings };
}

/** Läser ett facit i textform: rader som "12 B", "12. B", "12: A, C" eller "Fråga 12 – D". */
export function parseAnswerKey(text) {
  const key = new Map();
  for (const raw of String(text).split(/\n/)) {
    const m = /(?:Fr(?:å|a)ga\s*)?(\d{1,3})\s*[.):\-–]?\s*([A-F](?:\s*[,+&och]*\s*[A-F])*)\b/i.exec(raw.trim());
    if (m) key.set(Number(m[1]), m[2].replace(/[^A-F]/gi, "").toUpperCase());
  }
  return key;
}

/** Tentans namn ur filnamn eller sidhuvud: "Ordinarie HT24", "Rest VT25". */
export function guessExamMeta(filename, firstText = "") {
  const src = `${filename} ${firstText}`;
  const kind = /\b(rest|omtenta|omtentamen|omtentan)\b/i.test(src) ? "Rest" : /\bordinarie\b/i.test(src) ? "Ordinarie" : "Övrig";
  const t = /\b(HT|VT)\s?-?(\d{2}|20\d{2})\b/i.exec(src);
  let term = "";
  if (t) term = `${t[1].toUpperCase()}${t[2].slice(-2)}`;
  else {
    const d = /\b(20\d{2})-(\d{2})-\d{2}\b/.exec(src);
    if (d) {
      const month = Number(d[2]);
      const yy = d[1].slice(-2);
      term = month >= 8 ? `HT${yy}` : month === 1 ? `HT${String(Number(yy) - 1).padStart(2, "0")}` : `VT${yy}`;
    }
  }
  return { kind, term, code: term ? `${kind === "Övrig" ? "Tenta" : kind} ${term}` : filename.replace(/\.pdf$/i, "") };
}
