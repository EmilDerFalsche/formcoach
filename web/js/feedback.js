// Feedback-Texte (deutsch) und Sprachausgabe.

export const ISSUES = {
  shallow: {
    title: "Zu wenig Tiefe",
    detail: "Deine Hüfte ist nicht bis auf Kniehöhe gekommen.",
    cue: "Tiefer runter",
    tip: "Setz dich weiter nach hinten unten, als würdest du dich auf einen tiefen Stuhl setzen. Ziel: Hüftfalte mindestens auf Kniehöhe. Eine Box hinter dir hilft beim Gefühl für die Tiefe.",
  },
  forward_lean: {
    title: "Zu starke Vorlage",
    detail: "Dein Oberkörper kippt im tiefsten Punkt deutlich nach vorne.",
    cue: "Brust hoch",
    tip: "Brust raus und Blick nach vorne. Spann den Rumpf vor dem Absenken an (tief einatmen, Bauch fest). Oft helfen auch mehr Fußgelenk-Beweglichkeit oder eine etwas breitere Fußstellung.",
  },
  hips_first: {
    title: "Hüfte kommt zuerst hoch",
    detail: "Beim Aufstehen schießt die Hüfte nach oben, während der Oberkörper vorne bleibt.",
    cue: "Brust und Hüfte gemeinsam hoch",
    tip: "Drück dich mit dem ganzen Fuß vom Boden weg und führe Brust und Hüfte gleichzeitig nach oben. Gewicht ggf. reduzieren.",
  },
  knees_in: {
    title: "Knie fallen nach innen",
    detail: "Deine Knie bewegen sich näher zusammen als deine Füße (Knie-Valgus).",
    cue: "Knie nach außen",
    tip: "Drück die Knie aktiv in Richtung der kleinen Zehen. Stell dir vor, du willst den Boden zwischen deinen Füßen auseinanderreißen. Ein Mini-Band über den Knien hilft beim Training.",
  },
  heels_up: {
    title: "Fersen heben ab",
    detail: "Deine Fersen lösen sich vom Boden; das Gewicht ist zu weit vorne.",
    cue: "Fersen am Boden",
    tip: "Verlagere das Gewicht auf die Mitte des Fußes / die Fersen. Arbeite an der Sprunggelenk-Beweglichkeit oder lege vorübergehend kleine Gewichtsscheiben unter die Fersen.",
  },
  asymmetric: {
    title: "Asymmetrie",
    detail: "Dein Becken kippt oder verschiebt sich zu einer Seite.",
    cue: "Gewicht gleichmäßig verteilen",
    tip: "Achte auf gleiche Belastung beider Beine. Prüfe die Fußstellung (symmetrisch) und trainiere einbeinige Übungen (z. B. Split Squats), um Seitenunterschiede auszugleichen.",
  },
  too_fast: {
    title: "Zu schnelles Absenken",
    detail: "Du gehst sehr schnell in die Tiefe.",
    cue: "Langsamer absenken",
    tip: "Senke dich kontrolliert in etwa 2 Sekunden ab. Das verbessert Technik und Muskelspannung.",
  },
};

export const ML_LABEL_TEXT = {
  correct: "korrekte Ausführung",
  shallow: "zu wenig Tiefe",
  forward_lean: "zu starke Vorlage",
  knees_in: "Knie nach innen",
  heels_up: "Fersen heben ab",
  asymmetric: "asymmetrisch",
};

const PRAISE = ["Sauber!", "Sehr gut!", "Top Technik!", "Weiter so!"];

export class Voice {
  constructor() {
    this.enabled = true;
    this.supported = "speechSynthesis" in window;
    this.lastSpoken = 0;
  }
  say(text, { force = false } = {}) {
    if (!this.enabled || !this.supported) return;
    const now = performance.now();
    if (!force && now - this.lastSpoken < 1200) return;
    this.lastSpoken = now;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "de-DE";
    u.rate = 1.05;
    speechSynthesis.speak(u);
  }
}

/** Kurzer Sprach-Cue nach einer Wiederholung / einem Schlag. */
export function repCue(rep, issues = ISSUES, praise = PRAISE) {
  const main = rep.issues[0];
  if (!main) return `${rep.index}. ${praise[rep.index % praise.length]}`;
  return `${rep.index}. ${issues[main.key]?.cue ?? ""}`;
}

/**
 * Fasst einen Satz zusammen: häufigste Fehler + priorisierte Tipps.
 * @param {object} issues  Fehlerkatalog der Übung
 * @param {{one:string, many:string}} unit  z. B. Wiederholung/Wiederholungen oder Schlag/Schlägen
 */
export function summarize(reps, issues = ISSUES, unit = { one: "Wiederholung", many: "Wiederholungen", none: "Keine Wiederholung erkannt" }) {
  const counts = {};
  reps.forEach((r) => r.issues.forEach((i) => (counts[i.key] = (counts[i.key] || 0) + (i.severity === "major" ? 1 : 0.6))));
  const ranked = Object.entries(counts).filter(([k]) => issues[k]).sort((a, b) => b[1] - a[1]).map(([k]) => ({
    key: k, ...issues[k],
    reps: reps.filter((r) => r.issues.some((i) => i.key === k)).length,
  }));
  const avg = reps.length ? Math.round(reps.reduce((s, r) => s + r.score, 0) / reps.length) : 0;
  let headline;
  if (!reps.length) headline = `${unit.none}. Achte darauf, dass dein ganzer Körper im Bild ist.`;
  else if (!ranked.length) headline = `Starke Technik! In keiner ${unit.dat ?? unit.one} wurde ein Fehler erkannt.`;
  else headline = `Dein wichtigster Ansatzpunkt: ${ranked[0].title} (in ${ranked[0].reps} von ${reps.length} ${unit.datMany ?? unit.many}).`;
  return { avgScore: avg, ranked, headline };
}
