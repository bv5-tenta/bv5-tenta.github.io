/*
 * Synk mellan lokalt lager och Supabase.
 * - Student: skickar låsta försök + svar, hämtar publicerade tentor och träningsstatus.
 * - Admin: publicerar biblioteksstrukturen och tentor (inkl. frågebanken) till molnet.
 */

import { uuidFrom } from "../core/text.js";

const chunk = (list, n) => {
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
};

function dataUrlToBlob(url) {
  const [head, b64] = url.split(",");
  const mime = /data:([^;]+)/.exec(head)?.[1] || "application/octet-stream";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export class Sync {
  constructor(store, cloud, auth) {
    this.store = store;
    this.cloud = cloud;
    this.auth = auth;                      // {isAdmin(), hasAccess()}
    this.running = false;
    this.lastError = null;
    this.lastSync = null;
  }

  get ready() {
    return this.cloud.enabled && Boolean(this.cloud.token) && this.auth.hasAccess();
  }

  /* ---------- biblioteket och frågebanken (admin) ---------- */
  async publishLibrary(onProgress) {
    const lib = this.store.library;
    const mods = [...lib.modules.values()].map((m) => ({ nr: m.nr, titel: m.titel }));
    await this.cloud.upsert("library_modules", mods, "nr");
    const subs = [];
    for (const m of lib.index.modules) for (const s of m.submoduler) subs.push({ modul: m.nr, nr: s.nr, titel: s.titel });
    await this.cloud.upsert("library_submodules", subs, "modul,nr");
    const objs = [...lib.objectives.values()].map((o) => ({
      id: o.id, modul: o.modul, sub: o.sub, titel: o.titel, sammanfattning: o.sammanfattning || "", delmal: o.delmal || [], url: o.url,
    }));
    for (const part of chunk(objs, 100)) await this.cloud.upsert("learning_objectives", part, "id");
    onProgress?.("Lärandemål publicerade", 1, 3);
    const themes = [...lib.themes.values()].map((t) => ({
      id: t.id, modul: t.modul, tema: t.tema, objective_id: t.objective_id, beskrivning: t.beskrivning || "", fordjupning: t.fordjupning_html || "",
    }));
    for (const part of chunk(themes, 100)) await this.cloud.upsert("library_themes", part, "id");
    await this.cloud.upsert("app_settings", [{ key: "library_build", value: this.store.libraryBuild || "" }], "key");
    onProgress?.("Teman publicerade", 2, 3);
  }

  examRow(e) {
    return {
      id: e.id, code: e.code, kind: ["Ordinarie", "Rest", "Övrig"].includes(e.kind) ? e.kind : "Övrig",
      term: /^(HT|VT)\d{2}$/.test(e.term || "") ? e.term : "HT00",
      exam_date: e.exam_date || null, title: e.title || `BV5 ${e.code}`, duration_min: e.duration_min || 240,
      total_points: e.total_points || 0, pass_points: e.pass_points ?? null,
      source: ["bibliotek", "pdf", "manual"].includes(e.source) ? e.source : "manual",
      status: e.status === "published" ? "published" : e.status === "archived" ? "archived" : "draft",
      parse_report: e.parse_report || {}, published_at: e.status === "published" ? e.published_at || new Date().toISOString() : null,
    };
  }

  questionRow(q) {
    const lib = this.store.library;
    return {
      id: q.id, exam_id: q.exam_id, number: q.number,
      type: ["single", "multi", "freetext"].includes(q.type) ? q.type : "single",
      stem: q.stem || "", stem_html: q.stem_html || null, points: Number(q.points ?? 1),
      modul: lib.module(q.modul) ? Number(q.modul) : null,
      objective_id: lib.objective(q.objective_id) ? q.objective_id : null,
      theme_id: lib.theme(q.theme_id) ? q.theme_id : null,
      tag_source: ["bibliotek", "auto", "manual"].includes(q.tag_source) ? q.tag_source : "auto",
      tag_confidence: Math.max(0, Math.min(1, Number(q.tag_confidence || 0))),
      explanation: q.explanation || "", key_points: q.key_points || [],
      depth: ["u", "f", "t"].includes(q.depth) ? q.depth : null,
      status: ["ok", "osaker", "struken"].includes(q.status) ? q.status : "ok",
      correction_note: q.correction_note || "", content_hash: q.content_hash || q.id, library_key: q.library_key || null,
    };
  }

  async publishExam(examId, onProgress) {
    const e = this.store.exams.get(examId);
    if (!e) return;
    const qs = this.store.examQuestions(examId);
    await this.cloud.upsert("exams", [this.examRow(e)], "id");
    for (const part of chunk(qs.map((q) => this.questionRow(q)), 200)) await this.cloud.upsert("questions", part, "id");
    const opts = [];
    for (const q of qs) for (const o of q.options || []) opts.push({ question_id: q.id, ordinal: o.ordinal, text: o.text, is_correct: Boolean(o.is_correct) });
    for (const part of chunk(opts, 500)) await this.cloud.upsert("question_options", part, "question_id,ordinal");
    const rubric = [];
    for (const q of qs) (q.rubric || []).forEach((r, i) => rubric.push({ question_id: q.id, ordinal: i, criterion: r.criterion, points: Number(r.points || 0) }));
    if (rubric.length) await this.cloud.upsert("rubric_items", rubric, "question_id,ordinal");
    // Bilder från PDF-import laddas upp; bibliotekets figurer följer med appen.
    let n = 0;
    for (const q of qs) {
      const uploads = (q.media || []).filter((m) => m.data_url);
      if (!uploads.length) continue;
      await this.cloud.remove("question_media", `question_id=eq.${q.id}`);
      const rows = [];
      for (let i = 0; i < uploads.length; i++) {
        const m = uploads[i];
        const path = `${examId}/${q.id}-${i}.${m.data_url.startsWith("data:image/png") ? "png" : "webp"}`;
        await this.cloud.upload("question-media", path, dataUrlToBlob(m.data_url));
        rows.push({ id: await uuidFrom(`media:${path}`), question_id: q.id, kind: m.kind === "table" ? "table" : "figure", placement: m.placement || "stem", storage_path: path, width: m.width || null, height: m.height || null, alt: m.alt || "", ordinal: i });
      }
      await this.cloud.insert("question_media", rows, { returning: "minimal" });
      n++;
      onProgress?.(`Bilder (${n})`, n, qs.length);
    }
  }

  async publishBank(onProgress) {
    await this.publishLibrary(onProgress);
    const exams = this.store.listExams({ includeDrafts: true }).filter((e) => e.status === "published");
    let i = 0;
    for (const e of exams) {
      i++;
      onProgress?.(`Publicerar ${e.code}`, i, exams.length);
      await this.publishExam(e.id);
    }
    return exams.length;
  }

  /* ---------- försök (student) ---------- */
  async pushAttempt(attemptId) {
    const a = await this.store.getAttempt(attemptId);
    if (!a || !a.locked_at) return "skipped";
    const uid = this.cloud.userId;
    const row = {
      id: a.id, user_id: uid, exam_id: a.exam_id, mode: ["exam", "practice", "custom"].includes(a.mode) ? a.mode : "custom",
      title: a.title, question_ids: a.question_ids, started_at: a.started_at, submitted_at: a.submitted_at,
      locked_at: null, active_ms: Math.round(a.active_ms || 0), score: a.score, max_score: a.max_score, passed: a.passed,
    };
    try {
      await this.cloud.upsert("attempts", [row], "id");
    } catch (err) {
      if (err.code === "23503") await this.cloud.upsert("attempts", [{ ...row, exam_id: null }], "id");
      else if (err.code === "42501") return "already-locked";
      else throw err;
    }
    const resp = await this.store.getResponses(attemptId);
    const rows = [...resp.values()].map((r) => ({
      attempt_id: r.attempt_id, question_id: r.question_id, user_id: uid,
      selected: r.selected || [], free_text: r.free_text || "", flag_unsure: Boolean(r.flag_unsure), flag_cannot: Boolean(r.flag_cannot),
      time_ms: Math.round(r.time_ms || 0), visits: r.visits || 0, answer_changes: r.answer_changes || 0,
      is_correct: r.is_correct, points_awarded: r.points_awarded, self_grade: r.self_grade, ai_grade: r.ai_grade,
    }));
    let skipped = 0;
    for (const part of chunk(rows, 200)) {
      try {
        await this.cloud.upsert("responses", part, "attempt_id,question_id");
      } catch (err) {
        if (err.code !== "23503") throw err;
        for (const one of part) {
          try {
            await this.cloud.upsert("responses", [one], "attempt_id,question_id");
          } catch (e2) {
            if (e2.code === "23503") skipped++;
            else throw e2;
          }
        }
      }
    }
    await this.cloud.update("attempts", `id=eq.${a.id}`, { locked_at: a.locked_at });
    return skipped ? `partial:${skipped}` : "ok";
  }

  /* ---------- hämta från molnet ---------- */
  async pullProgress() {
    const uid = this.cloud.userId;
    if (!uid) return 0;
    const rows = await this.cloud.select("question_progress", `user_id=eq.${uid}&select=*`);
    return this.store.mergeProgress(rows.map(({ user_id, ...p }) => p));
  }

  async pullExams() {
    const exams = await this.cloud.select("exams", "status=eq.published&source=neq.bibliotek&select=*");
    let added = 0;
    for (const e of exams) {
      const local = this.store.exams.get(e.id);
      if (local && local.published_at === e.published_at && local.status === "published") continue;
      const qs = await this.cloud.select("questions", `exam_id=eq.${e.id}&select=*,question_options(*),question_media(*),rubric_items(*)&order=number`);
      const questions = [];
      for (const q of qs) {
        const media = [];
        for (const m of (q.question_media || []).sort((a, b) => a.ordinal - b.ordinal)) {
          try {
            media.push({ kind: m.kind, placement: m.placement, data_url: await blobToDataUrl(await this.cloud.download("question-media", m.storage_path)), width: m.width, height: m.height, alt: m.alt });
          } catch {
            /* bilden hoppas över om den inte kan hämtas */
          }
        }
        questions.push({
          id: q.id, exam_id: e.id, exam_code: e.code, number: q.number, type: q.type, stem: q.stem, stem_html: q.stem_html,
          points: Number(q.points), modul: q.modul, objective_id: q.objective_id, theme_id: q.theme_id, tag_source: q.tag_source,
          tag_confidence: q.tag_confidence, explanation: q.explanation, key_points: q.key_points || [], depth: q.depth,
          status: q.status, correction_note: q.correction_note, content_hash: q.content_hash, library_key: q.library_key,
          options: (q.question_options || []).sort((a, b) => a.ordinal - b.ordinal).map((o) => ({ ordinal: o.ordinal, text: o.text, is_correct: o.is_correct })),
          rubric: (q.rubric_items || []).sort((a, b) => a.ordinal - b.ordinal).map((r) => ({ criterion: r.criterion, points: Number(r.points) })),
          media,
        });
      }
      await this.store.idb.bulkPut("exams", [{ ...e, total_points: Number(e.total_points), pass_points: e.pass_points == null ? null : Number(e.pass_points), question_count: questions.length, sections: [] }]);
      await this.store.idb.deleteWhere("questions", "exam_id", e.id);
      await this.store.idb.bulkPut("questions", questions);
      added++;
    }
    if (added) {
      await this.store.reloadCaches();
      this.store.emit("exams");
    }
    return added;
  }

  /* ---------- utkorgen ---------- */
  async flush() {
    if (!this.ready || this.running) return { skipped: true };
    this.running = true;
    this.lastError = null;
    const result = { pushed: 0, failed: 0 };
    try {
      const items = await this.store.outbox();
      for (const it of items) {
        try {
          if (it.kind === "attempt") {
            await this.pushAttempt(it.ref);
          } else if (it.kind === "exam") {
            if (!this.auth.isAdmin()) {
              await this.store.dequeue(it.id);
              continue;
            }
            const e = this.store.exams.get(it.ref);
            if (e && e.source !== "bibliotek") await this.publishExam(it.ref);
          }
          await this.store.dequeue(it.id);
          result.pushed++;
        } catch (err) {
          result.failed++;
          this.lastError = err;
          if (err.code === "network") break;
        }
      }
      if (navigator.onLine !== false) {
        await this.pullExams().catch((e) => { this.lastError = e; });
        await this.pullProgress().catch((e) => { this.lastError = e; });
      }
      this.lastSync = new Date().toISOString();
    } finally {
      this.running = false;
      this.store.emit("sync", { ...result, error: this.lastError });
    }
    return result;
  }
}
