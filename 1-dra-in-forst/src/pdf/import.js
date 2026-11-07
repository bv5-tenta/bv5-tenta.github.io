/*
 * Importflöde: PDF (+ valfritt separat facit) → utkast till tenta med frågor, bilder,
 * taggar och kontrollrapport. Utkastet visas i verifieringsvyn innan det sparas.
 */

import { extractPdf } from "./extract.js";
import { parseInspera, parseNumbered, parseAnswerKey, looksLikeInspera, guessExamMeta } from "./layout.js";
import { contentHash, uuid } from "../core/text.js";
import { tagQuestion } from "../core/library.js";

async function readText(file) {
  if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
    const ex = await extractPdf(await file.arrayBuffer(), { ocr: "auto" });
    const text = ex.pages.map((p) => p.lines.map((l) => l.text).join("\n")).join("\n");
    return { text, extracted: ex };
  }
  return { text: await file.text(), extracted: null };
}

/**
 * @param {File} file              tentan som PDF
 * @param {Object} o               {store, facitFile?, ocr?, onProgress?, signal?}
 */
export async function importExamPdf(file, o) {
  const { store } = o;
  const progress = (phase, done = 0, total = 0, extra = "") => o.onProgress?.({ phase, done, total, extra });
  progress("Läser PDF", 0, 1);

  const ex = await extractPdf(await file.arrayBuffer(), {
    ocr: o.ocr || "auto",
    signal: o.signal,
    vendorBase: o.vendorBase,
    onProgress: (done, total, info) => progress(info?.phase === "ocr" ? "OCR (inskannad sida)" : "Läser sidor", done, total, `sida ${info?.page ?? done}`),
  });

  progress("Tolkar frågor", 0, 1);
  let parsed;
  let mode;
  let answerKey = new Map();
  if (o.facitFile) {
    progress("Läser facit", 0, 1);
    const fac = await readText(o.facitFile);
    if (fac.extracted && looksLikeInspera(fac.extracted.pages)) {
      const facParsed = parseInspera(fac.extracted.pages);
      for (const q of facParsed.questions) {
        const letters = q.options.map((op, i) => (op.is_correct ? "ABCDEFGHIJ"[i] : "")).join("");
        if (letters) answerKey.set(q.number, letters);
      }
    } else {
      answerKey = parseAnswerKey(fac.text);
    }
    if (fac.extracted) await fac.extracted.close();
  }

  if (looksLikeInspera(ex.pages)) {
    parsed = parseInspera(ex.pages);
    mode = "inspera";
    if (answerKey.size) {
      for (const q of parsed.questions) {
        const key = answerKey.get(q.number);
        if (!key || q.options.some((op) => op.is_correct)) continue;
        q.options = q.options.map((op, i) => ({ ...op, is_correct: key.includes("ABCDEFGHIJ"[i]) }));
        q.type = key.length > 1 ? "multi" : "single";
      }
    }
  } else {
    parsed = parseNumbered(ex.pages, answerKey);
    mode = "numrerad";
  }

  const meta = guessExamMeta(file.name, ex.firstText);
  const examId = uuid();
  const bank = store.bankIndex();
  const questions = [];
  const sectionIds = new Map(parsed.sections.map((title, i) => [title, i]));
  const total = parsed.questions.length;
  let i = 0;
  for (const pq of parsed.questions) {
    i++;
    if (i % 5 === 0) progress("Bilder och taggning", i, total);
    const options = pq.options.map((op) => ({ ordinal: op.ordinal, text: op.text, is_correct: op.is_correct }));
    const hash = await contentHash(pq.stem, options.map((op) => op.text));
    const media = [];
    for (const img of pq.images || []) {
      try {
        const c = await ex.crop(img.page, img, 2);
        media.push({ kind: "figure", placement: img.placement || "stem", data_url: c.data_url, width: c.width, height: c.height, alt: `Figur till fråga ${pq.number}` });
      } catch (err) {
        parsed.warnings.push(`Fråga ${pq.number}: bilden kunde inte klippas ut (${err.message})`);
      }
    }
    if (pq.table_like && pq.options.length) {
      const firstOpt = pq.options[0];
      if (firstOpt.page === pq.page) {
        try {
          const c = await ex.crop(pq.page, { x0: pq.region.x0, y0: pq.region.y0, x1: pq.region.x1, y1: firstOpt.y0 - 3 }, 4);
          media.push({ kind: "table", placement: "stem", data_url: c.data_url, width: c.width, height: c.height, alt: `Tabell i fråga ${pq.number}` });
        } catch (err) {
          parsed.warnings.push(`Fråga ${pq.number}: tabellen kunde inte klippas ut (${err.message})`);
        }
      }
    }
    const tag = await tagQuestion({ stem: pq.stem, options: options.map((op) => op.text), hash }, store.library, bank);
    questions.push({
      id: uuid(),
      exam_id: examId,
      exam_code: meta.code,
      number: pq.number,
      section: pq.section ?? null,
      section_index: pq.section != null ? sectionIds.get(pq.section) : null,
      type: pq.type,
      stem: pq.stem,
      points: pq.points,
      options,
      media,
      rubric: [],
      modul: tag.modul ?? null,
      objective_id: tag.objective_id ?? null,
      theme_id: tag.theme_id ?? null,
      tag_source: tag.tag_source,
      tag_confidence: tag.tag_confidence,
      tag_match: tag.match,
      tag_suggestions: tag.suggestions,
      explanation: tag.explanation || "",
      key_points: tag.key_points || [],
      depth: null,
      status: "ok",
      correction_note: "",
      content_hash: hash,
      source_page: pq.page,
      source_region: pq.region,
    });
  }

  const nOptionsQ = questions.filter((q) => q.options.length);
  const report = {
    mode,
    pages: ex.numPages,
    ocr_pages: ex.ocrPages,
    questions: questions.length,
    mcq: nOptionsQ.length,
    freetext: questions.length - nOptionsQ.length,
    with_answer: nOptionsQ.filter((q) => q.options.some((op) => op.is_correct)).length,
    images: questions.reduce((n, q) => n + q.media.length, 0),
    exact_duplicates: questions.filter((q) => q.tag_match?.kind === "exact").length,
    similar: questions.filter((q) => q.tag_match?.kind === "similar").length,
    low_confidence: questions.filter((q) => q.tag_confidence < 0.35).length,
    numbering_gaps: [],
    warnings: parsed.warnings,
    errors: [],
  };
  for (let k = 1; k < questions.length; k++) {
    if (questions[k].number !== questions[k - 1].number + 1) report.numbering_gaps.push(`${questions[k - 1].number}→${questions[k].number}`);
  }
  if (!questions.length) report.errors.push("Inga frågor hittades. Är det en tentamens-PDF med frågor och svarsalternativ?");
  const missing = nOptionsQ.filter((q) => !q.options.some((op) => op.is_correct));
  if (missing.length) report.errors.push(`${missing.length} flervalsfrågor saknar facit: ${missing.slice(0, 12).map((q) => q.number).join(", ")}${missing.length > 12 ? " …" : ""}`);
  if (report.numbering_gaps.length) report.warnings.push(`Luckor i numreringen: ${report.numbering_gaps.join(", ")}`);

  const exam = {
    id: examId,
    code: meta.code,
    kind: meta.kind,
    term: meta.term,
    exam_date: null,
    title: `BV5 ${meta.code}`,
    duration_min: questions.length > 140 ? 240 : questions.length >= 100 ? 225 : Math.max(30, Math.round(questions.length * 1.6)),
    total_points: questions.reduce((n, q) => n + (q.status === "struken" ? 0 : Number(q.points || 0)), 0),
    pass_points: null,
    source: "pdf",
    source_file: file.name,
    status: "draft",
    sections: parsed.sections,
    question_count: questions.length,
    parse_report: report,
    created_at: new Date().toISOString(),
  };

  progress("Klar", 1, 1);
  return { exam, questions, report, extracted: ex };
}
