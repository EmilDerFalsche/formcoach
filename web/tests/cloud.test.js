// Tests der Konto-/Sync-Logik gegen einen simulierten Supabase-Client (kein echter Server nötig).
import { Cloud } from "../js/cloud.js";

/** Minimaler Supabase-Mock: Auth + Tabelle "workouts" mit Unique(user_id, client_id). */
function mockSupabase() {
  const db = { users: new Map(), rows: [], online: true, session: null };
  let listener = () => {};
  const setSession = (user, event) => { db.session = user ? { user } : null; listener(event, db.session); };
  const err = (message) => ({ data: null, error: { message } });
  const query = () => {
    const q = {
      _rows: () => db.rows.filter((r) => r.user_id === db.session?.user.id),
      select() { return q; }, order() { return q; },
      limit(n) {
        if (!db.online) return Promise.resolve(err("Failed to fetch"));
        return Promise.resolve({ data: q._rows().slice().sort((a, b) => b.performed_at.localeCompare(a.performed_at)).slice(0, n), error: null });
      },
      upsert(rows) {
        if (!db.online) return Promise.resolve(err("Failed to fetch"));
        for (const r of rows) {
          if (r.user_id !== db.session?.user.id) return Promise.resolve(err("RLS violation"));
          const allowed = ["client_id", "performed_at", "exercise", "mode", "view", "rep_count", "avg_score", "top_issue", "reps", "trace", "user_id"];
          const bad = Object.keys(r).find((k) => !allowed.includes(k));
          if (bad) return Promise.resolve(err(`column "${bad}" does not exist`));
          if (!db.rows.some((x) => x.user_id === r.user_id && x.client_id === r.client_id)) db.rows.push({ ...r });
        }
        return Promise.resolve({ data: null, error: null });
      },
    };
    return q;
  };
  const client = {
    auth: {
      getSession: async () => ({ data: { session: db.session } }),
      onAuthStateChange: (fn) => { listener = fn; return { data: { subscription: { unsubscribe() {} } } }; },
      signUp: async ({ email, password }) => {
        if (db.users.has(email)) return { data: { user: { id: "x", identities: [] }, session: null }, error: null };
        db.users.set(email, { id: `u-${db.users.size + 1}`, email, password, confirmed: false });
        return { data: { user: { id: db.users.get(email).id, identities: [{}] }, session: null }, error: null };
      },
      signInWithPassword: async ({ email, password }) => {
        const u = db.users.get(email);
        if (!u || u.password !== password) return err("Invalid login credentials");
        if (!u.confirmed) return err("Email not confirmed");
        setSession({ id: u.id, email }, "SIGNED_IN");
        return { data: {}, error: null };
      },
      signOut: async () => { setSession(null, "SIGNED_OUT"); return { error: null }; },
      resetPasswordForEmail: async () => ({ error: null }),
      updateUser: async () => ({ error: null }),
    },
    from: () => query(),
    rpc: async (name) => {
      if (name !== "delete_user") return err("unknown");
      const id = db.session.user.id;
      db.rows = db.rows.filter((r) => r.user_id !== id);
      for (const [k, u] of db.users) if (u.id === id) db.users.delete(k);
      return { error: null };
    },
  };
  return { db, create: () => client };
}

const wait = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const row = (n) => ({ client_id: `c${n}`, performed_at: new Date(2026, 10, 16, 10, n).toISOString(), exercise: "squat", mode: "live", view: "side", rep_count: 5, avg_score: 80 + n, top_issue: null, reps: [{ index: 1, score: 80 }], trace: [] });

export async function runCloudTests() {
  const results = [];
  const check = (name, ok, info = "") => results.push({ name, ok, info });
  const keys = ["formcoach.pending", "formcoach.cloudCache", "formcoach.localWorkouts", "formcoach.history"];
  const backup = Object.fromEntries(keys.map((k) => [k, localStorage.getItem(k)]));
  keys.forEach((k) => localStorage.removeItem(k));
  try {
    const { db, create } = mockSupabase();
    const cloud = new Cloud({ url: "https://mock.supabase.co", key: "anon", createClient: create });
    await cloud.init();

    // Ohne Konto: lokal speichern (inkl. alter Verlauf)
    localStorage.setItem("formcoach.history", JSON.stringify([{ date: "2026-11-15T10:00:00.000Z", mode: "live", reps: 4, score: 70, view: "front", focus: "Knie fallen nach innen" }]));
    check("Ohne Konto: lokal gespeichert", (await cloud.saveWorkout(row(1))) === "local");
    const loc = await cloud.listWorkouts();
    check("Lokaler Verlauf inkl. alter Einträge", loc.source === "local" && loc.items.length === 2, `${loc.items.length} Einträge`);

    // Registrierung + Bestätigung
    const reg = await cloud.signUp("test@example.com", "geheim123");
    check("Registrierung verlangt E-Mail-Bestätigung", reg.needsConfirmation === true && !reg.error);
    const dup = await cloud.signUp("test@example.com", "geheim123");
    check("Doppelte Registrierung wird erkannt", /schon ein Konto/.test(dup.error || ""), dup.error);
    const unconf = await cloud.signIn("test@example.com", "geheim123");
    check("Login vor Bestätigung: deutsche Meldung", /bestätige/.test(unconf.error || ""), unconf.error);
    db.users.get("test@example.com").confirmed = true;
    const wrong = await cloud.signIn("test@example.com", "falsch!!!");
    check("Falsches Passwort: deutsche Meldung", /falsch/.test(wrong.error || ""), wrong.error);

    // Login -> lokale Sätze werden übernommen und hochgeladen
    await cloud.signIn("test@example.com", "geheim123");
    await wait(); await cloud.flush();
    check("Nach Login: lokale Sätze im Konto", db.rows.length === 2 && cloud.pendingCount() === 0, `${db.rows.length} in DB`);
    check("Nur echte Spalten hochgeladen", db.rows.every((r) => !("top_issue_title" in r)));

    // Offline speichern -> Warteschlange -> online hochladen, ohne Duplikate
    db.online = false;
    const st = await cloud.saveWorkout(row(2));
    const offList = await cloud.listWorkouts();
    check("Offline: in Warteschlange", st === "queued" && cloud.pendingCount() === 1, st);
    check("Offline: Verlauf aus Cache inkl. neuem Satz", offList.source === "cache" && offList.items.some((i) => i.client_id === "c2"));
    db.online = true;
    await cloud.flush(); await cloud.flush();
    check("Online: hochgeladen, keine Duplikate", db.rows.length === 3 && cloud.pendingCount() === 0, `${db.rows.length} in DB`);
    check("Online gespeichert", (await cloud.saveWorkout(row(3))) === "saved" && db.rows.length === 4);
    const list = await cloud.listWorkouts();
    check("Verlauf aus der Cloud, neueste zuerst", list.source === "cloud" && list.items[0].client_id === "c3");

    // Zweites Konto sieht nichts vom ersten; Warteschlange bleibt beim Besitzer
    db.online = false;
    await cloud.saveWorkout(row(4));
    await cloud.signOut();
    db.users.set("b@example.com", { id: "u-b", email: "b@example.com", password: "passwort2", confirmed: true });
    db.online = true;
    await cloud.signIn("b@example.com", "passwort2");
    await wait(); await cloud.flush();
    const listB = await cloud.listWorkouts();
    check("Anderes Konto sieht fremde Sätze nicht", listB.items.length === 0 && !db.rows.some((r) => r.user_id === "u-b"));
    await cloud.signOut();
    await cloud.signIn("test@example.com", "geheim123");
    await wait(); await cloud.flush();
    check("Wartender Satz geht ans richtige Konto", db.rows.filter((r) => r.user_id === "u-1").length === 5);

    // Konto löschen
    const del = await cloud.deleteAccount();
    check("Konto löschen entfernt alle Sätze", !del.error && db.rows.filter((r) => r.user_id === "u-1").length === 0 && !cloud.loggedIn);
  } catch (e) {
    check("Unerwarteter Fehler", false, e.message);
  } finally {
    keys.forEach((k) => (backup[k] == null ? localStorage.removeItem(k) : localStorage.setItem(k, backup[k])));
  }
  return results;
}
