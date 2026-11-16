// Synthetischer Selbsttest der Analyse-Logik ohne Kamera.
// Erzeugt Landmark-Sequenzen (Seiten- und Frontansicht) mit gezielten Fehlern
// und prüft, ob die Regeln die richtigen Fehler erkennen.
// Aufruf im Browser: tests/test.html
import { SquatAnalyzer } from "../js/squatAnalyzer.js";

const blank = () => Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.99 }));

/** Seitenansicht: Person schaut nach rechts. depth 0..1 (1 = Hüfte auf Kniehöhe+). */
function sidePose(s, err) {
  const lm = blank();
  const thigh = 0.2, shin = 0.2, torso = 0.25;
  const ankle = { x: 0.5, y: 0.85 };
  // Schienbeinwinkel und Oberkörperwinkel wachsen mit der Tiefe
  const shinA = (35 * s * Math.PI) / 180;
  const knee = { x: ankle.x + shin * Math.sin(shinA), y: ankle.y - shin * Math.cos(shinA) };
  const depthTarget = s * (err.shallow ? 0.6 : err.deep ? 1.5 : 1.15); // Hüfthöhe relativ
  // Hüfte: vertikal so, dass Hüfttiefe stimmt; horizontal hinter dem Knie
  const hipY = 0.85 - shin - thigh + depthTarget * thigh;
  const dy = Math.min(thigh, Math.max(-thigh, knee.y - hipY));
  const hip = { x: knee.x - Math.sqrt(Math.max(0, thigh * thigh - dy * dy)), y: hipY };
  const trunkDeg = (err.lean ? 62 : 35) * s + (err.hipsFirst && s > 0.5 && err._ascent ? 20 : 0);
  const tA = (trunkDeg * Math.PI) / 180;
  const sh = { x: hip.x + torso * Math.sin(tA), y: hip.y - torso * Math.cos(tA) };
  const heelLift = err.heels ? 0.03 * s : 0;
  const heel = { x: ankle.x - 0.04, y: 0.87 - heelLift }, foot = { x: ankle.x + 0.08, y: 0.87 };
  // Realistische MediaPipe-Fehler: Hüft-Landmarke in tiefer Hocke zu hoch
  const hipShown = err.hipHigh ? { x: hip.x, y: hip.y - 0.35 * thigh * s * s } : hip;
  for (const [i, p] of [[11, sh], [12, sh], [23, hipShown], [24, hipShown], [25, knee], [26, knee], [27, ankle], [28, ankle], [29, heel], [30, heel], [31, foot], [32, foot]]) {
    lm[i] = { x: p.x + (i % 2 ? 0 : 0.005), y: p.y, visibility: i % 2 ? 0.99 : 0.6 };
  }
  // ... und verdecktes (rechtes) Bein geschätzt: Knie deutlich zu tief
  if (err.farWrong) lm[26] = { ...lm[26], y: lm[26].y + 0.08 * s, visibility: 0.7 };
  return lm;
}

/** Frontansicht. */
function frontPose(s, err) {
  const lm = blank();
  const thigh = 0.2, shin = 0.2, torso = 0.25, hw = 0.06, aw = 0.08;
  const hipDrop = s * thigh * (err.shallow ? 0.65 : err.deep ? 1.6 : 1.15);
  // Perspektive: Knie kommen in der Hocke näher zur Kamera und wirken tiefer
  const kneeDrop = s * (err.deep ? 0.18 : 0.03);
  const tilt = err.asym ? 0.05 * s : 0;
  const kneeIn = err.knees ? 0.06 * s : -0.01 * s;
  const cx = 0.5;
  const set = (i, x, y) => (lm[i] = { x, y, visibility: 0.99 });
  set(27, cx - aw, 0.85); set(28, cx + aw, 0.85);
  set(29, cx - aw, 0.87); set(30, cx + aw, 0.87);
  set(31, cx - aw - 0.02, 0.88); set(32, cx + aw + 0.02, 0.88);
  set(25, cx - aw + kneeIn, 0.85 - shin + kneeDrop); set(26, cx + aw - kneeIn, 0.85 - shin + kneeDrop);
  const hy = 0.85 - shin - thigh + hipDrop;
  set(23, cx - hw, hy - tilt / 2); set(24, cx + hw, hy + tilt / 2);
  set(11, cx - 0.1, hy - torso); set(12, cx + 0.1, hy - torso);
  return lm;
}

export { sidePose, frontPose };
export function runSet(poseFn, err, reps = 3, fps = 30) {
  const a = new SquatAnalyzer();
  let t = 0;
  const push = (s, ascent = false) => { a.update(poseFn(s, { ...err, _ascent: ascent }), t, 1); t += 1000 / fps; };
  for (let i = 0; i < 30; i++) push(0); // Kalibrierung
  for (let r = 0; r < reps; r++) {
    const n = 45; // 1.5 s runter, 1.5 s hoch
    for (let i = 0; i <= n; i++) push(i / n);
    for (let i = n; i >= 0; i--) push(i / n, true);
    for (let i = 0; i < 15; i++) push(0);
  }
  return a;
}

/** Hand über den Kopf (Nase + Handgelenk ergänzen). */
const withHandUp = (lm) => {
  const c = lm.map((p) => ({ ...p }));
  const sh = c[11];
  c[0] = { x: sh.x, y: sh.y - 0.08, visibility: 0.99 };   // Nase
  c[16] = { x: sh.x + 0.03, y: sh.y - 0.3, visibility: 0.99 }; // rechtes Handgelenk weit oben
  return c;
};
/** Gebückt (Schultern unter Hüfte), z. B. Handy aufheben. */
const bentOver = (s) => {
  const lm = sidePose(s * 0.8, {});
  const hip = lm[23];
  for (const i of [11, 12]) lm[i] = { x: hip.x + 0.25, y: hip.y + 0.06 * s, visibility: 0.99 };
  return lm;
};
/** Seitenansicht, aber Person geht seitlich weg (Füße wandern). */
const walking = (s) => sidePose(s, {}).map((p, i) => ({ ...p, x: p.x + 0.25 * s }));

function extraTests() {
  const out = [];
  const fps = 30, dt = 1000 / fps;

  // 1) Start/Stopp per Handzeichen: vorher keine Wdh., nach Stopp-Geste beendet
  {
    let finished = false;
    const a = new SquatAnalyzer({ requireStartGesture: true, stopGesture: true, onFinish: () => (finished = true) });
    let t = 0; const push = (lm) => { a.update(lm, t, 1); t += dt; };
    for (let i = 0; i < 30; i++) push(sidePose(0, {}));
    for (let r = 0; r < 2; r++) { for (let i = 0; i <= 40; i++) push(sidePose(i / 40, {})); for (let i = 40; i >= 0; i--) push(sidePose(i / 40, {})); }
    const before = a.reps.length, stateBefore = a.state;
    for (let i = 0; i < 30; i++) push(withHandUp(sidePose(0, {})));   // Start-Geste (1 s)
    for (let i = 0; i < 40; i++) push(sidePose(0, {}));                // ruhig stehen -> kalibrieren
    for (let r = 0; r < 3; r++) { for (let i = 0; i <= 40; i++) push(sidePose(i / 40, {})); for (let i = 40; i >= 0; i--) push(sidePose(i / 40, {})); for (let i = 0; i < 10; i++) push(sidePose(0, {})); }
    for (let i = 0; i < 30; i++) push(withHandUp(sidePose(0, {})));   // Stopp-Geste
    for (let i = 0; i < 20; i++) push(walking(i / 20));                  // zum Handy gehen
    const ok = before === 0 && stateBefore === "waiting" && a.reps.length === 3 && finished && a.state === "finished";
    out.push({ name: "Handzeichen: Start, 3 Wdh., Stopp", ok, reps: a.reps.length, view: a.view, found: [`vorher=${before}`, `state=${a.state}`, `finished=${finished}`] });
  }

  // 2) Frontal kalibriert, dann seitlich gedreht -> neu kalibriert, keine Knie/Asymmetrie-Fehler
  {
    const a = new SquatAnalyzer();
    let t = 0; const push = (lm) => { a.update(lm, t, 1); t += dt; };
    for (let i = 0; i < 30; i++) push(frontPose(0, {}));
    const v1 = a.view;
    for (let i = 0; i < 50; i++) push(sidePose(0, {}));   // umdrehen + stehen
    for (let r = 0; r < 3; r++) { for (let i = 0; i <= 40; i++) push(sidePose(i / 40, {})); for (let i = 40; i >= 0; i--) push(sidePose(i / 40, {})); for (let i = 0; i < 10; i++) push(sidePose(0, {})); }
    const found = [...new Set(a.reps.flatMap((r) => r.issues.map((i) => i.key)))];
    const ok = v1 === "front" && a.view === "side" && a.reps.length === 3 && found.length === 0;
    out.push({ name: "Nach Kalibrierung umgedreht", ok, reps: a.reps.length, view: `${v1}→${a.view}`, found });
  }

  // 3) Geister-Bewegungen: bücken und weggehen zählen nicht
  {
    const a = new SquatAnalyzer();
    let t = 0; const push = (lm) => { a.update(lm, t, 1); t += dt; };
    for (let i = 0; i < 30; i++) push(sidePose(0, {}));
    for (let i = 0; i <= 30; i++) push(bentOver(i / 30)); for (let i = 30; i >= 0; i--) push(bentOver(i / 30));
    for (let i = 0; i < 10; i++) push(sidePose(0, {}));
    for (let i = 0; i <= 30; i++) { const lm = sidePose(i / 30, {}).map((p) => ({ ...p, x: p.x + 0.2 * (i / 30) })); push(lm); }
    for (let i = 30; i >= 0; i--) { const lm = sidePose(i / 30, {}).map((p) => ({ ...p, x: p.x + 0.2 })); push(lm); }
    const ok = a.reps.length === 0 && a.discarded >= 1;
    out.push({ name: "Bücken / Weggehen wird ignoriert", ok, reps: a.reps.length, view: a.view, found: [`verworfen=${a.discarded}`] });
  }
  return out;
}

export function runTests() {
  const cases = [
    { name: "Seite – sauber", fn: sidePose, err: {}, expect: [], view: "side" },
    { name: "Seite – sehr tief, Hüfte zu hoch erkannt", fn: sidePose, err: { deep: true, hipHigh: true }, expect: [], view: "side" },
    { name: "Seite – sehr tief, verdecktes Bein falsch", fn: sidePose, err: { deep: true, farWrong: true }, expect: [], view: "side" },
    { name: "Seite – zu flach", fn: sidePose, err: { shallow: true }, expect: ["shallow"], view: "side" },
    { name: "Seite – Vorlage", fn: sidePose, err: { lean: true }, expect: ["forward_lean"], view: "side" },
    { name: "Seite – Fersen", fn: sidePose, err: { heels: true }, expect: ["heels_up"], view: "side" },
    { name: "Seite – Hüfte zuerst", fn: sidePose, err: { hipsFirst: true }, expect: ["hips_first"], view: "side" },
    { name: "Front – sauber", fn: frontPose, err: {}, expect: [], view: "front" },
    { name: "Front – sehr tief (Perspektive)", fn: frontPose, err: { deep: true }, expect: [], view: "front" },
    { name: "Front – zu flach", fn: frontPose, err: { shallow: true }, expect: ["shallow"], view: "front" },
    { name: "Front – Knie innen", fn: frontPose, err: { knees: true }, expect: ["knees_in"], view: "front" },
    { name: "Front – asymmetrisch", fn: frontPose, err: { asym: true }, expect: ["asymmetric"], view: "front" },
  ];
  return cases.map((c) => {
    const a = runSet(c.fn, c.err);
    const found = [...new Set(a.reps.flatMap((r) => r.issues.map((i) => i.key)))].sort();
    const ok = a.reps.length === 3 && a.view === c.view && JSON.stringify(found) === JSON.stringify([...c.expect].sort());
    return { name: c.name, ok, reps: a.reps.length, view: a.view, found, metrics: a.reps[0]?.metrics };
  }).concat(extraTests());
}
