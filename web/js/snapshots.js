// Standbilder: pro Wiederholung/Schlag ein Foto im Schlüsselmoment (tiefster Punkt / Treffpunkt),
// mit eingezeichnetem Skelett. Bleibt auf dem Gerät (IndexedDB) – wird nie hochgeladen.
import { drawPose } from "./pose.js";

const W = 360;                 // Breite der Standbilder (Pixel)
const KEEP_MS = 4500;          // so lange zurück wird gepuffert
const MIN_GAP_MS = 90;         // höchstens ~11 Bilder pro Sekunde puffern (Analysezeit)
const POOL = 60;               // wiederverwendete Canvas-Elemente (kein Speicherwachstum)

/** Ringpuffer der letzten Sekunden in kleiner Auflösung. */
export class FrameRing {
  constructor() {
    this.frames = [];
    this.pool = [];
  }
  reset() { this.pool.push(...this.frames.map((f) => f.canvas)); this.frames = []; }

  /** @param {number} t Analysezeit (ms) – dieselbe Zeit, die der Analyzer bekommt */
  push(t, video, landmarks, mirror = false) {
    const last = this.frames.at(-1);
    if (last && t - last.t < MIN_GAP_MS && t >= last.t) return;
    if (last && t < last.t) this.reset(); // Zeit sprang zurück (neues Video / Fenster)
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return;
    const h = Math.round((W * vh) / vw);
    const c = this.pool.pop() ?? document.createElement("canvas");
    if (c.width !== W || c.height !== h) { c.width = W; c.height = h; }
    const g = c.getContext("2d");
    g.save();
    if (mirror) { g.translate(W, 0); g.scale(-1, 1); }
    g.drawImage(video, 0, 0, W, h);
    g.restore();
    this.frames.push({ t, canvas: c, lm: landmarks, mirror });
    while (this.frames.length && (this.frames[0].t < t - KEEP_MS || this.frames.length > POOL)) this.pool.push(this.frames.shift().canvas);
  }

  /**
   * Standbild zum Zeitpunkt t (nächstgelegenes gepuffertes Bild), mit Skelett.
   * @param {number[]} highlight Gelenke, die rot markiert werden (z. B. Knie bei "Knie nach innen")
   * @returns {string|null} JPEG als Data-URL
   */
  snapshotAt(t, highlight = [], good = false) {
    if (!this.frames.length || !Number.isFinite(t)) return null;
    const f = this.frames.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a));
    if (Math.abs(f.t - t) > 600) return null; // Schlüsselmoment liegt nicht mehr im Puffer
    const out = document.createElement("canvas");
    out.width = f.canvas.width; out.height = f.canvas.height;
    const g = out.getContext("2d");
    g.drawImage(f.canvas, 0, 0);
    if (f.lm) {
      const lm = f.mirror ? f.lm.map((p) => ({ ...p, x: 1 - p.x })) : f.lm;
      // Skelett ohne das Bild zu löschen: eigene Ebene zeichnen und darüberlegen
      const layer = document.createElement("canvas");
      layer.width = out.width; layer.height = out.height;
      drawPose(layer.getContext("2d"), lm, { highlight, good });
      g.drawImage(layer, 0, 0);
    }
    return out.toDataURL("image/jpeg", 0.72);
  }
}

// ---------- Speicher (IndexedDB) ----------
const DB = "formcoach-media", STORE = "snaps";
let dbp = null;
const db = () => (dbp ??= new Promise((res, rej) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => r.result.createObjectStore(STORE);
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
}));
const tx = async (mode, fn) => {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => res(req?.result);
    t.onerror = () => rej(t.error);
  });
};

/**
 * Standbilder eines Satzes speichern.
 * @param {string} id client_id des Satzes
 * @param {{cover: string|null, reps: Object<number,string>}} snaps
 */
export async function saveSnaps(id, snaps) {
  try { await tx("readwrite", (s) => s.put(snaps, id)); } catch (e) { console.warn("Standbilder nicht gespeichert", e); }
}
/** @returns {Promise<{cover: string|null, reps: Object<number,string>}|null>} */
export async function loadSnaps(id) {
  try { return (await tx("readonly", (s) => s.get(id))) ?? null; } catch { return null; }
}
export async function deleteSnaps(id) {
  try { await tx("readwrite", (s) => s.delete(id)); } catch {}
}
