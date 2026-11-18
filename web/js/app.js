import { initPose, detect, drawPose, initObjects, detectObjects, drawObjects } from "./pose.js";
import { THRESHOLDS } from "./squatAnalyzer.js";
import { PUSHUP_T } from "./pushupAnalyzer.js";
import { TENNIS_T } from "./tennisAnalyzer.js";
import { SquatClassifier } from "./classifier.js";
import { ML_LABEL_TEXT, Voice, repCue, summarize } from "./feedback.js";
import { Cloud, uuid } from "./cloud.js";
import { EXERCISES, exerciseOf, photoUrl, HOME_EXERCISES } from "./exercises.js";
import { FrameRing, saveSnaps, loadSnaps } from "./snapshots.js";

const ring = new FrameRing(); // letzte Sekunden in kleiner Auflösung -> Standbilder im Schlüsselmoment

const cloud = new Cloud();

const $ = (id) => document.getElementById(id);
const video = $("video"), canvas = $("overlay"), ctx = canvas.getContext("2d");
const voice = new Voice();
const VIEW_TEXT = { front: "frontal", side: "seitlich", diagonal: "diagonal", unbekannt: "–" };

let classifier;
let analyzer = null;
let mode = null;          // "live" | "video"
let running = false;
let stream = null;
let wakeLock = null;
let highlight = { joints: [], until: 0, good: false };
let lastStatus = "";
let lastExport = null;
let activeEx = EXERCISES.squat;   // Übung des laufenden / angezeigten Satzes
let videoInfo = null;             // Diagnose der Video-Analyse (für Export und Hinweise)

// ---------- Übungsauswahl ----------
const sel = { exercise: "squat", stroke: "serve", hand: "R" };
const selectedEx = () => exerciseOf(sel.exercise === "tennis" ? `tennis_${sel.stroke}` : sel.exercise);

function renderPicker() {
  document.querySelectorAll("#ex-chips .chip").forEach((c) => {
    const on = c.dataset.ex === sel.exercise;
    c.classList.toggle("active", on);
    c.setAttribute("aria-checked", on);
  });
  $("tennis-opts").hidden = sel.exercise !== "tennis";
  document.querySelectorAll("#stroke-seg .seg").forEach((b) => b.classList.toggle("active", b.dataset.stroke === sel.stroke));
  document.querySelectorAll("#hand-seg .seg").forEach((b) => b.classList.toggle("active", b.dataset.hand === sel.hand));
  const ex = selectedEx();
  $("howto-steps").innerHTML = ex.howto.map(([icon, title, text]) =>
    `<div class="step"><span class="step-icon"><svg><use href="#${icon}" /></svg></span><div><b>${title}</b><p>${text}</p></div></div>`).join("");
}
document.querySelectorAll("#ex-chips .chip").forEach((c) => c.addEventListener("click", () => { sel.exercise = c.dataset.ex; renderPicker(); saveSettings(); }));
document.querySelectorAll("#stroke-seg .seg").forEach((b) => b.addEventListener("click", () => { sel.stroke = b.dataset.stroke; renderPicker(); saveSettings(); }));
document.querySelectorAll("#hand-seg .seg").forEach((b) => b.addEventListener("click", () => { sel.hand = b.dataset.hand; renderPicker(); saveSettings(); }));

// ---------- Navigation ----------
function show(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
  document.body.classList.toggle("on-home", id === "screen-home");
  window.scrollTo(0, 0);
}

// ---------- Einstellungen (pro Gerät gemerkt) ----------
const SETTINGS_KEY = "formcoach.settings";
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    if ("voice" in s) $("opt-voice").checked = s.voice;
    if ("front" in s) $("opt-front").checked = s.front;
    if ("gesture" in s) $("opt-gesture").checked = s.gesture;
    if ("ml2" in s) $("opt-ml").checked = s.ml2; // alter Schlüssel "ml" bewusst ignoriert (jetzt standardmäßig aus)
    if (s.model) $("opt-model").value = s.model;
    if (["squat", "pushup", "tennis"].includes(s.exercise)) sel.exercise = s.exercise;
    if (["serve", "forehand", "backhand"].includes(s.stroke)) sel.stroke = s.stroke;
    if (s.hand === "L" || s.hand === "R") sel.hand = s.hand;
    if (s.slowmo) $("opt-slowmo").value = s.slowmo;
    if (s.speed) $("opt-speed").value = s.speed;
    if ("objects" in s) $("opt-objects").checked = s.objects;
  } catch {}
}
function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      voice: $("opt-voice").checked, front: $("opt-front").checked,
      gesture: $("opt-gesture").checked, ml2: $("opt-ml").checked, model: $("opt-model").value,
      exercise: sel.exercise, stroke: sel.stroke, hand: sel.hand,
      slowmo: $("opt-slowmo").value, objects: $("opt-objects").checked, speed: $("opt-speed").value,
    }));
  } catch {}
}
["opt-voice", "opt-front", "opt-gesture", "opt-ml", "opt-model", "opt-slowmo", "opt-objects", "opt-speed"].forEach((id) => $(id).addEventListener("change", saveSettings));

// ---------- Setup ----------
async function prepare() {
  ring.reset();
  $("loading").hidden = false;
  $("loading-text").textContent = "Lade KI-Modell …";
  voice.enabled = $("opt-voice").checked;
  await initPose($("opt-model").value);
  activeEx = selectedEx();
  if (activeEx.usesClassifier && classifier === undefined) classifier = await SquatClassifier.load();
  const gestures = mode === "live" && $("opt-gesture").checked;
  analyzer = activeEx.create({
    classifier: activeEx.usesClassifier && $("opt-ml").checked ? classifier : null,
    hand: sel.hand,
    onRep,
    onEvent,
    onFinish: () => setTimeout(finish, 0),
    requireStartGesture: gestures,
    stopGesture: gestures,
  });
  $("stage").classList.toggle("gestures", gestures);
  // Anzeigen an die Übung anpassen
  $("hud-unit").textContent = activeEx.unit.short;
  $("meter-label").textContent = activeEx.meter.label;
  $("meter-target").style.top = `${100 / activeEx.meter.max}%`;
  $("start-hint-text").textContent = activeEx.startHint;
  $("stop-hint-text").textContent = activeEx.stopHint;
  $("stage").classList.add("pre");
  $("depth-fill").style.height = "0%";
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  $("hud-reps").textContent = "0";
  $("hud-feedback").innerHTML = "";
  $("hud-feedback").className = "feedback";
  lastStatus = "";
}

function sizeCanvas() {
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
}

// ---------- Live ----------
async function startLive() {
  mode = "live";
  videoInfo = null;
  show("screen-analyze");
  const front = $("opt-front").checked;
  $("stage").classList.toggle("mirror", front);
  try {
    await prepare();
    $("loading-text").textContent = "Starte Kamera …";
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: front ? "user" : "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    video.srcObject = stream;
    video.removeAttribute("src");
    await video.play();
    sizeCanvas();
    try { wakeLock = await navigator.wakeLock?.request("screen"); } catch {}
    $("loading").hidden = true;
    running = true;
    voice.say(analyzer.requireStartGesture
      ? activeEx.voice.intro
      : "Ganzer Körper ins Bild, dann geht's los.", { force: true });
    requestAnimationFrame(liveLoop);
  } catch (e) {
    console.error(e);
    $("loading-text").textContent = e.name === "NotAllowedError"
      ? "Kamerazugriff verweigert. Bitte in den Browser-Einstellungen erlauben."
      : `Kamera konnte nicht gestartet werden (${e.message}). Hinweis: Die Kamera funktioniert nur über HTTPS oder localhost.`;
  }
}

function liveLoop() {
  if (!running || mode !== "live") return;
  if (video.readyState >= 2) processFrame(performance.now());
  requestAnimationFrame(liveLoop);
}

// ---------- Video-Upload ----------
// ---------- Video-Analyse: Tempo-Stufen ----------
// fineFps: Bilder pro Sekunde (echte Zeit) rund um einen Schlag
// objPre/objPost: Zeitfenster um die Schlagspitze, in dem Schläger & Ball gesucht werden (Sekunden)
const VIDEO_PRESETS = {
  fast:     { fineFps: 30,  objPre: 0.5, objPost: 0.3, linearFps: 15 },
  balanced: { fineFps: 60,  objPre: 0.8, objPost: 0.5, linearFps: 30 },
  precise:  { fineFps: 120, objPre: 1.6, objPost: 1.0, linearFps: 30 },
};
const SCAN_FPS = 10;          // Suchlauf: so viele Bilder pro Sekunde (echte Zeit)
const SCAN_TRIGGER = 3.5;     // Handgelenk-Tempo (Rumpflängen/s) im Suchlauf, ab dem ein Schlag vermutet wird
const WIN_BEFORE = 2.6;       // Sekunden vor der Schlagspitze (für Ausholen + Schulterdrehung)
const WIN_AFTER = 1.2;        // Sekunden danach (Ausschwung)

const yieldUI = () => new Promise((r) => setTimeout(r));
const fmtSec = (sec) => (sec >= 90 ? `${Math.round(sec / 60)} min` : `${Math.max(1, Math.round(sec))} s`);

function setVideoStatus(text) {
  $("hud-status").textContent = text;
  $("hud-status").dataset.state = "down";
  lastStatus = "video";
}

/** Kniebeuge/Liegestütz: gleichmäßig durch das ganze Video. */
async function analyzeVideoLinear(total, preset) {
  const step = 1 / preset.linearFps;
  let n = 0;
  const t0 = performance.now();
  for (let tv = 0; tv <= total && running && mode === "video"; tv += step, n++) {
    await seekTo(tv);
    processFrame(tv * 1000);
    const done = tv / total, el = (performance.now() - t0) / 1000;
    setVideoStatus(`Analyse ${Math.round(done * 100)} %${done > 0.05 ? ` · noch ca. ${fmtSec((el / done) * (1 - done))}` : ""}`);
    if (n % 4 === 0) await yieldUI();
  }
}

/**
 * Tennis: zweistufig.
 *  1. Suchlauf mit wenigen Bildern/s, nur Pose → Zeitpunkte der Schläge finden
 *  2. Feinanalyse nur rund um jeden Schlag (Pausen dazwischen werden übersprungen),
 *     Schläger & Ball nur im engen Fenster um den Treffpunkt
 */
async function analyzeTennisVideo(total, slow, useObjects, preset) {
  const totalReal = total / slow;
  const aspect = video.videoWidth / video.videoHeight;

  // ---- 1. Suchlauf ----
  const samples = [];
  let prev = null, n = 0;
  const tScan = performance.now();
  for (let tr = 0; tr <= totalReal && running && mode === "video"; tr += 1 / SCAN_FPS, n++) {
    await seekTo(tr * slow);
    const lm = detect(video);
    drawPose(ctx, lm, {});
    if (lm) {
      const P = (i) => ({ x: lm[i].x * aspect, y: lm[i].y });
      const sh = { x: (P(11).x + P(12).x) / 2, y: (P(11).y + P(12).y) / 2 }, hp = { x: (P(23).x + P(24).x) / 2, y: (P(23).y + P(24).y) / 2 };
      const torso = Math.hypot(sh.x - hp.x, sh.y - hp.y) || 1e-3;
      const cur = { tr, l: P(15), r: P(16) };
      if (prev) {
        const dt = tr - prev.tr;
        const v = Math.max(Math.hypot(cur.l.x - prev.l.x, cur.l.y - prev.l.y), Math.hypot(cur.r.x - prev.r.x, cur.r.y - prev.r.y)) / torso / dt;
        samples.push({ t: tr, v });
      }
      prev = cur;
    } else prev = null;
    setVideoStatus(`Suche Schläge … ${Math.round((tr / totalReal) * 100)} %`);
    if (n % 4 === 0) await yieldUI();
  }
  const msPerPose = (performance.now() - tScan) / Math.max(1, n);

  // Schlagspitzen: lokale Maxima über der Schwelle, mind. 1,2 s Abstand
  const peaks = [];
  for (const s of samples) {
    if (s.v < SCAN_TRIGGER) continue;
    const last = peaks.at(-1);
    if (last && s.t - last.t < 1.2) { if (s.v > last.v) Object.assign(last, s); }
    else peaks.push({ ...s });
  }
  if (!peaks.length || !running) return;

  // Zeitfenster zusammenführen
  const windows = [];
  for (const pk of peaks) {
    const a = Math.max(0, pk.t - WIN_BEFORE), b = Math.min(totalReal, pk.t + WIN_AFTER);
    const last = windows.at(-1);
    if (last && a <= last.b) last.b = b; else windows.push({ a, b });
  }
  // Schläger-/Ballerkennung: nur im Fenster um den Treffpunkt – und automatisch aus, wenn in den
  // ersten Schlägen kein Schläger gefunden wird (z. B. Schattenschläge ohne Schläger)
  let objectsActive = useObjects;
  const AUTO_OFF_FRAMES = 40;
  const objFor = (tr) => objectsActive && peaks.some((pk) => tr >= pk.t - preset.objPre && tr <= pk.t + preset.objPost);

  // Feinanalyse: höchstens so viele Bilder, wie das Video hergibt (Annahme: Datei mit 30 Bildern/s)
  const fineStep = Math.max(1 / preset.fineFps, 1 / (30 * slow));
  // Volle Bildrate nur in der letzten Sekunde vor dem Treffpunkt + Ausschwung; davor (Ausholen) reichen 15 Bilder/s
  const stepFor = (tr) => (peaks.some((pk) => tr >= pk.t - 1.0 && tr <= pk.t + WIN_AFTER) ? fineStep : Math.max(fineStep, 1 / 15));
  let todo = 0, objTodo = 0;
  for (const w of windows) for (let tr = w.a; tr <= w.b; tr += stepFor(tr)) { todo++; if (objFor(tr)) objTodo++; }
  let done = 0;
  const tFine = performance.now();
  for (const w of windows) {
    for (let tr = w.a; tr <= w.b && running && mode === "video"; tr += stepFor(tr), done++) {
      await seekTo(tr * slow);
      processFrame(tr * 1000, { objects: objFor(tr) });
      const vo = videoInfo?.objects;
      if (objectsActive && vo && vo.framesRun >= AUTO_OFF_FRAMES && vo.racketFrames === 0) {
        objectsActive = false;
        vo.autoDisabled = true;
      }
      const el = (performance.now() - tFine) / 1000;
      const est = done > 10 ? (el / done) * (todo - done) : ((todo - done) * msPerPose + objTodo * msPerPose * 3) / 1000;
      setVideoStatus(`${peaks.length} Schläge gefunden · Analyse ${Math.round((done / todo) * 100)} % · noch ca. ${fmtSec(est)}`);
      if (done % 4 === 0) await yieldUI();
    }
  }
}

/** Springt im Video an Zeitpunkt t (Sekunden) und wartet, bis das Bild da ist. */
function seekTo(t) {
  return new Promise((res) => {
    const done = () => { clearTimeout(timer); video.removeEventListener("seeked", done); res(); };
    const timer = setTimeout(done, 1500);
    video.addEventListener("seeked", done);
    video.currentTime = t;
  });
}

async function startVideo(file) {
  mode = "video";
  show("screen-analyze");
  $("stage").classList.remove("mirror");
  try {
    await prepare();
    // Zeitlupe: Zeit im Video / Faktor = echte Zeit (sonst wirkt jeder Schlag 4–8× zu langsam)
    const slow = activeEx.tennis ? Number($("opt-slowmo").value) || 1 : 1;
    const useObjects = activeEx.tennis && $("opt-objects").checked;
    videoInfo = { slow, speed: $("opt-speed").value, objects: { enabled: useObjects, loaded: false, error: null, framesRun: 0, racketFrames: 0, ballFrames: 0 } };
    if (useObjects) {
      $("loading-text").textContent = "Lade Schläger- und Ballerkennung …";
      try { await initObjects(); videoInfo.objects.loaded = true; }
      catch (e) { console.warn("Objekterkennung nicht verfügbar", e); videoInfo.objects.error = String(e?.message ?? e); }
    }
    video.srcObject = null;
    video.src = URL.createObjectURL(file);
    video.muted = true;
    await new Promise((res, rej) => { video.onloadedmetadata = res; video.onerror = () => rej(new Error("Video kann nicht gelesen werden")); });
    sizeCanvas();
    $("loading").hidden = true;
    running = true;
    voice.enabled = false; // beim Upload keine Sprachausgabe pro Wdh.
    video.pause();

    // Bild für Bild statt Abspielen: jedes Bild wird analysiert, auch wenn das Handy langsam rechnet
    const total = video.duration;
    if (!Number.isFinite(total) || total <= 0) throw new Error("Videolänge unbekannt – bitte als MP4 aufnehmen");
    const preset = VIDEO_PRESETS[$("opt-speed").value] ?? VIDEO_PRESETS.balanced;
    if (activeEx.tennis) await analyzeTennisVideo(total, slow, useObjects, preset);
    else await analyzeVideoLinear(total, preset);
    if (running && mode === "video") finish();
  } catch (e) {
    console.error(e);
    $("loading").hidden = false;
    $("loading-text").textContent = `Fehler: ${e.message}`;
  }
}

// ---------- Gemeinsame Frame-Verarbeitung ----------
function processFrame(t, { objects = false, progress = null } = {}) {
  const aspect = video.videoWidth / video.videoHeight;
  const lm = detect(video);
  try { ring.push(t, video, lm, $("stage").classList.contains("mirror")); } catch (e) { /* Standbild ist optional */ }
  const objs = objects ? detectObjects(video) : null;
  if (objects && videoInfo) {
    videoInfo.objects.framesRun++;
    if (objs?.racket) videoInfo.objects.racketFrames++;
    if (objs?.ball) videoInfo.objects.ballFrames++;
  }
  const res = analyzer.update(lm, t, aspect, objs);
  const now = performance.now();
  const hl = now < highlight.until ? highlight : { joints: [], good: false };
  drawPose(ctx, lm, { highlight: hl.joints, good: hl.good });
  drawObjects(ctx, objs, aspect);


  $("hud-view").textContent = `Ansicht: ${VIEW_TEXT[analyzer.view]}`;
  $("stage").classList.toggle("pre", !analyzer.base); // Zähler etc. erst nach Kalibrierung
  $("stage").classList.toggle("waiting", res.status === "waiting");
  $("gesture-fill").style.width = `${Math.round((res.gesture ?? 0) * 100)}%`;
  if (mode !== "video" && (res.status !== lastStatus || res.message !== $("hud-status").textContent)) {
    $("hud-status").textContent = res.message;
    $("hud-status").dataset.state = res.status;
    lastStatus = res.status;
  }
  const d = res.depth ?? 0, max = activeEx.meter.max;
  $("depth-fill").style.height = `${Math.max(0, Math.min(max, d)) / max * 100}%`;
}

function onEvent(type, info) {
  if (type === "start") {
    voice.say(activeEx.voice.afterStart, { force: true });
    if (navigator.vibrate) navigator.vibrate(80);
  } else if (type === "calibrated") {
    voice.say(analyzer.stopGesture ? activeEx.voice.ready : "Los geht's!", { force: true });
  } else if (type === "recalibrate") {
    voice.say(`${info}. Kurz ruhig stehen.`, { force: true });
  } else if (type === "discarded") {
    console.info("Bewegung nicht gewertet:", info);
    if (activeEx.tennis) {
      const fb = $("hud-feedback");
      fb.className = "feedback info show";
      fb.innerHTML = `<b>${info}</b><small>wird beim ${activeEx.name.split("· ")[1]}-Training nicht gewertet</small>`;
    }
  }
}

function onRep(rep) {
  const ex = activeEx;
  // Standbild im Schlüsselmoment (tiefster Punkt / Treffpunkt), fehlerhafte Gelenke rot markiert
  try {
    const joints = rep.issues.flatMap((i) => ex.joints[i.key] ?? []);
    rep.snapshot = ring.snapshotAt(rep.keyT ?? rep.end, joints, !rep.issues.length) ?? undefined;
  } catch (e) { console.warn("Standbild fehlgeschlagen", e); }
  $("hud-reps").textContent = rep.index;
  const fb = $("hud-feedback");
  if (rep.issues.length) {
    fb.className = "feedback bad show";
    fb.innerHTML = `<b>${ex.issues[rep.issues[0].key].cue}</b>` +
      (rep.issues.length > 1 ? `<small>+ ${rep.issues.slice(1).map((i) => ex.issues[i.key].title).join(", ")}</small>` : "");
    highlight = { joints: rep.issues.flatMap((i) => ex.joints[i.key] ?? []), until: performance.now() + 1800, good: false };
  } else {
    fb.className = "feedback good show";
    fb.innerHTML = `<b>${ex.tennis ? "Guter Schlag ✓" : "Saubere Wiederholung ✓"}</b>`;
    highlight = { joints: [], until: performance.now() + 1200, good: true };
  }
  if (navigator.vibrate) navigator.vibrate(rep.issues.length ? [60, 60, 60] : 40);
  voice.say(repCue(rep, ex.issues, ex.praise), { force: true });
}

// ---------- Abschluss ----------
function stopMedia() {
  running = false;
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  if (video.src) { video.pause(); URL.revokeObjectURL(video.src); video.removeAttribute("src"); video.load(); }
  try { wakeLock?.release(); } catch {}
  wakeLock = null;
}

function finish() {
  if (!analyzer || !running) { stopMedia(); show("screen-home"); return; }
  const ex = activeEx;
  const reps = analyzer.reps;
  const trace = analyzer.trace;
  const view = analyzer.view;
  stopMedia();
  const sum = summarize(reps, ex.issues, ex.unit);
  const thresholds = ex.id === "squat" ? THRESHOLDS : ex.id === "pushup" ? PUSHUP_T : TENNIS_T;
  lastExport = {
    app: "FormCoach", version: 3, exercise: ex.id, hand: ex.tennis ? sel.hand : undefined,
    date: new Date().toISOString(), mode, view,
    baseline: analyzer.base, thresholds, discarded: analyzer.discarded, discardedSwings: analyzer.discardedSwings,
    video: mode === "video" ? videoInfo : undefined,
    reps: reps.map(({ ml, snapshot, ...r }) => ({ ...r, ml: ml ? { label: ml.label, confidence: ml.confidence } : null })),
    trace: trace.map((p) => ({ t: Math.round(p.t), d: Math.round(p.d * 1000) / 1000 })),
  };
  renderResult(reps, sum, trace, view, ex);
  $("btn-export").hidden = false;
  $("res-saved").hidden = true;
  if (reps.length) {
    const row = buildWorkout(reps, sum, trace, view, ex);
    // Standbilder nur lokal speichern (nie hochladen). Titelbild: die Wiederholung mit dem deutlichsten Fehler,
    // bei fehlerfreien Sätzen die mittlere.
    const withSnap = reps.filter((r) => r.snapshot);
    if (withSnap.length) {
      const worst = [...withSnap].sort((a, b) => a.score - b.score)[0];
      const cover = worst.score < 100 ? worst.snapshot : withSnap[Math.floor(withSnap.length / 2)].snapshot;
      saveSnaps(row.client_id, { cover, reps: Object.fromEntries(withSnap.map((r) => [r.index, r.snapshot])) });
    }
    saveWorkout(row);
  }
  if ($("opt-voice").checked && reps.length) {
    voice.enabled = true;
    voice.say(`${reps.length} ${reps.length === 1 ? ex.unit.one : ex.unit.many}. Durchschnitt ${sum.avgScore} Punkte. ${sum.ranked[0] ? "Fokus: " + sum.ranked[0].title : "Sehr sauber!"}`, { force: true });
  }
  show("screen-result");
}

const scoreClass = (s) => (s >= 85 ? "good" : s >= 60 ? "mid" : "bad");

function renderResult(reps, sum, trace, view, ex = activeEx) {
  activeEx = ex;
  $("res-score").textContent = reps.length ? sum.avgScore : "–";
  $("score-ring").style.setProperty("--p", reps.length ? sum.avgScore : 0);
  $("score-ring").className = `score-ring ${reps.length ? scoreClass(sum.avgScore) : ""}`;
  const viewText = ex.tennis || ex.id === "pushup" ? "" : ` · ${VIEW_TEXT[view] ?? ""}`;
  $("res-title").textContent = `${ex.name} · ${reps.length} ${reps.length === 1 ? ex.unit.one : ex.unit.many}${viewText}`;
  $("res-headline").textContent = sum.headline;

  const tips = $("res-tips");
  tips.innerHTML = "";
  if (!sum.ranked.length) tips.innerHTML = `<p class="ok">Keine Fehler erkannt – stark!</p>`;
  sum.ranked.forEach((r, i) => {
    // Beispiel-Wiederholung für "Gesehen": die deutlichste mit diesem Fehler
    const ex1 = reps.find((x) => x.issues.some((k) => k.key === r.key && k.severity === "major")) ?? reps.find((x) => x.issues.some((k) => k.key === r.key));
    let seen = r.detail;
    try { if (r.seen && ex1) seen = r.seen(ex1.metrics); } catch (e) { console.warn(e); }
    const fix = Array.isArray(r.fix) ? `<ol>${r.fix.map((f) => `<li>${f}</li>`).join("")}</ol>` : `<p>${r.tip}</p>`;
    const el = document.createElement("div");
    el.className = "tip";
    el.innerHTML = `<div class="tip-head"><span class="badge">${i + 1}</span><b>${r.title}</b><span class="count">${r.reps} von ${reps.length}</span></div>
      <div class="tip-sec seen"><span class="tip-label">Das haben wir gesehen</span>${ex1?.snapshot ? `<img class="tip-snap" src="${ex1.snapshot}" alt="Standbild ${activeEx.tennis ? "Schlag" : "Wdh."} ${ex1.index}" />` : ""}<p>${seen}${ex1 ? ` <small>(${activeEx.tennis ? "Schlag" : "Wdh."} ${ex1.index})</small>` : ""}</p></div>
      ${r.why ? `<div class="tip-sec why"><span class="tip-label">Warum das wichtig ist</span><p>${r.why}</p></div>` : ""}
      <div class="tip-sec how"><span class="tip-label">So korrigierst du es</span>${fix}</div>
      ${r.drill ? `<div class="tip-sec drill"><span class="tip-label">Übung</span><p>${r.drill}</p></div>` : ""}`;
    tips.appendChild(el);
  });
  const note = ex.viewNote(view);
  if (note) tips.insertAdjacentHTML("beforeend", `<p class="hint">${note}</p>`);
  const vo = videoInfo?.objects;
  if (ex.tennis && mode === "video" && vo?.enabled && lastExport) {
    let msg = "";
    if (!vo.loaded) msg = `Die Schläger- und Ballerkennung konnte nicht geladen werden${vo.error ? ` (${vo.error})` : ""}. Der Treffpunkt wurde über die Handbewegung geschätzt.`;
    else if (vo.autoDisabled) msg = "Kein Schläger erkannt (z. B. Schattenschläge) – die Schläger- und Ballerkennung wurde automatisch abgeschaltet, um Zeit zu sparen. Der Treffpunkt wurde über die Handbewegung geschätzt.";
    else if (vo.framesRun && !vo.racketFrames) msg = "Der Schläger wurde in keinem Bild erkannt. Tipps: Schläger gut sichtbar halten, nicht gegen einen unruhigen Hintergrund filmen, Abstand max. 4–5 m. Der Treffpunkt wurde über die Handbewegung geschätzt.";
    else if (vo.framesRun) msg = `Schläger in ${Math.round((vo.racketFrames / vo.framesRun) * 100)} % der untersuchten Bilder erkannt, Ball in ${Math.round((vo.ballFrames / vo.framesRun) * 100)} %.`;
    if (msg) tips.insertAdjacentHTML("beforeend", `<p class="hint">${msg}</p>`);
  }

  const list = $("res-reps");
  list.innerHTML = "";
  const label = ex.tennis ? "Schlag" : "Wdh.";
  reps.forEach((r) => {
    const el = document.createElement("details");
    el.className = "rep";
    const cls = scoreClass(r.score);
    const issueText = r.issues.length ? r.issues.map((i) => `${ex.issues[i.key]?.title ?? i.key}${i.severity === "major" ? " (deutlich)" : ""}`).join(", ") : "Keine Fehler";
    const ml = r.ml ? `<li>KI-Einschätzung: <b>${ML_LABEL_TEXT[r.ml.label]}</b> (${Math.round(r.ml.confidence * 100)} %)</li>` : "";
    const lines = ex.metricLines(r, view).filter(Boolean).map((l) => `<li>${l}</li>`).join("");
    el.innerHTML = `<summary>${r.snapshot ? `<img class="rep-thumb" src="${r.snapshot}" alt="" />` : ""}<span class="rep-score ${cls}">${r.score}</span><span>${label} ${r.index}</span><small>${issueText}</small></summary>
      ${r.snapshot ? `<img class="rep-snap" src="${r.snapshot}" alt="Standbild ${label} ${r.index}" />` : ""}
      <ul class="metrics">${lines}${ml}</ul>`;
    list.appendChild(el);
  });
  $("lg-line-label").textContent = ex.chart.line;
  $("lg-ref-label").textContent = ex.chart.refLabel;
  $("chart-panel").hidden = trace.length < 2;
  drawChart(trace, reps, ex.chart);
}

function drawChart(trace, reps, cfg = activeEx.chart) {
  const c = $("res-chart");
  const w = (c.width = c.clientWidth * devicePixelRatio || 600);
  const h = (c.height = 160 * devicePixelRatio);
  const g = c.getContext("2d");
  g.clearRect(0, 0, w, h);
  if (trace.length < 2) return;
  const t0 = trace[0].t, t1 = trace[trace.length - 1].t;
  const maxD = cfg.max;
  const X = (t) => ((t - t0) / (t1 - t0 || 1)) * w;
  const Y = (d) => h - 8 * devicePixelRatio - (Math.max(-0.1, Math.min(maxD, d)) / maxD) * (h - 16 * devicePixelRatio);
  // Wiederholungs-/Schlag-Bereiche einfärben
  reps.forEach((r) => {
    g.fillStyle = r.issues.length ? "rgba(240,82,82,0.2)" : "rgba(59,130,246,0.18)";
    const x0 = X(r.start), x1 = X(r.end), rad = 6 * devicePixelRatio;
    g.beginPath();
    if (g.roundRect) g.roundRect(x0, 0, x1 - x0, h, rad); else g.rect(x0, 0, x1 - x0, h);
    g.fill();
  });
  g.setLineDash([6 * devicePixelRatio, 6 * devicePixelRatio]); g.strokeStyle = "rgba(148,163,184,0.6)"; g.lineWidth = devicePixelRatio;
  g.beginPath(); g.moveTo(0, Y(cfg.ref)); g.lineTo(w, Y(cfg.ref)); g.stroke(); g.setLineDash([]);
  const grad = g.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, "#3b82f6"); grad.addColorStop(1, "#3b82f6");
  g.strokeStyle = grad; g.lineWidth = 2.5 * devicePixelRatio; g.lineJoin = "round";
  g.beginPath();
  trace.forEach((p, i) => (i ? g.lineTo(X(p.t), Y(p.d)) : g.moveTo(X(p.t), Y(p.d))));
  g.stroke();
}

// ---------- Speichern & Verlauf ----------
const r2 = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) / 100 : v ?? null);
const roundObj = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k, r2(v)]));

/** Kompakte Darstellung eines Satzes für Verlauf / Datenbank (ohne Rohdaten pro Frame). */
function buildWorkout(reps, sum, trace, view, ex = activeEx) {
  const step = Math.max(1, Math.ceil(trace.length / 300));
  return {
    client_id: uuid(),
    performed_at: new Date().toISOString(),
    exercise: ex.id,
    mode, view,
    rep_count: reps.length,
    avg_score: sum.avgScore,
    top_issue: sum.ranked[0]?.key ?? null,
    reps: reps.map((r) => ({
      index: r.index, score: r.score, view: r.view,
      start: Math.round(r.start), end: Math.round(r.end),
      issues: r.issues.map(({ key, severity }) => ({ key, severity })),
      metrics: roundObj(r.metrics), depthParts: r.depthParts,
    })),
    trace: trace.filter((_, i) => i % step === 0).map((p) => ({ t: Math.round(p.t), d: Math.round(p.d * 1000) / 1000 })),
  };
}

async function saveWorkout(row) {
  let status;
  try { status = await cloud.saveWorkout(row); } catch (e) { console.error(e); status = "queued"; }
  showSaveStatus(status);
  renderHistory();
}

function showSaveStatus(status) {
  const el = $("res-saved");
  el.className = "save-status";
  if (status === "saved") {
    el.classList.add("ok");
    el.innerHTML = `<svg><use href="#i-cloud" /></svg>In deinem Konto gespeichert`;
  } else if (status === "queued") {
    el.innerHTML = `<svg><use href="#i-cloud" /></svg>Wird hochgeladen, sobald du online bist`;
  } else if (cloud.enabled) {
    el.innerHTML = `Nur auf diesem Gerät gespeichert · <button id="res-login">Anmelden</button>, um deine Sätze zu sichern`;
    $("res-login").addEventListener("click", openAccount);
  } else {
    el.hidden = true;
    return;
  }
  el.hidden = false;
}

const fmtDate = (iso) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString("de-DE")} ${d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`;
};

// ---------- Startseite (Profil) ----------
let homeItems = [];
const bg = (el, url) => { if (url) el.style.backgroundImage = `url("${url}")`; };
/** Neuestes eigenes Standbild je Übung (für Highlights / Level-Karten) */
const ownCovers = {};

async function renderHistory() {
  let res;
  try { res = await cloud.listWorkouts(); } catch (e) { console.warn(e); return; }
  const { source, items } = res;
  homeItems = items;
  const badge = $("history-source");
  badge.className = `sync-badge ${source === "cloud" ? "cloud" : ""}`;
  badge.textContent = source === "cloud" ? "☁ synchronisiert" : source === "cache" ? "offline" : cloud.enabled && items.length ? "nur auf diesem Gerät gespeichert" : "";

  // Profilkopf
  const scored = items.filter((i) => typeof i.avg_score === "number");
  $("ps-sets").textContent = items.length;
  $("ps-reps").textContent = items.reduce((s, i) => s + (i.rep_count || 0), 0);
  const last10 = scored.slice(0, 10);
  $("ps-score").textContent = last10.length ? Math.round(last10.reduce((s, i) => s + i.avg_score, 0) / last10.length) : "–";
  const email = cloud.user?.email;
  $("p-avatar").textContent = email ? email[0].toUpperCase() : "F";
  $("p-name").textContent = email ? email.split("@")[0] : "Dein Training";

  // Raster
  const grid = $("home-grid");
  grid.innerHTML = "";
  $("home-empty").hidden = items.length > 0;
  for (const k of Object.keys(ownCovers)) delete ownCovers[k];
  items.slice(0, 60).forEach((it) => {
    const ex = exerciseOf(it.exercise);
    const hasDetail = Array.isArray(it.reps) && it.reps.length > 0;
    const t = document.createElement("button");
    t.className = "tile stock";
    bg(t, photoUrl(ex.id, 300));
    const d = new Date(it.performed_at);
    const when = d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
    t.innerHTML = `${it.pending ? '<span class="pending" title="Noch nicht hochgeladen"></span>' : ""}<span class="score ${scoreClass(it.avg_score ?? 0)}">${it.avg_score ?? "–"}</span>
      <span class="lbl"><b>${ex.name.replace("Tennis · ", "")}</b>${when} · ${it.rep_count} ${ex.unit.short}</span>`;
    if (hasDetail) t.addEventListener("click", () => openWorkout(it));
    grid.appendChild(t);
    // eigenes Standbild nachladen
    loadSnaps(it.client_id).then((sn) => {
      if (!sn?.cover) return;
      t.classList.remove("stock");
      bg(t, sn.cover);
      if (!ownCovers[ex.id]) { ownCovers[ex.id] = sn.cover; renderHomeCards(); }
    });
  });
  renderHomeCards();
  if (!$("home-progress").hidden) drawScoreChart($("home-chart"), scored.slice(0, 30).reverse());
}

/** Highlights + Technik-Level-Karten (Foto = eigenes Standbild, sonst Übungsfoto) */
function renderHomeCards() {
  const hl = $("hl-row"), lv = $("level-row");
  hl.innerHTML = ""; lv.innerHTML = "";
  for (const h of HOME_EXERCISES) {
    const mine = ownCovers[h.id];
    const b = document.createElement("button");
    b.className = `hl ${mine ? "mine" : ""}`;
    b.innerHTML = `<span class="c"><div></div></span>${h.label}`;
    bg(b.querySelector("div"), mine ?? photoUrl(h.id, 160));
    b.addEventListener("click", () => openTraining(h.sel));
    hl.appendChild(b);

    const sets = homeItems.filter((i) => i.exercise === h.id && typeof i.avg_score === "number");
    const avg = (arr) => (arr.length ? Math.round(arr.reduce((s, i) => s + i.avg_score, 0) / arr.length) : null);
    const now = avg(sets.slice(0, 10)), before = avg(sets.slice(10, 20));
    const c = document.createElement("button");
    c.className = `lvl ${now == null ? "empty" : ""}`;
    bg(c, mine ?? photoUrl(h.id, 300));
    const trend = now != null && before != null && now !== before ? `<span class="trend ${now > before ? "up" : "down"}">${now > before ? "+" : ""}${now - before}</span>` : "";
    c.innerHTML = `${trend}<div class="in"><b>${now ?? "Starten"}</b><span>${h.label}${sets.length ? ` · ${sets.length}×` : ""}</span><div class="meter"><i style="width:${now ?? 0}%"></i></div></div>`;
    c.addEventListener("click", () => openTraining(h.sel));
    lv.appendChild(c);
  }
}

function drawScoreChart(c, items) {
  const dpr = devicePixelRatio;
  const w = (c.width = (c.clientWidth || 320) * dpr), h = (c.height = 170 * dpr);
  const g = c.getContext("2d");
  g.clearRect(0, 0, w, h);
  if (items.length < 2) return;
  const pad = 10 * dpr;
  const X = (i) => pad + (i / (items.length - 1)) * (w - 2 * pad);
  const Y = (s) => h - pad - (s / 100) * (h - 2 * pad);
  g.strokeStyle = "rgba(139,139,147,0.3)"; g.lineWidth = dpr; g.setLineDash([4 * dpr, 4 * dpr]);
  [60, 85].forEach((s) => { g.beginPath(); g.moveTo(0, Y(s)); g.lineTo(w, Y(s)); g.stroke(); });
  g.setLineDash([]);
  g.strokeStyle = "#3b82f6"; g.lineWidth = 2.5 * dpr; g.lineJoin = "round";
  g.beginPath();
  items.forEach((it, i) => (i ? g.lineTo(X(i), Y(it.avg_score)) : g.moveTo(X(i), Y(it.avg_score))));
  g.stroke();
  items.forEach((it, i) => {
    g.fillStyle = it.avg_score >= 85 ? "#3fb950" : it.avg_score >= 60 ? "#d29922" : "#f05252";
    g.beginPath(); g.arc(X(i), Y(it.avg_score), 3.5 * dpr, 0, Math.PI * 2); g.fill();
  });
}

// Tabs Raster / Fortschritt
document.querySelectorAll(".ptabs button").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll(".ptabs button").forEach((x) => x.classList.toggle("on", x === b));
  const chart = b.dataset.tab === "chart";
  $("home-grid").hidden = chart;
  $("home-empty").hidden = chart || homeItems.length > 0;
  $("home-progress").hidden = !chart;
  if (chart) drawScoreChart($("home-chart"), homeItems.filter((i) => typeof i.avg_score === "number").slice(0, 30).reverse());
}));

// ---------- Sheets ----------
function openSheet(id) { $(id).hidden = false; }
function closeSheets() { document.querySelectorAll(".sheet-backdrop").forEach((s) => (s.hidden = true)); }
document.querySelectorAll(".sheet-backdrop").forEach((bd) => bd.addEventListener("click", (e) => { if (e.target === bd) closeSheets(); }));
document.querySelectorAll(".sheet-close").forEach((b) => b.addEventListener("click", closeSheets));
/** Training-Sheet öffnen, optional mit vorausgewählter Übung */
function openTraining(pre) {
  if (pre) { Object.assign(sel, pre); renderPicker(); saveSettings(); }
  openSheet("train-sheet");
}
$("btn-train").addEventListener("click", () => openTraining());
$("btn-settings").addEventListener("click", () => openSheet("settings-sheet"));
$("btn-live").addEventListener("click", closeSheets);
$("file-input").addEventListener("change", closeSheets);

/** Gespeicherten Satz in der Ergebnisansicht öffnen. */
async function openWorkout(w) {
  videoInfo = null; // Diagnose gilt nur für die gerade analysierte Aufnahme
  const snaps = await loadSnaps(w.client_id);
  const reps = w.reps.map((r) => ({ ...r, issues: r.issues ?? [], metrics: r.metrics ?? {}, snapshot: snaps?.reps?.[r.index] }));
  const ex = exerciseOf(w.exercise);
  renderResult(reps, summarize(reps, ex.issues, ex.unit), w.trace ?? [], w.view, ex);
  $("res-title").textContent = `${ex.name} · ${fmtDate(w.performed_at)} · ${w.rep_count} ${ex.unit.short}`;
  $("btn-export").hidden = true;
  $("res-saved").hidden = true;
  mode = w.mode;
  show("screen-result");
}

// ---------- Konto ----------
let authMode = "login";
const toast = (msg) => {
  document.querySelectorAll(".toast").forEach((t) => t.remove());
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
};
const setMsg = (id, text, kind = "") => { const el = $(id); el.textContent = text || ""; el.className = `form-msg ${kind}`; };

function updateAccountButton() {
  $("btn-account").hidden = !cloud.enabled;
  const email = cloud.user?.email;
  $("acc-label").textContent = email ? email.split("@")[0] : "Anmelden";
  $("acc-avatar").innerHTML = email ? email[0].toUpperCase() : `<svg><use href="#i-user" /></svg>`;
}

function setAuthMode(m) {
  authMode = m;
  document.querySelectorAll("#acc-auth .seg").forEach((b) => b.classList.toggle("active", b.dataset.mode === m));
  $("acc-password2-row").hidden = m !== "register";
  $("acc-forgot").hidden = m !== "login";
  $("acc-submit").textContent = m === "login" ? "Anmelden" : "Konto erstellen";
  $("acc-password").autocomplete = m === "login" ? "current-password" : "new-password";
  setMsg("acc-msg", m === "register" ? "Mindestens 8 Zeichen. Du bekommst eine E-Mail zur Bestätigung." : "");
}

async function renderAccount() {
  const on = (id, v) => ($(id).hidden = !v);
  on("acc-disabled", !cloud.enabled);
  on("acc-recovery", cloud.enabled && cloud.recovery);
  on("acc-auth", cloud.enabled && !cloud.recovery && !cloud.loggedIn);
  on("acc-profile", cloud.enabled && !cloud.recovery && cloud.loggedIn);
  if (!cloud.loggedIn || cloud.recovery) return;

  const email = cloud.user.email;
  $("acc-name").textContent = email;
  $("acc-avatar-big").textContent = email[0].toUpperCase();
  const pending = cloud.pendingCount();
  $("acc-sync").textContent = pending ? `${pending} Satz/Sätze warten auf Upload` : navigator.onLine ? "Alles synchronisiert ✓" : "Offline";

  const { items } = await cloud.listWorkouts();
  const scored = items.filter((i) => typeof i.avg_score === "number");
  $("st-sets").textContent = items.length;
  $("st-reps").textContent = items.reduce((s, i) => s + (i.rep_count || 0), 0);
  const last10 = scored.slice(0, 10);
  $("st-score").textContent = last10.length ? Math.round(last10.reduce((s, i) => s + i.avg_score, 0) / last10.length) : "–";
  drawProgress(scored.slice(0, 30).reverse());
}

function drawProgress(items) {
  const c = $("acc-chart");
  const dpr = devicePixelRatio;
  const w = (c.width = (c.clientWidth || 300) * dpr), h = (c.height = 140 * dpr);
  const g = c.getContext("2d");
  g.clearRect(0, 0, w, h);
  $("acc-chart-hint").textContent = items.length < 2 ? "Nach ein paar Sätzen siehst du hier deinen Fortschritt." : "Ø Score pro Satz – je höher, desto sauberer.";
  if (items.length < 2) return;
  const pad = 10 * dpr;
  const X = (i) => pad + (i / (items.length - 1)) * (w - 2 * pad);
  const Y = (s) => h - pad - (s / 100) * (h - 2 * pad);
  g.strokeStyle = "rgba(148,163,184,0.25)"; g.lineWidth = dpr; g.setLineDash([4 * dpr, 4 * dpr]);
  [50, 85].forEach((s) => { g.beginPath(); g.moveTo(0, Y(s)); g.lineTo(w, Y(s)); g.stroke(); });
  g.setLineDash([]);
  const grad = g.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, "#3b82f6"); grad.addColorStop(1, "#3b82f6");
  g.strokeStyle = grad; g.lineWidth = 2.5 * dpr; g.lineJoin = "round";
  g.beginPath();
  items.forEach((it, i) => (i ? g.lineTo(X(i), Y(it.avg_score)) : g.moveTo(X(i), Y(it.avg_score))));
  g.stroke();
  items.forEach((it, i) => {
    g.fillStyle = it.avg_score >= 85 ? "#34d399" : it.avg_score >= 60 ? "#fbbf24" : "#fb7185";
    g.beginPath(); g.arc(X(i), Y(it.avg_score), 3.5 * dpr, 0, Math.PI * 2); g.fill();
  });
}

function openAccount() {
  setAuthMode(authMode);
  show("screen-account");
  renderAccount();
}

async function withBusy(btn, fn) {
  btn.disabled = true;
  try { return await fn(); } finally { btn.disabled = false; }
}

$("btn-account").addEventListener("click", openAccount);
$("acc-back").addEventListener("click", () => show("screen-home"));
document.querySelectorAll("#acc-auth .seg").forEach((b) => b.addEventListener("click", () => setAuthMode(b.dataset.mode)));

$("acc-form").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const email = $("acc-email").value.trim();
  const pw = $("acc-password").value;
  if (!/^\S+@\S+\.\S+$/.test(email)) return setMsg("acc-msg", "Bitte gib eine gültige E-Mail-Adresse ein.", "error");
  if (pw.length < 8) return setMsg("acc-msg", "Das Passwort muss mindestens 8 Zeichen haben.", "error");
  if (authMode === "register" && pw !== $("acc-password2").value) return setMsg("acc-msg", "Die Passwörter stimmen nicht überein.", "error");
  withBusy($("acc-submit"), async () => {
    setMsg("acc-msg", authMode === "login" ? "Melde an …" : "Erstelle Konto …");
    if (authMode === "login") {
      const { error } = await cloud.signIn(email, pw);
      if (error) return setMsg("acc-msg", error, "error");
      $("acc-password").value = "";
      toast("Angemeldet ✓");
      updateAccountButton();
      renderAccount();
      renderHistory();
    } else {
      const { error, needsConfirmation } = await cloud.signUp(email, pw);
      if (error) return setMsg("acc-msg", error, "error");
      $("acc-password").value = ""; $("acc-password2").value = "";
      if (needsConfirmation) {
        setMsg("acc-msg", "Fast geschafft! Wir haben dir eine E-Mail geschickt. Tippe auf den Link darin, um dein Konto zu bestätigen – danach kannst du dich hier anmelden.", "ok");
        setAuthMode("login");
        setMsg("acc-msg", "Bestätigungs-E-Mail verschickt ✓ Nach dem Bestätigen kannst du dich hier anmelden.", "ok");
      } else {
        toast("Konto erstellt ✓");
        renderAccount();
      }
    }
  });
});

$("acc-forgot").addEventListener("click", () => {
  const email = $("acc-email").value.trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) return setMsg("acc-msg", "Gib oben deine E-Mail-Adresse ein, dann schicken wir dir einen Link.", "error");
  withBusy($("acc-forgot"), async () => {
    const { error } = await cloud.resetPassword(email);
    setMsg("acc-msg", error || "Falls ein Konto existiert, ist eine E-Mail zum Zurücksetzen unterwegs.", error ? "error" : "ok");
  });
});

$("acc-recovery").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const pw = $("acc-newpass").value;
  if (pw.length < 8) return setMsg("acc-recovery-msg", "Mindestens 8 Zeichen.", "error");
  withBusy(ev.submitter || $("acc-recovery").querySelector("button"), async () => {
    const { error } = await cloud.updatePassword(pw);
    if (error) return setMsg("acc-recovery-msg", error, "error");
    $("acc-newpass").value = "";
    toast("Passwort geändert ✓");
    renderAccount();
  });
});

$("acc-logout").addEventListener("click", async () => {
  await cloud.signOut();
  toast("Abgemeldet");
  updateAccountButton();
  renderAccount();
  renderHistory();
});

$("acc-delete").addEventListener("click", async () => {
  if (!confirm("Konto wirklich löschen?\n\nAlle gespeicherten Sätze werden endgültig gelöscht. Das kann nicht rückgängig gemacht werden.")) return;
  const { error } = await cloud.deleteAccount();
  if (error) return toast(`Löschen fehlgeschlagen: ${error}`);
  toast("Konto gelöscht");
  updateAccountButton();
  renderAccount();
  renderHistory();
});

cloud.onChange((type, info) => {
  if (type === "auth" || type === "ready") {
    updateAccountButton();
    renderHistory();
    if (cloud.recovery) openAccount();
    else if (document.getElementById("screen-account").classList.contains("active")) renderAccount();
  }
  if (type === "migrated") toast(`${info} Satz/Sätze von diesem Gerät ins Konto übernommen`);
  if (type === "synced") { renderHistory(); if ($("screen-account").classList.contains("active")) renderAccount(); }
});

// ---------- Events ----------
$("btn-live").addEventListener("click", startLive);
$("file-input").addEventListener("change", (e) => {
  const f = e.target.files?.[0];
  e.target.value = "";
  if (f) startVideo(f);
});
$("btn-stop").addEventListener("click", finish);
$("btn-export").addEventListener("click", async () => {
  if (!lastExport) return;
  const name = `formcoach-${lastExport.date.slice(0, 19).replace(/[:T]/g, "-")}.json`;
  const file = new File([JSON.stringify(lastExport, null, 1)], name, { type: "application/json" });
  // Am Handy: Teilen-Menü (z. B. an dich selbst senden), sonst normaler Download
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: "FormCoach Messdaten" }); return; } catch (e) { if (e.name === "AbortError") return; }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$("btn-again").addEventListener("click", () => (mode === "video" ? $("file-input").click() : startLive()));
$("btn-home").addEventListener("click", () => show("screen-home"));

document.body.classList.add("on-home");
loadSettings();
renderPicker();
updateAccountButton();
renderHistory();
cloud.init();
// Debug-Hook für Tests ohne Kamera: index.html?debug
if (new URLSearchParams(location.search).has("debug")) {
  window.__formcoach = { renderResult, summarize, show, cloud, buildWorkout, saveWorkout, renderHistory, openAccount, exerciseOf };
}
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
