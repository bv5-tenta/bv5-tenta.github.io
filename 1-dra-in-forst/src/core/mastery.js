/*
 * "Öva på dina fel": samma regler som databastriggern apply_response_to_progress().
 * - Fel, 🟨 eller 🟥 → frågan hamnar i svaghetsbanken med status "weak" och sviten nollställs.
 * - Rätt utan flagga ökar sviten. När sviten når målet (standard 3) blir frågan "mastered".
 * - En fråga som aldrig varit svag blir aldrig "mastered" – den har inget att bemästra.
 * - Obesvarad utan flagga påverkar inte statusen (ger 0 poäng i tentan, men är inget "fel").
 */

export const DEFAULT_STREAK = 3;

export function emptyProgress(questionId) {
  return {
    question_id: questionId,
    times_seen: 0,
    times_wrong: 0,
    times_unsure: 0,
    times_cannot: 0,
    correct_streak: 0,
    state: "new",
    in_weak_bank: false,
    last_outcome: null,
    last_seen_at: null,
    mastered_at: null,
  };
}

/** Inget svar och ingen flagga: frågan hoppades över och säger inget om kunskapen. */
export function hasChoice(response) {
  const choice = Array.isArray(response?.selected) && response.selected.length > 0;
  return choice || Boolean(String(response?.free_text || "").trim());
}

export function isBlank(response) {
  return !hasChoice(response) && !response?.flag_unsure && !response?.flag_cannot;
}

export function outcomeOf(response, graded) {
  if (response?.flag_cannot) return "cannot";
  if (response?.flag_unsure) return "unsure";
  return graded.is_correct ? "correct" : "wrong";
}

/** Returnerar ny progress (muterar inte). graded = resultat från gradeResponse. */
export function applyOutcome(progress, response, graded, streakGoal = DEFAULT_STREAK, now = new Date().toISOString()) {
  const p = { ...(progress || emptyProgress(response.question_id)) };
  if (!graded.scored || graded.is_correct === null) return p;     // struken eller ej bedömd
  if (isBlank(response)) return p;                                 // obesvarad utan flagga = ingen information

  const outcome = outcomeOf(response, graded);
  const clean = graded.is_correct && !response.flag_unsure && !response.flag_cannot;

  p.times_seen += 1;
  if (!graded.is_correct && hasChoice(response)) p.times_wrong += 1;   // 🟥 utan svar är "kan ej", inte "fel"
  if (response.flag_unsure) p.times_unsure += 1;
  if (response.flag_cannot) p.times_cannot += 1;

  if (!clean) {
    p.correct_streak = 0;
    p.in_weak_bank = true;
    p.state = "weak";
    p.mastered_at = null;
  } else {
    p.correct_streak += 1;
    if (p.in_weak_bank && p.correct_streak >= streakGoal) {
      p.state = "mastered";
      p.mastered_at = p.mastered_at || now;
    } else if (p.in_weak_bank) {
      p.state = "learning";
    }
  }
  p.last_outcome = outcome;
  p.last_seen_at = now;
  return p;
}

export const STATE_LABELS = {
  new: "Ny",
  weak: "Svag",
  learning: "Under inlärning",
  mastered: "Bemästrad",
};
