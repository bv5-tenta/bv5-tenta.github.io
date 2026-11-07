/*
 * PDF → sidlayout (webbläsare). Använder PDF.js (vendor/pdf.min.js) för text, rendering och
 * bildpositioner, och Tesseract.js (laddas vid behov) för sidor utan läsbart textlager.
 * Radioknappar och gröna facitbockar hittas i den renderade sidan, så samma metod fungerar
 * för text-PDF:er och inskannade/OCR-tolkade sidor.
 */

import { buildLines } from "./layout.js";

const SCALE = 2;                         // renderingsskala (pt → px)
const TESSERACT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";

let pdfjsReady = null;
export function loadPdfJs(base = "./vendor/") {
  if (globalThis.pdfjsLib) {
    globalThis.pdfjsLib.GlobalWorkerOptions.workerSrc = `${base}pdf.worker.min.js`;
    return Promise.resolve(globalThis.pdfjsLib);
  }
  if (!pdfjsReady) {
    pdfjsReady = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = `${base}pdf.min.js`;
      s.onload = () => {
        globalThis.pdfjsLib.GlobalWorkerOptions.workerSrc = `${base}pdf.worker.min.js`;
        resolve(globalThis.pdfjsLib);
      };
      s.onerror = () => reject(new Error("PDF.js kunde inte laddas"));
      document.head.appendChild(s);
    });
  }
  return pdfjsReady;
}

let tesseractReady = null;
function loadTesseract() {
  if (globalThis.Tesseract) return Promise.resolve(globalThis.Tesseract);
  if (!tesseractReady) {
    tesseractReady = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = TESSERACT_URL;
      s.onload = () => resolve(globalThis.Tesseract);
      s.onerror = () => {
        tesseractReady = null;
        reject(new Error("OCR-motorn (Tesseract.js) kunde inte hämtas. Kontrollera nätverket – OCR behövs bara för inskannade sidor."));
      };
      document.head.appendChild(s);
    });
  }
  return tesseractReady;
}

/* ---------- textkvalitet ---------- */
export function textQuality(text) {
  const chars = text.replace(/\s/g, "");
  if (chars.length < 40) return 0;
  const good = (chars.match(/[a-zA-ZåäöÅÄÖéÉüÜ]/g) || []).length;
  return good / chars.length;
}

/* ---------- pixelanalys ---------- */
function components(mask, w, h, minPx = 4) {
  const seen = new Uint8Array(w * h);
  const out = [];
  const stack = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || seen[i]) continue;
    let x0 = w, y0 = h, x1 = 0, y1 = 0, n = 0, touch = 0;
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const p = stack.pop();
      const x = p % w;
      const y = (p - x) / w;
      n++;
      if (mask[p] === 2) touch++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      const nb = [p - 1, p + 1, p - w, p + w];
      if (x === 0) nb[0] = -1;
      if (x === w - 1) nb[1] = -1;
      for (const q of nb) {
        if (q >= 0 && q < mask.length && mask[q] && !seen[q]) {
          seen[q] = 1;
          stack.push(q);
        }
      }
    }
    if (n >= minPx) out.push({ x0, y0, x1, y1, n, touch });
  }
  return out;
}

/** Hittar gröna bockar (#358D14-liknande) och grå radioknappar i en renderad sida. */
export function scanPixels(imageData, scale = SCALE) {
  const { data, width: w, height: h } = imageData;
  const green = new Uint8Array(w * h);
  const gray = new Uint8Array(w * h);
  const radioLimit = Math.floor(w * 0.45);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (g > 90 && g - r > 45 && g - b > 45) green[y * w + x] = 1;
      if (x < radioLimit) {
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        if (mx - mn < 22 && mx > 95 && mx < 245) gray[y * w + x] = 1;
      }
    }
  }
  // Markera grå pixlar som ligger intill mörka (kantutjämning runt text) – radioknappar har inga sådana.
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < radioLimit - 1; x++) {
      const p = y * w + x;
      if (!gray[p]) continue;
      for (const q of [p - 1, p + 1, p - w, p + w]) {
        const i = q * 4;
        if (Math.max(data[i], data[i + 1], data[i + 2]) < 95) {
          gray[p] = 2;
          break;
        }
      }
    }
  }
  const toPt = (c) => ({ x0: c.x0 / scale, y0: c.y0 / scale, x1: (c.x1 + 1) / scale, y1: (c.y1 + 1) / scale });
  const checks = components(green, w, h, Math.round(6 * scale))
    .map(toPt)
    .filter((c) => c.x1 - c.x0 >= 3 && c.x1 - c.x0 <= 22 && c.y1 - c.y0 >= 2.5 && c.y1 - c.y0 <= 22);
  const radios = components(gray, w, h, Math.round(8 * scale))
    .filter((c) => c.touch / c.n < 0.12)
    .map(toPt)
    .filter((c) => {
      const cw = c.x1 - c.x0, ch = c.y1 - c.y0;
      return cw >= 5 && cw <= 16 && ch >= 5 && ch <= 16 && Math.abs(cw - ch) <= 3;
    });
  return { checks: mergeClose(checks), radios };
}

function mergeClose(boxes) {
  const out = [];
  for (const b of boxes.sort((a, c) => a.y0 - c.y0)) {
    const prev = out.find((o) => Math.abs(o.y0 - b.y0) < 6 && Math.abs(o.x0 - b.x0) < 14);
    if (prev) {
      prev.x0 = Math.min(prev.x0, b.x0); prev.y0 = Math.min(prev.y0, b.y0);
      prev.x1 = Math.max(prev.x1, b.x1); prev.y1 = Math.max(prev.y1, b.y1);
    } else out.push({ ...b });
  }
  return out;
}

/* ---------- bildpositioner via operatorlistan ---------- */
function mul(m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

async function imageBoxes(page, viewport, OPS) {
  const ops = await page.getOperatorList();
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const boxes = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform) ctm = mul(ctm, args);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      if (Array.isArray(args[0]) && args[0].length === 6) ctm = mul(ctm, args[0]);
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageXObjectRepeat) {
      const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => {
        const ux = ctm[0] * x + ctm[2] * y + ctm[4];
        const uy = ctm[1] * x + ctm[3] * y + ctm[5];
        return viewport.convertToViewportPoint(ux, uy);
      });
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      const b = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
      if (b.x1 - b.x0 >= 40 && b.y1 - b.y0 >= 24) boxes.push(b);
    }
  }
  return boxes;
}

/* ---------- text ---------- */
function textItems(content, viewport, page) {
  const items = [];
  for (const it of content.items) {
    if (!("str" in it) || !it.str) continue;
    const [x, y] = viewport.convertToViewportPoint(it.transform[4], it.transform[5]);
    const size = Math.hypot(it.transform[2], it.transform[3]) || it.height || 10;
    let fontName = "";
    try {
      fontName = page.commonObjs.has(it.fontName) ? page.commonObjs.get(it.fontName)?.name || "" : "";
    } catch {
      fontName = "";
    }
    items.push({ str: it.str, x0: x, x1: x + (it.width || 0), y, size, bold: /bold|black|heavy|semibold/i.test(fontName) });
  }
  return items;
}

let ocrWorker = null;
async function ocrPage(canvas) {
  const T = await loadTesseract();
  if (!ocrWorker) ocrWorker = await T.createWorker("swe");
  const { data } = await ocrWorker.recognize(canvas);
  const items = [];
  for (const line of data.lines || []) {
    for (const w of line.words || []) {
      const h = (w.bbox.y1 - w.bbox.y0) / SCALE;
      items.push({
        str: w.text,
        x0: w.bbox.x0 / SCALE,
        x1: w.bbox.x1 / SCALE,
        y: (line.baseline?.y0 ?? w.bbox.y1) / SCALE,
        size: Math.max(6, (line.bbox.y1 - line.bbox.y0) / SCALE * 0.82 || h),
        bold: Boolean(w.is_bold),
      });
    }
  }
  return items;
}

export async function terminateOcr() {
  if (ocrWorker) {
    await ocrWorker.terminate();
    ocrWorker = null;
  }
}

/**
 * Läser hela PDF:en.
 * @param {ArrayBuffer} buffer
 * @param {{onProgress?:(done,total,info)=>void, ocr?:'auto'|'force'|'off', signal?:AbortSignal}} opts
 */
export async function extractPdf(buffer, opts = {}) {
  const pdfjsLib = await loadPdfJs(opts.vendorBase);
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false }).promise;
  const pages = [];
  const ocrPages = [];
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const mode = opts.ocr || "auto";
  let firstText = "";

  for (let n = 1; n <= doc.numPages; n++) {
    if (opts.signal?.aborted) throw new DOMException("Avbrutet", "AbortError");
    const page = await doc.getPage(n);
    const vp1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: SCALE });
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;

    const content = await page.getTextContent();
    let items = textItems(content, vp1, page);
    const raw = items.map((i) => i.str).join(" ");
    let usedOcr = false;
    if (mode === "force" || (mode === "auto" && textQuality(raw) < 0.6)) {
      if (mode !== "off") {
        opts.onProgress?.(n - 1, doc.numPages, { phase: "ocr", page: n });
        items = await ocrPage(canvas);
        usedOcr = true;
        ocrPages.push(n);
      }
    }
    if (n <= 2) firstText += ` ${items.map((i) => i.str).join(" ")}`;

    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const { checks, radios } = scanPixels(img, SCALE);
    const images = await imageBoxes(page, vp1, pdfjsLib.OPS);
    pages.push({
      index: n,
      width: vp1.width,
      height: vp1.height,
      lines: buildLines(items),
      checks,
      radios,
      images,
      ocr: usedOcr,
    });
    page.cleanup();
    opts.onProgress?.(n, doc.numPages, { phase: usedOcr ? "ocr" : "text", page: n });
    await new Promise((r) => setTimeout(r, 0));           // låt gränssnittet andas
  }

  async function crop(pageIndex, box, pad = 6) {
    const page = await doc.getPage(pageIndex);
    const vp = page.getViewport({ scale: SCALE });
    const c = document.createElement("canvas");
    const x0 = Math.max(0, (box.x0 - pad) * SCALE);
    const y0 = Math.max(0, (box.y0 - pad) * SCALE);
    const x1 = Math.min(vp.width, (box.x1 + pad) * SCALE);
    const y1 = Math.min(vp.height, (box.y1 + pad) * SCALE);
    c.width = Math.max(1, Math.round(x1 - x0));
    c.height = Math.max(1, Math.round(y1 - y0));
    const cx = c.getContext("2d");
    cx.fillStyle = "#fff";
    cx.fillRect(0, 0, c.width, c.height);
    cx.translate(-x0, -y0);
    await page.render({ canvasContext: cx, viewport: vp }).promise;
    const type = "image/webp";
    let url = c.toDataURL(type, 0.86);
    if (!url.startsWith("data:image/webp")) url = c.toDataURL("image/png");
    return { data_url: url, width: c.width, height: c.height };
  }

  return {
    numPages: doc.numPages,
    pages,
    ocrPages,
    firstText: firstText.trim(),
    crop,
    close: async () => {
      await terminateOcr();
      await doc.destroy();
    },
  };
}
