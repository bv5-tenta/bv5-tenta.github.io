/*
 * Inloggning och behörighet.
 * - Lokalt läge (inget Supabase konfigurerat): appens ägare är superadmin på den här datorn.
 * - Molnläge: profilen i Supabase avgör roll och giltighetstid; databasen spärrar i RLS oavsett klient.
 */

export class Auth {
  constructor(cloud, config) {
    this.cloud = cloud;
    this.config = config;
    this.profile = null;
    this.error = null;
  }

  get mode() {
    return this.cloud.enabled ? "cloud" : "local";
  }

  async init() {
    if (!this.cloud.enabled) {
      this.profile = {
        id: "local", email: this.config.SUPER_ADMIN_EMAIL || "", first_name: "", last_name: "",
        role: "superadmin", access_status: "active", access_expires_at: null, local: true,
      };
      return this.profile;
    }
    try {
      await this.cloud.consumeRedirect();
    } catch (err) {
      this.error = err.message;
    }
    if (!this.cloud.token) return null;
    return this.refreshProfile();
  }

  async refreshProfile() {
    try {
      await this.cloud.ensureFresh();
      if (!this.cloud.token) {
        this.profile = null;
        return null;
      }
      if (!this.cloud.session.user) {
        const user = await this.cloud.getUser();
        this.cloud.setSession({ ...this.cloud.session, user });
      }
      const rows = await this.cloud.select("profiles", `id=eq.${this.cloud.userId}&select=*`);
      this.profile = rows[0] || {
        id: this.cloud.userId, email: this.cloud.email, role: "student", access_status: "pending", access_expires_at: null,
      };
      // Cacha senaste kända profil så att appen öppnar offline.
      try {
        localStorage.setItem("bv5.profile", JSON.stringify(this.profile));
      } catch {
        /* inget */
      }
    } catch (err) {
      if (err.code === "network") {
        try {
          this.profile = JSON.parse(localStorage.getItem("bv5.profile") || "null");
        } catch {
          this.profile = null;
        }
        this.offline = true;
      } else if (err.status === 401) {
        this.cloud.setSession(null);
        this.profile = null;
      } else {
        this.error = err.message;
      }
    }
    return this.profile;
  }

  isSuperadmin() {
    return this.profile?.role === "superadmin";
  }
  isAdmin() {
    return this.profile?.role === "admin" || this.isSuperadmin();
  }

  /** Samma regel som has_access() i databasen. */
  hasAccess(now = Date.now()) {
    const p = this.profile;
    if (!p) return false;
    if (p.role === "superadmin") return true;
    if (p.access_status !== "active") return false;
    return !p.access_expires_at || new Date(p.access_expires_at).getTime() > now;
  }

  /** 'local' | 'anon' | 'active' | 'pending' | 'expired' | 'paused' | 'revoked' */
  status() {
    if (this.mode === "local") return "local";
    const p = this.profile;
    if (!p) return "anon";
    if (this.hasAccess()) return "active";
    if (p.access_status === "active" && p.access_expires_at && new Date(p.access_expires_at).getTime() <= Date.now()) return "expired";
    return p.access_status || "pending";
  }

  displayName() {
    const p = this.profile;
    if (!p) return "";
    const n = `${p.first_name || ""} ${p.last_name || ""}`.trim();
    return n || p.email || "";
  }

  async signOut() {
    await this.cloud.signOut();
    this.profile = null;
    try {
      localStorage.removeItem("bv5.profile");
    } catch {
      /* inget */
    }
  }
}
