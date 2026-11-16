// Geometrie-Hilfen und Merkmalsberechnung aus MediaPipe-Pose-Landmarks.
// Landmarks sind normalisiert (x, y in [0,1], y nach unten).

export const LM = {
  L_SHOULDER: 11, R_SHOULDER: 12,
  L_HIP: 23, R_HIP: 24,
  L_KNEE: 25, R_KNEE: 26,
  L_ANKLE: 27, R_ANKLE: 28,
  L_HEEL: 29, R_HEEL: 30,
  L_FOOT: 31, R_FOOT: 32,
};

// Reihenfolge MUSS mit training/train_model.py (FEATURES) übereinstimmen.
export const FEATURE_ORDER = [
  "left_knee_angle", "right_knee_angle",
  "left_hip_angle", "right_hip_angle",
  "left_ankle_angle", "right_ankle_angle",
  "spine_angle", "torso_lean",
  "left_knee_lateral", "right_knee_lateral",
  "symmetry_score", "hip_depth",
];

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, visibility: Math.min(a.visibility ?? 1, b.visibility ?? 1) });

/** Innenwinkel ABC in Grad (0..180), 2D. */
export function angle(a, b, c) {
  const v1x = a.x - b.x, v1y = a.y - b.y;
  const v2x = c.x - b.x, v2y = c.y - b.y;
  const n = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  if (n === 0) return 180;
  const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / n));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** Winkel eines Segments (von unten nach oben) gegenüber der Senkrechten in Grad. */
export function angleFromVertical(bottom, top) {
  const dx = top.x - bottom.x, dy = bottom.y - top.y; // dy > 0 wenn top oberhalb
  return (Math.atan2(Math.abs(dx), dy) * 180) / Math.PI;
}

const vis = (p) => p?.visibility ?? 1;

/**
 * Berechnet alle Rohmerkmale eines Frames.
 * @param {Array} lm 33 normalisierte Landmarks
 * @param {number} aspect Bildbreite / Bildhöhe (für korrekte Winkel)
 */
export function computeFrame(lm, aspect = 1) {
  // x mit Seitenverhältnis skalieren, damit Winkel nicht verzerrt werden
  const p = (i) => ({ x: lm[i].x * aspect, y: lm[i].y, visibility: vis(lm[i]) });
  const ls = p(LM.L_SHOULDER), rs = p(LM.R_SHOULDER);
  const lh = p(LM.L_HIP), rh = p(LM.R_HIP);
  const lk = p(LM.L_KNEE), rk = p(LM.R_KNEE);
  const la = p(LM.L_ANKLE), ra = p(LM.R_ANKLE);
  const lhe = p(LM.L_HEEL), rhe = p(LM.R_HEEL);
  const lf = p(LM.L_FOOT), rf = p(LM.R_FOOT);

  const shoulderMid = mid(ls, rs), hipMid = mid(lh, rh);
  const torsoLen = dist(shoulderMid, hipMid) || 1e-6;

  const leftVis = (vis(ls) + vis(lh) + vis(lk) + vis(la)) / 4;
  const rightVis = (vis(rs) + vis(rh) + vis(rk) + vis(ra)) / 4;

  const kneeL = angle(lh, lk, la), kneeR = angle(rh, rk, ra);
  const hipL = angle(ls, lh, lk), hipR = angle(rs, rh, rk);
  const ankleL = angle(lk, la, lf), ankleR = angle(rk, ra, rf);

  // In Seitenansicht ist eine Körperseite verdeckt -> die besser sichtbare nehmen
  const best = leftVis >= rightVis ? "L" : "R";
  const S = best === "L"
    ? { shoulder: ls, hip: lh, knee: lk, ankle: la, heel: lhe, foot: lf, knee_angle: kneeL, hip_angle: hipL }
    : { shoulder: rs, hip: rh, knee: rk, ankle: ra, heel: rhe, foot: rf, knee_angle: kneeR, hip_angle: hipR };

  return {
    // Rohpunkte (seitenverhältnis-korrigiert)
    ls, rs, lh, rh, lk, rk, la, ra, lhe, rhe, lf, rf, shoulderMid, hipMid, S, aspect,
    torsoLen,
    shoulderWidthRatio: Math.abs(ls.x - rs.x) / torsoLen,
    leftVis, rightVis,
    visibility: Math.max(leftVis, rightVis),
    minVisibility: Math.min(leftVis, rightVis),
    kneeL, kneeR, hipL, hipR, ankleL, ankleR,
    kneeAngle: Math.min(leftVis, rightVis) > 0.6 ? (kneeL + kneeR) / 2 : S.knee_angle,
    trunkFromVertical: angleFromVertical(S.hip, S.shoulder),
    shinFromVertical: angleFromVertical(S.ankle, S.knee),
    kneeDist: Math.abs(lk.x - rk.x),
    ankleDist: Math.abs(la.x - ra.x),
    hipY: hipMid.y,
    kneeY: (lk.y + rk.y) / 2,
    hipTilt: Math.abs(lh.y - rh.y) / (Math.abs(lh.x - rh.x) || 1e-6),
    hipShift: (hipMid.x - mid(la, ra).x),
    heelToeL: lhe.y - lf.y, heelToeR: rhe.y - rf.y,
    footLenL: dist(lhe, lf), footLenR: dist(rhe, rf),
  };
}

/** Merkmalsvektor im Format des Kaggle-Datasets (für das ML-Modell). */
export function datasetFeatures(f) {
  const torsoLean = 90 + (f.shoulderMid.x - f.hipMid.x >= 0 ? 1 : -1) * f.trunkFromVertical;
  return [
    f.kneeL, f.kneeR,
    f.hipL, f.hipR,
    f.ankleL, f.ankleR,
    f.hipL,            // spine_angle == left_hip_angle im Dataset
    torsoLean,
    Math.abs(f.lk.x - f.la.x) / f.aspect, Math.abs(f.rk.x - f.ra.x) / f.aspect,
    Math.abs(f.kneeL - f.kneeR) + Math.abs(f.hipL - f.hipR),
    f.hipY,
  ];
}
