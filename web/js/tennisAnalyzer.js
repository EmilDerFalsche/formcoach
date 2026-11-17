// Tennis-Analyse: Aufschlag, Vorhand, Rückhand.
//
// Ohne Schläger-/Balltracking: Das Handgelenk der Schlaghand dient als Stellvertreter.
// Ein Schlag = Geschwindigkeitsspitze des Handgelenks. Bewertet wird an Schlüsselpositionen
// (Ausholen, Treffpunkt ≈ Geschwindigkeitsspitze, Ausschwung).
//
// Referenzwerte Aufschlag (Meta-Analyse, Frontiers in Sports and Active Living 2024):
// Kniebeugung in der Trophy-Position ~ 47–81° (Innenwinkel ~ 100–135°),
// Ellbogenbeugung im Treffpunkt ~ 30° (Innenwinkel ~ 150°).
import { angle, dist } from "./features.js";
import { HandRaise } from "./gesture.js";

const VIEW_OF = (swr) => (swr > 0.45 ? "front" : swr < 0.28 ? "side" : "diagonal");
const median = (a) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export const TENNIS_T = {
  minVisibility: 0.5,
  swingSpeed: 4.5,        // Handgelenk-Geschwindigkeit (Rumpflängen/s), ab der ein Schlag beginnt
  minPeakSpeed: 6,        // so schnell muss die Spitze mindestens sein
  evalDelayMs: 800,       // Ausschwung abwarten, bevor bewertet wird
  cooldownMs: 1000,       // Mindestabstand zwischen zwei Schlägen
  bufferMs: 3500,
  serve: {
    knee: { minor: 145, major: 158 },          // min. Kniewinkel (innen) beim Ausholen
    elbow: { minor: 145, major: 120 },         // Ellbogen im Treffpunkt
    contactHeight: { minor: 0.7, major: 0.35 },// Handgelenk über Nase (Rumpflängen)
    toss: 0.45,                                // Ballwurfarm über Nase (Rumpflängen)
    followBelowHip: 0,                         // Handgelenk muss nach Treffpunkt bis unter die Hüfte
  },
  ground: {
    knee: 165,                                 // min. Kniewinkel während des Schlags
    turn: { minor: 0.25, major: 0.12 },        // Schulterdrehung (rel. Verkürzung der Schulterbreite)
    cramped: 90,                               // Ellbogen im Treffpunkt (Vorhand)
    oneHandElbow: 140,                         // einhändige Rückhand: Arm gestreckt
    twoHandDist: 0.45,                         // Handgelenke näher als das -> beidhändig
    followHigh: 0,                             // Handgelenk endet über Schulterhöhe
  },
};

export const STROKE_NAMES = { serve: "Aufschlag", forehand: "Vorhand", backhand: "Rückhand" };

export class TennisAnalyzer {
  /**
   * @param {object} o
   * @param {'serve'|'forehand'|'backhand'} o.stroke trainierter Schlag
   * @param {'R'|'L'} o.hand Schlaghand
   */
  constructor({ stroke = "forehand", hand = "R", onRep = () => {}, onFinish = () => {}, onEvent = () => {}, requireStartGesture = false, stopGesture = false } = {}) {
    Object.assign(this, { stroke, hand, onRep, onFinish, onEvent, requireStartGesture, stopGesture });
    this.startGesture = new HandRaise();
    this.stopGestureDetector = new HandRaise({ both: true, holdMs: 1200 }); // beide Hände: Aufschlag löst nicht aus
    this.reset();
  }

  reset() {
    this.state = this.requireStartGesture ? "waiting" : "setup"; // waiting | setup | ready | finished
    this.base = null;
    this.buf = [];
    this.speed = 0;
    this.swing = null;
    this.cooldownUntil = 0;
    this.reps = [];
    this.trace = [];
    this.discarded = 0;
    this.setupCount = 0;
    this.swrWin = [];
  }

  get view() { return this.base?.view ?? "unbekannt"; }

  _frame(lm, aspect, t) {
    const P = (i) => ({ x: lm[i].x * aspect, y: lm[i].y, v: lm[i].visibility ?? 1 });
    const R = this.hand === "R";
    const d = R ? { s: 12, e: 14, w: 16, h: 24 } : { s: 11, e: 13, w: 15, h: 23 };
    const o = R ? { s: 11, e: 13, w: 15, h: 23 } : { s: 12, e: 14, w: 16, h: 24 };
    const ds = P(d.s), de = P(d.e), dw = P(d.w), dh = P(d.h);
    const os = P(o.s), ow = P(o.w), oh = P(o.h);
    const nose = P(0);
    const hipMid = { x: (dh.x + oh.x) / 2, y: (dh.y + oh.y) / 2 };
    const shMid = { x: (ds.x + os.x) / 2, y: (ds.y + os.y) / 2 };
    const torso = dist(shMid, hipMid) || 1e-3;
    const knee = (h, k, a) => ((lm[k].visibility ?? 1) > 0.5 ? angle(P(h), P(k), P(a)) : 180);
    return {
      t, ds, de, dw, dh, os, ow, oh, nose, hipMid, shMid, torso,
      elbow: angle(ds, de, dw),
      knee: Math.min(knee(23, 25, 27), knee(24, 26, 28)),
      swr: Math.abs(ds.x - os.x) / torso,
      visibility: [d.s, d.e, d.w, 23, 24].reduce((s, i) => s + (lm[i].visibility ?? 1), 0) / 5,
    };
  }

  update(lm, tMs, aspect = 1) {
    const T = TENNIS_T;
    if (this.state === "finished") return { status: "finished", message: "Training beendet" };
    if (!lm) return { status: "no_person", message: "Keine Person erkannt" };
    const f = this._frame(lm, aspect, tMs);

    if (this.state === "waiting") {
      const g = this.startGesture.update(lm, f.torso, tMs);
      if (g >= 1) { this.state = "setup"; this.onEvent("start"); return { status: "setup", message: "Ganzen Körper ins Bild bringen …" }; }
      return { status: "waiting", message: g > 0 ? `Hand oben halten … ${Math.round(g * 100)} %` : "Hand über den Kopf heben zum Starten", gesture: g };
    }
    if (f.visibility < T.minVisibility) return { status: "low_vis", message: "Ganzer Körper muss sichtbar sein" };

    this.swrWin.push(f.swr); if (this.swrWin.length > 30) this.swrWin.shift();
    if (this.state === "setup") {
      if (++this.setupCount >= 10) {
        this.base = { view: VIEW_OF(median(this.swrWin)) };
        this.state = "ready";
        this.onEvent("calibrated", this.base.view);
      }
      return { status: "calibrating", message: "Bereit machen …" };
    }
    if (!this.swing) this.base.view = VIEW_OF(median(this.swrWin));

    // Stopp: beide Hände über den Kopf (nicht während eines Schlags)
    if (this.stopGesture && !this.swing) {
      const g = this.stopGestureDetector.update(lm, f.torso, tMs);
      if (g >= 1) { this.state = "finished"; this.onFinish(); return { status: "finished", message: "Training beendet" }; }
      if (g > 0) return { status: "ready", message: `Beide Hände oben halten … ${Math.round(g * 100)} %`, gesture: g, depth: 0 };
    }

    // Geschwindigkeit des Handgelenks (geglättet), in Rumpflängen pro Sekunde
    const prev = this.buf[this.buf.length - 1];
    if (prev && tMs > prev.t) {
      const v = dist(f.dw, prev.dw) / f.torso / ((tMs - prev.t) / 1000);
      this.speed = 0.6 * v + 0.4 * this.speed;
    }
    f.speed = this.speed;
    this.buf.push(f);
    while (this.buf.length && this.buf[0].t < tMs - T.bufferMs) this.buf.shift();
    const meter = this.speed / T.minPeakSpeed;
    if (this.trace.length === 0 || tMs - this.trace[this.trace.length - 1].t > 50) this.trace.push({ t: tMs, d: meter });

    // Schlag erkennen
    if (!this.swing && tMs >= this.cooldownUntil && this.speed > T.swingSpeed) {
      this.swing = { peakT: tMs, peakSpeed: this.speed };
    } else if (this.swing) {
      if (this.speed > this.swing.peakSpeed && tMs - this.swing.peakT < 400) { this.swing.peakT = tMs; this.swing.peakSpeed = this.speed; }
      if (tMs >= this.swing.peakT + T.evalDelayMs) {
        const s = this.swing;
        this.swing = null;
        this.cooldownUntil = s.peakT + T.cooldownMs;
        if (s.peakSpeed >= T.minPeakSpeed) this._finishSwing(s);
      }
    }
    return { status: this.swing ? "down" : "ready", message: this.swing ? "Schlag …" : `Bereit – ${STROKE_NAMES[this.stroke]}`, depth: meter };
  }

  _win(a, b) { return this.buf.filter((x) => x.t >= a && x.t <= b); }

  /** Welcher Schlag war das? serve | forehand | backhand | unknown */
  _classify(peakT) {
    // Die schnellste Handbewegung liegt oft kurz NACH dem Treffpunkt (Ausschwung) -> Fenster nach vorne erweitert
    const around = this._win(peakT - 450, peakT + 200);
    const height = Math.max(...around.map((x) => (x.nose.y - x.dw.y) / x.torso));
    if (height > 0.15) return "serve";
    // Ausholbewegung: wo ist das Handgelenk relativ zum Körper (Schlagseite / Gegenseite)?
    const back = this._win(peakT - 900, peakT - 100);
    if (!back.length) return "unknown";
    const far = back.reduce((a, b) => (dist(b.dw, b.hipMid) > dist(a.dw, a.hipMid) ? b : a));
    for (const [p, q] of [[far.dh, far.oh], [far.ds, far.os]]) {
      const v = { x: p.x - q.x, y: p.y - q.y }, len = Math.hypot(v.x, v.y);
      if (len / far.torso < 0.25) continue; // von der Seite gefilmt: Achse nicht messbar
      const side = ((far.dw.x - far.hipMid.x) * v.x + (far.dw.y - far.hipMid.y) * v.y) / len / far.torso;
      if (side > 0.15) return "forehand";
      if (side < -0.15) return "backhand";
    }
    return "unknown";
  }

  _finishSwing(s) {
    // Endet die Bewegung mit beiden Händen über dem Kopf, ist es das Stopp-Zeichen, kein Schlag
    const end = this._win(s.peakT + 300, s.peakT + TENNIS_T.evalDelayMs);
    const bothUp = end.length && end.every((x) => x.dw.y < x.nose.y && x.ow.y < x.nose.y);
    if (bothUp) return;
    const detected = this._classify(s.peakT);
    // Anderer Schlag als trainiert (z. B. Rückhand im Vorhand-Training) -> nicht werten.
    // "unknown" (z. B. seitlich gefilmt) wird als der gewählte Schlag gewertet.
    if (detected !== "unknown" && detected !== this.stroke) {
      this.discarded++;
      this.onEvent("discarded", `${STROKE_NAMES[detected]} erkannt`);
      return;
    }
    const rep = this._evaluate(s, detected);
    this.reps.push(rep);
    this.onRep(rep);
  }

  _evaluate(s, detected) {
    const T = TENNIS_T, t0 = s.peakT;
    const pre = this._win(t0 - 1500, t0);
    const post = this._win(t0 + 1, t0 + T.evalDelayMs);
    const around = this._win(t0 - 450, t0 + 150);
    const peakFrame = this._win(t0, t0).at(-1) ?? around.at(-1);
    const issues = [];
    const add = (key, severity, value) => issues.push({ key, severity, value });
    const m = { stroke: this.stroke, detected, peakSpeed: s.peakSpeed, kneeMin: Math.min(...pre.map((x) => x.knee)) };

    if (this.stroke === "serve") {
      const S = T.serve;
      const contact = around.reduce((a, b) => ((b.nose.y - b.dw.y) / b.torso > (a.nose.y - a.dw.y) / a.torso ? b : a));
      m.elbowContact = contact.elbow;
      m.contactHeight = (contact.nose.y - contact.dw.y) / contact.torso;
      m.tossHeight = Math.max(...pre.map((x) => (x.nose.y - x.ow.y) / x.torso));
      m.followBelowHip = post.length ? Math.max(...post.map((x) => (x.dw.y - x.hipMid.y) / x.torso)) : NaN;
      if (m.kneeMin > S.knee.major) add("serve_knees", "major", m.kneeMin);
      else if (m.kneeMin > S.knee.minor) add("serve_knees", "minor", m.kneeMin);
      if (m.elbowContact < S.elbow.major) add("serve_arm_bent", "major", m.elbowContact);
      else if (m.elbowContact < S.elbow.minor) add("serve_arm_bent", "minor", m.elbowContact);
      if (m.contactHeight < S.contactHeight.major) add("serve_low_contact", "major", m.contactHeight);
      else if (m.contactHeight < S.contactHeight.minor) add("serve_low_contact", "minor", m.contactHeight);
      if (m.tossHeight < S.toss) add("serve_toss_arm", "minor", m.tossHeight);
      if (Number.isFinite(m.followBelowHip) && m.followBelowHip < S.followBelowHip) add("serve_short_follow", "minor", m.followBelowHip);
    } else {
      const G = T.ground;
      const contact = peakFrame;
      m.elbowContact = contact.elbow;
      m.twoHanded = dist(contact.dw, contact.ow) / contact.torso < G.twoHandDist;
      m.followHigh = post.length ? Math.max(...post.map((x) => (x.ds.y - x.dw.y) / x.torso)) : NaN;
      const open = this._win(t0 - 2500, t0 - 700).map((x) => x.swr);
      const closed = this._win(t0 - 900, t0 - 50).map((x) => x.swr);
      const openSwr = open.length ? Math.max(...open) : NaN;
      m.turn = open.length && closed.length && openSwr > 0.35 ? 1 - Math.min(...closed) / openSwr : NaN;
      if (Number.isFinite(m.turn)) {
        if (m.turn < G.turn.major) add("turn", "major", m.turn);
        else if (m.turn < G.turn.minor) add("turn", "minor", m.turn);
      }
      if (m.kneeMin > G.knee) add("ground_knees", "minor", m.kneeMin);
      if (this.stroke === "forehand" && m.elbowContact < G.cramped) add("cramped", "minor", m.elbowContact);
      if (this.stroke === "backhand" && !m.twoHanded && m.elbowContact < G.oneHandElbow) add("bh_arm_bent", "minor", m.elbowContact);
      if (Number.isFinite(m.followHigh) && m.followHigh < G.followHigh) add("low_follow", "minor", m.followHigh);
    }
    issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "major" ? -1 : 1));
    const score = Math.max(0, 100 - issues.reduce((sum, i) => sum + (i.severity === "major" ? 25 : 12), 0));
    return { index: this.reps.length + 1, view: this.view, metrics: m, issues, score, start: t0 - 1000, end: t0 + 600 };
  }
}
