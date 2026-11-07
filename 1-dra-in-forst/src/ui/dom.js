/* DOM-hjälpare: delegerade händelser, toast, dialog, nedladdning, små SVG-diagram. */

import { esc } from "../core/text.js";

export { esc };

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Delegerad händelse: on(root, "click", "[data-act=x]", (ev, el) => …) */
export function on(root, type, selector, handler, opts) {
  const fn = (ev) => {
    const el = ev.target.closest(selector);
    if (el && root.contains(el)) handler(ev, el);
  };
  root.addEventListener(type, fn, opts);
  return () => root.removeEventListener(type, fn, opts);
}

let toastHost = null;
export function toast(message, kind = "", ms = 3600) {
  if (!toastHost) {
    toastHost = document.createElement("div");
    toastHost.className = "toasts";
    toastHost.setAttribute("role", "status");
    toastHost.setAttribute("aria-live", "polite");
    document.body.appendChild(toastHost);
  }
  const t = document.createElement("div");
  t.className = `toast ${kind}`;
  t.textContent = message;
  toastHost.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

/**
 * Dialog. actions: [{label, value, kind}] → Promise<value|null>.
 * body kan vara HTML-sträng; formulärfält läses med getValues(dialogEl) i onSubmit.
 */
export function modal({ title, body, actions = [{ label: "Stäng", value: null }], onOpen, onSubmit, wide = false }) {
  return new Promise((resolve) => {
    const d = document.createElement("dialog");
    d.className = "modal";
    if (wide) d.style.width = "min(860px, 96vw)";
    d.innerHTML = `
      <form method="dialog">
        <div class="modal-head"><h2>${esc(title)}</h2></div>
        <div class="modal-body">${body}</div>
        <div class="modal-foot">${actions
          .map((a, i) => `<button class="btn ${a.kind || ""}" value="${i}" ${a.kind === "primary" ? "autofocus" : ""}>${esc(a.label)}</button>`)
          .join("")}</div>
      </form>`;
    document.body.appendChild(d);
    let result = null;
    d.querySelector("form").addEventListener("submit", async (ev) => {
      const idx = Number(ev.submitter?.value ?? -1);
      const action = actions[idx];
      if (action && onSubmit && action.value !== null && action.value !== undefined) {
        ev.preventDefault();
        try {
          const r = await onSubmit(action.value, d);
          if (r === false) return;
          result = r === undefined ? action.value : r;
        } catch (err) {
          toast(err.message || String(err), "err", 6000);
          return;
        }
        d.close();
        return;
      }
      result = action ? action.value : null;
    });
    d.addEventListener("close", () => {
      d.remove();
      resolve(result);
    });
    d.addEventListener("cancel", () => {
      result = null;
    });
    d.showModal();
    onOpen?.(d);
  });
}

export async function confirmDialog(title, text, okLabel = "Fortsätt", danger = false) {
  const v = await modal({
    title,
    body: `<p>${esc(text)}</p>`,
    actions: [{ label: "Avbryt", value: null }, { label: okLabel, value: true, kind: danger ? "danger" : "primary" }],
  });
  return v === true;
}

export function download(filename, data, mime = "application/octet-stream") {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function lightbox(src, alt = "") {
  const d = document.createElement("div");
  d.className = "lightbox";
  d.innerHTML = `<img src="${esc(src)}" alt="${esc(alt)}">`;
  const close = () => {
    d.remove();
    document.removeEventListener("keydown", onKey, true);
  };
  const onKey = (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  };
  d.addEventListener("click", close);
  document.addEventListener("keydown", onKey, true);
  document.body.appendChild(d);
}

/** Ring med procent. */
export function ringSvg(percent, passed, label = "") {
  const r = 62;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, percent));
  const color = passed === null ? "var(--warn)" : passed ? "var(--ok)" : "var(--err)";
  return `<svg class="ring" viewBox="0 0 150 150" role="img" aria-label="${esc(label || `${p} procent`)}">
    <circle cx="75" cy="75" r="${r}" fill="none" stroke="var(--surface-3)" stroke-width="12"/>
    <circle cx="75" cy="75" r="${r}" fill="none" stroke="${color}" stroke-width="12" stroke-linecap="round"
      stroke-dasharray="${(c * p) / 100} ${c}" transform="rotate(-90 75 75)"/>
    <text x="75" y="80" text-anchor="middle" font-size="30" font-weight="700" fill="var(--ink)">${Math.round(p)}%</text>
    <text x="75" y="102" text-anchor="middle" font-size="12" fill="var(--ink-3)">${esc(label)}</text>
  </svg>`;
}

/** Stapeldiagram över tid per fråga (färg efter utfall). */
export function timeChartSvg(items, maxMs) {
  const w = 1000;
  const h = 120;
  const n = items.length || 1;
  const bw = w / n;
  const max = maxMs || Math.max(1, ...items.map((i) => i.ms));
  const color = (o) => (o === "correct" ? "var(--teal)" : o === "wrong" ? "var(--err)" : o === "unsure" ? "var(--unsure)" : o === "cannot" ? "var(--cannot)" : "var(--ink-3)");
  const bars = items
    .map((it, i) => {
      const bh = Math.max(1.5, (it.ms / max) * (h - 8));
      return `<rect x="${(i * bw + 0.5).toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${Math.max(1, bw - 1).toFixed(1)}" height="${bh.toFixed(1)}" fill="${color(it.outcome)}"><title>Fråga ${it.n}: ${Math.round(it.ms / 1000)} s</title></rect>`;
    })
    .join("");
  return `<svg class="timechart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Tid per fråga">${bars}</svg>`;
}

export function setTitle(t) {
  document.title = t ? `${t} · BV5 Tentasimulator` : "BV5 Tentasimulator";
}
