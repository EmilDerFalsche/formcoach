// MediaPipe Pose Landmarker (Tasks Vision) – läuft vollständig auf dem Gerät.
import { FilesetResolver, PoseLandmarker, ObjectDetector } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODELS = {
  lite: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
  full: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
};

// Objekterkennung (COCO): enthält die Klassen "tennis racket" und "sports ball"
const OBJECT_MODEL = "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/float16/1/efficientdet_lite2.tflite";

let landmarker = null;
let lastTs = 0;
let visionFiles = null;
const getVision = async () => (visionFiles ??= await FilesetResolver.forVisionTasks(WASM));

export async function initPose(variant = "full") {
  if (landmarker) return landmarker;
  const vision = await getVision();
  const opts = (delegate) => ({
    baseOptions: { modelAssetPath: MODELS[variant], delegate },
    runningMode: "VIDEO",
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  try {
    landmarker = await PoseLandmarker.createFromOptions(vision, opts("GPU"));
  } catch (e) {
    console.warn("GPU nicht verfügbar, nutze CPU", e);
    landmarker = await PoseLandmarker.createFromOptions(vision, opts("CPU"));
  }
  return landmarker;
}

/** Erkennt Pose in einem Video-Frame. Zeitstempel müssen strikt steigen. */
export function detect(video) {
  let ts = performance.now();
  if (ts <= lastTs) ts = lastTs + 1;
  lastTs = ts;
  const res = landmarker.detectForVideo(video, ts);
  return res.landmarks?.[0] ?? null;
}

// ---------- Schläger & Ball (nur Video-Modus) ----------
let objDetector = null;
let objTs = 0;

export async function initObjects() {
  if (objDetector) return objDetector;
  const vision = await getVision();
  const opts = (delegate) => ({
    baseOptions: { modelAssetPath: OBJECT_MODEL, delegate },
    runningMode: "VIDEO",
    scoreThreshold: 0.2,
    maxResults: 6,
    categoryAllowlist: ["tennis racket", "sports ball"],
  });
  try {
    objDetector = await ObjectDetector.createFromOptions(vision, opts("GPU"));
  } catch (e) {
    console.warn("Objekterkennung: GPU nicht verfügbar, nutze CPU", e);
    objDetector = await ObjectDetector.createFromOptions(vision, opts("CPU"));
  }
  return objDetector;
}

/**
 * Schläger und Ball im aktuellen Frame.
 * @returns {{racket: object|null, ball: object|null}} normalisiert (x mit Seitenverhältnis skaliert, wie die Pose-Merkmale)
 */
export function detectObjects(video) {
  if (!objDetector) return { racket: null, ball: null };
  let ts = performance.now();
  if (ts <= objTs) ts = objTs + 1;
  objTs = ts;
  const W = video.videoWidth, H = video.videoHeight, aspect = W / H;
  let racket = null, ball = null;
  for (const d of objDetector.detectForVideo(video, ts).detections ?? []) {
    const c = d.categories?.[0];
    const b = d.boundingBox;
    if (!c || !b) continue;
    const o = { x: ((b.originX + b.width / 2) / W) * aspect, y: (b.originY + b.height / 2) / H, w: (b.width / W) * aspect, h: b.height / H, score: c.score };
    if (c.categoryName === "tennis racket" && (!racket || o.score > racket.score)) racket = o;
    if (c.categoryName === "sports ball" && (!ball || o.score > ball.score)) ball = o;
  }
  return { racket, ball };
}

/** Schläger (gelber Rahmen) und Ball (grüner Kreis) einzeichnen. */
export function drawObjects(ctx, objs, aspect) {
  if (!objs) return;
  const { width: w, height: h } = ctx.canvas;
  const lw = Math.max(2, w / 300);
  ctx.lineWidth = lw;
  if (objs.racket) {
    const r = objs.racket;
    ctx.strokeStyle = "rgba(250, 204, 21, 0.95)";
    ctx.strokeRect(((r.x - r.w / 2) / aspect) * w, (r.y - r.h / 2) * h, (r.w / aspect) * w, r.h * h);
  }
  if (objs.ball) {
    const b = objs.ball;
    ctx.strokeStyle = "rgba(74, 222, 128, 0.95)";
    ctx.beginPath();
    ctx.arc((b.x / aspect) * w, b.y * h, Math.max(lw * 3, 6), 0, Math.PI * 2);
    ctx.stroke();
  }
}

const CONNECTIONS = [
  [11, 12], [11, 23], [12, 24], [23, 24],
  [11, 13], [13, 15], [12, 14], [14, 16],
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31],
  [24, 26], [26, 28], [28, 30], [30, 32], [28, 32],
];

/** Zeichnet das Skelett; markierte Gelenke (z. B. Knie bei Fehler) in Rot. */
export function drawPose(ctx, lm, { highlight = [], good = false } = {}) {
  const { width: w, height: h } = ctx.canvas;
  ctx.clearRect(0, 0, w, h);
  if (!lm) return;
  const lw = Math.max(2, w / 220);
  ctx.lineWidth = lw;
  ctx.lineCap = "round";
  ctx.strokeStyle = good ? "rgba(74, 222, 128, 0.9)" : "rgba(255, 255, 255, 0.85)";
  for (const [a, b] of CONNECTIONS) {
    if ((lm[a].visibility ?? 1) < 0.4 || (lm[b].visibility ?? 1) < 0.4) continue;
    ctx.beginPath();
    ctx.moveTo(lm[a].x * w, lm[a].y * h);
    ctx.lineTo(lm[b].x * w, lm[b].y * h);
    ctx.stroke();
  }
  for (let i = 11; i < 33; i++) {
    if ((lm[i].visibility ?? 1) < 0.4) continue;
    const hot = highlight.includes(i);
    ctx.fillStyle = hot ? "#f87171" : "#38bdf8";
    ctx.beginPath();
    ctx.arc(lm[i].x * w, lm[i].y * h, hot ? lw * 3 : lw * 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Welche Gelenke bei welchem Fehler hervorgehoben werden. */
export const ISSUE_JOINTS = {
  knees_in: [25, 26],
  shallow: [23, 24, 25, 26],
  forward_lean: [11, 12, 23, 24],
  hips_first: [23, 24],
  heels_up: [29, 30],
  asymmetric: [23, 24],
  too_fast: [],
};
