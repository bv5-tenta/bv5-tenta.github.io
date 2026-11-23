/* Startsidan för Basvetenskap 5.
   Första vyn: kursnamn, "Öppna biblioteket", "Dags för tentaplugg?" och direkt under dem
   "Fortsätt där du slutade", bredvid en guldcaduceus (vektor – skarp i alla upplösningar).
   När studenten scrollar (eller klickar "Vad finns i appen?") följer bilden med i rörelsen,
   krymper och landar bredvid förklaringen av vad appen innehåller.
   Rörelsen styrs helt av scrollpositionen (båda riktningarna), stängs av vid reducerad rörelse
   och påverkar inte layouten (figurens platser har fast storlek). Innehållet hämtas ur biblioteket. */

import { esc, on, setTitle } from "../ui/dom.js";
import { loadLibrary } from "./library.js";
import { progress } from "../core/progress.js";

const ARROW = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`;

function resumeTarget(ctx, attempts) {
  const open = attempts.filter((a) => !a.submitted_at).sort((a, b) => String(b.updated_at || b.started_at).localeCompare(String(a.updated_at || a.started_at)))[0];
  const last = progress.last();
  const openT = open ? Date.parse(open.updated_at || open.started_at) || 0 : 0;
  if (open && (!last || openT > last.t)) return { href: `#/forsok/${open.id}`, label: `Tenta: ${open.title}` };
  if (last) return { href: last.hash, label: last.label };
  return null;
}

const HERO_IMG = "data/home/caduceus.svg";

export async function welcomeView(ctx, root) {
  setTitle("Basvetenskap 5");
  const [M, attempts] = await Promise.all([loadLibrary(ctx), ctx.store.listAttempts().catch(() => [])]);
  const resume = resumeTarget(ctx, attempts);
  const fmt = (n) => n.toLocaleString("sv-SE");
  const nObj = M.objectives.length;
  const nFig = Object.keys(M.bilder).length + M.objectives.filter((o) => o.format === "md").reduce((n, o) => n + (o.body.match(/!\[/g) || []).length, 0);
  const exams = [...ctx.store.exams.values()].filter((e) => e.status === "published");
  const del1 = exams.filter((e) => (e.del || 1) === 1).length;
  const del2 = exams.filter((e) => e.del === 2).length;
  const nQ = [...ctx.store.questions.values()].filter((q) => ctx.store.isOfficial(q)).length;
  const rats = ctx.store.listRats();
  const repeat = progress.toRepeat().slice(0, 4).map((r) => ({ ...r, o: M.byId.get(r.id) })).filter((r) => r.o);
  const done = attempts.filter((a) => a.locked_at).length;

  const features = [
    ["📚", "Lärandemålsbiblioteket", `${fmt(nObj)} lärandemål i del 1 och del 2, förklarade steg för steg med ${fmt(nFig)} figurer från föreläsningarna. Varje mål har "Det viktigaste", hur det har examinerats och ett quiz med motiverat facit.`, "#/bibliotek", "Öppna biblioteket"],
    ["📝", "Tentasimulator", `${fmt(exams.length)} gamla tentor (${del1} i del 1, ${del2} i del 2) med ${fmt(nQ)} frågor. Skriv på tid som i salen, flagga det du är osäker på – allt sparas automatiskt.`, "#/tentor", "Välj en tenta"],
    ["🧪", "RAT inför modulerna", rats.length ? `Simulerade iRAT för modul ${rats.map((r) => r.modul).join(", ")} i samma format som InteDashboard. Lämna in och se vilka delmoduler du ska prioritera.` : "Simulerade iRAT i samma format som InteDashboard.", "#/rat", "Gör en RAT"],
    ["📊", "Tidigare tentor", "Vilka lärandemål som återkommer, hur ofta och på vilket djup – så att du vet var poängen brukar ligga.", "#/tidigare-tentor", "Se mönstren"],
    ["🔁", "Öva på dina fel", "Allt du svarat fel på, gissat eller markerat som \"kan ej\" samlas här tills du klarar det flera gånger i rad.", "#/ova", "Öva nu"],
    ["🎴", "Anki-kortlekar", "Exportera dina fel med ett klick: fråga och alternativ på framsidan, facit, förklaring, lärandemål och källa på baksidan.", "#/ova", "Exportera"],
    ["📈", "Mitt resultat", `Poäng, tid per fråga och hur väl din känsla stämde med resultatet. ${done ? `${done} genomförda hittills.` : ""}`, "#/historik", "Se historiken"],
    ["💻", "Fungerar som app", "Installera sidan på datorn eller mobilen med egen ikon – den fungerar även utan internet.", null, null],
  ];

  root.innerHTML = `<div class="home2 home3">
    <section class="home-hero" aria-labelledby="home-title">
      <div class="home-hero-text">
        <p class="home-kicker">Karolinska Institutet · Läkarprogrammet, termin 3</p>
        <h1 id="home-title">Basvetenskap 5</h1>
        <p class="home-lead">Allt du behöver för kursen på ett ställe – från första föreläsningen till sista tentan.</p>
        <div class="home-cta">
          <a class="btn primary big" href="#/bibliotek">Öppna biblioteket ${ARROW}</a>
          <a class="btn big gold" href="#/traning">Dags för tentaplugg?</a>
        </div>
        ${resume ? `<a class="home-resume" href="${esc(resume.href)}"><span>Fortsätt där du slutade</span><b>${esc(resume.label)}</b></a>` : ""}
      </div>
      <div class="home-hero-fig">
        <div class="fig-slot gold" data-slot="start"><img src="${HERO_IMG}" alt="Guldfärgad caduceus – läkekonstens symbol" decoding="async" fetchpriority="high"></div>
        <button class="btn ghost home-explore" data-act="explore">Vad finns i appen? <span aria-hidden="true">↓</span></button>
      </div>
    </section>

    <section class="home-section" id="innehall" aria-labelledby="innehall-title">
      <div class="home-section-fig"><div class="fig-slot gold" data-slot="end"><img src="${HERO_IMG}" alt="" aria-hidden="true" decoding="async"></div></div>
      <div class="home-section-text">
        <p class="home-kicker">Vad appen innehåller</p>
        <h2 id="innehall-title">Plugga under kursen. Träna inför tentan.</h2>
        <p class="home-lead small-lead">Appen har två delar som hänger ihop: <b>biblioteket</b> förklarar varje lärandemål, och <b>träningen</b> visar om du kan använda det. Varje fel du gör pekar tillbaka till rätt stycke i biblioteket.</p>
        <ol class="home-steps">
          <li><b>Läs</b> lärandemålet som modulen handlar om just nu – med figurer och det viktigaste först.</li>
          <li><b>Testa dig</b> med quiz, RAT och gamla tentor på tid.</li>
          <li><b>Repetera</b> dina fel tills de sitter – i appen eller som Anki-kort.</li>
        </ol>
      </div>
    </section>

    <section class="home-features" aria-label="Funktioner">
      ${features.map(([ico, h, p, href, cta]) => `<${href ? `a href="${href}"` : "div"} class="feat-card">
        <span class="feat-ico" aria-hidden="true">${ico}</span>
        <h3>${esc(h)}</h3>
        <p>${esc(p)}</p>
        ${cta ? `<span class="feat-go">${esc(cta)} →</span>` : ""}
      </${href ? "a" : "div"}>`).join("")}
    </section>

    ${repeat.length ? `<section class="home-repeat"><h2>Att repetera</h2><p class="small muted">Mål där du svarat fel eller gissat i bibliotekets quiz.</p><ul>${repeat
      .map((r) => `<li><a href="#/bibliotek/${encodeURIComponent(r.id)}?ova=1"><b>${esc(r.id)}</b> ${esc(r.o.titel)}</a><span class="small muted">${r.wrong} fel · ${r.guessed} gissat</span></li>`)
      .join("")}</ul></section>` : ""}
    <p class="welcome-credit">Made by Abdarrahman</p>
    <figure class="fly gold" aria-hidden="true"><img src="${HERO_IMG}" alt="" decoding="async"></figure>
  </div>`;

  const offs = [];
  offs.push(setupFlight(root));
  offs.push(on(root, "click", "[data-act=explore]", () => {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById("innehall")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
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
