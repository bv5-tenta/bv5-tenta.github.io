/* Inloggning (magisk länk), ansökan via delningslänk och statussidor för konton utan åtkomst. */

import { esc, toast, setTitle } from "../ui/dom.js";
import { formatDate } from "../core/text.js";

const APP_URL = () => `${location.origin}${location.pathname}`;

export function loginView(ctx, root) {
  setTitle("Logga in");
  root.innerHTML = `<div class="center-page"><div class="card">
    <div class="brand" style="margin-bottom:18px"><span class="brand-mark">BV5</span><span>BV5 Tentasimulator<small>Läkarprogrammet · KI</small></span></div>
    <h1 style="font-size:24px">Logga in</h1>
    <p class="muted">Ange e-postadressen du ansökte med. Du får en inloggningslänk – inget lösenord behövs.</p>
    ${ctx.auth.error ? `<div class="notice err" style="margin-bottom:12px">${esc(ctx.auth.error)}</div>` : ""}
    <form id="login">
      <div class="field"><label for="email">E-post</label><input type="email" id="email" required autocomplete="email" placeholder="namn@stud.ki.se"></div>
      <button class="btn primary" style="width:100%">Skicka inloggningslänk</button>
    </form>
    <div id="sent" hidden class="notice ok" style="margin-top:14px"></div>
    <form id="code-form" hidden style="margin-top:14px">
      <div class="field"><label for="code">Kod från mejlet</label><input type="text" id="code" required inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,12}" maxlength="12" placeholder="123456"></div>
      <button class="btn primary" style="width:100%">Logga in med koden</button>
    </form>
    <p class="small muted" style="margin-top:18px">Har du inget konto? Använd delningslänken du fått för att ansöka om åtkomst.</p>
  </div></div>`;
  let sentTo = "";
  root.querySelector("#code-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button");
    const code = root.querySelector("#code").value.replace(/\s+/g, "");
    btn.disabled = true;
    btn.textContent = "Loggar in …";
    try {
      await ctx.cloud.verifyEmailCode(sentTo, code);
      ctx.auth.error = null;
      await ctx.auth.refreshProfile();
      if (ctx.auth.hasAccess()) ctx.sync?.flush();
      ctx.go("#/");
      ctx.render();
    } catch (err) {
      toast(/expired|invalid|otp/i.test(`${err.code} ${err.message}`)
        ? "Koden är fel eller har gått ut. Begär en ny kod och försök igen."
        : err.message, "err", 8000);
      btn.disabled = false;
      btn.textContent = "Logga in med koden";
    }
  });
  root.querySelector("#login").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button");
    const email = root.querySelector("#email").value.trim().toLowerCase();
    btn.disabled = true;
    btn.textContent = "Skickar …";
    try {
      await ctx.cloud.sendMagicLink(email, APP_URL());
      sentTo = email;
      const s = root.querySelector("#sent");
      s.hidden = false;
      s.innerHTML = `Klart! Vi har mejlat <b>${esc(email)}</b>. Klicka på länken i mejlet, <b>eller</b> skriv in koden från mejlet här nedanför. Det fungerar även i den installerade appen. Koden gäller i en timme.`;
      root.querySelector("#code-form").hidden = false;
      root.querySelector("#code").focus();
    } catch (err) {
      const msg = /signups not allowed|user not found|not allowed for otp/i.test(err.message)
        ? "Det finns inget godkänt konto för den adressen. Ansök via delningslänken eller kontakta administratören."
        : err.message;
      toast(msg, "err", 8000);
    }
    btn.disabled = false;
    btn.textContent = "Skicka inloggningslänk";
  });
}

export function applyView(ctx, root, params) {
  setTitle("Ansök om åtkomst");
  const code = params.code || "";
  if (!ctx.cloud.enabled) {
    root.innerHTML = `<div class="center-page"><div class="card"><h1 style="font-size:24px">Ansökan är inte aktiverad</h1><p class="muted">Appen körs i lokalt läge utan konton.</p><a class="btn" href="#/">Till startsidan</a></div></div>`;
    return;
  }
  root.innerHTML = `<div class="center-page"><div class="card">
    <div class="brand" style="margin-bottom:18px"><span class="brand-mark">BV5</span><span>BV5 Tentasimulator<small>Tentaträning för Basvetenskap 5</small></span></div>
    <h1 style="font-size:24px">Ansök om åtkomst</h1>
    <p class="muted">Fyll i dina uppgifter. När ansökan är godkänd får du ett mejl med inloggningslänk och hur länge åtkomsten gäller.</p>
    <form id="apply">
      <div class="field-row">
        <div class="field"><label for="fn">Förnamn</label><input type="text" id="fn" required maxlength="80" autocomplete="given-name"></div>
        <div class="field"><label for="ln">Efternamn</label><input type="text" id="ln" required maxlength="80" autocomplete="family-name"></div>
      </div>
      <div class="field"><label for="term">Termin</label><input type="text" id="term" required maxlength="40" placeholder="T.ex. T3 HT26"></div>
      <div class="field"><label for="em">E-postadress</label><input type="email" id="em" required autocomplete="email"></div>
      <button class="btn primary" style="width:100%">Skicka ansökan</button>
    </form>
    <div id="done" hidden></div>
  </div></div>`;
  root.querySelector("#apply").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button");
    btn.disabled = true;
    try {
      await ctx.cloud.rpc("submit_application", {
        p_first_name: root.querySelector("#fn").value.trim(),
        p_last_name: root.querySelector("#ln").value.trim(),
        p_termin: root.querySelector("#term").value.trim(),
        p_email: root.querySelector("#em").value.trim(),
        p_share_code: code,
      }, { auth: false });
      e.target.hidden = true;
      const d = root.querySelector("#done");
      d.hidden = false;
      d.innerHTML = `<div class="notice ok"><b>Tack, ansökan är skickad!</b><br>Du får ett mejl när den har behandlats.</div>`;
    } catch (err) {
      toast(err.message, "err", 8000);
      btn.disabled = false;
    }
  });
}

export function statusView(ctx, root) {
  const st = ctx.auth.status();
  const p = ctx.auth.profile || {};
  setTitle("Åtkomst");
  const text = {
    pending: ["Ansökan behandlas", "Ditt konto är skapat men inte godkänt ännu. Du får ett mejl när administratören har godkänt det."],
    expired: ["Åtkomsten har löpt ut", `Din åtkomst gällde till och med ${formatDate(p.access_expires_at)}. Dina resultat och din träningsstatus finns kvar och blir tillgängliga igen när åtkomsten förlängs.`],
    paused: ["Åtkomsten är pausad", "Administratören har pausat ditt konto tillfälligt."],
    revoked: ["Åtkomsten är återkallad", "Kontakta administratören om du tror att det är fel."],
  }[st] || ["Ingen åtkomst", "Kontot saknar åtkomst."];
  root.innerHTML = `<div class="center-page"><div class="card">
    <h1 style="font-size:24px">${esc(text[0])}</h1>
    <p class="muted">${esc(text[1])}</p>
    <p class="small muted">Inloggad som ${esc(p.email || ctx.cloud.email || "")}.</p>
    <div class="btn-row" style="margin-top:16px">
      ${st === "expired" || st === "paused" ? `<button class="btn primary" data-act="renew">Ansök om förlängning</button>` : ""}
      <button class="btn" data-act="refresh">Kontrollera igen</button>
      <button class="btn ghost" data-act="logout">Logga ut</button>
    </div>
  </div></div>`;
  root.addEventListener("click", async (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (!act) return;
    if (act === "logout") {
      await ctx.auth.signOut();
      ctx.go("#/logga-in");
      ctx.render();
    } else if (act === "refresh") {
      await ctx.auth.refreshProfile();
      ctx.render();
    } else if (act === "renew") {
      try {
        await ctx.cloud.rpc("request_renewal");
        toast("Förfrågan är skickad till administratören.", "ok");
      } catch (err) {
        toast(err.message, "err", 7000);
      }
    }
  });
}
