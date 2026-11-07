/* BV5 Tentasimulator – appskal: start, router, navigering, tema, installation och synk. */

import { CONFIG } from "../config.js";
import { Store } from "./data/store.js";
import { Cloud } from "./cloud/supabase.js";
import { Auth } from "./cloud/auth.js";
import { Sync } from "./cloud/sync.js";
import { esc, on, toast, modal } from "./ui/dom.js";
import { homeView, examsView, practiceView, historyView } from "./views/study.js";
import { runnerView } from "./views/runner.js";
import { resultsView, gradeView } from "./views/results.js";
import { importView } from "./views/import.js";
import { adminView } from "./views/admin.js";
import { loginView, applyView, statusView } from "./views/access.js";

const app = document.getElementById("app");

const ctx = {
  config: CONFIG,
  store: null,
  cloud: new Cloud(CONFIG),
  auth: null,
  sync: null,
  go(hash, replace = false) {
    if (replace) {
      history.replaceState(null, "", hash);
      render();
    } else if (location.hash === hash) render();
    else location.hash = hash;
  },
  render: () => render(),
  showShortcuts,
};
ctx.auth = new Auth(ctx.cloud, CONFIG);
window.__bv5 = ctx;

/* ---------- tema ---------- */
function applyTheme(t) {
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  try {
    localStorage.setItem("bv5.theme", JSON.stringify(t || "auto"));
  } catch {
    /* temat gäller ändå för sessionen */
  }
}
function currentTheme() {
  return ctx.store?.settings.theme || "auto";
}

/* ---------- installation (PWA) ---------- */
let installPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
  renderChrome();
});
window.addEventListener("appinstalled", () => {
  installPrompt = null;
  toast("Appen är installerad på datorn.", "ok");
  renderChrome();
});
const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

async function install() {
  if (installPrompt) {
    installPrompt.prompt();
    const choice = await installPrompt.userChoice.catch(() => null);
    if (choice?.outcome === "accepted") installPrompt = null;
    renderChrome();
    return;
  }
  const ua = navigator.userAgent;
  const safari = /Safari/.test(ua) && !/Chrome|Chromium|Edg/.test(ua);
  const firefox = /Firefox/.test(ua);
  const secure = location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname);
  await modal({
    title: "Ladda ner appen till datorn",
    body: !secure
      ? `<p>Installation kräver att appen öppnas via <b>https</b> (t.ex. GitHub Pages) eller <b>localhost</b>. Följ installationsguiden i README.</p>`
      : safari
        ? `<ol><li>Välj <b>Arkiv → Lägg till i Dock</b> i Safari (macOS Sonoma eller senare).</li><li>Appen får en egen ikon och öppnas i ett eget fönster, även offline.</li></ol>`
        : firefox
          ? `<p>Firefox stöder inte installation av webbappar. Öppna sidan i <b>Chrome</b> eller <b>Edge</b> och klicka på knappen igen.</p>`
          : `<ol><li>Klicka på installationsikonen <b>⊕</b> längst till höger i adressfältet (Chrome/Edge).</li><li>Eller öppna menyn <b>⋮ → Spara och dela → Installera sidan som app</b>.</li></ol><p class="small muted">Ikonen visas när appen har laddats klart en gång.</p>`,
    actions: [{ label: "OK", value: null, kind: "primary" }],
  });
}

/* ---------- kortkommandon ---------- */
function showShortcuts() {
  modal({
    title: "Kortkommandon i simulatorn",
    body: `<table class="table"><tbody>
      <tr><td><kbd>→</kbd></td><td>Nästa fråga (sista frågan → inlämning)</td></tr>
      <tr><td><kbd>←</kbd></td><td>Föregående fråga</td></tr>
      <tr><td><kbd>1</kbd> – <kbd>9</kbd></td><td>Välj svarsalternativ (tryck igen för att ångra)</td></tr>
      <tr><td><kbd>F</kbd></td><td>🟨 Flagga som osäker</td></tr>
      <tr><td><kbd>K</kbd></td><td>🟥 Markera "kan ej överhuvudtaget"</td></tr>
      <tr><td><kbd>Esc</kbd></td><td>Från inlämningssidan tillbaka till frågorna</td></tr>
      <tr><td><kbd>?</kbd></td><td>Visa den här listan</td></tr></tbody></table>
      <p class="small muted">Allt sparas automatiskt. Klockan räknar bara när tentan är öppen och synlig.</p>`,
    actions: [{ label: "Stäng", value: null, kind: "primary" }],
  });
}

/* ---------- router ---------- */
function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [path, qs] = raw.split("?");
  const p = path.split("/").filter(Boolean).map(decodeURIComponent);
  const query = Object.fromEntries(new URLSearchParams(qs || ""));
  if (!p.length) return { name: "home", query };
  if (p[0] === "tentor") return { name: "exams", query };
  if (p[0] === "forsok" && p[1]) {
    if (p[2] === "resultat") return { name: "results", id: p[1], query };
    if (p[2] === "bedom") return { name: "grade", id: p[1], query };
    return { name: "runner", id: p[1], query };
  }
  if (p[0] === "ova") return { name: "practice", query };
  if (p[0] === "historik") return { name: "history", query };
  if (p[0] === "importera") return { name: "import", query };
  if (p[0] === "admin") return { name: "admin", tab: p[1] || "oversikt", query };
  if (p[0] === "ansok") return { name: "apply", code: p[1] || "", query };
  if (p[0] === "logga-in") return { name: "login", query };
  return { name: "home", query };
}

const VIEWS = {
  home: homeView, exams: examsView, runner: runnerView, results: resultsView, grade: gradeView,
  practice: practiceView, history: historyView, import: importView, admin: adminView,
  apply: applyView, login: loginView, status: statusView,
};
const PUBLIC = new Set(["apply", "login"]);
const NAV = [
  ["home", "#/", "Hem"],
  ["exams", "#/tentor", "Tentor"],
  ["practice", "#/ova", "Öva på dina fel"],
  ["history", "#/historik", "Historik"],
];

const THEME_ICON = {
  auto: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor"/></svg>`,
  dark: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg>`,
  light: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`,
};

let cleanup = null;
let renderSeq = 0;

function syncState() {
  if (!ctx.cloud.enabled) return { cls: "", label: "Lokalt läge – data sparas på den här datorn" };
  if (ctx.sync?.lastError) return { cls: "err", label: `Synkfel: ${ctx.sync.lastError.message}` };
  if (ctx.auth.offline || navigator.onLine === false) return { cls: "pending", label: "Offline – synkar när nätet är tillbaka" };
  return { cls: "ok", label: ctx.sync?.lastSync ? "Synkat" : "Ansluten" };
}

function renderChrome() {
  const route = parseRoute();
  const top = document.getElementById("topbar");
  if (!top || !ctx.store) return;
  const inRunner = route.name === "runner";
  const loggedOut = ctx.auth.mode === "cloud" && ctx.auth.status() !== "active";
  top.hidden = inRunner;
  const s = syncState();
  const nav = loggedOut ? [] : [...NAV, ...(ctx.auth.isAdmin() ? [["import", "#/importera", "Importera"], ["admin", "#/admin", "Admin"]] : [])];
  top.innerHTML = `
    <a class="brand" href="#/"><span class="brand-mark">BV5</span><span>Tentasimulator<small>Basvetenskap 5 · Läkarprogrammet</small></span></a>
    ${nav.length ? `<button class="btn icon ghost menu-toggle" data-act="menu" aria-label="Meny" aria-expanded="false">☰</button>` : ""}
    <nav class="nav" id="nav">${nav.map(([name, href, label]) => `<a href="${href}" ${route.name === name ? 'aria-current="page"' : ""}>${label}</a>`).join("")}</nav>
    <div class="topbar-right">
      ${!isStandalone() ? `<button class="btn small" data-act="install" title="Installera som fristående app med egen ikon och offlinestöd">⬇ Ladda ner appen till datorn</button>` : ""}
      <span class="sync-dot ${s.cls}" title="${esc(s.label)}" aria-label="${esc(s.label)}"></span>
      <button class="btn icon ghost" data-act="theme" aria-label="Byt tema" title="Tema: ${currentTheme() === "auto" ? "följer systemet" : currentTheme() === "dark" ? "mörkt" : "ljust"}">${THEME_ICON[currentTheme()]}</button>
      ${ctx.auth.mode === "cloud" && ctx.auth.profile ? `<button class="btn small ghost" data-act="logout" title="${esc(ctx.auth.profile.email || "")}">Logga ut</button>` : ""}
    </div>`;
}

async function render() {
  const seq = ++renderSeq;
  if (cleanup) {
    try {
      await cleanup();
    } catch (e) {
      console.error(e);
    }
    cleanup = null;
  }
  if (seq !== renderSeq) return;
  let route = parseRoute();
  const status = ctx.auth.status();
  if (ctx.auth.mode === "cloud" && !PUBLIC.has(route.name)) {
    if (status === "anon") {
      if (location.hash !== "#/logga-in") history.replaceState(null, "", "#/logga-in");
      route = { name: "login" };
    } else if (status !== "active") route = { name: "status" };
  }
  if (["import", "admin"].includes(route.name) && !ctx.auth.isAdmin()) route = { name: "home" };
  renderChrome();
  const main = document.getElementById("main");
  main.className = route.name === "runner" ? "wide" : "";
  const view = document.createElement("div");
  view.className = "view";
  main.replaceChildren(view);
  try {
    const result = await VIEWS[route.name](ctx, view, route);
    if (seq === renderSeq) cleanup = typeof result === "function" ? result : null;
    else if (typeof result === "function") result();
  } catch (err) {
    console.error(err);
    view.innerHTML = `<div class="card" style="max-width:640px;margin:8vh auto"><h2>Något gick fel</h2>
      <p class="muted">${esc(err.message || String(err))}</p>
      <div class="btn-row"><a class="btn primary" href="#/">Till startsidan</a><button class="btn" onclick="location.reload()">Ladda om</button></div></div>`;
  }
  if (route.name !== "runner") window.scrollTo({ top: 0 });
}

/* ---------- globala händelser ---------- */
on(document, "click", "#topbar [data-act]", async (e, el) => {
  const act = el.dataset.act;
  if (act === "install") install();
  else if (act === "menu") {
    const nav = document.getElementById("nav");
    nav.classList.toggle("open");
    el.setAttribute("aria-expanded", String(nav.classList.contains("open")));
  } else if (act === "theme") {
    const next = { auto: "dark", dark: "light", light: "auto" }[currentTheme()];
    await ctx.store.saveSettings({ theme: next });
    applyTheme(next);
    renderChrome();
  } else if (act === "logout") {
    await ctx.auth.signOut();
    ctx.go("#/logga-in");
  }
});
on(document, "click", "#nav a", () => document.getElementById("nav")?.classList.remove("open"));

window.addEventListener("hashchange", async () => {
  // Inloggningslänken kan öppnas i en flik där appen redan körs: då ändras bara #-delen.
  if (ctx.cloud.enabled && /access_token=|error_description=/.test(location.hash)) {
    try {
      await ctx.cloud.consumeRedirect();
      await ctx.auth.refreshProfile();
      if (ctx.auth.hasAccess()) ctx.sync?.flush();
    } catch (err) {
      ctx.auth.error = err.message;
    }
  }
  render();
});
window.addEventListener("online", () => {
  ctx.sync?.flush();
  renderChrome();
});
window.addEventListener("offline", renderChrome);

/* Felgräns för oväntade fel utanför vyerna */
window.addEventListener("unhandledrejection", (e) => {
  console.error(e.reason);
  toast(`Oväntat fel: ${e.reason?.message || e.reason}`, "err", 7000);
});

/* ---------- start ---------- */
async function boot() {
  const status = document.getElementById("boot-status");
  const say = (t) => { if (status) status.textContent = t; };
  try {
    say("Kontrollerar inloggning …");
    await ctx.auth.init();
    say("Öppnar den lokala databasen …");
    ctx.store = await Store.open({ base: "./", onProgress: say });
    applyTheme(ctx.store.settings.theme);
    ctx.sync = new Sync(ctx.store, ctx.cloud, ctx.auth);
    ctx.store.on((type) => {
      if (type === "sync") renderChrome();
    });
    document.getElementById("boot")?.remove();
    await render();
    if (ctx.cloud.enabled && ctx.auth.hasAccess()) {
      ctx.sync.flush();
      setInterval(() => ctx.sync.flush(), 120000);
    }
    if (ctx.auth.error) toast(ctx.auth.error, "err", 8000);
  } catch (err) {
    console.error(err);
    const b = document.getElementById("boot");
    if (b) b.innerHTML = `<div><h2>Appen kunde inte starta</h2><p class="muted">${esc(err.message || String(err))}</p>
      <p class="small muted">Öppna appen via en webbserver (se README) – inte direkt som fil.</p><button class="btn primary" onclick="location.reload()">Försök igen</button></div>`;
  }
  if ("serviceWorker" in navigator && (location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname))) {
    // När en ny version tagit över laddas sidan om en gång direkt (allt är redan autosparat),
    // så att man aldrig fastnar på gamla filer ur cachen.
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController || reloaded) return;
      reloaded = true;
      location.reload();
    });
    navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).then((reg) => {
      reg.update().catch(() => {});
      reg.addEventListener("updatefound", () => {
        const nw = reg.installing;
        nw?.addEventListener("statechange", () => {
          if (nw.state === "installed" && navigator.serviceWorker.controller) {
            toast("Appen uppdateras …");
          }
        });
      });
    }).catch((err) => console.warn("Service worker:", err));
  }
}

boot();
