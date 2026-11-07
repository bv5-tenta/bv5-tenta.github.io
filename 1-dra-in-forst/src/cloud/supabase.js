/*
 * Minimal Supabase-klient över fetch: Auth (magisk länk), PostgREST, RPC, Storage och Edge Functions.
 * Ingen extern kod behövs. Sessionen sparas i localStorage (med try/catch – appen fungerar utan).
 */

const SESSION_KEY = "bv5.session";

function readSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function writeSession(s) {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* privat läge: sessionen lever bara i minnet */
  }
}

export class CloudError extends Error {
  constructor(message, status, code, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const FRIENDLY = {
  "42501": "Du saknar behörighet för detta.",
  "23505": "Uppgiften finns redan.",
  "23503": "En kopplad post saknas i molnet.",
  "P0002": "Posten finns inte.",
  "22023": "Ogiltigt värde.",
};

export class Cloud {
  constructor(cfg) {
    this.url = String(cfg.SUPABASE_URL || "").replace(/\/+$/, "");
    this.key = cfg.SUPABASE_ANON_KEY || "";
    this.enabled = Boolean(this.url && this.key);
    this.session = this.enabled ? readSession() : null;
    this.memorySession = null;
  }

  /* ---------- session ---------- */
  get token() {
    return this.session?.access_token || null;
  }
  get userId() {
    return this.session?.user?.id || null;
  }
  get email() {
    return this.session?.user?.email || null;
  }

  setSession(s) {
    this.session = s;
    writeSession(s);
  }

  /** Läser token ur adressen efter att användaren klickat på den magiska länken. */
  async consumeRedirect() {
    if (!this.enabled) return false;
    const h = location.hash.startsWith("#") ? location.hash.slice(1) : "";
    if (!/access_token=|error_description=/.test(h)) return false;
    const p = new URLSearchParams(h.replace(/^\//, ""));
    history.replaceState(null, "", `${location.pathname}${location.search}#/`);
    if (p.get("error_description")) {
      throw new CloudError(decodeURIComponent(p.get("error_description")).replace(/\+/g, " "), 401, p.get("error_code"));
    }
    const session = {
      access_token: p.get("access_token"),
      refresh_token: p.get("refresh_token"),
      expires_at: Math.floor(Date.now() / 1000) + Number(p.get("expires_in") || 3600),
      user: null,
    };
    this.setSession(session);
    session.user = await this.getUser();
    this.setSession(session);
    return true;
  }

  async ensureFresh() {
    if (!this.session) return;
    const left = (this.session.expires_at || 0) - Math.floor(Date.now() / 1000);
    if (left > 90) return;
    if (!this.session.refresh_token) {
      this.setSession(null);
      return;
    }
    try {
      const data = await this.raw("/auth/v1/token?grant_type=refresh_token", {
        method: "POST", body: { refresh_token: this.session.refresh_token }, auth: false,
      });
      this.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: data.expires_at || Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600),
        user: data.user || this.session.user,
      });
    } catch (err) {
      if (err.status === 400 || err.status === 401) this.setSession(null);
      else throw err;
    }
  }

  /* ---------- transport ---------- */
  async raw(path, { method = "GET", body, auth = true, headers = {}, raw = false } = {}) {
    if (!this.enabled) throw new CloudError("Molnet är inte konfigurerat", 0, "offline");
    const h = { apikey: this.key, ...headers };
    if (auth && this.token) h.Authorization = `Bearer ${this.token}`;
    else h.Authorization = `Bearer ${this.key}`;
    let payload = body;
    if (body !== undefined && !(body instanceof Blob) && !(body instanceof ArrayBuffer) && !(body instanceof Uint8Array)) {
      h["Content-Type"] = h["Content-Type"] || "application/json";
      payload = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(`${this.url}${path}`, { method, headers: h, body: payload });
    } catch (err) {
      throw new CloudError("Ingen kontakt med servern. Kontrollera nätverket.", 0, "network", err.message);
    }
    if (raw) return res;
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      const code = data?.code || data?.error_code || String(res.status);
      const msg = data?.message || data?.msg || data?.error_description || data?.error || `HTTP ${res.status}`;
      throw new CloudError(FRIENDLY[code] && !/[åäö]/i.test(msg) ? `${FRIENDLY[code]} (${msg})` : msg, res.status, code, data?.details || data?.hint);
    }
    return data;
  }

  async request(path, opts = {}) {
    if (opts.auth !== false) await this.ensureFresh();
    return this.raw(path, opts);
  }

  /* ---------- Auth ---------- */
  async sendMagicLink(email, redirectTo) {
    const q = redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : "";
    return this.raw(`/auth/v1/otp${q}`, { method: "POST", body: { email, create_user: false }, auth: false });
  }

  async getUser() {
    return this.raw("/auth/v1/user");
  }

  async signOut() {
    try {
      if (this.token) await this.raw("/auth/v1/logout", { method: "POST" });
    } catch {
      /* utloggning lokalt räcker */
    }
    this.setSession(null);
  }

  /* ---------- PostgREST ---------- */
  select(table, query = "") {
    return this.request(`/rest/v1/${table}${query ? `?${query}` : ""}`);
  }
  insert(table, rows, { returning = "representation" } = {}) {
    return this.request(`/rest/v1/${table}`, { method: "POST", body: rows, headers: { Prefer: `return=${returning}` } });
  }
  upsert(table, rows, onConflict, { returning = "minimal" } = {}) {
    const q = onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : "";
    return this.request(`/rest/v1/${table}${q}`, {
      method: "POST", body: rows, headers: { Prefer: `resolution=merge-duplicates,return=${returning}` },
    });
  }
  update(table, filter, patch) {
    return this.request(`/rest/v1/${table}?${filter}`, { method: "PATCH", body: patch, headers: { Prefer: "return=representation" } });
  }
  remove(table, filter) {
    return this.request(`/rest/v1/${table}?${filter}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  }
  rpc(name, args = {}, { auth = true } = {}) {
    return this.request(`/rest/v1/rpc/${name}`, { method: "POST", body: args, auth });
  }

  /* ---------- Edge Functions ---------- */
  fn(name, body) {
    return this.request(`/functions/v1/${name}`, { method: "POST", body });
  }

  /* ---------- Storage ---------- */
  async upload(bucket, path, blob, contentType) {
    return this.request(`/storage/v1/object/${bucket}/${path}`, {
      method: "POST", body: blob, headers: { "Content-Type": contentType || blob.type || "application/octet-stream", "x-upsert": "true" },
    });
  }
  async download(bucket, path) {
    const res = await this.request(`/storage/v1/object/authenticated/${bucket}/${path}`, { raw: true });
    if (!res.ok) throw new CloudError(`Kunde inte hämta ${path}`, res.status, String(res.status));
    return res.blob();
  }
}
