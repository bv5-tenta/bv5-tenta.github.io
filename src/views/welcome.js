/* Välkomstfliken: första sidan man ser, med logga och en knapp in till tentasimulatorn. */

import { setTitle } from "../ui/dom.js";

export function welcomeView(ctx, root) {
  setTitle("Välkommen");
  root.innerHTML = `<section class="welcome">
    <img class="welcome-art" src="icons/caduceus.jpg" alt="Hermesstav med vingar och två ormar" width="394" height="360">
    <p class="welcome-kicker">Välkommen till</p>
    <h1 class="welcome-title">BV5 Tenta</h1>
    <p class="welcome-lead">Gamla tentor, Öva på dina fel och Anki-export för Basvetenskap 5 på läkarprogrammet.</p>
    <a class="btn primary welcome-cta" href="#/">Gå till tentasimulatorn →</a>
    <p class="welcome-credit">Made by Abdarrahman</p>
  </section>`;
}
