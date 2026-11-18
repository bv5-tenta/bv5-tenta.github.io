/*
 * "Koncept att studera": grupperar dina tidigare svar per lärandemål (koncept) och rangordnar
 * vilka du behöver läsa på, utifrån hur ofta du svarat fel, 🟨 osäker eller 🟥 kan ej.
 *
 * Ett koncept visas så länge minst en av dess frågor fortfarande är svag eller under inlärning.
 * PRIO 1: minst 3 missar och minst 60 % missar (t.ex. 4 fel av 5 svar).
 * PRIO 2: minst 2 missar och minst 40 % missar, eller minst 4 missar totalt.
 * PRIO 3: övriga koncept med missar som du ännu inte bemästrat.
 */

export const PRIO_RULES = {
  1: { minMisses: 3, minRate: 0.6 },
  2: { minMisses: 2, minRate: 0.4, orMisses: 4 },
};

export const PRIO_TEXT = {
  1: "Du har kontinuerligt svarat fel: minst 3 missar och minst 60 % av dina svar på konceptet.",
  2: "Återkommande fel: minst 2 missar och minst 40 % av svaren, eller minst 4 missar totalt.",
  3: "Enstaka missar som du ännu inte har bemästrat.",
};

function missesOf(p, cats) {
  let m = 0;
  if (cats.includes("wrong")) m += p.times_wrong || 0;
  if (cats.includes("unsure")) m += p.times_unsure || 0;
  if (cats.includes("cannot")) m += p.times_cannot || 0;
  return Math.min(p.times_seen || 0, m);     // en fråga kan vara både fel och 🟨 i samma svar
}

export function prioFor(misses, rate) {
  const r1 = PRIO_RULES[1], r2 = PRIO_RULES[2];
  if (misses >= r1.minMisses && rate >= r1.minRate) return 1;
  if ((misses >= r2.minMisses && rate >= r2.minRate) || misses >= r2.orMisses) return 2;
  return 3;
}

/**
 * @param {Array} progressList  alla question_progress-poster
 * @param {Map} questions       question_id → fråga
 * @param {Library} library     lärandemålsbiblioteket (linkFor, moduleName)
 * @param {Object} f            {categories, modules}
 * @returns {Array} koncept sorterade efter prio, antal missar och andel
 */
export function rankConcepts(progressList, questions, library, f = {}) {
  const cats = f.categories?.length ? f.categories : ["wrong", "unsure", "cannot"];
  const mods = new Set((f.modules || []).map(Number));
  const groups = new Map();
  for (const p of progressList) {
    if (!p.times_seen) continue;
    const q = questions.get(p.question_id);
    if (!q || q.status === "struken") continue;
    if (mods.size && !mods.has(Number(q.modul ?? 0))) continue;
    const link = library.linkFor(q);
    const key = q.objective_id ? `mal:${q.objective_id}` : `modul:${q.modul ?? 0}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        key, objective_id: q.objective_id || null, label: q.objective_id ? link.label : `Övrigt i ${library.moduleName(q.modul)}`,
        url: link.url, modul: Number(q.modul ?? 0), seen: 0, misses: 0, answered: 0, missedQuestions: 0, open: [], mastered: 0, items: [],
      };
      groups.set(key, g);
    }
    const m = missesOf(p, cats);
    g.seen += p.times_seen;
    g.misses += m;
    g.answered += 1;
    if (m > 0) {
      g.missedQuestions += 1;
      g.items.push({ question: q, progress: p, misses: m });
    }
    if (m > 0 && p.in_weak_bank && (p.state === "weak" || p.state === "learning")) g.open.push(p);
    if (p.state === "mastered") g.mastered += 1;
  }
  const out = [];
  for (const g of groups.values()) {
    if (!g.open.length || !g.misses) continue;          // allt bemästrat → inget kvar att studera
    g.rate = g.seen ? g.misses / g.seen : 0;
    g.prio = prioFor(g.misses, g.rate);
    g.items.sort((a, b) => b.misses - a.misses || String(b.progress.last_seen_at || "").localeCompare(String(a.progress.last_seen_at || "")));
    out.push(g);
  }
  return out.sort((a, b) => a.prio - b.prio || b.misses - a.misses || b.rate - a.rate || a.label.localeCompare(b.label, "sv"));
}
