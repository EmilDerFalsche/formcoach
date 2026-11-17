// Synthetische Tests für Liegestütz- und Tennis-Analyse.
import { PushupAnalyzer } from "../js/pushupAnalyzer.js";
import { TennisAnalyzer } from "../js/tennisAnalyzer.js";

const IDX = { nose: 0, lear: 7, rear: 8, lsh: 11, rsh: 12, lel: 13, rel: 14, lwr: 15, rwr: 16, lhip: 23, rhip: 24, lkn: 25, rkn: 26, lank: 27, rank: 28, lheel: 29, rheel: 30, lfoot: 31, rfoot: 32 };
const toLm = (pts, vis = {}) => {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.99 }));
  for (const [k, [x, y]] of Object.entries(pts)) lm[IDX[k]] = { x, y, visibility: vis[k] ?? 0.99 };
  return lm;
};
const lerp = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
const sorted = (arr) => [...new Set(arr)].sort();
const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

// ---------- Liegestütz ----------
function pushPose(s, o = {}) {
  const top = o.noLockout ? 150 : 170, low = o.shallow ? 122 : 85;
  const th = ((top - (top - low) * s) * Math.PI) / 180;
  const a = 0.12;
  const dSW = Math.sqrt(2 * a * a * (1 - Math.cos(th)));
  const wr = [0.3, 0.8], sh = [0.3, 0.8 - dSW];
  const el = [0.3 + Math.sqrt(Math.max(0, a * a - (dSW / 2) ** 2)), 0.8 - dSW / 2];
  const ank = [0.85, 0.8];
  const L = Math.hypot(ank[0] - sh[0], ank[1] - sh[1]);
  const u = [(ank[0] - sh[0]) / L, (ank[1] - sh[1]) / L];
  const off = (o.sag ?? 0) - (o.pike ?? 0);
  const hip = [sh[0] + u[0] * 0.45 * L, sh[1] + u[1] * 0.45 * L + off * L];
  const kn = [sh[0] + u[0] * 0.72 * L, sh[1] + u[1] * 0.72 * L + off * 0.5 * L];
  const ear = [sh[0] - u[0] * 0.07, sh[1] - u[1] * 0.07 + (o.headDrop ? 0.1 * L : -0.01)];
  const p = { nose: [ear[0] - 0.02, ear[1] + 0.01], lear: ear, rear: ear, lsh: sh, rsh: sh, lel: el, rel: el, lwr: wr, rwr: wr, lhip: hip, rhip: hip, lkn: kn, rkn: kn, lank: ank, rank: ank, lheel: [0.86, 0.8], rheel: [0.86, 0.8], lfoot: [0.9, 0.81], rfoot: [0.9, 0.81] };
  return toLm(p, { rsh: 0.6, rel: 0.6, rwr: 0.6, rhip: 0.6, rank: 0.6 });
}
const standing = (handUp) => toLm({ nose: [0.5, 0.2], lsh: [0.46, 0.3], rsh: [0.54, 0.3], lhip: [0.48, 0.55], rhip: [0.52, 0.55], lank: [0.48, 0.9], rank: [0.52, 0.9], lkn: [0.48, 0.72], rkn: [0.52, 0.72], lwr: handUp ? [0.46, 0.02] : [0.44, 0.55], rwr: [0.56, 0.55], lel: [0.45, 0.42], rel: [0.55, 0.42] });

function runPushups(o, reps = 3, { gestures = false } = {}) {
  let finished = false;
  const a = new PushupAnalyzer({ requireStartGesture: gestures, stopGesture: gestures, onFinish: () => (finished = true) });
  let t = 0; const push = (lm) => { a.update(lm, t, 1); t += 1000 / 30; };
  if (gestures) { for (let i = 0; i < 30; i++) push(standing(true)); for (let i = 0; i < 20; i++) push(standing(false)); }
  for (let i = 0; i < 20; i++) push(pushPose(0, o));
  for (let r = 0; r < reps; r++) {
    for (let i = 0; i <= 30; i++) push(pushPose(i / 30, o));
    for (let i = 30; i >= 0; i--) push(pushPose(i / 30, o));
    for (let i = 0; i < 10; i++) push(pushPose(0, o));
  }
  if (gestures) { for (let i = 0; i < 25; i++) push(standing(false)); for (let i = 0; i < 35; i++) push(standing(true)); }
  return { a, finished };
}

// ---------- Tennis ----------
const BASE = {
  nose: [0.5, 0.3], lear: [0.47, 0.29], rear: [0.53, 0.29],
  lsh: [0.4, 0.4], rsh: [0.6, 0.4], lel: [0.38, 0.5], rel: [0.62, 0.5], lwr: [0.42, 0.6], rwr: [0.58, 0.6],
  lhip: [0.45, 0.6], rhip: [0.55, 0.6], lkn: [0.42, 0.75], rkn: [0.58, 0.75], lank: [0.45, 0.9], rank: [0.55, 0.9],
  lheel: [0.45, 0.92], rheel: [0.55, 0.92], lfoot: [0.43, 0.93], rfoot: [0.57, 0.93],
};
/** Keyframes [[ms, overrides]] -> Landmarks zu Zeit t (linear interpoliert). */
function timeline(keys) {
  const full = keys.map(([t, o]) => [t, { ...BASE, ...o }]);
  return (t) => {
    let i = full.findIndex(([kt]) => kt > t);
    if (i === -1) return toLm(full.at(-1)[1]);
    if (i === 0) return toLm(full[0][1]);
    const [t0, a] = full[i - 1], [t1, b] = full[i];
    const k = (t - t0) / (t1 - t0);
    return toLm(Object.fromEntries(Object.keys(a).map((n) => [n, lerp(a[n], b[n], k)])));
  };
}
function strokeKeys(kind, o = {}) {
  const straight = o.straightLegs ? { lkn: [0.45, 0.75], rkn: [0.55, 0.75] } : {};
  const compress = o.noTurn ? {} : { lsh: [0.48, 0.4], rsh: [0.52, 0.4] };
  if (kind === "forehand") {
    const finish = o.lowFollow ? [0.35, 0.62] : o.highFinish ? [0.36, 0.1] : [0.35, 0.36];
    const finishEl = o.highFinish ? [0.42, 0.22] : [0.45, 0.4];
    const point = o.pointLeft ? { lwr: [0.3, 0.12], lel: [0.35, 0.25] } : {}; // linke Hand zeigt hoch zum Ball
    return [
      [0, straight], [1500, straight],
      ...(o.loop ? [[1850, { ...straight, ...compress, ...point, rwr: [0.72, 0.28], rel: [0.7, 0.36] }]] : []), // Loop: Hand über Schulterhöhe
      [2100, { ...straight, ...compress, ...point, rwr: [0.8, 0.55], rel: [0.7, 0.5] }],
      [2300, { ...straight, ...point, rwr: [0.55, 0.5], rel: o.cramped ? [0.64, 0.5] : [0.58, 0.45] }],   // Treffpunkt (eng: Ellbogen ~70°)
      [2380, { ...straight, ...(o.pointLeft ? { lwr: [0.32, 0.2], lel: [0.36, 0.28] } : {}), rwr: [0.45, 0.42], rel: o.cramped ? [0.48, 0.5] : [0.52, 0.42] }],
      [2750, { ...straight, ...(o.pointLeft ? { lwr: [0.4, 0.45], lel: [0.38, 0.45] } : {}), rwr: finish, rel: finishEl }], // Ausschwung, linke Hand sinkt
      [3100, { ...straight, rwr: finish, rel: finishEl }],
      [4000, straight], [5000, straight],
    ];
  }
  if (kind === "backhand") {
    const two = o.twoHanded;
    return [
      [0, straight], [1500, straight],
      [2100, { ...straight, ...compress, rwr: [0.22, 0.55], rel: [0.32, 0.5], ...(two ? { lwr: [0.25, 0.55] } : {}) }],
      [2350, { ...straight, rwr: [0.62, 0.5], rel: o.bent ? [0.5, 0.58] : [0.61, 0.45], ...(two ? { lwr: [0.6, 0.5] } : {}) }],
      [2500, { ...straight, rwr: [0.8, 0.36], rel: [0.7, 0.38], ...(two ? { lwr: [0.78, 0.37] } : {}) }],
      [3100, { ...straight, rwr: [0.8, 0.36], rel: [0.7, 0.38], ...(two ? { lwr: [0.78, 0.37] } : {}) }],
      [4000, straight], [5000, straight],
    ];
  }
  // Aufschlag
  const bent = o.noKnees ? {} : { lkn: [0.37, 0.72], rkn: [0.63, 0.72] };
  const toss = o.noToss ? {} : { lwr: [0.42, 0.05], lel: [0.41, 0.2] };
  const contact = o.lowContact ? { rwr: [0.62, 0.22], rel: [0.72, 0.3] } : { rwr: [0.58, 0.02], rel: [0.59, 0.21] };
  const follow = o.shortFollow ? { rwr: [0.62, 0.45], rel: [0.66, 0.42] } : { rwr: [0.4, 0.72], rel: [0.45, 0.6] };
  return [
    [0, {}], [1500, {}],
    [2050, { ...bent, ...toss, rwr: [0.68, 0.3], rel: [0.7, 0.38] }],          // Trophy-Position
    [2250, { ...bent, ...toss, rwr: [0.7, 0.42], rel: [0.7, 0.32] }],          // Schläger fällt hinter den Rücken
    [2350, { ...contact, ...(o.noToss ? {} : { lwr: [0.43, 0.25], lel: [0.42, 0.33] }) }], // Treffpunkt, Wurfarm sinkt langsam
    [2750, { ...follow }],
    [3200, { ...follow }],
    [4200, {}], [5200, {}],
  ];
}

/** Simulierter Schläger (aus Hand + Unterarmrichtung) und Ball – wie sie die Objekterkennung liefern würde. */
function synthObjects(lm, s, kind, o) {
  const w = lm[16], e = lm[14];
  const len = Math.hypot(w.x - e.x, w.y - e.y) || 1;
  // Aufschlag: Schläger in Verlängerung des Arms; Grundschläge: Schläger zeigt im Treffpunkt etwa waagerecht nach außen
  let racket = kind === "serve"
    ? { x: w.x + ((w.x - e.x) / len) * 0.2, y: w.y + ((w.y - e.y) / len) * 0.2, w: 0.1, h: 0.1 }
    : { x: w.x + (kind === "forehand" ? 0.2 : -0.2), y: w.y - 0.02, w: 0.1, h: 0.1 };
  if (kind === "forehand" && s > 2050 && s < 2250) racket = { ...racket, x: w.x + 0.12, y: w.y + (o.noDrop ? -0.12 : 0.12) }; // Schlägerkopf fällt (Topspin)
  const racketAt = (ss) => racket; // vereinfachend: Ball fliegt auf den aktuellen Schläger zu
  let ball = null;
  if (kind !== "serve") {
    if (s >= 1900 && s <= 2300) { const k = (s - 1900) / 400; const r = racketAt(s); ball = { x: 0.1 + (r.x - 0.1) * k, y: 0.45 + (r.y - 0.45) * k }; }
    else if (s > 2300 && s < 2700) { const k = (s - 2300) / 400; ball = { x: 0.6 - 0.5 * k, y: 0.48 - 0.1 * k }; }
  } else {
    const apexY = o.tossLow ? 0.05 : -0.24;
    if (s >= 1500 && s <= 2050) { const k = (s - 1500) / 550; ball = { x: 0.42 + 0.08 * k, y: 0.6 + (apexY - 0.6) * (1 - (1 - k) ** 2) }; }
    else if (s > 2050 && s <= 2350) { const k = (s - 2050) / 300; ball = { x: 0.5 + (racket.x - 0.5) * k, y: apexY + (racket.y - apexY) * k }; }
  }
  return { racket, ball };
}

function runTennis(stroke, playKind, o = {}, n = 3, { gestures = false, fps = 30 } = {}) {
  let finished = false;
  const discarded = [];
  const a = new TennisAnalyzer({ stroke, hand: "R", requireStartGesture: gestures, stopGesture: gestures, onFinish: () => (finished = true), onEvent: (ty, info) => ty === "discarded" && discarded.push(info) });
  let t = 0; const dt = 1000 / fps;
  const push = (lm, objs = null) => { a.update(lm, t, 1, objs); t += dt; };
  if (gestures) {
    const up = toLm({ ...BASE, lwr: [0.42, 0.05], lel: [0.41, 0.2] });
    for (let i = 0; i < 30; i++) push(up);
    for (let i = 0; i < 15; i++) push(toLm(BASE));
  }
  const tl = timeline(strokeKeys(playKind, o));
  const SWAP = [[7, 8], [11, 12], [13, 14], [15, 16], [23, 24], [25, 26], [27, 28], [29, 30], [31, 32]];
  const mirrorLabels = (lm) => { const c = lm.slice(); for (const [a, b] of SWAP) { c[a] = lm[b]; c[b] = lm[a]; } return c; };
  for (let k = 0; k < n; k++) for (let s = 0; s < 5200; s += dt) {
    const lm = tl(s);
    push(o.swapLabels ? mirrorLabels(lm) : lm, o.objects ? synthObjects(lm, s, playKind, o) : null);
  }
  if (gestures) {
    const both = toLm({ ...BASE, lwr: [0.42, 0.05], lel: [0.41, 0.2], rwr: [0.58, 0.05], rel: [0.59, 0.2] });
    for (let i = 0; i < 45; i++) push(both);
  }
  return { a, finished, discarded };
}

export function runExerciseTests() {
  const out = [];
  const keys = (a) => a.reps.flatMap((r) => r.issues.map((i) => i.key));

  const pushCases = [
    ["Liegestütz – sauber", {}, []],
    ["Liegestütz – zu wenig Tiefe", { shallow: true }, ["shallow"]],
    ["Liegestütz – Hüfte hängt durch", { sag: 0.1 }, ["hip_sag"]],
    ["Liegestütz – Po zu hoch", { pike: 0.12 }, ["hip_pike"]],
    ["Liegestütz – Arme oben nicht gestreckt", { noLockout: true }, ["no_lockout"]],
    ["Liegestütz – Kopf hängt", { headDrop: true }, ["head_drop"]],
  ];
  for (const [name, o, expect] of pushCases) {
    const { a } = runPushups(o);
    const found = keys(a);
    out.push({ name, ok: a.reps.length === 3 && same(found, expect), reps: a.reps.length, view: a.view, found: sorted(found), metrics: a.reps[0]?.metrics ?? a.discardedSwings?.[0] });
  }
  {
    const { a, finished } = runPushups({}, 2, { gestures: true });
    out.push({ name: "Liegestütz – Handzeichen Start, Aufstehen + Hand = Stopp", ok: a.reps.length === 2 && finished, reps: a.reps.length, view: a.view, found: [`finished=${finished}`, `state=${a.state}`] });
  }

  const tennisCases = [
    ["Tennis Vorhand – sauber", "forehand", "forehand", {}, []],
    ["Tennis Vorhand – keine Schulterdrehung", "forehand", "forehand", { noTurn: true }, ["turn"]],
    ["Tennis Vorhand – flacher Ausschwung", "forehand", "forehand", { lowFollow: true }, ["low_follow"]],
    ["Tennis Vorhand – gestreckte Beine", "forehand", "forehand", { straightLegs: true }, ["ground_knees"]],
    ["Tennis Vorhand – Ball zu nah am Körper", "forehand", "forehand", { cramped: true }, ["cramped"]],
    ["Tennis Vorhand – Ausschwung über Kopfhöhe (kein Aufschlag!)", "forehand", "forehand", { highFinish: true }, []],
    ["Tennis Vorhand – linke Hand zeigt hoch zum Ball", "forehand", "forehand", { pointLeft: true, highFinish: true }, []],
    ["Tennis Vorhand – Loop-Ausholen über Schulter + hoher Ausschwung", "forehand", "forehand", { loop: true, highFinish: true, pointLeft: true }, []],
    ["Tennis Vorhand – MediaPipe vertauscht links/rechts (von hinten)", "forehand", "forehand", { swapLabels: true, pointLeft: true, highFinish: true }, []],
    ["Tennis Rückhand beidhändig – sauber", "backhand", "backhand", { twoHanded: true }, []],
    ["Tennis Rückhand einhändig – Arm gebeugt", "backhand", "backhand", { bent: true }, ["bh_arm_bent"]],
    ["Tennis Aufschlag – sauber", "serve", "serve", {}, []],
    ["Tennis Aufschlag – keine Kniebeugung", "serve", "serve", { noKnees: true }, ["serve_knees"]],
    ["Tennis Aufschlag – tiefer Treffpunkt, Arm gebeugt", "serve", "serve", { lowContact: true }, ["serve_arm_bent", "serve_low_contact"]],
    ["Tennis Aufschlag – Ballwurfarm unten", "serve", "serve", { noToss: true }, ["serve_toss_arm"]],
    ["Tennis Aufschlag – kurzer Ausschwung", "serve", "serve", { shortFollow: true }, ["serve_short_follow"]],
  ];
  // Handy live: nur ~10–15 Bilder/s (aus echtem Export gemessen: ~11 fps)
  const lowFps = [
    ["12 fps: Vorhand – hoher Ausschwung + zeigende Hand", "forehand", "forehand", { highFinish: true, pointLeft: true }, []],
    ["12 fps: Vorhand – sauber", "forehand", "forehand", {}, []],
    ["12 fps: Vorhand – Ball zu nah am Körper", "forehand", "forehand", { cramped: true }, ["cramped"]],
    ["12 fps: Aufschlag – sauber", "serve", "serve", {}, []],
    ["12 fps: Rückhand beidhändig – sauber", "backhand", "backhand", { twoHanded: true }, []],
    ["12 fps: Vorhand mit Schläger & Ball – sauber", "forehand", "forehand", { objects: true }, []],
  ].map(([n, s, p, o, e]) => [n, s, p, o, e, 12]);
  const withObjects = [
    ["Schläger & Ball: Vorhand – sauber (Treffpunkt über Ball)", "forehand", "forehand", { objects: true }, []],
    ["Schläger & Ball: Vorhand – kein Topspin-Schwung", "forehand", "forehand", { objects: true, noDrop: true }, ["no_racket_drop"]],
    ["Schläger & Ball: Aufschlag – sauber", "serve", "serve", { objects: true }, []],
    ["Schläger & Ball: Aufschlag – Ballwurf zu niedrig", "serve", "serve", { objects: true, tossLow: true }, ["toss_low"]],
  ];
  for (const [name, stroke, play, o, expect, fps] of [...tennisCases, ...lowFps, ...withObjects]) {
    const { a } = runTennis(stroke, play, o, 3, { fps: fps ?? 30 });
    const found = keys(a);
    out.push({ name, ok: a.reps.length === 3 && same(found, expect), reps: a.reps.length, view: a.view, found: sorted(found), metrics: a.reps[0]?.metrics ?? a.discardedSwings?.[0] });
  }
  {
    const { a, discarded } = runTennis("forehand", "backhand", { twoHanded: true }, 2);
    out.push({ name: "Tennis – Rückhand im Vorhand-Training wird nicht gewertet", ok: a.reps.length === 0 && discarded.length === 2, reps: a.reps.length, view: a.view, found: discarded });
  }
  {
    const { a, discarded } = runTennis("forehand", "serve", {}, 2);
    out.push({ name: "Tennis – Aufschlag im Vorhand-Training wird nicht gewertet", ok: a.reps.length === 0 && discarded.length === 2, reps: a.reps.length, view: a.view, found: discarded });
  }
  {
    const { a, finished } = runTennis("serve", "serve", {}, 2, { gestures: true });
    out.push({ name: "Tennis – Start mit einer Hand, Aufschlag stoppt nicht, beide Hände = Stopp", ok: a.reps.length === 2 && finished, reps: a.reps.length, view: a.view, found: [`finished=${finished}`] });
  }
  return out;
}
