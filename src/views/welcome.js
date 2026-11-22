/* Välkomstfliken: första sidan man ser, med logga och val mellan BV5 Del 1 och Del 2. */

import { setTitle } from "../ui/dom.js";

const ARROW = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`;

function partStats(store) {
  const exams = store ? [...store.exams.values()] : [];
  const questions = store ? store.questions.size : 0;
  return { exams: exams.length, questions };
}

export function welcomeView(ctx, root) {
  setTitle("Välkommen");
  const s = partStats(ctx.store);
  const fmt = (n) => n.toLocaleString("sv-SE");
  root.innerHTML = `<section class="welcome">
    <img class="welcome-art" src="icons/caduceus.jpg" alt="Hermesstav med vingar och två ormar" width="394" height="360">
    <p class="welcome-kicker">Välkommen till</p>
    <h1 class="welcome-title">BV5 Tenta</h1>
    <p class="welcome-lead">Gamla tentor, Öva på dina fel och Anki-export för Basvetenskap 5 på läkarprogrammet. Välj vilken del du vill plugga.</p>
    <div class="part-choice" role="list">
      <a class="part-card" href="#/" role="listitem">
        <span class="part-label">BV5</span>
        <span class="part-name">Del 1</span>
        <span class="part-meta">${s.exams ? `${fmt(s.exams)} tentor · ${fmt(s.questions)} frågor` : "Tentasimulator"}</span>
        <span class="part-go">Öppna ${ARROW}</span>
      </a>
      <a class="part-card soon" href="#/del-2" role="listitem">
        <span class="part-label">BV5</span>
        <span class="part-name">Del 2</span>
        <span class="part-meta">Tentorna läggs in snart</span>
        <span class="part-go">Kommer snart</span>
      </a>
    </div>
    <p class="welcome-credit">Made by Abdarrahman</p>
  </section>`;
}

/** Del 2: platshållarsida tills de gamla tentorna för del 2 är inlagda. */
export function part2View(ctx, root) {
  setTitle("BV5 Del 2");
  root.innerHTML = `<section class="welcome part2">
    <p class="welcome-kicker">BV5</p>
    <h1 class="welcome-title">Del 2</h1>
    <p class="welcome-lead">Här kommer tentasimulatorn för del 2, med samma funktioner som i del 1: gamla tentor, 🟨/🟥-markering, resultatanalys, Öva på dina fel och Anki-export.</p>
    <div class="card part2-card">
      <span class="chip warn">Kommer snart</span>
      <p>De gamla tentorna för del 2 håller på att läggas in.</p>
    </div>
    <div class="btn-row center">
      <a class="btn primary" href="#/">Gå till Del 1 ${ARROW}</a>
      <a class="btn" href="#/valkommen">Tillbaka</a>
    </div>
  </section>`;
}
