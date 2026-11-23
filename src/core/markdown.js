/* Liten, säker markdown-tolk för bibliotekstexterna. All text escapas först – ingen rå HTML släpps igenom.
   Stöd: ## / ### rubriker, stycken, listor, tabeller, **fet**, *kursiv*, `kod`, samt bibliotekets tillägg:
     ![Bildtext](data/bild.jpg "Källa")        → figur (flera i rad → bildgalleri)
     flöde: A → B → C                           → flödeskedja
     > [!klinik] Rubrik  /  > text …            → faktaruta (viktigt, klinik, minne, fallgrop, forklaring, exempel)
     ## Det viktigaste  (eller ## Tentafokus)   → plockas ut som "nyckelpunkter" och visas överst av vyn */

import { esc } from "./text.js";

function inline(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/(^|\s)(↑|↓)(?=\s|$|[,.;)])/g, '$1<span class="arrow">$2</span>');
}

function slug(text) {
  return String(text).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const CALLOUTS = {
  viktigt: { icon: "★", label: "Viktigt" },
  klinik: { icon: "⚕", label: "Kliniskt" },
  minne: { icon: "💡", label: "Minnesregel" },
  fallgrop: { icon: "⚠", label: "Vanlig fälla på tentan" },
  forklaring: { icon: "?", label: "Varför?" },
  exempel: { icon: "✎", label: "Exempel" },
};

const FIG = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)\s*$/;
const KEY_HEADINGS = /^(det viktigaste|tentafokus)$/i;

function safeSrc(src) {
  return /^(data\/|https:\/\/)[\w\-./%]+\.(jpe?g|png|webp|svg)$/i.test(src) ? src : "";
}

function figureHtml(m) {
  const src = safeSrc(m[2]);
  if (!src) return "";
  const [caption, hint] = m[1].split(/\s*\|\|\s*/);
  const [source, page] = String(m[3] || "").split("|");
  const pageSrc = safeSrc(page || "");
  return `<figure class="md-fig"><button type="button" class="md-fig-btn" data-zoom="${esc(src)}" data-caption="${esc(caption)}${source ? ` – ${esc(source)}` : ""}" aria-label="Förstora bild: ${esc(caption)}"><img src="${esc(src)}" alt="${esc(caption)}" loading="lazy" decoding="async"></button>
    <figcaption>${inline(caption)}${hint ? `<span class="md-fig-hint"><b>Lägg märke till:</b> ${inline(hint)}</span>` : ""}<span class="md-fig-src">${source ? `Källa: ${esc(source.replace(/, s\. (\d+)$/, " · PDF-sida $1"))}` : ""}${pageSrc ? ` · <button type="button" class="linklike" data-zoom="${esc(pageSrc)}" data-caption="${esc(source)} – hela PDF-sidan">Visa hela PDF-sidan</button>` : ""}</span></figcaption></figure>`;
}

/** Tolkar ett block (utan nyckelpunktsavsnittet). */
function renderBlocks(lines, toc, counter) {
  const out = [];
  let i = 0;
  let open = false;
  const closeSec = () => {
    if (open) out.push("</section>");
    open = false;
  };
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const h = line.match(/^(#{2,4})\s+(.+)$/);
    if (h) {
      const id = slug(h[2]);
      if (h[1].length === 2) {
        closeSec();
        counter.n++;
        toc.push({ id, text: h[2] });
        out.push(`<section class="md-sec" id="${id}"><h3><span class="md-sec-nr">${counter.n}</span>${inline(h[2])}</h3>`);
        open = true;
      } else out.push(`<h4 id="${id}">${inline(h[2])}</h4>`);
      i++;
      continue;
    }
    const fig = line.match(FIG);
    if (fig) {
      const figs = [];
      while (i < lines.length && FIG.test(lines[i])) figs.push(figureHtml(lines[i++].match(FIG)));
      const ok = figs.filter(Boolean);
      if (ok.length) out.push(ok.length > 1 ? `<div class="md-figs n${Math.min(ok.length, 3)}">${ok.join("")}</div>` : ok[0]);
      continue;
    }
    const flow = line.match(/^flöde:\s*(.+)$/i);
    if (flow) {
      const steps = flow[1].split(/\s*(?:→|->)\s*/).filter(Boolean);
      out.push(`<ol class="md-flow">${steps.map((s) => `<li>${inline(s)}</li>`).join("")}</ol>`);
      i++;
      continue;
    }
    const co = line.match(/^>\s*\[!(\w+)\]\s*(.*)$/);
    if (co) {
      const kind = CALLOUTS[co[1].toLowerCase()] ? co[1].toLowerCase() : "viktigt";
      const body = [];
      i++;
      while (i < lines.length && /^>/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ""));
      const inner = renderBlocks(body, [], { n: 0 }).html;
      const c = CALLOUTS[kind];
      out.push(`<aside class="md-callout ${kind}"><div class="md-callout-head"><span class="md-callout-icon" aria-hidden="true">${c.icon}</span>${inline(co[2] || c.label)}</div>${inner}</aside>`);
      continue;
    }
    if (/^>\s?/.test(line)) {
      const body = [];
      while (i < lines.length && /^>/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ""));
      out.push(`<blockquote>${renderBlocks(body, [], { n: 0 }).html}</blockquote>`);
      continue;
    }
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const row = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const head = row(line);
      i += 2;
      const body = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) body.push(row(lines[i++]));
      out.push(`<div class="md-table"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${body
        .map((r) => `<tr>${r.map((c, k) => `<td data-label="${esc(head[k] || "")}">${inline(c)}</td>`).join("")}</tr>`)
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
      out.push(`<ol class="md-steps">${items.map((t) => `<li>${inline(t)}</li>`).join("")}</ol>`);
      continue;
    }
    const para = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !/^(#{2,4}\s|\s*[-•]\s|\s*\d+[.)]\s|\s*\||>|!\[|flöde:)/i.test(lines[i])) para.push(lines[i++]);
    out.push(`<p>${inline(para.join(" "))}</p>`);
  }
  closeSec();
  return { html: out.join("\n") };
}

/** Returnerar { html, toc, key, figures } – key är nyckelpunkterna (HTML-listpunkter) och figures antal bilder. */
export function renderMarkdown(src) {
  const lines = String(src || "").replace(/\r/g, "").split("\n");
  const key = [];
  const rest = [];
  let inKey = false;
  for (const l of lines) {
    const h = l.match(/^##\s+(.+)$/);
    if (h) inKey = KEY_HEADINGS.test(h[1].trim());
    if (inKey) {
      const li = l.match(/^\s*[-•]\s+(.+)$/);
      if (li) key.push(inline(li[1]));
      continue;
    }
    rest.push(l);
  }
  const toc = [];
  const { html } = renderBlocks(rest, toc, { n: 0 });
  const figures = rest.filter((l) => FIG.test(l)).length;
  return { html, toc, key, figures };
}

/** Del 1-texterna är ren text med en rubrik eller ett stycke per rad. */
export function renderPlainSummary(src) {
  const lines = String(src || "").replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
  const out = [];
  const toc = [];
  let list = [];
  let open = false;
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
      if (open) out.push("</section>");
      out.push(`<section class="md-sec" id="${id}"><h3><span class="md-sec-nr">${toc.length}</span>${inline(l)}</h3>`);
      open = true;
    } else out.push(`<p>${inline(l)}</p>`);
  }
  flushList();
  if (open) out.push("</section>");
  return { html: out.join("\n"), toc, key: [], figures: 0 };
}

/** Uppskattad lästid i minuter. */
export function readingMinutes(src) {
  const words = String(src || "").split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 170));
}
