/*
 * Konfiguration för BV5 Tentasimulator.
 *
 * Lämna SUPABASE_URL och SUPABASE_ANON_KEY tomma för LOKALT LÄGE: appen fungerar fullt ut på
 * den här datorn utan konton (du är superadmin). Fyll i dem för MOLNLÄGE med inloggning,
 * ansökningar, tidsbegränsad åtkomst och synk mellan enheter – se README, avsnitt "Supabase".
 *
 * Anon-nyckeln är avsedd att ligga i webbläsaren; det är databasens RLS-regler som skyddar datan.
 * Lägg aldrig service_role-nyckeln här.
 */
export const CONFIG = {
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
  SUPER_ADMIN_EMAIL: "abodi.ki.study@gmail.com",
  AI_GRADING: false,
  LIBRARY_URL: "https://ybgdon7.github.io/bibliotek/",
};
