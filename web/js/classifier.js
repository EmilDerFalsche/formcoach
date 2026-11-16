// Führt das in training/train_model.py trainierte MLP im Browser aus.

export class SquatClassifier {
  constructor(model) {
    this.m = model;
    this.labels = model.labels;
  }

  static async load(url = "model/squat_model.json") {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(res.status);
      return new SquatClassifier(await res.json());
    } catch (e) {
      console.warn("ML-Modell konnte nicht geladen werden – nur Regeln aktiv.", e);
      return null;
    }
  }

  /** @returns {number[]} Wahrscheinlichkeit pro Klasse */
  predict(x) {
    const { mean, scale } = this.m.scaler;
    let a = x.map((v, i) => (v - mean[i]) / scale[i]);
    const L = this.m.layers;
    L.forEach((layer, li) => {
      const z = layer.W.map((row, j) => row.reduce((s, w, k) => s + w * a[k], layer.b[j]));
      a = li < L.length - 1 ? z.map((v) => Math.max(0, v)) : z;
    });
    const mx = Math.max(...a);
    const e = a.map((v) => Math.exp(v - mx));
    const s = e.reduce((p, c) => p + c, 0);
    return e.map((v) => v / s);
  }

  /** Mittelt die Vorhersagen über mehrere Frames (z. B. die tiefste Phase einer Wiederholung). */
  predictMany(xs) {
    if (!xs.length) return null;
    const acc = new Array(this.labels.length).fill(0);
    xs.forEach((x) => this.predict(x).forEach((p, i) => (acc[i] += p / xs.length)));
    const best = acc.indexOf(Math.max(...acc));
    return { probs: acc, label: this.labels[best], confidence: acc[best] };
  }
}
