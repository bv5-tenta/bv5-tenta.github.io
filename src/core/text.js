/* Textverktyg: normalisering, HTML-escape, hash, svensk ordstamning. Inga beroenden. */

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
}

/** Normalisering för dubblettkontroll – samma regler som scripts/index-bibliotek.mjs. */
export function normalizeForHash(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[‐-―]/g, "-")
    .replace(/[“”„"']/g, "")
    .replace(/[^\p{L}\p{N}+\-]+/gu, " ")
    .trim();
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha1Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-1", data);
  return toHex(digest);
}

/** Samma hash som indexeraren: sha1(normaliserad stam + \u0001 + varje normaliserat alternativ). */
export async function contentHash(stem, options) {
  let joined = normalizeForHash(stem);
  for (const o of options) joined += "\u0001" + normalizeForHash(o);
  return sha1Hex(joined);
}

/** Deterministiskt UUID (v5-format) – samma algoritm som indexeraren. */
export async function uuidFrom(name) {
  const h = (await sha1Hex(String(name))).slice(0, 32).split("");
  h[12] = "5";
  h[16] = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  const x = h.join("");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

export function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const b = globalThis.crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const x = toHex(b);
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

/* ---------- svensk sökning ---------- */

const STOP = new Set(
  ("och i att det som en på är av för med till den har de inte om ett vid kan eller så från vilken vilket vilka " +
    "hur vad bäst följande nedan av beskriver mest sannolika sannolik stämmer korrekt alternativ välj ett denna dessa " +
    "detta deras dess hos under efter mot utan samt även man vara blir ska får när där")
    .split(" ")
);
const SUFFIXES = [
  "erna", "arna", "orna", "ande", "ende", "heten", "heter", "ingen", "ingar", "ning", "else",
  "ade", "are", "ast", "het", "lig", "iga", "igt", "ens", "ets", "ern", "ar", "er", "or", "en", "et",
  "na", "a", "e", "s", "t",
];

export function stem(word) {
  let w = word;
  if (w.length <= 4) return w;
  for (const suf of SUFFIXES) {
    if (w.length - suf.length >= 4 && w.endsWith(suf)) {
      w = w.slice(0, -suf.length);
      break;
    }
  }
  return w;
}

export function tokenize(text) {
  return normalizeForHash(text)
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem);
}

/** Ordtrigram för likhetsmätning mellan nästan identiska frågor. */
export function trigrams(text) {
  const words = normalizeForHash(text).split(/\s+/).filter(Boolean);
  const set = new Set();
  for (let i = 0; i < words.length; i++) {
    set.add(words.slice(i, i + 3).join(" "));
  }
  return set;
}

export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  for (const x of small) if (large.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export function formatDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h} h ${String(m).padStart(2, "0")} min`;
  if (m) return `${m} min ${String(s).padStart(2, "0")} s`;
  return `${s} s`;
}

export function formatClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function formatDate(iso) {
  if (!iso) return "–";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "–";
  return d.toLocaleDateString("sv-SE", { year: "numeric", month: "short", day: "numeric" });
}

export function formatDateTime(iso) {
  if (!iso) return "–";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "–";
  return d.toLocaleString("sv-SE", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function pct(part, whole) {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}
