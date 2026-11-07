# BV5 Tentasimulator & Studieplattform

Tentasimulator för Basvetenskap 5 på läkarprogrammet. Appen innehåller 16 gamla tentor (HT22–VT26) med 2 276 frågor från [Lärandemålsbiblioteket](https://ybgdon7.github.io/bibliotek/), och du kan importera fler tentor från PDF. Den har en tentamenssimulator med 🟨/🟥-markering och resultatanalys med länkar till lärandemålen. "Öva på dina fel" och Anki-export (.apkg och TSV) ingår, och appen kan installeras på datorn med offlinestöd.

Appen fungerar i två lägen:

| Läge | När | Vad som krävs |
| --- | --- | --- |
| **Lokalt läge** | Du pluggar själv | Bara en webbserver eller GitHub Pages. All data sparas på datorn. Du är superadmin. |
| **Molnläge** | Andra ska ansöka om åtkomst, och data ska synkas mellan enheter | Ett gratis Supabase-projekt (se avsnittet *Supabase*). |

Appen har inget byggsteg och behöver ingen `npm install`. Allt som behövs ligger i mappen.

---

## 1. Starta på din Mac (lokalt)

Service workern och installationen kräver att appen öppnas via `http://localhost` eller `https://`. Den fungerar inte som `file://`.

1. Öppna **Terminal** och gå till mappen:
   ```bash
   cd ~/Downloads/"Claude + tenta optimizer"/bv5-tentasimulator
   ```
2. Starta en webbserver. Python 3 finns på macOS (första gången kan macOS be dig installera "Command Line Tools", godkänn det):
   ```bash
   python3 -m http.server 8080
   ```
3. Öppna **http://localhost:8080** i Chrome eller Edge.
4. Klicka på **"⬇ Ladda ner appen till datorn"** uppe till höger och sedan **Installera**. Appen får en egen ikon i Launchpad/Dock och fungerar offline.
   - I Safari väljer du *Arkiv → Lägg till i Dock* (macOS Sonoma eller senare).
5. Stoppa servern med `Ctrl + C`. Den installerade appen fungerar ändå offline. Starta servern igen när du vill hämta uppdateringar.

## 2. Publicera på GitHub Pages (rekommenderas)

Med GitHub Pages får appen en fast `https`-adress som fungerar på alla dina enheter. Det är samma tjänst som kursbiblioteket redan ligger på.

1. Skapa ett nytt repo på GitHub, t.ex. `bv5-tenta`.
2. Ladda upp **allt innehåll** i mappen `bv5-tentasimulator` (dra in filerna under *Add file → Upload files*, eller använd `git push`).
3. Gå till *Settings → Pages*, välj *Deploy from a branch* och sedan `main` och `/ (root)`. Spara.
4. Efter någon minut ligger appen på `https://<ditt-användarnamn>.github.io/bv5-tenta/`.
5. Gör sedan steg 4 i avsnitt 1 för att installera appen.

> Frågebanken ligger i `data/fragebank-seed.json`, och allt på GitHub Pages är publikt. Innehållet är detsamma som i det publika kursbiblioteket. Molnlägets åtkomstkontroll skyddar konton, resultat och importerade tentor, men inte filerna på själva webbplatsen.

## 3. Supabase (molnläge: konton, ansökningar och synk)

Gör detta en gång. Det tar ungefär 20 minuter.

### 3.1 Skapa projekt och databas
1. Skapa ett gratis konto på [supabase.com](https://supabase.com) och ett nytt projekt (region: *Stockholm/Frankfurt*).
2. Öppna **SQL Editor**, klistra in hela `supabase/migrations/0001_schema.sql` och klicka *Run*. Skriptet skapar 18 tabeller, alla RLS-regler, funktionerna och utgångsjobbet var 15:e minut.
   - Får du ett felmeddelande om `pg_cron`: aktivera tillägget under *Database → Extensions → pg_cron* och kör sedan
     `select cron.schedule('expire-access', '*/15 * * * *', 'select public.expire_access()');`
   - Superadmin är förinställd till `abodi.ki.study@gmail.com`. Vill du ändra den, kör
     `update app_settings set value = '"ny@adress.se"' where key = 'super_admin_email';`

### 3.2 Inloggning
Under **Authentication → Sign In / Providers → Email**:
- **Enable Email provider**: på.
- **Allow new users to sign up**: **av**. Bara godkända kan logga in.
- **Confirm email**: på.

Under **Authentication → URL Configuration**:
- **Site URL**: appens adress, t.ex. `https://<användarnamn>.github.io/bv5-tenta/`.
- **Redirect URLs**: samma adress, plus `http://localhost:8080/` om du även kör lokalt.

### 3.3 E-post via Gmail
Supabase inbyggda e-post är bara till för test och har ett lågt tak. Använd ditt Gmail:
1. Slå på tvåstegsverifiering på Google-kontot och skapa ett **app-lösenord** på [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords).
2. Gå till **Authentication → Emails → SMTP Settings** och aktivera *Custom SMTP*:
   - Host `smtp.gmail.com`, Port `465`, Username `abodi.ki.study@gmail.com`, Password = app-lösenordet.
   - Sender email `abodi.ki.study@gmail.com`, Sender name `BV5 Tentasimulator`.
3. Gå till **Authentication → Emails → Templates**:
   - *Invite user*: ämne "Din åtkomst till BV5 Tentasimulator är godkänd", innehåll från `supabase/email-templates/invite.html`.
   - *Magic Link*: ämne "Din inloggningslänk till BV5 Tentasimulator", innehåll från `supabase/email-templates/magic-link.html`.

Gmail tillåter ungefär 500 mejl per dygn, vilket räcker gott för en termin.

### 3.4 Edge Functions
**Edge Functions → Deploy a new function → Via Editor**:
1. Namn `approve-application`. Klistra in `supabase/functions/approve-application/index.ts` och klicka *Deploy*.
2. *(Valfritt, AI-bedömning av fritext)* Namn `ai-grade`, innehåll från `supabase/functions/ai-grade/index.ts`.

Lägg till följande under **Edge Functions → Secrets**:
- `SITE_URL` = appens adress (samma som Site URL).
- `ANTHROPIC_API_KEY` = din API-nyckel. Behövs bara för `ai-grade`. Sätt också `AI_GRADING: true` i `config.js`.

### 3.5 Koppla appen
1. Kopiera *Project URL* och *anon public key* från **Project Settings → API**.
2. Fyll i `config.js`:
   ```js
   SUPABASE_URL: "https://xxxx.supabase.co",
   SUPABASE_ANON_KEY: "eyJ…",
   ```
   Anon-nyckeln får ligga i webbläsaren. Lägg aldrig `service_role`-nyckeln i appen.
3. Skapa ditt eget konto: **Authentication → Users → Add user → Send invitation** till `abodi.ki.study@gmail.com`. Klicka på länken i mejlet. Du blir automatiskt superadmin med livstidsåtkomst.
4. I appen: gå till **Admin → Tentor → "Publicera frågebanken till molnet"**. Det behövs en gång, så att studenternas svar kan synkas.
5. Gå till **Admin → Delningslänkar → Skapa länk** och dela länken med kurskamraterna.

### 3.6 Så fungerar åtkomsten
1. Besökaren öppnar delningslänken och fyller i förnamn, efternamn, termin och e-post.
2. Du ser ansökan under **Admin → Ansökningar**. Där väljer du **Godkänn** och giltighetstid (30 dagar, 90 dagar, hela terminen eller ett slutdatum), eller **Neka**.
3. Ett bekräftelsemejl skickas automatiskt med inloggningslänk och slutdatum.
4. När tiden har gått ut spärrar databasen kontot direkt i varje anrop. Studenten ser då slutdatumet och kan be om förlängning.
5. Under **Admin → Användare** kan du när som helst pausa, återuppta, förlänga eller återkalla åtkomst, och göra någon till admin.

"Hela terminen" betyder till och med 18 januari (HT) respektive 30 juni (VT). Datumen ändrar du i tabellen `app_settings` (`term_end_dates`).

---

## 4. Använda appen

| Del | Var | Viktigt att veta |
| --- | --- | --- |
| Tentamen | *Tentor → Starta tenta* | Riktig tidsgräns: 225 min för 135 frågor och 240 min för 150. Klockan står still när appen är stängd. |
| Kortkommandon | I simulatorn | `←` `→` byt fråga · `1`–`9` välj svar · `F` 🟨 osäker · `K` 🟥 kan ej · `?` hjälp |
| Autospar | Alltid | Varje val sparas inom 0,3 s och när fliken stängs. Tiden loggas per fråga. |
| Resultat | Efter inlämning | Poäng, gräns, tid, moduler och metakognition. Varje fel visas med förklaring och länk till lärandemålet. |
| Öva på dina fel | Menyn | Fel, 🟨 och 🟥 samlas automatiskt. En fråga blir *Bemästrad* efter 3 rätt i rad utan flagga (inställbart). Obesvarade frågor utan flagga räknas inte. |
| Eget quiz | *Tentor → Eget quiz* | Välj moduler, antal frågor och tidsgräns ur hela banken. |
| Anki | Resultat eller Öva på dina fel | **.apkg**: dubbelklicka för att öppna i Anki. Korten är interaktiva: klicka på ett alternativ (bokstaven visas i lila) och tryck på mellanslag för att svara – ditt svar blir rött om det är fel och rätt svar grönt, utan att något flyttar sig, med förklaring, lärandemål och källa under. Bilder följer med, och en ny export uppdaterar befintliga kort. **TSV**: *Arkiv → Importera* i Anki (vanliga fram-/baksidekort). |
| Import | *Importera* (admin) | Inspera-PDF "med svar" läses helt automatiskt, med facit från den gröna bocken. Inskannade sidor tolkas med OCR. Granska i förhandsvisningen och publicera sedan. |
| Diagnostik | *Admin → Systemdiagnostik* | Testar PDF-tolken, rättningen, bibliotekslänkarna, Anki-exporten och databaserna med en demotenta. |

## 5. Underhåll

- **Kursbiblioteket har uppdaterats:** kör `node scripts/index-bibliotek.mjs`. Det kräver [Node.js](https://nodejs.org) och nätverk. Kör sedan `node scripts/release.mjs` och ladda upp `data/` och `sw.js` igen.
- **Efter kodändringar:** kör `node scripts/release.mjs`. Det ger service workern en ny version, så att installerade appar hämtar de nya filerna.
- **Appen visar en gammal version:** öppna `reset.html` (t.ex. `http://localhost:8080/reset.html`). Sidan tömmer appens sparade filer och öppnar den senaste versionen. Tentor, svar och "Öva på dina fel" ligger kvar.
- **Tester:**
  - `node --test tests/core.test.mjs`: kärnlogiken, 17 tester.
  - `supabase/tests/`: databasreglerna, 28 tester, körs mot Postgres.
  - Systemdiagnostiken i appen.
- **Säkerhetskopia (lokalt läge):** *Admin → Inställningar → Exportera säkerhetskopia*.

## 6. Mappstruktur

```text
index.html · config.js · manifest.webmanifest · sw.js
src/
  app.js              router, skal, installation, synk
  core/               rättning, Bemästrad-regler, bibliotek/taggning, quiz, text
  data/               IndexedDB och lokalt datalager
  cloud/              Supabase-klient, inloggning, synk
  pdf/                PDF.js-utvinning, Inspera-tolk, importflöde
  anki/               zip, kortinnehåll, .apkg/TSV
  views/              alla sidor
  diagnostics.js      systemdiagnostik
data/                 frågebank, biblioteksindex, figurer, demotenta
vendor/               PDF.js 3.11.174 och sql.js (licenser i vendor/LICENSES.md)
supabase/             migration, Edge Functions, e-postmallar, SQL-tester
scripts/              index-bibliotek.mjs, release.mjs
tests/                enhetstester
```
