// Wiederholungserkennung + regelbasierte Technikbewertung für Kniebeugen.
import { computeFrame, datasetFeatures, dist } from "./features.js";

const median = (arr) => {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const percentile = (arr, p) => {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const PRIORITY =["knees_in", "shallow", "forward_lean", "heels_up", "hips_first", "asymmetric", "too_fast"];

// Schwellwerte an einer Stelle – leicht anpassbar.
export const THRESHOLDS = {
  minVisibility: 0.55,
  startDepth: 0.25,      // Anteil der Oberschenkellänge, ab dem eine Wdh. beginnt
  endDepth: 0.12,        // darunter gilt man wieder als stehend
  minRepDepth: 0.35,     // flachere Bewegungen werden ignoriert (Wackeln)
  shallow: { minor: -0.15, major: -0.35 },          // Tiefe relativ zur Oberschenkellänge (0 = parallel)
  parallelKneeAngle: 60,                            // Kniewinkel (Grad) bei paralleler Hocke, seitlich
  parallelHipDrop: 1.1,                            // Hüftabsenkung (in Oberschenkellängen) bei paralleler Hocke
  minVisibilityInRep: 0.3,                          // in der Hocke sind Gelenke oft verdeckt -> toleranter
  forwardLean: { minor: 48, major: 58 },            // Grad Oberkörper vs. Senkrechte
  hipsFirst: 12,                                    // Grad zusätzliche Vorlage beim Hochkommen
  kneesIn: { minor: 0.88, major: 0.75 },            // Kniebreite/Fußbreite relativ zum Stand
  heelsUp: { minor: 0.06, major: 0.1 },             // Fersenhub relativ zur Schienbeinlänge
  asymTilt: { minor: 0.18, major: 0.28 },           // Beckenschiefstand (Höhendifferenz / Hüftbreite)
  asymShift: 0.25,                                  // seitliche Verschiebung relativ zur Fußbreite
  tooFastSec: 0.5,
  // Start/Stopp-Geste und Plausibilität
  gestureHoldMs: 800,     // Hand so lange über dem Kopf halten
  calibFrames: 25,        // ~1 s ruhig stehen
  calibStillness: 0.15,   // erlaubte Fuß-/Hüftbewegung während Kalibrierung (rel. Schienbein)
  feetMoved: 0.4,         // Füße weiter bewegt (rel. Schienbein) -> Wdh. ungültig / neu kalibrieren
  maxPlausibleDepth: 2.0, // Hüfte tiefer als 2 Oberschenkellängen -> keine Kniebeuge
  maxPlausibleTrunk: 95,  // Schultern unter Hüfthöhe -> z. B. bücken, keine Kniebeuge
  maxRepSec: 8,
};

const VIEW_OF = (swr) => (swr > 0.45 ? "front" : swr < 0.28 ? "side" : "diagonal");

export class SquatAnalyzer {
  /**
   * @param {object} o
   * @param {boolean} o.requireStartGesture  Satz erst nach Handzeichen starten (live)
   * @param {boolean} o.stopGesture          Handzeichen im Stand beendet den Satz
   * @param {Function} o.onRep               Callback pro gültiger Wiederholung
   * @param {Function} o.onFinish            Callback, wenn per Geste beendet
   * @param {Function} o.onEvent             Callback für Ereignisse (start, calibrated, recalibrate, discarded)
   */
  constructor({ classifier = null, onRep = () => {}, onFinish = () => {}, onEvent = () => {}, requireStartGesture = false, stopGesture = false } = {}) {
    this.classifier = classifier;
    this.onRep = onRep;
    this.onFinish = onFinish;
    this.onEvent = onEvent;
    this.requireStartGesture = requireStartGesture;
    this.stopGesture = stopGesture;
    this.reset();
  }

  reset() {
    this.state = this.requireStartGesture ? "waiting" : "calibrating"; // waiting | calibrating | standing | down | finished
    this.base = null;
    this.calib = [];
    this.rep = null;
    this.reps = [];
    this.discarded = 0;
    this.trace = []; // {t, d} für das Diagramm
    this.lastStatus = "";
    this.gestureSince = null;
    this.gestureCooldownUntil = 0;
    this.swrWindow = [];
    this.feetMovedFrames = 0;
  }

  get view() {
    return this.base?.view ?? "unbekannt";
  }

  /**
   * Verarbeitet einen Frame.
   * @returns {{status:string, message:string, frame?:object, depth?:number, gesture?:number}}
   */
  update(landmarks, tMs, aspect = 1) {
    if (this.state === "finished") return this._status("finished", "Satz beendet");
    if (!landmarks) { this.gestureSince = null; return this._status("no_person", "Keine Person erkannt"); }
    const f = computeFrame(landmarks, aspect);
    const gesture = this._gesture(landmarks, f, tMs);

    if (this.state === "waiting") {
      if (gesture >= 1) {
        this.state = "calibrating";
        this.calib = [];
        this.onEvent("start");
        return this._status("calibrating", "Hand runter und ruhig hinstellen …", f);
      }
      return { ...this._status("waiting", gesture > 0 ? `Hand oben halten … ${Math.round(gesture * 100)} %` : "Hand über den Kopf heben zum Starten", f), gesture };
    }

    // Während einer Wiederholung nicht gleich Frames verwerfen: gerade der tiefste
    // Punkt hat oft geringere Sichtbarkeit und darf für die Tiefenmessung nicht fehlen.
    const minVis = this.state === "down" ? THRESHOLDS.minVisibilityInRep : THRESHOLDS.minVisibility;
    if (f.visibility < minVis) {
      return this._status("low_vis", "Ganzer Körper inkl. Füße muss sichtbar sein", f);
    }

    if (this.state === "calibrating") return this._calibrate(f);

    const b = this.base;
    const y = this._ys(f);
    const d = (y.hipY - b.hipY) / b.thigh; // 0 = stehend, ~1 = Hüfte auf Kniehöhe
    const feetMove = this._feetMove(f);
    if (this.trace.length === 0 || tMs - this.trace[this.trace.length - 1].t > 50) this.trace.push({ t: tMs, d });

    if (this.state === "standing") {
      // Stopp per Handzeichen
      if (this.stopGesture && gesture >= 1) {
        this.state = "finished";
        this.onFinish();
        return this._status("finished", "Satz beendet");
      }
      // Perspektive gewechselt (z. B. nach dem Kalibrieren umgedreht) -> neu kalibrieren
      this.swrWindow.push(f.shoulderWidthRatio);
      if (this.swrWindow.length > 20) this.swrWindow.shift();
      const nowView = this.swrWindow.length >= 20 ? VIEW_OF(median(this.swrWindow)) : b.view;
      const viewChanged = nowView !== b.view && (nowView !== "diagonal" || this._clearlyOther(median(this.swrWindow), b.view));
      // Füße deutlich versetzt (umgestellt / weggegangen) -> neu kalibrieren
      this.feetMovedFrames = feetMove > THRESHOLDS.feetMoved ? this.feetMovedFrames + 1 : 0;
      if (viewChanged || this.feetMovedFrames > 10) {
        this._recalibrate(viewChanged ? "Perspektive geändert" : "Position geändert");
        return this._status("calibrating", `${viewChanged ? "Perspektive" : "Position"} geändert – kurz ruhig stehen …`, f);
      }
      if (d > THRESHOLDS.startDepth) {
        this.state = "down";
        this.rep = { start: tMs, frames: [] };
      } else if (d < 0.08) {
        this._updateBaseline(f); // Baseline langsam nachführen
      }
    }

    if (this.state === "down") {
      this.rep.frames.push({ ...this._frameMetrics(f, d, tMs), feetMove, swr: f.shoulderWidthRatio });
      if (d < THRESHOLDS.endDepth) {
        const done = this.rep;
        this.rep = null;
        this.state = "standing";
        const maxD = Math.max(...done.frames.map((x) => x.d));
        if (maxD >= THRESHOLDS.minRepDepth && done.frames.length >= 5) {
          const reason = this._implausible(done, tMs);
          if (reason) {
            this.discarded++;
            this.onEvent("discarded", reason);
          } else {
            const rep = this._evaluate(done, tMs);
            this.reps.push(rep);
            this.onRep(rep);
          }
        }
      }
    }
    let msg = this.state === "down" ? "Runter … und hoch" : "Bereit – los geht's";
    if (this.state === "standing" && gesture > 0 && this.stopGesture) msg = `Hand oben halten zum Beenden … ${Math.round(gesture * 100)} %`;
    return { ...this._status(this.state, msg, f), depth: d, gesture };
  }

  _status(status, message, frame) {
    this.lastStatus = status;
    return { status, message, frame };
  }

  /** Hand über dem Kopf: liefert Fortschritt 0..1 (1 = lange genug gehalten). */
  _gesture(lm, f, tMs) {
    if (tMs < this.gestureCooldownUntil) return 0;
    const nose = lm[0], wl = lm[15], wr = lm[16];
    const margin = 0.25 * f.torsoLen; // deutlich über dem Kopf
    const up = [wl, wr].some((w) => (w.visibility ?? 1) > 0.5 && w.y < nose.y - margin);
    if (!up) { this.gestureSince = null; return 0; }
    if (this.gestureSince == null) this.gestureSince = tMs;
    const p = Math.min(1, (tMs - this.gestureSince) / THRESHOLDS.gestureHoldMs);
    if (p >= 1) { this.gestureSince = null; this.gestureCooldownUntil = tMs + 2000; }
    return p;
  }

  _clearlyOther(swr, baseView) {
    return baseView === "front" ? swr < 0.35 : baseView === "side" ? swr > 0.38 : swr > 0.5 || swr < 0.22;
  }

  _ankle(f) {
    if (this.base?.view === "side") return this.base.side === "L" ? f.la : f.ra;
    return { x: (f.la.x + f.ra.x) / 2, y: (f.la.y + f.ra.y) / 2 };
  }

  _feetMove(f) {
    const a = this._ankle(f), b = this.base;
    return Math.hypot(a.x - b.ankleX, a.y - b.ankleY) / b.shin;
  }

  _recalibrate(reason) {
    this.state = "calibrating";
    this.base = null;
    this.calib = [];
    this.rep = null;
    this.swrWindow = [];
    this.feetMovedFrames = 0;
    this.onEvent("recalibrate", reason);
  }

  /** Bewegungen, die keine Kniebeuge sein können (hinstellen, bücken, zum Handy laufen). */
  _implausible(rep, endT) {
    const T = THRESHOLDS, fr = rep.frames;
    if (Math.max(...fr.map((x) => x.d)) > T.maxPlausibleDepth) return "zu tief für eine Kniebeuge";
    if (Math.max(...fr.map((x) => x.trunk)) > T.maxPlausibleTrunk) return "Oberkörper unter Hüfthöhe";
    if (Math.max(...fr.map((x) => x.feetMove)) > T.feetMoved) return "Füße bewegt";
    if ((endT - rep.start) / 1000 > T.maxRepSec) return "zu lang";
    return null;
  }

  _calibrate(f) {
    const upright = f.trunkFromVertical < 25 && f.kneeAngle > 150;
    if (!upright) {
      this.calib = [];
      return this._status("calibrating", "Stell dich aufrecht hin – ich kalibriere …", f);
    }
    // Nur kalibrieren, wenn man wirklich still steht (nicht beim Umdrehen/Hinlaufen)
    const first = this.calib[0];
    if (first) {
      const s = dist(first.S.knee, first.S.ankle) || 1e-3;
      const ankleMove = Math.hypot((f.la.x + f.ra.x) / 2 - (first.la.x + first.ra.x) / 2, (f.la.y + f.ra.y) / 2 - (first.la.y + first.ra.y) / 2) / s;
      const swrMove = Math.abs(f.shoulderWidthRatio - first.shoulderWidthRatio);
      if (ankleMove > THRESHOLDS.calibStillness || swrMove > 0.15) this.calib = [];
    }
    this.calib.push(f);
    const N = THRESHOLDS.calibFrames;
    if (this.calib.length < N) {
      return this._status("calibrating", `Ruhig stehen … ${Math.round((this.calib.length / N) * 100)} %`, f);
    }
    const c = this.calib;
    const m = (fn) => median(c.map(fn));
    const view = VIEW_OF(m((x) => x.shoulderWidthRatio));
    // In Seitenansicht durchgehend die kamerazugewandte Seite verwenden
    const side = m((x) => x.leftVis) >= m((x) => x.rightVis) ? "L" : "R";
    this.base = { view, side };
    const ys = c.map((x) => this._ys(x));
    const ank = c.map((x) => this._ankle(x));
    Object.assign(this.base, {
      hipY: median(ys.map((v) => v.hipY)),
      kneeY: median(ys.map((v) => v.kneeY)),
      thigh: Math.max(1e-3, median(ys.map((v) => v.kneeY - v.hipY))),
      shin: Math.max(1e-3, m((x) => dist(x.S.knee, x.S.ankle))),
      ankleX: median(ank.map((a) => a.x)), ankleY: median(ank.map((a) => a.y)),
      kneeRatio: m((x) => x.kneeDist / Math.max(1e-3, x.ankleDist)),
      ankleDist: m((x) => x.ankleDist),
      hipWidth: Math.max(1e-3, m((x) => Math.abs(x.lh.x - x.rh.x))),
      heelToeL: m((x) => x.heelToeL), heelToeR: m((x) => x.heelToeR),
      heelToeS: m((x) => x.S.heel.y - x.S.foot.y),
      hipShift: m((x) => x.hipShift),
    });
    this.calib = [];
    this.swrWindow = [];
    this.state = "standing";
    this.onEvent("calibrated", view);
    return this._status("standing", "Kalibriert – los geht's!", f);
  }

  /** Hüft-/Knie-Höhe und Kniewinkel: seitlich nur die sichtbare Seite, sonst Mittelwerte. */
  _ys(f) {
    if (this.base?.view === "side") {
      const L = this.base.side === "L";
      return { hipY: (L ? f.lh : f.rh).y, kneeY: (L ? f.lk : f.rk).y, knee: L ? f.kneeL : f.kneeR };
    }
    return { hipY: f.hipY, kneeY: f.kneeY, knee: f.kneeAngle };
  }

  _updateBaseline(f) {
    const a = 0.03, b = this.base, y = this._ys(f);
    b.hipY += a * (y.hipY - b.hipY);
    b.kneeY += a * (y.kneeY - b.kneeY);
    b.thigh += a * (Math.max(1e-3, y.kneeY - y.hipY) - b.thigh);
  }

  _frameMetrics(f, d, t) {
    const b = this.base;
    const heelLiftS = (b.heelToeS - (f.S.heel.y - f.S.foot.y)) / b.shin;
    const heelLiftLR = ((b.heelToeL - f.heelToeL) + (b.heelToeR - f.heelToeR)) / 2 / b.shin;
    const y = this._ys(f);
    return {
      t, d,
      depthRel: (y.hipY - y.kneeY) / b.thigh, // 0 = parallel, >0 = tiefer
      trunk: f.trunkFromVertical,
      knee: y.knee,
      // Nur werten, wenn die Füße im Bild sichtbar auseinanderstehen; sonst null (wird ignoriert)
      kneeRatio: f.ankleDist > 0.5 * b.ankleDist && b.ankleDist > 0.02 ? f.kneeDist / f.ankleDist / Math.max(1e-3, b.kneeRatio) : null,
      heelLift: this.view === "front" ? heelLiftLR : heelLiftS,
      // Beckenschiefstand relativ zur Hüftbreite im Stand (nicht zur aktuellen, die bei Drehung gegen 0 geht)
      hipTilt: Math.abs(f.lh.y - f.rh.y) / b.hipWidth,
      // nur sinnvoll, wenn die Füße sichtbar auseinanderstehen (nicht in Seitenansicht)
      hipShift: b.ankleDist > 0.02 ? (f.hipShift - b.hipShift) / b.ankleDist : 0,
      feats: datasetFeatures(f),
    };
  }

  _evaluate(rep, endT) {
    const T = THRESHOLDS, fr = rep.frames, view = this.view;
    const maxD = Math.max(...fr.map((x) => x.d));
    const bottomIdx = fr.findIndex((x) => x.d === maxD);
    const bottom = fr.filter((x) => x.d >= maxD - 0.08);
    const deep = fr.filter((x) => x.d >= 0.4 * maxD);
    const ascent = fr.slice(bottomIdx).filter((x) => x.d >= 0.5 * maxD);

    // Tiefe: 0 = Hüfte auf Kniehöhe (parallel), > 0 = tiefer, < 0 = höher.
    // Seitlich: direkter Vergleich Hüfte vs. Knie im Bild (zuverlässig).
    // Frontal: Knie sind in der Hocke näher an der Kamera und wirken durch die
    // Perspektive tiefer -> stattdessen Absenkung der Hüfte relativ zur Oberschenkellänge.
    // Zusätzlich seitlich: Kniewinkel (parallel ≈ 60°). Die Hüft-Landmarke sitzt bei
    // MediaPipe in tiefer Hocke oft zu hoch, der Kniewinkel ist dort robuster.
    const kneeVsHip = Math.max(...fr.map((x) => x.depthRel));
    const hipDrop = maxD - T.parallelHipDrop;
    const kneeMin = Math.min(...fr.map((x) => x.knee));
    const byKnee = (T.parallelKneeAngle - kneeMin) / T.parallelKneeAngle;
    const depth = view === "side" ? Math.max(kneeVsHip, byKnee)
      : view === "front" ? hipDrop
      : Math.max(kneeVsHip, hipDrop, byKnee);

    const m = {
      depth,
      trunk: median(bottom.map((x) => x.trunk)),
      kneeMin: Math.min(...fr.map((x) => x.knee)),
      // 20. Perzentil statt Minimum: einzelne Ausreißer-Frames von MediaPipe ignorieren
      kneeRatio: percentile(deep.map((x) => x.kneeRatio).filter((v) => v != null), 0.2),
      heelLift: median(bottom.map((x) => x.heelLift)),
      hipTilt: median(bottom.map((x) => x.hipTilt)),
      hipShift: median(bottom.map((x) => x.hipShift)),
      // Referenz: Oberkörperwinkel am tiefsten Punkt aus der Absenkphase
      hipsFirst: ascent.length
        ? Math.max(...ascent.map((x) => x.trunk)) - median(fr.slice(0, bottomIdx + 1).filter((x) => x.d >= maxD - 0.08).map((x) => x.trunk))
        : 0,
      descentSec: (fr[bottomIdx].t - rep.start) / 1000,
      durationSec: (endT - rep.start) / 1000,
    };

    const issues = [];
    const add = (key, severity, value) => issues.push({ key, severity, value });
    const sideLike = view !== "front";
    const frontLike = view !== "side";

    if (m.depth < T.shallow.major) add("shallow", "major", m.depth);
    else if (m.depth < T.shallow.minor) add("shallow", "minor", m.depth);

    if (sideLike) {
      if (m.trunk > T.forwardLean.major) add("forward_lean", "major", m.trunk);
      else if (m.trunk > T.forwardLean.minor) add("forward_lean", "minor", m.trunk);
      if (m.hipsFirst > T.hipsFirst) add("hips_first", "minor", m.hipsFirst);
    }
    if (frontLike && !Number.isNaN(m.kneeRatio)) {
      if (m.kneeRatio < T.kneesIn.major) add("knees_in", "major", m.kneeRatio);
      else if (m.kneeRatio < T.kneesIn.minor) add("knees_in", "minor", m.kneeRatio);
    }
    // Asymmetrie nur, wenn beide Hüften im Stand sichtbar nebeneinander lagen
    // (Hüftbreite mind. 40 % der Fußbreite) – sonst ist der Wert reines Rauschen.
    const hipsVisibleApart = this.base.hipWidth > 0.4 * Math.max(this.base.ankleDist, 0.05);
    if (frontLike && hipsVisibleApart) {
      if (m.hipTilt > T.asymTilt.major) add("asymmetric", "major", m.hipTilt);
      else if (m.hipTilt > T.asymTilt.minor || Math.abs(m.hipShift) > T.asymShift) add("asymmetric", "minor", m.hipTilt);
    }
    if (m.heelLift > T.heelsUp.major) add("heels_up", "major", m.heelLift);
    else if (m.heelLift > T.heelsUp.minor) add("heels_up", "minor", m.heelLift);
    if (m.descentSec < T.tooFastSec) add("too_fast", "minor", m.descentSec);

    issues.sort((a, b) => (a.severity === b.severity ? PRIORITY.indexOf(a.key) - PRIORITY.indexOf(b.key) : a.severity === "major" ? -1 : 1));
    const score = Math.max(0, 100 - issues.reduce((s, i) => s + (i.severity === "major" ? 25 : 12), 0));

    const ml = this.classifier ? this.classifier.predictMany(bottom.map((x) => x.feats)) : null;

    const r3 = (v) => Math.round(v * 1000) / 1000;
    const frames = fr.map((x) => ({
      t: Math.round(x.t), d: r3(x.d), depthRel: r3(x.depthRel), knee: r3(x.knee), trunk: r3(x.trunk),
      kneeRatio: x.kneeRatio == null ? null : r3(x.kneeRatio), heelLift: r3(x.heelLift), hipTilt: r3(x.hipTilt),
      feetMove: x.feetMove == null ? null : r3(x.feetMove), swr: x.swr == null ? null : r3(x.swr),
    }));
    const depthParts = { kneeVsHip: r3(kneeVsHip), hipDrop: r3(hipDrop), byKnee: r3(byKnee) };
    return { index: this.reps.length + 1, view, metrics: m, depthParts, issues, score, ml, start: rep.start, end: endT, frames };
  }
}
