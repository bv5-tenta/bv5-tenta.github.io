/* Rättningsmotor. Ren logik – samma regler i klient, tester och diagnostik. */

export const DEFAULT_PASS_RATIO = 0.6;

export function isScored(q) {
  return q.status !== "struken";
}

export function maxPoints(q) {
  if (!isScored(q)) return 0;
  if (q.type === "freetext" && Array.isArray(q.rubric) && q.rubric.length) {
    return q.rubric.reduce((n, r) => n + Number(r.points || 0), 0);
  }
  return Number(q.points ?? 1);
}

export function correctOrdinals(q) {
  return (q.options || []).filter((o) => o.is_correct).map((o) => o.ordinal);
}

export function hasAnswer(q, r) {
  if (!r) return false;
  if (q.type === "freetext") return String(r.free_text || "").trim().length > 0;
  return Array.isArray(r.selected) && r.selected.length > 0;
}

/**
 * Rättar ett svar.
 * - Envalsfråga: rätt om valt alternativ är markerat rätt.
 * - Flervalsfråga: rätt endast om exakt de rätta alternativen är valda.
 * - Fritext: poäng = summan av självbedömda (eller godkända AI-) kriteriepoäng; null tills bedömd.
 * - Struken fråga: räknas inte (scored = false).
 */
export function gradeResponse(q, r) {
  const max = maxPoints(q);
  if (!isScored(q)) return { scored: false, is_correct: null, points: 0, max: 0, pending: false };

  if (q.type === "freetext") {
    const grade = r?.self_grade;
    if (!grade || typeof grade !== "object") {
      return { scored: true, is_correct: hasAnswer(q, r) ? null : false, points: 0, max, pending: hasAnswer(q, r) };
    }
    const points = Math.min(
      max,
      Object.values(grade).reduce((n, v) => n + (Number.isFinite(Number(v)) ? Number(v) : 0), 0)
    );
    return { scored: true, is_correct: points >= max && max > 0, points, max, pending: false };
  }

  const right = correctOrdinals(q);
  const chosen = Array.isArray(r?.selected) ? [...new Set(r.selected)] : [];
  if (!chosen.length || !right.length) return { scored: true, is_correct: false, points: 0, max, pending: false };
  const ok = chosen.length === right.length && chosen.every((c) => right.includes(c));
  return { scored: true, is_correct: ok, points: ok ? max : 0, max, pending: false };
}

/** Klassificering för metakognitiv analys. */
export function metaCategory(q, r, graded) {
  if (!graded.scored) return "struken";
  if (r?.flag_cannot) return "kanEj";
  if (!hasAnswer(q, r)) return "obesvarad";
  if (graded.pending) return "vantar";
  if (graded.is_correct) return r?.flag_unsure ? "gissatRatt" : "sakerRatt";
  return r?.flag_unsure ? "osakerFel" : "sakerFel";
}

export const META_LABELS = {
  sakerRatt: "Säker och rätt",
  gissatRatt: "Osäker men rätt",
  osakerFel: "Osäker och fel",
  sakerFel: "Säker men fel",
  kanEj: "Kan ej",
  obesvarad: "Obesvarad",
  vantar: "Väntar på bedömning",
  struken: "Struken",
};

/**
 * Sammanställer ett försök.
 * @param {Array} questions  frågor i försökets ordning
 * @param {Map|Object} responses  question_id → response
 * @param {{pass_points?: number, pass_ratio?: number}} opts
 */
export function gradeAttempt(questions, responses, opts = {}) {
  const get = (id) => (responses instanceof Map ? responses.get(id) : responses[id]);
  const items = [];
  let score = 0;
  let max = 0;
  let pending = 0;
  let totalMs = 0;
  const byModule = new Map();
  const meta = Object.fromEntries(Object.keys(META_LABELS).map((k) => [k, 0]));

  for (const q of questions) {
    const r = get(q.id) || null;
    const g = gradeResponse(q, r);
    const cat = metaCategory(q, r, g);
    meta[cat]++;
    totalMs += Number(r?.time_ms || 0);
    if (g.scored) {
      score += g.points;
      max += g.max;
      if (g.pending) pending++;
      const key = q.modul ?? 0;
      const m = byModule.get(key) || { modul: key, score: 0, max: 0, count: 0, correct: 0, wrong: 0, unsure: 0, cannot: 0, time_ms: 0 };
      m.score += g.points;
      m.max += g.max;
      m.count++;
      if (g.is_correct) m.correct++;
      else if (!g.pending) m.wrong++;
      if (r?.flag_unsure) m.unsure++;
      if (r?.flag_cannot) m.cannot++;
      m.time_ms += Number(r?.time_ms || 0);
      byModule.set(key, m);
    }
    items.push({ question: q, response: r, grade: g, category: cat });
  }

  const passPoints = Number.isFinite(opts.pass_points) && opts.pass_points !== null
    ? Number(opts.pass_points)
    : Math.ceil(max * (opts.pass_ratio ?? DEFAULT_PASS_RATIO));
  const scoredCount = items.filter((i) => i.grade.scored).length;

  return {
    items,
    score,
    max,
    percent: max > 0 ? Math.round((score / max) * 1000) / 10 : 0,
    pass_points: passPoints,
    passed: pending === 0 ? score >= passPoints : null,
    pending,
    total_ms: totalMs,
    avg_ms: scoredCount ? Math.round(totalMs / scoredCount) : 0,
    meta,
    by_module: [...byModule.values()].sort((a, b) => a.modul - b.modul),
    wrong: items.filter((i) => i.grade.scored && i.grade.is_correct === false && !i.response?.flag_cannot),
    unsure: items.filter((i) => i.response?.flag_unsure),
    cannot: items.filter((i) => i.response?.flag_cannot),
  };
}
