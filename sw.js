/*
 * Service worker för BV5 Tentasimulator.
 * - Förladdar appskalet, frågebanken och biblioteksindexet → hela simulatorn fungerar offline.
 * - Figurer och PDF-motorn cachas första gången de används.
 * - VERSION uppdateras av scripts/release.mjs när filerna ändras.
 */

const VERSION = "bv5-2026-11-07-allafacit1";
const SHELL = `shell-${VERSION}`;
const RUNTIME = `runtime-${VERSION}`;

const PRECACHE = [
  "./",
  "./index.html",
  "./config.js",
  "./manifest.webmanifest",
  "./src/styles.css",
  "./src/app.js",
  "./src/diagnostics.js",
  "./src/core/text.js",
  "./src/core/grading.js",
  "./src/core/mastery.js",
  "./src/core/library.js",
  "./src/core/quiz.js",
  "./src/data/idb.js",
  "./src/data/store.js",
  "./src/cloud/supabase.js",
  "./src/cloud/auth.js",
  "./src/cloud/sync.js",
  "./src/ui/dom.js",
  "./src/views/study.js",
  "./src/views/runner.js",
  "./src/views/results.js",
  "./src/views/anki.js",
  "./src/views/import.js",
  "./src/views/admin.js",
  "./src/views/access.js",
  "./src/views/welcome.js",
  "./src/anki/zip.js",
  "./src/anki/cards.js",
  "./src/anki/apkg.js",
  "./src/pdf/layout.js",
  "./src/pdf/extract.js",
  "./src/pdf/import.js",
  "./vendor/sql-wasm.js",
  "./vendor/sql-wasm.wasm",
  "./data/bibliotek-index.json",
  "./data/fragebank-seed.json",
  "./icons/caduceus.jpg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) => cache.addAll(PRECACHE.map((u) => new Request(u, { cache: "reload" }))))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== SHELL && k !== RUNTIME).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

async function networkFirst(request) {
  try {
    const res = await fetch(request);
    if (res.ok) (await caches.open(SHELL)).put(request, res.clone());
    return res;
  } catch {
    return (await caches.match(request)) || (await caches.match("./index.html"));
  }
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const update = fetch(request)
    .then(async (res) => {
      if (res.ok) (await caches.open(SHELL)).put(request, res.clone());
      return res;
    })
    .catch(() => null);
  return cached || (await update) || new Response("Offline", { status: 503 });
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok && res.type !== "opaque") (await caches.open(RUNTIME)).put(request, res.clone());
  return res;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) {
    // OCR-motorn från CDN cachas så att OCR fungerar offline efter första användningen.
    if (url.hostname === "cdn.jsdelivr.net" && url.pathname.includes("tesseract")) event.respondWith(cacheFirst(req));
    return;                                   // Supabase och övriga anrop går direkt till nätet
  }
  if (req.mode === "navigate") {
    event.respondWith(networkFirst(req));
    return;
  }
  if (url.pathname.endsWith(".json") && url.pathname.includes("/data/")) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }
  // Stora, oföränderliga filer (PDF-/SQL-motor, ikoner) från cachen; appens egna filer alltid färska
  // från servern när den nås – cachen används bara offline.
  if (url.pathname.includes("/vendor/") || url.pathname.includes("/icons/")) {
    event.respondWith(cacheFirst(req));
    return;
  }
  event.respondWith(networkFirst(req));
});

self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});
