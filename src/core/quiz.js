/* Dynamisk quizgenerator för "Öva på dina fel" och egna quiz ur frågebanken. */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(list, rand = Math.random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function weakness(p) {
  return p.times_wrong * 2 + p.times_cannot * 3 + p.times_unsure - p.correct_streak * 1.5;
}

export function inCategory(p, category) {
  if (category === "wrong") return p.times_wrong > 0;
  if (category === "unsure") return p.times_unsure > 0;
  if (category === "cannot") return p.times_cannot > 0;
  return false;
}

/**
 * Filtrerar svaghetsbanken.
 * @param {Array} progressList   question_progress-poster
 * @param {Map} questions        question_id → fråga
 * @param {Object} f             {categories, modules, objectives, states}
 */
export function filterWeakBank(progressList, questions, f = {}) {
  const cats = f.categories?.length ? f.categories : ["wrong", "unsure", "cannot"];
  const states = f.states?.length ? f.states : ["weak", "learning"];
  const mods = new Set((f.modules || []).map(Number));
  const objs = new Set(f.objectives || []);
  return progressList.filter((p) => {
    if (!p.in_weak_bank) return false;
    if (!states.includes(p.state)) return false;
    const q = questions.get(p.question_id);
    if (!q || q.status === "struken") return false;
    if (!cats.some((c) => inCategory(p, c))) return false;
    if (mods.size && !mods.has(Number(q.modul ?? 0))) return false;
    if (objs.size && !objs.has(q.objective_id)) return false;
    return true;
  });
}

export function orderProgress(list, order = "weakest", rand = Math.random) {
  if (order === "random") return shuffle(list, rand);
  if (order === "oldest") {
    return [...list].sort((a, b) => String(a.last_seen_at || "").localeCompare(String(b.last_seen_at || "")));
  }
  return [...list].sort((a, b) => weakness(b) - weakness(a) || String(a.last_seen_at || "").localeCompare(String(b.last_seen_at || "")));
}

export function buildWeakQuiz(progressList, questions, f = {}, rand = Math.random) {
  const filtered = filterWeakBank(progressList, questions, f);
  const ordered = orderProgress(filtered, f.order || "weakest", rand);
  const count = Math.max(1, Math.min(Number(f.count) || 20, ordered.length));
  return ordered.slice(0, count).map((p) => p.question_id);
}

/** Egen quiz ur hela banken: valda moduler/tentor, valfritt antal, blandad ordning. */
export function buildBankQuiz(allQuestions, f = {}, rand = Math.random) {
  const mods = new Set((f.modules || []).map(Number));
  const exams = new Set(f.exams || []);
  const pool = allQuestions.filter(
    (q) => q.status !== "struken" && (q.options?.length || q.type === "freetext") &&
      (!mods.size || mods.has(Number(q.modul ?? 0))) && (!exams.size || exams.has(q.exam_id))
  );
  const count = Math.max(1, Math.min(Number(f.count) || 20, pool.length));
  return shuffle(pool, rand).slice(0, count).map((q) => q.id);
}
