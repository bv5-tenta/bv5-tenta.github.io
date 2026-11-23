/* Tidigare tentor: examinationsmönster per deltentamen, härlett ur data/tentaanalys.json
   (byggd av scripts/build_analys.py). Tre dimensioner hålls isär:
   1) vad kursen kräver (alla lärandemål i biblioteket),
   2) hur tidigare tentor har examinerat området (förekomst med nämnare och period),
   3) vad den enskilda studenten behöver repetera (egna quiz- och tentautfall). */

import { esc, on, setTitle } from "../ui/dom.js";
import { loadLibrary, hue } from "./library.js";
import { progress } from "../core/progress.js";

const K = { aterg: "Återgivning", mekanism: "Mekanism", jamforelse: "Jämförelse", berakning: "Beräkning", figur_fall: "Figur/fall" };

export async function analysisView(ctx, root, route) {
  root.innerHTML = `<div class="loading-screen"><div><span class="spinner"></span><p>Räknar fram examinationsmönstret …</p></div></div>`;
  const M = await loadLibrary(ctx);
  const q = route.query || {};
  const del = Number(q.del) === 2 ? 2 : 1;
  const modFilter = q.modul ? Number(q.modul) : null;
  const focus = q.mal || null;
  setTitle("Tidigare tentor");
  const a = M.ta?.delar?.[del];
  if (!a) {
    root.innerHTML = `<div class="card"><h2>Analysen saknas</h2><p>Filen data/tentaanalys.json kunde inte laddas. Kör <code>python3 scripts/build_analys.py</code>.</p></div>`;
    return;
  }
  const mods = del === 2 ? [9, 10, 11, 12] : [1, 2, 3, 4, 5, 6, 7, 8];
  const objs = M.objectives.filter((o) => o.del === del && (!modFilter || o.modul === modFilter));
  const weak = new Map();
  for (const p of await ctx.store.allProgress()) {
    if (!p.in_weak_bank || p.state === "mastered") continue;
    const qq = ctx.store.questions.get(p.question_id);
    if (qq?.objective_id) weak.set(qq.objective_id, (weak.get(qq.objective_id) || 0) + 1);
  }
  const repeat = new Map(progress.toRepeat().map((r) => [r.id, r]));
  const rows = objs
    .map((o) => ({ o, m: a.mal[o.id] || null }))
    .sort((x, y) => (y.m?.antal_tentor || 0) - (x.m?.antal_tentor || 0) || (y.m?.fragor || 0) - (x.m?.fragor || 0) || x.o.id.localeCompare(y.o.id, "sv", { numeric: true }));
  const examined = rows.filter((r) => r.m).length;
  const total = Object.values(a.kunskapshandling).reduce((x, y) => x + y, 0);
  const kDist = Object.entries(a.kunskapshandling).sort((x, y) => y[1] - x[1]).map(([k, n]) => `<span class="kpill">${esc(K[k] || k)} <b>${Math.round((n / total) * 100)} %</b></span>`).join("");
  const ev = a.utvardering;
  const imp = (M.ta.import || []).filter((r) => r.del === del);

  const tableRows = rows
    .map(({ o, m }) => {
      const share = m ? m.antal_tentor / a.antal_tentor : 0;
      const mine = weak.get(o.id) || 0;
      const rep = repeat.get(o.id);
      const need = mine || rep ? `<span class="need">${[mine && `${mine} i felbanken`, rep && `${rep.wrong + rep.guessed} quiz fel/gissat`].filter(Boolean).join(" · ")}</span>` : progress.objectiveStats(o.id).sure ? `<span class="need ok">visad förståelse</span>` : `<span class="muted small">–</span>`;
      const status = !m
        ? `<span class="muted small">Saknar tillräckligt historiskt underlag (0 av ${a.antal_tentor})</span>`
        : m.antal_tentor < 2 ? `<span class="small">1 av ${a.antal_tentor} tentor – för litet underlag för mönster</span>` : "";
      return `<tr class="${focus === o.id ? "focus" : ""}" id="row-${esc(o.id)}">
        <td><a href="#/bibliotek/${encodeURIComponent(o.id)}"><b>${esc(o.id)}</b> ${esc(o.titel)}</a>${status ? `<div>${status}</div>` : ""}</td>
        <td class="num">${m ? `<span class="freqbar" style="--w:${Math.round(share * 100)}%;--mh:${hue(o.modul)}"><i></i></span><b>${m.antal_tentor}</b>/${a.antal_tentor}` : `<span class="muted">0/${a.antal_tentor}</span>`}</td>
        <td class="num">${m ? `${m.fragor}${m.unika !== m.fragor ? ` <span class="muted small">(${m.unika} unika)</span>` : ""}` : "–"}</td>
        <td>${m ? esc(K[m.dominerande] || "") : "–"}${m?.osakra_kopplingar ? ` <span class="chip warn" title="${m.osakra_kopplingar} automatiska kopplingar bör granskas">granska</span>` : ""}</td>
        <td>${need}</td>
        <td>${m ? `<a class="small" href="#/bibliotek/${encodeURIComponent(o.id)}?fraga=${encodeURIComponent(m.exempel[0] || "")}">Se frågor →</a>` : ""}</td></tr>`;
    })
    .join("");

  root.innerHTML = `<section class="ana">
    <header class="ana-head">
      <p class="welcome-kicker">Basvetenskap 5 · Träna inför tentan</p>
      <h1>Tidigare tentor</h1>
      <p class="lead">Vilka lärandemål har examinerats, hur ofta, och vilken kunskapshandling krävdes? Siffrorna räknas fram ur de inlagda tentorna och uppdateras när en ny tenta importeras.</p>
      <div class="tabs" role="tablist">
        <a role="tab" href="#/tidigare-tentor?del=1" aria-selected="${del === 1}">Del 1</a>
        <a role="tab" href="#/tidigare-tentor?del=2" aria-selected="${del === 2}">Del 2</a>
      </div>
    </header>
    <div class="ana-cards">
      <div class="ana-card"><b>${a.antal_tentor}</b><span>jämförbara tentor · ${esc(a.period)}</span></div>
      <div class="ana-card"><b>${a.fragor}</b><span>frågor · ${a.dubbletter} återanvända · ${a.utan_mal} utan målkoppling</span></div>
      <div class="ana-card"><b>${examined}/${objs.length}</b><span>lärandemål${modFilter ? ` i modul ${modFilter}` : ""} har förekommit minst en gång</span></div>
    </div>
    <div class="ana-dims">
      <div><h3>1 · Vad kursen kräver</h3><p>Alla ${objs.length} lärandemål i listan ingår i kursen – även de som sällan eller aldrig förekommit på tentorna.</p></div>
      <div><h3>2 · Hur tentorna examinerat</h3><p>Förekomst räknas som antal <i>separata</i> tentor där målet fanns med, av ${a.antal_tentor} (${esc(a.period)}). Kunskapshandling totalt: ${kDist}</p></div>
      <div><h3>3 · Vad du behöver repetera</h3><p>Hämtas ur dina egna tentaförsök (felbanken) och dina quiz i biblioteket – kolumnen <i>Mitt läge</i>.</p></div>
    </div>
    <div class="ana-filter">${[`<a href="#/tidigare-tentor?del=${del}" class="${modFilter ? "" : "on"}">Alla moduler</a>`, ...mods.map((n) => `<a href="#/tidigare-tentor?del=${del}&modul=${n}" class="${modFilter === n ? "on" : ""}" style="--mh:${hue(n)}">Modul ${n} · ${esc(M.modules.get(n)?.titel || "")}</a>`)].join("")}</div>
    <div class="ana-table-wrap"><table class="ana-table">
      <thead><tr><th>Lärandemål</th><th>Förekomst</th><th>Frågor</th><th>Krävs oftast</th><th>Mitt läge</th><th></th></tr></thead>
      <tbody>${tableRows}</tbody></table></div>
    ${ev ? `<section class="ana-eval"><h2>Hur säker är analysen?</h2>
      <p>Metoden testas genom att hålla undan den senaste tentan (<b>${esc(ev.undanhallen.replace(/^Del 2 /, ""))}</b>), analysera de ${ev.tidigare.length} tidigare och sedan kontrollera mot den undanhållna. Mål som förekom på minst hälften av de tidigare tentorna räknades som återkommande (${ev.forutsagda_mal} mål).</p>
      <div class="ana-cards">
        <div class="ana-card"><b>${Math.round(ev.andel_fangade * 100)} %</b><span>av frågorna på den undanhållna tentan (${ev.fragor_pa_forutsagda_mal} av ${ev.fragor_pa_undanhallen}) gällde återkommande mål</span></div>
        <div class="ana-card"><b>${Math.round(ev.precision * 100)} %</b><span>av de återkommande målen (${ev.forutsagda_som_kom} av ${ev.forutsagda_mal}) kom också på den undanhållna tentan</span></div>
        <div class="ana-card"><b>${ev.nya_mal.length}</b><span>mål på den undanhållna tentan hade aldrig förekommit tidigare</span></div>
      </div>
      <p class="small muted">Slutsats: historiken pekar ut kärnområden med rimlig säkerhet, men ungefär var tredje fråga gällde mål utanför de återkommande. Läs därför hela kursen och använd frekvensen för prioritering, inte för att välja bort mål. Analysen bygger på automatiska målkopplingar; rader märkta <i>granska</i> innehåller kopplingar med låg säkerhet.</p>
    </section>` : ""}
    <section class="ana-import"><h2>Importkontroll</h2>
      <p class="small muted">Varje tenta jämförs med originalets frågenummer. Upprepad import ersätter samma frågor (stabila id:n), så inget räknas dubbelt och gamla försök finns kvar.</p>
      <ul>${imp
        .map((r) => {
          const bad = new Set([...(r.saknar_facit || []), ...(r.essa_utan_svarsforslag || []), ...(r.saknar_bild || [])]);
          const notes = [
            r.saknade_nummer.length && `saknar nr ${r.saknade_nummer.join(", ")}`,
            r.saknar_facit.length && `${r.saknar_facit.length} utan verifierat facit (nr ${r.saknar_facit.join(", ")})`,
            r.essa_utan_svarsforslag?.length && `${r.essa_utan_svarsforslag.length} essäer utan officiellt svarsförslag`,
            r.saknar_bild?.length && `${r.saknar_bild.length} frågor har bild i originalet som inte extraherats (nr ${r.saknar_bild.join(", ")})`,
            r.utan_larandemal && `${r.utan_larandemal} utan lärandemålskoppling`,
          ].filter(Boolean);
          return `<li><b>${esc(r.tenta.replace(/^Del 2 /, ""))}</b>: ${r.importerat - bad.size} av ${r.forvantat} frågor kompletta${notes.length ? `; ${esc(notes.join("; "))}` : ""}</li>`;
        })
        .join("")}</ul>
      <p class="small muted">${esc(M.ta.metod || "")}</p>
    </section>
  </section>`;
  if (focus) setTimeout(() => document.getElementById(`row-${focus}`)?.scrollIntoView({ block: "center" }), 50);
  return on(root, "click", "[data-noop]", () => {});
}
