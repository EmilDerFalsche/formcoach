// Liegestütz-Analyse (seitliche Aufnahme).
// Wiederholungen über den Ellbogenwinkel, Körperlinie über die Abweichung der Hüfte
// von der Linie Schulter → Knöchel.
import { angle, dist } from "./features.js";
import { HandRaise } from "./gesture.js";

const median = (a) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export const PUSHUP_T = {
  minVisibility: 0.5,
  plankMaxTilt: 35,              // Körperlinie max. Grad gegen die Horizontale
  plankMinElbow: 145,            // Arme gestreckt in der Startposition
  setupFrames: 12,
  leftPlankTilt: 55,             // darüber: aufgestanden / Pause
  downElbow: 135,                // darunter beginnt eine Wiederholung
  upElbow: 155,                  // darüber ist sie beendet
  targetElbow: 90,               // Ziel-Tiefe (Meter = 1)
  depth: { minor: 100, major: 115 },   // min. Ellbogenwinkel
  sag: { minor: 0.045, major: 0.08 },  // Hüfte unter der Linie (rel. Körperlänge)
  pike: { minor: 0.06, major: 0.1 },   // Hüfte über der Linie
  lockout: 158,                  // Ellbogen oben mindestens
  headDrop: 0.06,
  tooFastSec: 0.4,
  maxRepSec: 8,
};
const PRIORITY = ["hip_sag", "shallow", "hip_pike", "no_lockout", "head_drop", "too_fast"];

export class PushupAnalyzer {
  constructor({ onRep = () => {}, onFinish = () => {}, onEvent = () => {}, requireStartGesture = false, stopGesture = false } = {}) {
    Object.assign(this, { onRep, onFinish, onEvent, requireStartGesture, stopGesture });
    this.gesture = new HandRaise();
    this.reset();
  }

  reset() {
    this.state = this.requireStartGesture ? "waiting" : "setup"; // waiting | setup | up | down | paused | finished
    this.base = null;
    this.setupCount = 0;
    this.rep = null;
    this.reps = [];
    this.trace = [];
    this.discarded = 0;
    this.topElbow = 0;        // höchster Ellbogenwinkel in der oberen Position vor der nächsten Wdh.
    this.offPlank = 0;
  }

  get view() { return this.base ? "side" : "unbekannt"; }

  _frame(lm, aspect) {
    const P = (i) => ({ x: lm[i].x * aspect, y: lm[i].y, v: lm[i].visibility ?? 1 });
    const sideVis = (ids) => ids.reduce((s, i) => s + (lm[i].visibility ?? 1), 0) / ids.length;
    const lv = sideVis([11, 13, 15, 23, 27]), rv = sideVis([12, 14, 16, 24, 28]);
    const L = (this.base?.side ?? (lv >= rv ? "L" : "R")) === "L";
    const sh = P(L ? 11 : 12), el = P(L ? 13 : 14), wr = P(L ? 15 : 16), hip = P(L ? 23 : 24), ank = P(L ? 27 : 28), ear = P(L ? 7 : 8);
    const bodyLen = dist(sh, ank) || 1e-3;
    const u = { x: (ank.x - sh.x) / bodyLen, y: (ank.y - sh.y) / bodyLen };
    const sgn = u.x >= 0 ? 1 : -1;
    const dev = (p) => ((u.x * (p.y - sh.y) - u.y * (p.x - sh.x)) * sgn) / bodyLen; // + = unter der Linie
    const elbow = angle(sh, el, wr);
    return {
      side: L ? "L" : "R",
      visibility: Math.max(lv, rv),
      elbow,
      tilt: (Math.atan2(Math.abs(ank.y - sh.y), Math.abs(ank.x - sh.x)) * 180) / Math.PI,
      hipDev: dev(hip),
      earDev: dev(ear),
      torsoLen: dist(sh, hip) || 1e-3,
      meter: (170 - elbow) / (170 - PUSHUP_T.targetElbow),
    };
  }

  update(lm, tMs, aspect = 1) {
    const T = PUSHUP_T;
    if (this.state === "finished") return { status: "finished", message: "Satz beendet" };
    if (!lm) return { status: "no_person", message: "Keine Person erkannt" };
    const f = this._frame(lm, aspect);
    const g = (this.state === "waiting" || this.state === "paused") ? this.gesture.update(lm, f.torsoLen, tMs) : 0;

    if (this.state === "waiting") {
      if (g >= 1) { this.state = "setup"; this.onEvent("start"); return { status: "setup", message: "Seitlich zur Kamera in die Liegestütz-Position" }; }
      return { status: "waiting", message: g > 0 ? `Hand oben halten … ${Math.round(g * 100)} %` : "Hand über den Kopf heben zum Starten", gesture: g };
    }
    if (f.visibility < T.minVisibility) return { status: "low_vis", message: "Ganzer Körper muss seitlich sichtbar sein" };

    const inPlank = f.tilt < T.plankMaxTilt;
    if (this.state === "setup") {
      this.setupCount = inPlank && f.elbow > T.plankMinElbow ? this.setupCount + 1 : 0;
      if (this.setupCount >= T.setupFrames) {
        this.base = { side: f.side, view: "side" };
        this.state = "up";
        this.topElbow = f.elbow;
        this.armed = true;
        this.onEvent("calibrated", "side");
        return { status: "up", message: "Bereit – los geht's!", depth: 0 };
      }
      return { status: "calibrating", message: f.tilt > 60 ? "Seitlich zur Kamera in die Liegestütz-Position gehen" : "Arme strecken, Körper gerade halten …" };
    }

    if (this.trace.length === 0 || tMs - this.trace[this.trace.length - 1].t > 50) this.trace.push({ t: tMs, d: f.meter });

    // Pause: aufgestanden / abgelegt
    if (this.state === "paused") {
      if (this.stopGesture && g >= 1) { this.state = "finished"; this.onFinish(); return { status: "finished", message: "Satz beendet" }; }
      if (inPlank && f.elbow > T.plankMinElbow) { this.state = "up"; this.topElbow = f.elbow; this.armed = true; }
      else return { status: "paused", message: this.stopGesture ? "Pause – Hand heben zum Beenden oder weitermachen" : "Pause – zurück in die Position", gesture: g };
    }
    this.offPlank = f.tilt > T.leftPlankTilt ? this.offPlank + 1 : 0;
    if (this.offPlank > 15) {
      this.state = "paused"; this.rep = null; this.offPlank = 0;
      return { status: "paused", message: "Pause erkannt" };
    }

    if (this.state === "up") {
      this.topElbow = Math.max(this.topElbow, f.elbow);
      if (f.elbow >= this.topElbow - 5) this.lastTopT = tMs; // Absenken beginnt, wenn die obere Position verlassen wird
      // erst wieder "scharf", wenn die Arme oben (fast) gestreckt sind – verhindert Doppelzählung
      if (f.elbow > T.downElbow + 10) this.armed = true;
      if (this.armed && f.elbow < T.downElbow) {
        this.armed = false; this.state = "down"; this.rep = { start: Math.min(tMs, this.lastTopT ?? tMs), top: this.topElbow, frames: [], minElbow: 180 }; }
    }
    if (this.state === "down") {
      this.rep.frames.push({ t: tMs, ...f });
      this.rep.minElbow = Math.min(this.rep.minElbow, f.elbow);
      // Ende: wieder oben – auch wenn die Arme nicht ganz gestreckt werden (wird dann als Fehler gewertet)
      if (f.elbow > Math.min(T.upElbow, this.rep.minElbow + 35)) {
        const done = this.rep;
        this.rep = null; this.state = "up"; this.topElbow = f.elbow;
        const reason = this._implausible(done, tMs);
        if (reason) { this.discarded++; this.onEvent("discarded", reason); }
        else { const rep = this._evaluate(done, tMs); this.reps.push(rep); this.onRep(rep); }
      }
    }
    return { status: this.state, message: this.state === "down" ? "Runter … und hoch" : "Bereit", depth: f.meter };
  }

  _implausible(rep, endT) {
    const T = PUSHUP_T;
    if (rep.frames.length < 4) return "zu kurz";
    if ((endT - rep.start) / 1000 > T.maxRepSec) return "zu lang";
    if (Math.max(...rep.frames.map((x) => x.tilt)) > T.leftPlankTilt) return "Körper nicht waagerecht";
    return null;
  }

  _evaluate(rep, endT) {
    const T = PUSHUP_T, fr = rep.frames;
    const minElbow = Math.min(...fr.map((x) => x.elbow));
    const bottomIdx = fr.findIndex((x) => x.elbow === minElbow);
    const m = {
      minElbow,
      topElbow: rep.top,
      hipDev: median(fr.map((x) => x.hipDev)),
      earDev: median(fr.map((x) => x.earDev)),
      descentSec: (fr[bottomIdx].t - rep.start) / 1000,
      durationSec: (endT - rep.start) / 1000,
    };
    const issues = [];
    const add = (key, severity, value) => issues.push({ key, severity, value });
    if (m.minElbow > T.depth.major) add("shallow", "major", m.minElbow);
    else if (m.minElbow > T.depth.minor) add("shallow", "minor", m.minElbow);
    if (m.hipDev > T.sag.major) add("hip_sag", "major", m.hipDev);
    else if (m.hipDev > T.sag.minor) add("hip_sag", "minor", m.hipDev);
    if (-m.hipDev > T.pike.major) add("hip_pike", "major", m.hipDev);
    else if (-m.hipDev > T.pike.minor) add("hip_pike", "minor", m.hipDev);
    if (m.topElbow < T.lockout) add("no_lockout", "minor", m.topElbow);
    if (m.earDev > T.headDrop) add("head_drop", "minor", m.earDev);
    if (m.descentSec < T.tooFastSec) add("too_fast", "minor", m.descentSec);
    issues.sort((a, b) => (a.severity === b.severity ? PRIORITY.indexOf(a.key) - PRIORITY.indexOf(b.key) : a.severity === "major" ? -1 : 1));
    const score = Math.max(0, 100 - issues.reduce((s, i) => s + (i.severity === "major" ? 25 : 12), 0));
    return { index: this.reps.length + 1, view: "side", metrics: m, issues, score, start: rep.start, end: endT, keyT: fr[bottomIdx].t };
  }
}
