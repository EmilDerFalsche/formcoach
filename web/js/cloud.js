// Konten (Supabase Auth) + Trainingsverlauf mit Offline-Warteschlange.
//
// - Nicht angemeldet: Sätze werden nur lokal im Browser gespeichert.
// - Angemeldet: Sätze gehen in die Warteschlange und werden hochgeladen, sobald Netz da ist.
//   Jeder Satz hat eine client_id -> erneutes Hochladen erzeugt keine Duplikate.
// - Beim Anmelden werden lokal gespeicherte Sätze ins Konto übernommen.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
const K = {
  pending: "formcoach.pending",       // [{owner, row}]
  cache: "formcoach.cloudCache",      // {owner, items}
  local: "formcoach.localWorkouts",   // [row] (ohne Konto)
  legacy: "formcoach.history",        // alter Verlauf (nur Zusammenfassung)
};
const LOCAL_MAX = 50;
const COLUMNS = ["client_id", "performed_at", "exercise", "mode", "view", "rep_count", "avg_score", "top_issue", "reps", "trace"];
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

const store = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const appUrl = () => location.origin + location.pathname;

const ERRORS = [
  [/invalid login credentials/i, "E-Mail oder Passwort ist falsch."],
  [/email not confirmed/i, "Bitte bestätige zuerst deine E-Mail-Adresse (Link im Postfach)."],
  [/already registered|already been registered|user already exists/i, "Für diese E-Mail-Adresse gibt es schon ein Konto."],
  [/password should be at least|weak password|password is too short/i, "Das Passwort ist zu kurz (mindestens 8 Zeichen)."],
  [/rate limit|for security purposes|too many/i, "Zu viele Versuche – bitte einen Moment warten."],
  [/invalid email|unable to validate email|email address .* is invalid/i, "Bitte gib eine gültige E-Mail-Adresse ein."],
  [/failed to fetch|network|load failed/i, "Keine Verbindung zum Server. Bist du online?"],
  [/same password|different from the old/i, "Das neue Passwort muss sich vom alten unterscheiden."],
];
export function germanError(e) {
  if (!e) return null;
  const msg = e.message || String(e);
  for (const [re, de] of ERRORS) if (re.test(msg)) return de;
  return msg;
}

export class Cloud {
  /** @param {{createClient?: Function, url?: string, key?: string}} [o] createClient nur für Tests */
  constructor(o = {}) {
    this.url = o.url ?? SUPABASE_URL;
    this.key = o.key ?? SUPABASE_ANON_KEY;
    this._createClient = o.createClient;
    this.enabled = Boolean(this.url && this.key);
    this.user = null;
    this.recovery = false; // true nach Klick auf "Passwort zurücksetzen"-Link
    this.ready = false;
    this._listeners = new Set();
    this._loginHandledFor = null;
  }

  onChange(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
  _emit(type, info) { this._listeners.forEach((fn) => { try { fn(type, info); } catch (e) { console.error(e); } }); }

  async init() {
    if (!this.enabled) { this.ready = true; return; }
    try {
      const create = this._createClient ?? (await import(SUPABASE_JS)).createClient;
      this.sb = create(this.url, this.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
      const { data } = await this.sb.auth.getSession();
      this.user = data?.session?.user ?? null;
      this.sb.auth.onAuthStateChange((event, session) => {
        this.user = session?.user ?? null;
        if (event === "PASSWORD_RECOVERY") this.recovery = true;
        // Keine weiteren Supabase-Aufrufe direkt im Callback (Empfehlung von Supabase) -> entkoppeln
        setTimeout(() => {
          if (this.user && this._loginHandledFor !== this.user.id) this._afterLogin();
          if (!this.user) this._loginHandledFor = null;
          this._emit("auth", event);
        }, 0);
      });
      if (this.user) await this._afterLogin();
      addEventListener("online", () => this.flush());
    } catch (e) {
      console.warn("Supabase nicht erreichbar – Konten vorübergehend offline.", e);
      this.offlineInit = true;
    }
    this.ready = true;
    this._emit("ready");
  }

  get loggedIn() { return Boolean(this.user); }

  // ---------- Auth ----------
  async signUp(email, password) {
    const { data, error } = await this.sb.auth.signUp({ email, password, options: { emailRedirectTo: appUrl() } });
    if (error) return { error: germanError(error) };
    // Supabase gibt bei bereits registrierter E-Mail (aus Datenschutzgründen) keinen Fehler,
    // sondern einen Nutzer ohne Identitäten zurück.
    if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      return { error: germanError({ message: "already registered" }) };
    }
    return { needsConfirmation: !data?.session };
  }

  async signIn(email, password) {
    const { error } = await this.sb.auth.signInWithPassword({ email, password });
    return { error: germanError(error) };
  }

  async resetPassword(email) {
    const { error } = await this.sb.auth.resetPasswordForEmail(email, { redirectTo: appUrl() });
    return { error: germanError(error) };
  }

  async updatePassword(password) {
    const { error } = await this.sb.auth.updateUser({ password });
    if (!error) this.recovery = false;
    return { error: germanError(error) };
  }

  async signOut() {
    await this.sb.auth.signOut({ scope: "local" });
    this.user = null;
    this._loginHandledFor = null;
    this._emit("auth", "SIGNED_OUT");
  }

  async deleteAccount() {
    const uid = this.user?.id;
    const { error } = await this.sb.rpc("delete_user");
    if (error) return { error: germanError(error) };
    store.set(K.pending, store.get(K.pending, []).filter((p) => p.owner !== uid));
    store.del(K.cache);
    await this.signOut();
    return {};
  }

  // ---------- Verlauf ----------
  /** Speichert einen Satz. @returns {'local'|'saved'|'queued'} */
  async saveWorkout(row) {
    if (!this.loggedIn) {
      const list = store.get(K.local, []);
      list.unshift(row);
      store.set(K.local, list.slice(0, LOCAL_MAX));
      return "local";
    }
    const pending = store.get(K.pending, []);
    pending.push({ owner: this.user.id, row });
    store.set(K.pending, pending);
    // sofort in den Cache, damit der Verlauf ihn direkt zeigt
    const cache = this._cache();
    cache.items = [row, ...cache.items.filter((i) => i.client_id !== row.client_id)];
    store.set(K.cache, cache);
    const ok = await this.flush();
    return ok && !this.pendingCount() ? "saved" : "queued";
  }

  pendingCount() {
    const uid = this.user?.id;
    return uid ? store.get(K.pending, []).filter((p) => p.owner === uid).length : 0;
  }

  /** Lädt wartende Sätze hoch. @returns {boolean} true, wenn alles hochgeladen ist */
  async flush() {
    if (!this.loggedIn || !this.sb) return false;
    if (this._flushing) return this._flushing;
    this._flushing = (async () => {
      const uid = this.user.id;
      const all = store.get(K.pending, []);
      const mine = all.filter((p) => p.owner === uid);
      if (!mine.length) return true;
      if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
      const rows = mine.map((p) => ({ ...pick(p.row, COLUMNS), user_id: uid }));
      const { error } = await this.sb.from("workouts").upsert(rows, { onConflict: "user_id,client_id", ignoreDuplicates: true });
      if (error) { console.warn("Sync fehlgeschlagen:", error.message); return false; }
      const done = new Set(mine.map((p) => p.row.client_id));
      store.set(K.pending, store.get(K.pending, []).filter((p) => !(p.owner === uid && done.has(p.row.client_id))));
      this._emit("synced", mine.length);
      return true;
    })();
    try { return await this._flushing; } finally { this._flushing = null; }
  }

  _cache() {
    const c = store.get(K.cache, null);
    return c && c.owner === this.user?.id ? c : { owner: this.user?.id, items: [] };
  }

  /** Verlauf: angemeldet aus der Cloud (mit Offline-Cache), sonst lokal. */
  async listWorkouts() {
    if (!this.loggedIn) {
      const legacy = store.get(K.legacy, []).map(legacyToRow);
      return { source: "local", items: [...store.get(K.local, []), ...legacy] };
    }
    const uid = this.user.id;
    const pendingIds = new Set(store.get(K.pending, []).filter((p) => p.owner === uid).map((p) => p.row.client_id));
    const { data, error } = await this.sb.from("workouts")
      .select("client_id, performed_at, mode, view, rep_count, avg_score, top_issue, reps, trace")
      .order("performed_at", { ascending: false })
      .limit(100);
    let items;
    if (error) {
      items = this._cache().items;
    } else {
      const pend = store.get(K.pending, []).filter((p) => p.owner === uid).map((p) => p.row);
      const ids = new Set(data.map((d) => d.client_id));
      items = [...pend.filter((r) => !ids.has(r.client_id)), ...data]
        .sort((a, b) => new Date(b.performed_at) - new Date(a.performed_at));
      store.set(K.cache, { owner: uid, items });
    }
    return { source: error ? "cache" : "cloud", items: items.map((i) => ({ ...i, pending: pendingIds.has(i.client_id) })) };
  }

  /** Nach dem Anmelden: lokale Sätze ins Konto übernehmen und hochladen. */
  async _afterLogin() {
    this._loginHandledFor = this.user.id;
    const local = store.get(K.local, []);
    const legacy = store.get(K.legacy, []).map(legacyToRow);
    const migrate = [...local, ...legacy];
    if (migrate.length) {
      const pending = store.get(K.pending, []);
      migrate.forEach((row) => pending.push({ owner: this.user.id, row }));
      store.set(K.pending, pending);
      store.del(K.local);
      store.del(K.legacy);
      this._emit("migrated", migrate.length);
    }
    await this.flush();
  }
}

/** Alter Verlauf (nur Zusammenfassung) -> Datenbankzeile ohne Wiederholungsdetails. */
function legacyToRow(e) {
  return {
    client_id: `legacy-${e.date}`,
    performed_at: e.date,
    exercise: "squat",
    mode: e.mode === "video" ? "video" : "live",
    view: e.view ?? null,
    rep_count: e.reps ?? 0,
    avg_score: e.score ?? null,
    top_issue: e.focusKey ?? null,
    top_issue_title: e.focus ?? null, // nur lokal zur Anzeige, wird nicht hochgeladen
    reps: [],
    trace: [],
  };
}
