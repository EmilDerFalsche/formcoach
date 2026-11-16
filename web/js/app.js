import { initPose, detect, drawPose, ISSUE_JOINTS } from "./pose.js";
import { SquatAnalyzer, THRESHOLDS } from "./squatAnalyzer.js";
import { SquatClassifier } from "./classifier.js";
import { ISSUES, ML_LABEL_TEXT, Voice, repCue, summarize } from "./feedback.js";

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

// ---------- Navigation ----------
function show(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
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
  } catch {}
}
function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      voice: $("opt-voice").checked, front: $("opt-front").checked,
      gesture: $("opt-gesture").checked, ml2: $("opt-ml").checked, model: $("opt-model").value,
    }));
  } catch {}
}
["opt-voice", "opt-front", "opt-gesture", "opt-ml", "opt-model"].forEach((id) => $(id).addEventListener("change", saveSettings));

// ---------- Setup ----------
async function prepare() {
  $("loading").hidden = false;
  $("loading-text").textContent = "Lade KI-Modell …";
  voice.enabled = $("opt-voice").checked;
  await initPose($("opt-model").value);
  if (classifier === undefined) classifier = await SquatClassifier.load();
  const gestures = mode === "live" && $("opt-gesture").checked;
  analyzer = new SquatAnalyzer({
    classifier: $("opt-ml").checked ? classifier : null,
    onRep,
    onEvent,
    onFinish: () => setTimeout(finish, 0),
    requireStartGesture: gestures,
    stopGesture: gestures,
  });
  $("stage").classList.toggle("gestures", gestures);
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
      ? "Stell dich hin und heb eine Hand über den Kopf, um zu starten."
      : "Stell dich seitlich oder frontal hin, ganzer Körper im Bild.", { force: true });
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
async function startVideo(file) {
  mode = "video";
  show("screen-analyze");
  $("stage").classList.remove("mirror");
  try {
    await prepare();
    video.srcObject = null;
    video.src = URL.createObjectURL(file);
    video.muted = true;
    await new Promise((res, rej) => { video.onloadedmetadata = res; video.onerror = () => rej(new Error("Video kann nicht gelesen werden")); });
    sizeCanvas();
    $("loading").hidden = true;
    running = true;
    voice.enabled = false; // beim Upload keine Sprachausgabe pro Wdh.
    video.onended = () => finish();
    await video.play();
    const step = () => {
      if (!running || mode !== "video") return;
      processFrame(video.currentTime * 1000);
      if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(step);
      else requestAnimationFrame(step);
    };
    if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(step); else requestAnimationFrame(step);
  } catch (e) {
    console.error(e);
    $("loading-text").textContent = `Fehler: ${e.message}`;
  }
}

// ---------- Gemeinsame Frame-Verarbeitung ----------
function processFrame(t) {
  const lm = detect(video);
  const res = analyzer.update(lm, t, video.videoWidth / video.videoHeight);
  const now = performance.now();
  const hl = now < highlight.until ? highlight : { joints: [], good: false };
  drawPose(ctx, lm, { highlight: hl.joints, good: hl.good });

  $("hud-view").textContent = `Ansicht: ${VIEW_TEXT[analyzer.view]}`;
  $("stage").classList.toggle("pre", !analyzer.base); // Zähler etc. erst nach Kalibrierung
  $("stage").classList.toggle("waiting", res.status === "waiting");
  $("gesture-fill").style.width = `${Math.round((res.gesture ?? 0) * 100)}%`;
  if (res.status !== lastStatus || res.message !== $("hud-status").textContent) {
    $("hud-status").textContent = res.message;
    $("hud-status").dataset.state = res.status;
    lastStatus = res.status;
  }
  const d = res.depth ?? 0;
  $("depth-fill").style.height = `${Math.max(0, Math.min(1.2, d)) / 1.2 * 100}%`;
}

function onEvent(type, info) {
  if (type === "start") {
    voice.say("Satz startet. Stell dich ruhig hin.", { force: true });
    if (navigator.vibrate) navigator.vibrate(80);
  } else if (type === "calibrated") {
    voice.say(analyzer.stopGesture ? "Los geht's! Zum Beenden Hand heben." : "Kalibriert. Los geht's!", { force: true });
  } else if (type === "recalibrate") {
    voice.say(`${info}. Kurz ruhig stehen.`, { force: true });
  } else if (type === "discarded") {
    console.info("Bewegung nicht als Wiederholung gezählt:", info);
  }
}

function onRep(rep) {
  $("hud-reps").textContent = rep.index;
  const fb = $("hud-feedback");
  if (rep.issues.length) {
    fb.className = "feedback bad show";
    fb.innerHTML = `<b>${ISSUES[rep.issues[0].key].cue}</b>` +
      (rep.issues.length > 1 ? `<small>+ ${rep.issues.slice(1).map((i) => ISSUES[i.key].title).join(", ")}</small>` : "");
    highlight = { joints: rep.issues.flatMap((i) => ISSUE_JOINTS[i.key]), until: performance.now() + 1800, good: false };
  } else {
    fb.className = "feedback good show";
    fb.innerHTML = "<b>Saubere Wiederholung ✓</b>";
    highlight = { joints: [], until: performance.now() + 1200, good: true };
  }
  if (navigator.vibrate) navigator.vibrate(rep.issues.length ? [60, 60, 60] : 40);
  voice.say(repCue(rep), { force: true });
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
  const reps = analyzer.reps;
  const trace = analyzer.trace;
  const view = analyzer.view;
  stopMedia();
  const sum = summarize(reps);
  lastExport = {
    app: "FormCoach", version: 2, date: new Date().toISOString(), mode, view,
    baseline: analyzer.base, thresholds: THRESHOLDS, discarded: analyzer.discarded,
    reps: reps.map(({ ml, ...r }) => ({ ...r, ml: ml ? { label: ml.label, confidence: ml.confidence } : null })),
    trace: trace.map((p) => ({ t: Math.round(p.t), d: Math.round(p.d * 1000) / 1000 })),
  };
  renderResult(reps, sum, trace, view);
  saveHistory(reps, sum, view);
  if ($("opt-voice").checked && reps.length) {
    voice.enabled = true;
    voice.say(`${reps.length} Wiederholungen. Durchschnitt ${sum.avgScore} Punkte. ${sum.ranked[0] ? "Fokus: " + sum.ranked[0].title : "Sehr sauber!"}`, { force: true });
  }
  show("screen-result");
}

const scoreClass = (s) => (s >= 85 ? "good" : s >= 60 ? "mid" : "bad");

function renderResult(reps, sum, trace, view) {
  $("res-score").textContent = reps.length ? sum.avgScore : "–";
  $("score-ring").style.setProperty("--p", reps.length ? sum.avgScore : 0);
  $("score-ring").className = `score-ring ${reps.length ? scoreClass(sum.avgScore) : ""}`;
  $("res-title").textContent = `${reps.length} Wiederholung${reps.length === 1 ? "" : "en"} · ${VIEW_TEXT[view]}`;
  $("res-headline").textContent = sum.headline;

  const tips = $("res-tips");
  tips.innerHTML = "";
  if (!sum.ranked.length) {
    tips.innerHTML = `<p class="ok">Keine Fehler erkannt. ${view === "side" ? "Filme den nächsten Satz frontal, um auch Knie-Stellung und Symmetrie zu prüfen." : view === "front" ? "Filme den nächsten Satz seitlich, um Tiefe und Oberkörperhaltung genauer zu prüfen." : ""}</p>`;
  }
  sum.ranked.forEach((r, i) => {
    const el = document.createElement("div");
    el.className = "tip";
    el.innerHTML = `<div class="tip-head"><span class="badge">${i + 1}</span><b>${r.title}</b><span class="count">${r.reps}/${reps.length}</span></div>
      <p>${r.detail}</p><p class="how"><b>So geht's:</b> ${r.tip}</p>`;
    tips.appendChild(el);
  });
  if (view === "side") tips.insertAdjacentHTML("beforeend", `<p class="hint">Seitliche Aufnahme: Knie-nach-innen und Asymmetrie wurden nicht geprüft.</p>`);
  if (view === "front") tips.insertAdjacentHTML("beforeend", `<p class="hint">Frontale Aufnahme: Oberkörper-Vorlage wurde nicht geprüft.</p>`);

  const list = $("res-reps");
  list.innerHTML = "";
  reps.forEach((r) => {
    const m = r.metrics;
    const el = document.createElement("details");
    el.className = "rep";
    const cls = scoreClass(r.score);
    const issueText = r.issues.length ? r.issues.map((i) => `${ISSUES[i.key].title}${i.severity === "major" ? " (deutlich)" : ""}`).join(", ") : "Keine Fehler";
    const ml = r.ml ? `<li>KI-Einschätzung: <b>${ML_LABEL_TEXT[r.ml.label]}</b> (${Math.round(r.ml.confidence * 100)} %)</li>` : "";
    el.innerHTML = `<summary><span class="rep-score ${cls}">${r.score}</span><span>Wdh. ${r.index}</span><small>${issueText}</small></summary>
      <ul class="metrics">
        <li>Tiefe: ${m.depth >= 0 ? "unter parallel ✓" : `${Math.round(-m.depth * 100)} % über parallel`}</li>
        <li>Min. Kniewinkel: ${Math.round(m.kneeMin)}°</li>
        ${view !== "front" ? `<li>Oberkörper-Vorlage: ${Math.round(m.trunk)}°</li>` : ""}
        ${view !== "side" ? `<li>Knie-/Fußbreite: ${Math.round(m.kneeRatio * 100)} % des Stands</li>` : ""}
        <li>Absenken: ${m.descentSec.toFixed(1)} s · gesamt ${m.durationSec.toFixed(1)} s</li>
        ${ml}
      </ul>`;
    list.appendChild(el);
  });
  drawChart(trace, reps);
}

function drawChart(trace, reps) {
  const c = $("res-chart");
  const w = (c.width = c.clientWidth * devicePixelRatio || 600);
  const h = (c.height = 160 * devicePixelRatio);
  const g = c.getContext("2d");
  g.clearRect(0, 0, w, h);
  if (trace.length < 2) return;
  const t0 = trace[0].t, t1 = trace[trace.length - 1].t;
  const maxD = 1.3;
  const X = (t) => ((t - t0) / (t1 - t0 || 1)) * w;
  const Y = (d) => h - 8 * devicePixelRatio - (Math.max(-0.1, Math.min(maxD, d)) / maxD) * (h - 16 * devicePixelRatio);
  // Rep-Bereiche einfärben
  reps.forEach((r) => {
    g.fillStyle = r.issues.length ? "rgba(251,113,133,0.24)" : "rgba(52,211,153,0.24)";
    const x0 = X(r.start), x1 = X(r.end), rad = 6 * devicePixelRatio;
    g.beginPath();
    if (g.roundRect) g.roundRect(x0, 0, x1 - x0, h, rad); else g.rect(x0, 0, x1 - x0, h);
    g.fill();
  });
  g.setLineDash([6 * devicePixelRatio, 6 * devicePixelRatio]); g.strokeStyle = "rgba(148,163,184,0.6)"; g.lineWidth = devicePixelRatio;
  g.beginPath(); g.moveTo(0, Y(1)); g.lineTo(w, Y(1)); g.stroke(); g.setLineDash([]);
  const grad = g.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, "#22d3ee"); grad.addColorStop(1, "#818cf8");
  g.strokeStyle = grad; g.lineWidth = 2.5 * devicePixelRatio; g.lineJoin = "round";
  g.beginPath();
  trace.forEach((p, i) => (i ? g.lineTo(X(p.t), Y(p.d)) : g.moveTo(X(p.t), Y(p.d))));
  g.stroke();
}

// ---------- Verlauf ----------
const HISTORY_KEY = "formcoach.history";
function readHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch { return []; }
}
function saveHistory(reps, sum, view) {
  if (!reps.length) return;
  const h = readHistory();
  h.unshift({ date: new Date().toISOString(), mode, reps: reps.length, score: sum.avgScore, view, focus: sum.ranked[0]?.title ?? null });
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, 50))); } catch {}
  renderHistory();
}
function renderHistory() {
  const h = readHistory();
  const ul = $("history");
  $("history-panel").hidden = !h.length;
  ul.innerHTML = "";
  h.slice(0, 10).forEach((e) => {
    const d = new Date(e.date);
    const li = document.createElement("li");
    li.innerHTML = `<span class="h-score ${scoreClass(e.score)}">${e.score}</span><span><b>${e.reps} Wdh.</b> · ${e.mode === "live" ? "Live" : "Video"} · ${VIEW_TEXT[e.view] ?? ""}<small>${d.toLocaleDateString("de-DE")} ${d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}${e.focus ? " · Fokus: " + e.focus : ""}</small></span>`;
    ul.appendChild(li);
  });
}

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

loadSettings();
renderHistory();
// Debug-Hook für Tests ohne Kamera: index.html?debug
if (new URLSearchParams(location.search).has("debug")) {
  window.__formcoach = { renderResult, summarize, show };
}
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
