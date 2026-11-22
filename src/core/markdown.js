/* Liten, säker markdown-tolk för bibliotekstexterna: rubriker, stycken, listor, tabeller,
   fet/kursiv stil och kod. All text escapas först – ingen rå HTML släpps igenom. */

import { esc } from "./text.js";

function inline(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function slug(text) {
  return String(text).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Returnerar { html, toc } där toc är rubrikerna på nivå 2 (för innehållsförteckning). */
export function renderMarkdown(src) {
  const lines = String(src || "").replace(/\r/g, "").split("\n");
  const out = [];
  const toc = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const h = line.match(/^(#{2,4})\s+(.+)$/);
    if (h) {
      const level = Math.min(h[1].length + 1, 5); // ## → h3, ### → h4
      const id = slug(h[2]);
      if (h[1].length === 2) toc.push({ id, text: h[2] });
      out.push(`<h${level} id="${id}">${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const row = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const head = row(line);
      i += 2;
      const body = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) body.push(row(lines[i++]));
      out.push(`<div class="md-table"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${body
        .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
        .join("")}</tbody></table></div>`);
      continue;
    }
    if (/^\s*[-•]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-•]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-•]\s+/, ""));
      out.push(`<ul>${items.map((t) => `<li>${inline(t)}</li>`).join("")}</ul>`);
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ""));
      out.push(`<ol>${items.map((t) => `<li>${inline(t)}</li>`).join("")}</ol>`);
      continue;
    }
    const para = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !/^(#{2,4}\s|\s*[-•]\s|\s*\d+[.)]\s|\s*\|)/.test(lines[i])) para.push(lines[i++]);
    out.push(`<p>${inline(para.join(" "))}</p>`);
  }
  return { html: out.join("\n"), toc };
}

/** Del 1-texterna är ren text med en rubrik eller ett stycke per rad. */
export function renderPlainSummary(src) {
  const lines = String(src || "").replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
  const out = [];
  const toc = [];
  let list = [];
  const flushList = () => {
    if (list.length) out.push(`<ul>${list.map((t) => `<li>${inline(t)}</li>`).join("")}</ul>`);
    list = [];
  };
  for (const l of lines) {
    if (/^[•\-–]\s+/.test(l)) {
      list.push(l.replace(/^[•\-–]\s+/, ""));
      continue;
    }
    flushList();
    const heading = l.length <= 90 && !/[.:;!?,)]$/.test(l) && !/^\d/.test(l) && l.split(" ").length <= 12;
    if (heading) {
      const id = slug(l);
      toc.push({ id, text: l });
      out.push(`<h3 id="${id}">${inline(l)}</h3>`);
    } else out.push(`<p>${inline(l)}</p>`);
  }
  flushList();
  return { html: out.join("\n"), toc };
}
