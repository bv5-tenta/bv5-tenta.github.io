/* Studieprogression i biblioteket, sparad lokalt i webbläsaren (localStorage).
   Två skilda saker hålls isär:
   - Genomgånget: vad studenten själv har bockat av som läst (mål och delmål).
   - Visad förståelse: vad quizutfallen visar – rätt, fel och rätt-men-gissat per fråga.
   Dessutom sparas senaste besökta ställe så att startsidan kan erbjuda "Fortsätt där du slutade". */

const KEY = "bv5.studie.v1";
const OLD_GOALS = "bv5.lib.goals";

function load() {
  let s;
  try {
    s = JSON.parse(localStorage.getItem(KEY) || "null");
  } catch {
    s = null;
  }
  if (!s || typeof s !== "object") s = { read: {}, goals: {}, answers: {}, last: null };
  s.read ||= {};
  s.goals ||= {};
  s.answers ||= {};
  try {
    const old = JSON.parse(localStorage.getItem(OLD_GOALS) || "null");
    if (old && typeof old === "object") {
      Object.assign(s.goals, old);
      localStorage.removeItem(OLD_GOALS);
    }
  } catch {
    /* gammalt format ignoreras */
  }
  return s;
}

let state = load();
const listeners = new Set();

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* privat läge eller fullt lagringsutrymme: progressionen gäller bara den här sessionen */
  }
  listeners.forEach((fn) => {
    try {
      fn(state);
    } catch {
      /* lyssnarfel får inte stoppa sparandet */
    }
  });
}

export const progress = {
  reload() {
    state = load();
  },
  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  /* ---- genomgånget ---- */
  isRead(id) {
    return Boolean(state.read[id]);
  },
  setRead(id, on = true) {
    if (on) state.read[id] = Date.now();
    else delete state.read[id];
    save();
  },
  goalDone(key) {
    return Boolean(state.goals[key]);
  },
  setGoal(key, on) {
    if (on) state.goals[key] = 1;
    else delete state.goals[key];
    save();
  },

  /* ---- visad förståelse ---- */
  record(questionId, { objective, correct, guessed }) {
    const prev = state.answers[questionId];
    state.answers[questionId] = {
      o: objective || prev?.o || null,
      c: Boolean(correct),
      g: Boolean(guessed),
      n: (prev?.n || 0) + 1,
      t: Date.now(),
    };
    save();
  },
  answer(questionId) {
    return state.answers[questionId] || null;
  },
  /** Sammanfattning för ett mål: antal besvarade, säkert rätt, gissat rätt, fel. */
  objectiveStats(objectiveId) {
    let answered = 0, sure = 0, guessed = 0, wrong = 0, lastT = 0;
    for (const a of Object.values(state.answers)) {
      if (a.o !== objectiveId) continue;
      answered++;
      if (a.c && !a.g) sure++;
      else if (a.c) guessed++;
      else wrong++;
      lastT = Math.max(lastT, a.t);
    }
    return { answered, sure, guessed, wrong, lastT };
  },
  /** Mål som behöver repeteras: fel eller gissat på senaste försöket. */
  toRepeat() {
    const by = new Map();
    for (const [qid, a] of Object.entries(state.answers)) {
      if (!a.o || (a.c && !a.g)) continue;
      if (!by.has(a.o)) by.set(a.o, { id: a.o, wrong: 0, guessed: 0, t: 0, questions: [] });
      const r = by.get(a.o);
      if (a.c) r.guessed++;
      else r.wrong++;
      r.t = Math.max(r.t, a.t);
      r.questions.push(qid);
    }
    return [...by.values()].sort((a, b) => b.wrong + b.guessed - (a.wrong + a.guessed) || b.t - a.t);
  },
  readCount(ids) {
    return ids.reduce((n, id) => n + (state.read[id] ? 1 : 0), 0);
  },

  /* ---- var studenten slutade ---- */
  setLast(hash, label, kind = "bibliotek") {
    state.last = { hash, label, kind, t: Date.now() };
    save();
  },
  last() {
    return state.last;
  },
};
