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
    cramped: { elbow: 75, reach: 0.8 },        // Vorhand: Arm stark gebeugt UND Hand nah an der Brust
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
    this.speed = 0; this.speedD = 0; this.speedO = 0;
    this.swing = null;
    this.cooldownUntil = 0;
    this.reps = [];
    this.trace = [];
    this.discarded = 0;
    this.discardedSwings = [];   // für den Export: warum wurden Schläge nicht gewertet?
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
    const os = P(o.s), oe = P(o.e), ow = P(o.w), oh = P(o.h);
    const nose = P(0);
    const hipMid = { x: (dh.x + oh.x) / 2, y: (dh.y + oh.y) / 2 };
    const shMid = { x: (ds.x + os.x) / 2, y: (ds.y + os.y) / 2 };
    const torso = dist(shMid, hipMid) || 1e-3;
    const knee = (h, k, a) => ((lm[k].visibility ?? 1) > 0.5 ? angle(P(h), P(k), P(a)) : 180);
    return {
      t, ds, de, dw, dh, os, oe, ow, oh, nose, hipMid, shMid, torso,
      elbow: angle(ds, de, dw),
      oelbow: angle(os, oe, ow),
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

    // Geschwindigkeit BEIDER Handgelenke (geglättet), in Rumpflängen pro Sekunde.
    // Die schnellere Hand ist die Schlaghand – das fängt vertauschte Links/Rechts-Erkennung ab
    // (passiert bei MediaPipe v. a., wenn man von hinten filmt).
    const prev = this.buf[this.buf.length - 1];
    if (prev && tMs > prev.t) {
      const dt = (tMs - prev.t) / 1000;
      this.speedD = 0.6 * (dist(f.dw, prev.dw) / f.torso / dt) + 0.4 * (this.speedD ?? 0);
      this.speedO = 0.6 * (dist(f.ow, prev.ow) / f.torso / dt) + 0.4 * (this.speedO ?? 0);
      this.speed = Math.max(this.speedD, this.speedO);
    }
    f.speed = this.speed;
    this.buf.push(f);
    while (this.buf.length && this.buf[0].t < tMs - T.bufferMs) this.buf.shift();
    const meter = this.speed / T.minPeakSpeed;
    if (this.trace.length === 0 || tMs - this.trace[this.trace.length - 1].t > 50) this.trace.push({ t: tMs, d: meter });

    // Schlag erkennen
    if (!this.swing && tMs >= this.cooldownUntil && this.speed > T.swingSpeed) {
      this.swing = { peakT: tMs, peakSpeed: this.speed, peakD: this.speedD ?? 0, peakO: this.speedO ?? 0 };
    } else if (this.swing) {
      this.swing.peakD = Math.max(this.swing.peakD, this.speedD ?? 0);
      this.swing.peakO = Math.max(this.swing.peakO, this.speedO ?? 0);
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

  _win(a, b, frames = this.frames ?? this.buf) { return frames.filter((x) => x.t >= a && x.t <= b); }

  /**
   * Treffpunkt ≈ schnellster Moment der Schlaghand rund um die Spitze.
   * Grundschläge: nur Frames, in denen das Handgelenk NICHT über der Schulter ist – bei niedriger
   * Bildrate (Handy live ~10–15 fps) liegt sonst oft schon der hohe Ausschwung im "schnellsten" Frame.
   */
  _contactFrame(peakT, groundstroke = this.stroke !== "serve") {
    const w = this._win(peakT - 450, peakT + 100);
    const pick = (ok) => {
      let best = null, bestV = -1;
      for (let i = 1; i < w.length; i++) {
        if (!ok(w[i])) continue;
        // Geschwindigkeit über die Nachbarframes mitteln (robuster bei wenigen Bildern)
        const v = dist(w[i].dw, w[i - 1].dw) / w[i].torso / Math.max(1e-3, (w[i].t - w[i - 1].t) / 1000);
        if (v > bestV) { bestV = v; best = w[i]; }
      }
      return best;
    };
    const belowShoulder = (x) => x.dw.y > x.ds.y - 0.1 * x.torso;
    return (groundstroke ? pick(belowShoulder) : null) ?? pick(() => true) ?? w.at(-1);
  }

  /** Zurückgelegte Strecke eines Handgelenks (in Rumpflängen) in einem Zeitfenster. */
  _path(key, a, b) {
    const w = this._win(a, b, this.buf);
    let sum = 0;
    for (let i = 1; i < w.length; i++) sum += dist(w[i][key], w[i - 1][key]) / w[i].torso;
    return sum;
  }

  /** Rollen tauschen: Gegenhand wird zur Schlaghand (bei vertauschter Links/Rechts-Erkennung). */
  static _swap(x) {
    return { ...x, ds: x.os, os: x.ds, de: x.oe, oe: x.de, dw: x.ow, ow: x.dw, dh: x.oh, oh: x.dh, elbow: x.oelbow, oelbow: x.elbow };
  }

  /** Welcher Schlag war das? serve | forehand | backhand | unknown */
  _classify(peakT) {
    // Aufschlag braucht ZWEI Merkmale:
    //  1. Ausholen über Kopf: vor der schnellen Phase war die Schlaghand deutlich über der Schulter (Trophy-Position)
    //  2. Treffpunkt über dem Kopf
    // Ein hoher Vorhand-Ausschwung erfüllt nur (2) – und auch das nur bei niedriger Bildrate scheinbar.
    const prep = this._win(peakT - 1100, peakT - 150);
    const prepAboveShoulder = prep.length ? Math.max(...prep.map((x) => (x.ds.y - x.dw.y) / x.torso)) : -9;
    const around = this._win(peakT - 450, peakT + 50);
    const height = around.length ? Math.max(...around.map((x) => (x.nose.y - x.dw.y) / x.torso)) : -9;
    this._lastHeight = height;
    this._lastPrep = prepAboveShoulder;
    if (height > 0.1 && prepAboveShoulder > 0.3) return "serve";
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
    const end = this._win(s.peakT + 300, s.peakT + TENNIS_T.evalDelayMs, this.buf);
    const bothUp = end.length && end.every((x) => x.dw.y < x.nose.y && x.ow.y < x.nose.y);
    if (bothUp) return;
    // Welche Hand hat geschlagen? Die Hand mit deutlich mehr Weg rund um den Schlag.
    // (Robuster als eine einzelne Geschwindigkeitsspitze, z. B. wenn der Wurfarm schnell herunterfällt.)
    const pathD = this._path("dw", s.peakT - 500, s.peakT + 300);
    const pathO = this._path("ow", s.peakT - 500, s.peakT + 300);
    const swapped = pathO > 1.3 * pathD;
    this.frames = swapped ? this.buf.map(TennisAnalyzer._swap) : this.buf;
    try {
      const detected = this._classify(s.peakT);
      // Anderer Schlag als trainiert (z. B. Rückhand im Vorhand-Training) -> nicht werten.
      // "unknown" (z. B. seitlich gefilmt) wird als der gewählte Schlag gewertet.
      if (detected !== "unknown" && detected !== this.stroke) {
        this.discarded++;
        this.discardedSwings.push({ t: Math.round(s.peakT), detected, swapped, peakD: +s.peakD.toFixed(2), peakO: +s.peakO.toFixed(2), heightAtContact: +this._lastHeight.toFixed(2), prepAboveShoulder: +this._lastPrep.toFixed(2) });
        this.onEvent("discarded", `${STROKE_NAMES[detected]} erkannt`);
        return;
      }
      const rep = this._evaluate(s, detected);
      rep.metrics.swappedHands = swapped;
      this.reps.push(rep);
      this.onRep(rep);
    } finally {
      this.frames = null;
    }
  }

  _evaluate(s, detected) {
    const T = TENNIS_T, t0 = s.peakT;
    const pre = this._win(t0 - 1500, t0);
    const post = this._win(t0 + 1, t0 + T.evalDelayMs);
    const around = this._win(t0 - 450, t0 + 150);
    const peakFrame = this._contactFrame(t0) ?? around.at(-1);
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
      m.reach = dist(contact.dw, contact.shMid) / contact.torso; // Abstand Hand – Brustmitte
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
      // "Ball zu nah" nur, wenn der Arm stark gebeugt ist UND die Hand nah am Körper – ein angewinkelter
      // Arm allein ist bei moderner Vorhand normal ("double bend").
      if (this.stroke === "forehand" && m.elbowContact < G.cramped.elbow && m.reach < G.cramped.reach) add("cramped", "minor", m.elbowContact);
      if (this.stroke === "backhand" && !m.twoHanded && m.elbowContact < G.oneHandElbow) add("bh_arm_bent", "minor", m.elbowContact);
      if (Number.isFinite(m.followHigh) && m.followHigh < G.followHigh) add("low_follow", "minor", m.followHigh);
    }
    issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "major" ? -1 : 1));
    const score = Math.max(0, 100 - issues.reduce((sum, i) => sum + (i.severity === "major" ? 25 : 12), 0));
    return { index: this.reps.length + 1, view: this.view, metrics: m, issues, score, start: t0 - 1000, end: t0 + 600 };
  }
}
