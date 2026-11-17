// Handzeichen über Pose-Landmarks (kein extra Modell nötig).
// "Hand über den Kopf" = Handgelenk deutlich oberhalb der Nase, eine Zeit lang gehalten.

export class HandRaise {
  /**
   * @param {object} o
   * @param {boolean} o.both   beide Hände nötig (z. B. Tennis, damit der Aufschlag nicht als Stopp zählt)
   * @param {number} o.holdMs  wie lange halten
   */
  constructor({ both = false, holdMs = 800 } = {}) {
    this.both = both;
    this.holdMs = holdMs;
    this.since = null;
    this.cooldownUntil = 0;
  }

  /** @returns {number} Fortschritt 0..1 (1 = ausgelöst) */
  update(lm, torsoLen, tMs) {
    if (!lm || tMs < this.cooldownUntil) { this.since = null; return 0; }
    const nose = lm[0];
    const margin = 0.25 * torsoLen;
    const isUp = (w) => (w.visibility ?? 1) > 0.5 && w.y < nose.y - margin;
    const up = this.both ? isUp(lm[15]) && isUp(lm[16]) : isUp(lm[15]) || isUp(lm[16]);
    if (!up) { this.since = null; return 0; }
    if (this.since == null) this.since = tMs;
    const p = Math.min(1, (tMs - this.since) / this.holdMs);
    if (p >= 1) { this.since = null; this.cooldownUntil = tMs + 2000; }
    return p;
  }
}
