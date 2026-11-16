// MediaPipe Pose Landmarker (Tasks Vision) – läuft vollständig auf dem Gerät.
import { FilesetResolver, PoseLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODELS = {
  lite: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
  full: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
};

let landmarker = null;
let lastTs = 0;

export async function initPose(variant = "full") {
  if (landmarker) return landmarker;
  const vision = await FilesetResolver.forVisionTasks(WASM);
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
