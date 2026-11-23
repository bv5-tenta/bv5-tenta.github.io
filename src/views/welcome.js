/* Startsidan för Basvetenskap 5.
   Första vyn: kursnamn, kort beskrivning, "Öppna biblioteket", "Starta tentasimulering" och
   "Fortsätt där du slutade", bredvid en riktig föreläsningsfigur märkt med sitt kursavsnitt.
   När studenten scrollar (eller klickar "Utforska avsnittet") följer samma figur med i rörelsen,
   krymper och landar bredvid en förhandsvisning av det riktiga avsnittet i biblioteket.
   Rörelsen styrs helt av scrollpositionen (båda riktningarna), stängs av vid reducerad rörelse
   och påverkar inte layouten (figurens platser har fast storlek). Innehållet hämtas ur biblioteket. */

import { esc, on, setTitle } from "../ui/dom.js";
import { loadLibrary, hue } from "./library.js";
import { renderMarkdown } from "../core/markdown.js";
import { progress } from "../core/progress.js";

const ARROW = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`;
const FEATURED = ["9.3.1"];
const LETTERS = "ABCDE";

/** Väljer ett avsnitt med figur, nyckelpunkter och en facitbelagd fråga ur biblioteket. */
function pickFeatured(ctx, M) {
  const candidates = [...FEATURED.map((id) => M.byId.get(id)).filter(Boolean), ...M.objectives.filter((o) => o.format === "md")];
  for (const o of candidates) {
    const r = renderMarkdown(o.body);
    const fig = (o.body.match(/!\[([^\]]*)\]\((data\/[^\s)]+)/g) || [])
      .map((x) => x.match(/!\[([^\]]*)\]\((data\/[^\s)]+)/))
      .find((m) => !/-sida\.jpg$/.test(m[2]) && /cirkulation|shunt/i.test(m[1])) || (o.body.match(/!\[([^\]]*)\]\((data\/[^\s)]+)/) || null);
    if (!fig) continue;
    const q = [...ctx.store.questions.values()].find((x) => x.objective_id === o.id && x.options?.length && x.explanation && ctx.store.isOfficial(x));
    return { o, key: r.key, caption: fig[1].split(/\s*\|\|\s*/)[0], src: fig[2], q };
  }
  return null;
}

function resumeTarget(ctx, attempts) {
  const open = attempts.filter((a) => !a.submitted_at).sort((a, b) => String(b.updated_at || b.started_at).localeCompare(String(a.updated_at || a.started_at)))[0];
  const last = progress.last();
  const openT = open ? Date.parse(open.updated_at || open.started_at) || 0 : 0;
  if (open && (!last || openT > last.t)) return { href: `#/forsok/${open.id}`, label: `Tenta: ${open.title}` };
  if (last) return { href: last.hash, label: last.label };
  return null;
}

export async function welcomeView(ctx, root) {
  setTitle("Basvetenskap 5");
  const [M, attempts] = await Promise.all([loadLibrary(ctx), ctx.store.listAttempts().catch(() => [])]);
  const F = pickFeatured(ctx, M);
  const resume = resumeTarget(ctx, attempts);
  const fmt = (n) => n.toLocaleString("sv-SE");
  const nObj = M.objectives.length;
  const nFig = Object.keys(M.bilder).length + M.objectives.filter((o) => o.format === "md").reduce((n, o) => n + (o.body.match(/!\[/g) || []).length, 0);
  const exams = [...ctx.store.exams.values()].filter((e) => e.status === "published");
  const del1 = exams.filter((e) => (e.del || 1) === 1).length;
  const del2 = exams.filter((e) => e.del === 2).length;
  const repeat = progress.toRepeat().slice(0, 4).map((r) => ({ ...r, o: M.byId.get(r.id) })).filter((r) => r.o);
  const done = attempts.filter((a) => a.locked_at).length;
  const label = F ? `Modul ${F.o.modul} · ${F.o.modul_titel} · ${F.o.id}` : "";
  const figLabel = F ? `${label} ${F.o.titel}` : "";

  root.innerHTML = `<div class="home2" style="--mh:${F ? hue(F.o.modul) : 325}">
    <section class="home-hero" aria-labelledby="home-title">
      <div class="home-hero-text">
        <p class="home-kicker">Karolinska Institutet · Läkarprogrammet, termin 3</p>
        <h1 id="home-title">Basvetenskap 5</h1>
        <p class="home-lead">Hela kursen på ett ställe: ${fmt(nObj)} lärandemål förklarade med föreläsningarnas egna figurer, ${fmt(exams.length)} gamla tentor med facit, och en analys av hur varje mål har examinerats.</p>
        <div class="home-cta">
          <a class="btn primary big" href="#/bibliotek">Öppna biblioteket ${ARROW}</a>
          <a class="btn big" href="#/tentor">Starta tentasimulering</a>
        </div>
        ${resume ? `<a class="home-resume" href="${esc(resume.href)}"><span>Fortsätt där du slutade</span><b>${esc(resume.label)}</b></a>` : ""}
      </div>
      ${F ? `<div class="home-hero-fig">
        <div class="fig-slot" data-slot="start"><img src="${esc(F.src)}" alt="${esc(F.caption)}" decoding="async" fetchpriority="high"></div>
        <p class="fig-label">${esc(figLabel)}</p>
        <button class="btn ghost home-explore" data-act="explore">Utforska avsnittet <span aria-hidden="true">↓</span></button>
      </div>` : ""}
    </section>

    ${F ? `<section class="home-section" id="avsnitt" aria-labelledby="avsnitt-title">
      <div class="home-section-fig"><div class="fig-slot" data-slot="end"><img src="${esc(F.src)}" alt="" aria-hidden="true" decoding="async"></div>
        <p class="fig-cap">${esc(F.caption)}</p></div>
      <div class="home-section-text">
        <p class="home-kicker">Ur biblioteket · ${esc(label)}</p>
        <h2 id="avsnitt-title">${esc(F.o.titel)}</h2>
        ${F.key.length ? `<ol class="home-keys">${F.key.slice(0, 3).map((k) => `<li>${k}</li>`).join("")}</ol>` : ""}
        <div class="home-cta"><a class="btn primary" href="#/bibliotek/${encodeURIComponent(F.o.id)}">Öppna lärandemålet ${ARROW}</a>
          ${F.q ? `<button class="btn" data-act="tryq">Prova en tentafråga</button>` : ""}</div>
        ${F.q ? `<div class="home-q" hidden data-q data-right="${F.q.options.filter((x) => x.is_correct).map((x) => x.ordinal).join(",")}">
          <p class="small muted">Officiell tentafråga · ${esc((ctx.store.exams.get(F.q.exam_id)?.code || "").replace(/^Del 2 /, ""))} · fråga ${F.q.number}</p>
          <p class="lq-stem">${esc(F.q.stem)}</p>
          <ol class="lq-opts">${F.q.options.map((x, k) => `<li><button type="button" class="lq-opt" data-k="${x.ordinal}"><span class="lq-letter">${LETTERS[k]}</span><span>${esc(x.text)}</span></button></li>`).join("")}</ol>
          <div class="lq-feedback" hidden><p class="lq-verdict"></p><div class="lq-why"><b>Varför:</b> ${esc(F.q.explanation)}</div>
            <p class="lq-back"><a href="#/bibliotek/${encodeURIComponent(F.o.id)}?ova=1">Fler frågor på samma mål →</a></p></div>
        </div>` : ""}
      </div>
    </section>` : ""}

    <section class="home-modes" aria-label="Två sätt att använda sidan">
      <div class="mode-card">
        <p class="mode-kicker">Under kursen</p>
        <h2>Plugga under kursen</h2>
        <p>Börja från modulen eller lärandemålet ni har nu. Varje mål visar vad du ska kunna, var det förklaras, hur det har examinerats och ett quiz som visar om du kan använda det.</p>
        <ul class="mode-links">
          <li><a href="#/bibliotek?del=1">Biblioteket, del 1 <span>modul 1–8</span></a></li>
          <li><a href="#/bibliotek?del=2">Biblioteket, del 2 <span>modul 9–12</span></a></li>
          <li><span class="muted small">${fmt(nObj)} lärandemål · ${fmt(nFig)} föreläsningsfigurer</span></li>
        </ul>
      </div>
      <div class="mode-card">
        <p class="mode-kicker">Inför tentan</p>
        <h2>Träna inför tentan</h2>
        <p>Skriv en hel tenta på tid eller träna på ett kunskapsgap. Efter tentan går du från ditt svar till förklaringen, rätt stycke i biblioteket och en ny kontrollfråga.</p>
        <ul class="mode-links">
          <li><a href="#/tentor?del=1">Simulera del 1 <span>${del1} tentor</span></a></li>
          <li><a href="#/tentor?del=2">Simulera del 2 <span>${del2} tentor</span></a></li>
          <li><a href="#/ova">Öva på dina fel</a></li>
          <li><a href="#/tidigare-tentor">Tidigare tentor <span>examinationsmönster</span></a></li>
          <li><a href="#/historik">Mitt resultat <span>${done} genomförda</span></a></li>
        </ul>
      </div>
    </section>

    ${repeat.length ? `<section class="home-repeat"><h2>Att repetera</h2><p class="small muted">Mål där du svarat fel eller gissat i bibliotekets quiz.</p><ul>${repeat
      .map((r) => `<li><a href="#/bibliotek/${encodeURIComponent(r.id)}?ova=1"><b>${esc(r.id)}</b> ${esc(r.o.titel)}</a><span class="small muted">${r.wrong} fel · ${r.guessed} gissat</span></li>`)
      .join("")}</ul></section>` : ""}
    <p class="welcome-credit">Made by Abdarrahman</p>
    ${F ? `<figure class="fly" aria-hidden="true"><img src="${esc(F.src)}" alt="" decoding="async"></figure>` : ""}
  </div>`;

  const offs = [];
  if (F) offs.push(setupFlight(root));
  offs.push(on(root, "click", "[data-act=explore]", () => {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById("avsnitt")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
  }));
  offs.push(on(root, "click", "[data-act=tryq]", (e, el) => {
    const box = root.querySelector("[data-q]");
    box.hidden = false;
    el.remove();
    box.querySelector(".lq-opt")?.focus();
  }));
  offs.push(on(root, "click", ".home-q .lq-opt", (e, el) => {
    const box = el.closest("[data-q]");
    if (box.classList.contains("answered")) return;
    const right = box.dataset.right.split(",").map(Number);
    const k = Number(el.dataset.k);
    box.classList.add("answered", right.includes(k) ? "ok" : "fail");
    box.querySelectorAll(".lq-opt").forEach((b) => {
      const n = Number(b.dataset.k);
      if (right.includes(n)) b.classList.add("right");
      else if (n === k) b.classList.add("wrong");
    });
    box.querySelector(".lq-verdict").textContent = right.includes(k) ? "Rätt!" : `Fel – rätt svar är ${right.map((n) => LETTERS[n]).join(", ")}.`;
    box.querySelector(".lq-feedback").hidden = false;
  }));
  return () => offs.forEach((f) => typeof f === "function" && f());
}

/** Scrollstyrd övergång: figuren interpoleras mellan startplatsen och landningsplatsen. */
function setupFlight(root) {
  const wrap = root.querySelector(".home2");
  const fly = root.querySelector(".fly");
  const startSlot = root.querySelector('[data-slot="start"]');
  const endSlot = root.querySelector('[data-slot="end"]');
  const mq = matchMedia("(prefers-reduced-motion: reduce)");
  if (!fly || !startSlot || !endSlot) return () => {};
  let a = null, b = null, raf = 0;

  const measure = () => {
    const w = wrap.getBoundingClientRect();
    const r1 = startSlot.getBoundingClientRect();
    const r2 = endSlot.getBoundingClientRect();
    a = { x: r1.left - w.left, y: r1.top - w.top, w: r1.width, h: r1.height };
    b = { x: r2.left - w.left, y: r2.top - w.top, w: r2.width, h: r2.height };
  };
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const paint = () => {
    raf = 0;
    if (!a) measure();
    const reduce = mq.matches;
    wrap.classList.toggle("reduced", reduce);
    if (reduce) {
      // reducerad rörelse: figuren visas stillastående på båda platserna
      fly.style.transform = "";
      return;
    }
    const top = window.scrollY + wrap.getBoundingClientRect().top;
    const from = top + a.y - 80;                          // när startfiguren börjar lämna vyn
    const to = top + b.y - window.innerHeight * 0.18;     // när landningsplatsen är väl synlig
    const t = Math.min(1, Math.max(0, (window.scrollY - from) / Math.max(1, to - from)));
    const e = ease(t);
    const x = a.x + (b.x - a.x) * e;
    const y = a.y + (b.y - a.y) * e;
    const s = (a.w + (b.w - a.w) * e) / a.w;
    fly.style.width = `${a.w}px`;
    fly.style.height = `${a.h}px`;
    fly.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${s}, ${(a.h + (b.h - a.h) * e) / a.h})`;
    fly.style.setProperty("--t", e.toFixed(3));
    wrap.style.setProperty("--landed", e > 0.98 ? "1" : "0");
    wrap.classList.toggle("landed", e > 0.98);
  };
  const req = () => {
    if (!raf) raf = requestAnimationFrame(paint);
  };
  const resize = () => {
    measure();
    req();
  };
  const ro = "ResizeObserver" in window ? new ResizeObserver(resize) : null;
  ro?.observe(wrap);
  window.addEventListener("scroll", req, { passive: true });
  window.addEventListener("resize", resize);
  mq.addEventListener?.("change", req);
  wrap.classList.add("flight-ready");
  const img = fly.querySelector("img");
  if (img && !img.complete) img.addEventListener("load", resize, { once: true });
  resize();
  return () => {
    window.removeEventListener("scroll", req);
    window.removeEventListener("resize", resize);
    mq.removeEventListener?.("change", req);
    ro?.disconnect();
    cancelAnimationFrame(raf);
  };
}

/** Äldre adress #/del-2: skickar vidare till del 2 i simulatorn. */
export function part2View(ctx) {
  ctx.go("#/tentor?del=2");
}
