/*
 * Appens lokala datalager (local-first). IndexedDB är sanningen för allt studentarbete;
 * molnsynken (cloud/sync.js) läser utkorgen och skickar vidare när nätet och kontot finns.
 */

import { Idb } from "./idb.js";
import { Library, BankIndex } from "../core/library.js";
import { gradeResponse, gradeAttempt, DEFAULT_PASS_RATIO } from "../core/grading.js";
import { applyOutcome, isBlank, DEFAULT_STREAK } from "../core/mastery.js";
import { uuid } from "../core/text.js";

export const DEFAULT_SETTINGS = {
  mastery_streak: DEFAULT_STREAK,
  pass_ratio: DEFAULT_PASS_RATIO,
  theme: "auto",
  show_timer: true,
  confirm_submit: true,
};

export class Store {
  constructor(idb, opts = {}) {
    this.idb = idb;
    this.base = opts.base || "./";
    this.exams = new Map();
    this.questions = new Map();
    this.library = null;
    this.bank = null;
    this.settings = { ...DEFAULT_SETTINGS };
    this.listeners = new Set();
  }

  static async open(opts = {}) {
    const idb = await Idb.open(opts.dbName);
    const s = new Store(idb, opts);
    await s.load(opts);
    return s;
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(type, detail) {
    for (const fn of this.listeners) {
      try {
        fn(type, detail);
      } catch (e) {
        console.error(e);
      }
    }
  }

  async fetchJson(path) {
    const res = await fetch(`${this.base}${path}`, { cache: "no-cache" });
    if (!res.ok) throw new Error(`Kunde inte läsa ${path} (HTTP ${res.status})`);
    return res.json();
  }

  async load(opts = {}) {
    const saved = await this.idb.get("meta", "settings");
    if (saved) this.settings = { ...DEFAULT_SETTINGS, ...saved.value };
    const index = await this.fetchJson("data/bibliotek-index.json");
    this.library = new Library(index);
    this.libraryBuild = index.library_build || "";
    await this.ensureSeed(opts.onProgress);
    await this.reloadCaches();
  }

  async ensureSeed(onProgress) {
    const meta = await this.idb.get("meta", "seed");
    let seed;
    try {
      seed = await this.fetchJson("data/fragebank-seed.json");
    } catch (err) {
      if (meta) return;                        // offline men redan inläst
      throw err;
    }
    if (meta && meta.value.built_at === seed.built_at) return;
    onProgress?.("Läser in frågebanken …");
    const edited = new Set(
      (await this.idb.getAll("questions")).filter((q) => q.edited).map((q) => q.id)
    );
    const exams = [];
    const questions = [];
    for (const e of seed.exams) {
      const { questions: qs, ...exam } = e;
      exams.push({ ...exam, status: "published", pass_points: null, created_at: exam.created_at || seed.built_at });
      for (const q of qs) {
        if (edited.has(q.id)) continue;
        questions.push({
          ...q,
          exam_id: e.id,
          exam_code: e.code,
          media: (q.media || []).map((m) => ({ ...m, url: `${this.base}data/${m.path}` })),
        });
      }
    }
    await this.idb.bulkPut("exams", exams);
    await this.idb.bulkPut("questions", questions);
    await this.idb.put("meta", { key: "seed", value: { built_at: seed.built_at, library_build: seed.library_build, counts: seed.counts } });
  }

  async reloadCaches() {
    const [exams, questions] = await Promise.all([this.idb.getAll("exams"), this.idb.getAll("questions")]);
    this.exams = new Map(exams.map((e) => [e.id, e]));
    this.questions = new Map(questions.map((q) => [q.id, q]));
    this.bank = null;
  }

  bankIndex() {
    if (!this.bank) this.bank = new BankIndex([...this.questions.values()]);
    return this.bank;
  }

  async saveSettings(patch) {
    this.settings = { ...this.settings, ...patch };
    await this.idb.put("meta", { key: "settings", value: this.settings });
    this.emit("settings", this.settings);
  }

  async getMeta(key, fallback = null) {
    const m = await this.idb.get("meta", key);
    return m ? m.value : fallback;
  }
  async setMeta(key, value) {
    await this.idb.put("meta", { key, value });
  }

  /* ---------- tentor och frågor ---------- */
  listExams({ includeDrafts = false } = {}) {
    const order = (e) => {
      const y = Number(String(e.term || "").slice(2)) || 0;
      return y * 100 + (String(e.term).startsWith("VT") ? 0 : 50) + (e.kind === "Rest" ? 1 : 0);
    };
    return [...this.exams.values()]
      .filter((e) => includeDrafts || e.status === "published")
      .sort((a, b) => order(b) - order(a) || String(a.code).localeCompare(String(b.code)));
  }

  examQuestions(examId) {
    return [...this.questions.values()].filter((q) => q.exam_id === examId).sort((a, b) => a.number - b.number);
  }

  questionsByIds(ids) {
    return ids.map((id) => this.questions.get(id)).filter(Boolean);
  }

  async saveExam(exam, questions) {
    await this.idb.bulkPut("exams", [exam]);
    await this.idb.deleteWhere("questions", "exam_id", exam.id);
    await this.idb.bulkPut("questions", questions);
    await this.reloadCaches();
    await this.enqueue({ kind: "exam", id: exam.id });
    this.emit("exams");
  }

  async setExamStatus(examId, status) {
    const e = this.exams.get(examId);
    if (!e) return;
    const next = { ...e, status, published_at: status === "published" ? new Date().toISOString() : e.published_at };
    await this.idb.put("exams", next);
    this.exams.set(examId, next);
    await this.enqueue({ kind: "exam", id: examId });
    this.emit("exams");
  }

  async deleteExam(examId) {
    await this.idb.delete("exams", examId);
    await this.idb.deleteWhere("questions", "exam_id", examId);
    await this.reloadCaches();
    this.emit("exams");
  }

  async updateQuestion(q) {
    const next = { ...q, edited: true, updated_at: new Date().toISOString() };
    await this.idb.put("questions", next);
    this.questions.set(q.id, next);
    this.bank = null;
    await this.enqueue({ kind: "exam", id: q.exam_id });
  }

  /* ---------- försök ---------- */
  async createAttempt({ mode, title, exam_id = null, question_ids, duration_min = null }) {
    const now = new Date().toISOString();
    const a = {
      id: uuid(), mode, title, exam_id, question_ids, duration_min,
      started_at: now, submitted_at: null, locked_at: null, active_ms: 0,
      current_index: 0, score: null, max_score: null, passed: null, updated_at: now,
    };
    await this.idb.put("attempts", a);
    this.emit("attempts");
    return a;
  }

  getAttempt(id) {
    return this.idb.get("attempts", id);
  }

  async listAttempts() {
    const all = await this.idb.getAll("attempts");
    return all.sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)));
  }

  async saveAttempt(a) {
    a.updated_at = new Date().toISOString();
    await this.idb.put("attempts", a);
    return a;
  }

  async deleteAttempt(id) {
    await this.idb.deleteWhere("responses", "attempt_id", id);
    await this.idb.delete("attempts", id);
    this.emit("attempts");
  }

  async getResponses(attemptId) {
    const list = await this.idb.getAll("responses", "attempt_id", attemptId);
    return new Map(list.map((r) => [r.question_id, r]));
  }

  async saveResponses(list) {
    if (!list.length) return;
    await this.idb.bulkPut("responses", list);
  }

  newResponse(attemptId, questionId) {
    return {
      attempt_id: attemptId, question_id: questionId,
      selected: [], free_text: "", flag_unsure: false, flag_cannot: false,
      time_ms: 0, visits: 0, answer_changes: 0,
      is_correct: null, points_awarded: null, self_grade: null, ai_grade: null,
      progress_applied: false, updated_at: new Date().toISOString(),
    };
  }

  /** Lämnar in: rättar alla svar. Låser direkt om inga fritextsvar väntar på bedömning. */
  async submitAttempt(attemptId) {
    const a = await this.getAttempt(attemptId);
    if (!a) throw new Error("Försöket finns inte");
    const qs = this.questionsByIds(a.question_ids);
    const resp = await this.getResponses(attemptId);
    const changed = [];
    for (const q of qs) {
      const r = resp.get(q.id) || this.newResponse(attemptId, q.id);
      const g = gradeResponse(q, r);
      r.is_correct = g.scored ? g.is_correct : null;
      r.points_awarded = g.scored ? g.points : null;
      resp.set(q.id, r);
      changed.push(r);
    }
    await this.saveResponses(changed);
    a.submitted_at = a.submitted_at || new Date().toISOString();
    const summary = this.summarize(a, qs, resp);
    a.score = summary.score;
    a.max_score = summary.max;
    a.passed = summary.passed;
    await this.saveAttempt(a);
    if (summary.pending === 0) await this.lockAttempt(attemptId);
    this.emit("attempts");
    return a;
  }

  /** Sparar självbedömning av fritextsvar. */
  async saveSelfGrade(attemptId, questionId, grade) {
    const resp = await this.getResponses(attemptId);
    const q = this.questions.get(questionId);
    const r = resp.get(questionId) || this.newResponse(attemptId, questionId);
    r.self_grade = grade;
    const g = gradeResponse(q, r);
    r.is_correct = g.is_correct;
    r.points_awarded = g.points;
    await this.saveResponses([r]);
    return r;
  }

  /** Låser försöket och för in varje svar i "Öva på dina fel" exakt en gång. */
  async lockAttempt(attemptId) {
    const a = await this.getAttempt(attemptId);
    if (!a || a.locked_at) return a;
    const qs = this.questionsByIds(a.question_ids);
    const resp = await this.getResponses(attemptId);
    const now = new Date().toISOString();
    const progress = [];
    const responses = [];
    for (const q of qs) {
      const r = resp.get(q.id);
      if (!r || r.progress_applied) continue;
      const g = gradeResponse(q, r);
      if (!g.scored || g.is_correct === null) continue;
      if (isBlank(r)) {
        r.progress_applied = true;
        responses.push(r);
        continue;
      }
      const prev = await this.idb.get("progress", q.id);
      progress.push(applyOutcome(prev, r, g, this.settings.mastery_streak, now));
      r.progress_applied = true;
      responses.push(r);
    }
    await this.idb.bulkPut("progress", progress);
    await this.saveResponses(responses);
    const summary = this.summarize(a, qs, resp);
    a.locked_at = now;
    a.score = summary.score;
    a.max_score = summary.max;
    a.passed = summary.passed;
    await this.saveAttempt(a);
    await this.enqueue({ kind: "attempt", id: attemptId });
    this.emit("progress");
    return a;
  }

  summarize(attempt, qs, resp) {
    const exam = attempt.exam_id ? this.exams.get(attempt.exam_id) : null;
    return gradeAttempt(qs || this.questionsByIds(attempt.question_ids), resp, {
      pass_points: exam?.pass_points ?? null,
      pass_ratio: this.settings.pass_ratio,
    });
  }

  async attemptSummary(attemptId) {
    const a = await this.getAttempt(attemptId);
    if (!a) return null;
    const qs = this.questionsByIds(a.question_ids);
    const resp = await this.getResponses(attemptId);
    return { attempt: a, questions: qs, responses: resp, summary: this.summarize(a, qs, resp) };
  }

  /* ---------- träningsstatus ---------- */
  async allProgress() {
    return this.idb.getAll("progress");
  }

  async mergeProgress(list) {
    const out = [];
    for (const p of list) {
      const local = await this.idb.get("progress", p.question_id);
      if (!local || (p.times_seen || 0) > (local.times_seen || 0)) out.push(p);
    }
    if (out.length) {
      await this.idb.bulkPut("progress", out);
      this.emit("progress");
    }
    return out.length;
  }

  async resetProgress(questionId) {
    await this.idb.delete("progress", questionId);
    this.emit("progress");
  }

  /* ---------- utkorg för molnsynk ---------- */
  async enqueue(item) {
    // En post per objekt: nyckeln "<typ>:<id>" gör att upprepade ändringar slås ihop.
    await this.idb.put("outbox", { id: `${item.kind}:${item.id}`, kind: item.kind, ref: item.id, queued_at: new Date().toISOString() });
    this.emit("outbox");
  }
  outbox() {
    return this.idb.getAll("outbox");
  }
  async dequeue(outboxId) {
    await this.idb.delete("outbox", outboxId);
  }

  /* ---------- export/import av all lokal data ---------- */
  async exportAll() {
    const [attempts, responses, progress] = await Promise.all([
      this.idb.getAll("attempts"), this.idb.getAll("responses"), this.idb.getAll("progress"),
    ]);
    const custom = [...this.exams.values()].filter((e) => e.source !== "bibliotek");
    return {
      format: "bv5-tentasimulator-backup", version: 1, exported_at: new Date().toISOString(),
      settings: this.settings, attempts, responses, progress,
      exams: custom, questions: [...this.questions.values()].filter((q) => custom.some((e) => e.id === q.exam_id) || q.edited),
    };
  }

  async importAll(data) {
    if (data?.format !== "bv5-tentasimulator-backup") throw new Error("Filen är inte en säkerhetskopia från BV5 Tentasimulator");
    await this.idb.bulkPut("exams", data.exams || []);
    await this.idb.bulkPut("questions", data.questions || []);
    await this.idb.bulkPut("attempts", data.attempts || []);
    await this.idb.bulkPut("responses", data.responses || []);
    await this.idb.bulkPut("progress", data.progress || []);
    if (data.settings) await this.saveSettings(data.settings);
    await this.reloadCaches();
    this.emit("attempts");
    this.emit("progress");
  }
}
