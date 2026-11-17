// Übungskatalog: alles, was sich pro Übung unterscheidet (Analyse, Fehlertexte, Anzeige).
import { SquatAnalyzer } from "./squatAnalyzer.js";
import { PushupAnalyzer } from "./pushupAnalyzer.js";
import { TennisAnalyzer, STROKE_NAMES } from "./tennisAnalyzer.js";
import { ISSUES as SQUAT_ISSUES } from "./feedback.js";
import { ISSUE_JOINTS as SQUAT_JOINTS } from "./pose.js";

const deg = (v) => `${Math.round(v)}°`;
const fin = (v) => typeof v === "number" && Number.isFinite(v);

// ---------- Liegestütz ----------
const PUSHUP_ISSUES = {
  shallow: {
    title: "Zu wenig Tiefe",
    detail: "Deine Ellbogen beugen sich nicht bis etwa 90°.",
    cue: "Tiefer runter",
    tip: "Senke dich, bis die Brust knapp über dem Boden ist (Ellbogen ca. 90°). Wenn das noch nicht geht: Liegestütze erhöht an einer Bank oder auf den Knien üben und die Tiefe beibehalten.",
  },
  hip_sag: {
    title: "Hüfte hängt durch",
    detail: "Deine Hüfte sinkt unter die Linie Schulter–Fuß (Hohlkreuz).",
    cue: "Bauch anspannen",
    tip: "Spanne Bauch und Po fest an – der Körper bleibt ein Brett von Kopf bis Fuß. Planks (Unterarmstütz) helfen, die nötige Rumpfspannung aufzubauen.",
  },
  hip_pike: {
    title: "Po zu hoch",
    detail: "Deine Hüfte liegt über der Körperlinie – der Körper bildet ein Dach.",
    cue: "Hüfte runter",
    tip: "Bring die Hüfte in eine Linie mit Schultern und Füßen. Stell dir einen Besenstiel auf deinem Rücken vor, der Hinterkopf, Rücken und Po berührt.",
  },
  no_lockout: {
    title: "Arme oben nicht gestreckt",
    detail: "Zwischen den Wiederholungen streckst du die Arme nicht ganz durch.",
    cue: "Oben ganz strecken",
    tip: "Drück dich am Ende jeder Wiederholung vollständig hoch, bis die Arme gestreckt sind – so trainierst du die volle Bewegung.",
  },
  head_drop: {
    title: "Kopf hängt",
    detail: "Dein Kopf sinkt vor dem Körper Richtung Boden.",
    cue: "Kopf in Linie",
    tip: "Halte den Kopf in Verlängerung der Wirbelsäule und schau auf einen Punkt etwa 30 cm vor deinen Händen.",
  },
  too_fast: {
    title: "Zu schnelles Absenken",
    detail: "Du lässt dich sehr schnell fallen.",
    cue: "Langsamer runter",
    tip: "Senke dich kontrolliert in etwa 1–2 Sekunden ab. Das schont die Schultern und macht die Übung effektiver.",
  },
};
const PUSHUP_JOINTS = { shallow: [13, 14], hip_sag: [23, 24], hip_pike: [23, 24], no_lockout: [13, 14], head_drop: [0, 7, 8], too_fast: [] };

// ---------- Tennis ----------
const TENNIS_ISSUES = {
  serve_knees: {
    title: "Zu wenig Beinarbeit",
    detail: "Beim Ausholen beugst du die Knie kaum.",
    cue: "Knie beugen",
    tip: "Geh in der Trophy-Position (Schläger hinter dem Kopf, Ballwurfarm oben) deutlich in die Knie und drück dich dann explosiv nach oben ab. Ein großer Teil der Aufschlagkraft kommt aus den Beinen.",
  },
  serve_arm_bent: {
    title: "Arm im Treffpunkt gebeugt",
    detail: "Dein Schlagarm ist beim Treffen nicht gestreckt.",
    cue: "Hoch strecken",
    tip: "Triff den Ball am höchsten Punkt mit (fast) gestrecktem Arm. Wirf den Ball etwas höher und leicht vor dich, damit du dich zum Ball strecken kannst.",
  },
  serve_low_contact: {
    title: "Treffpunkt zu tief",
    detail: "Du triffst den Ball deutlich unterhalb deiner maximalen Reichweite.",
    cue: "Höher treffen",
    tip: "Ein hoher Treffpunkt gibt dir einen besseren Winkel ins Feld. Strecke dich aus den Beinen über die Hüfte bis in die Schlagschulter nach oben zum Ball.",
  },
  serve_toss_arm: {
    title: "Ballwurfarm zu niedrig",
    detail: "Dein Ballwurfarm streckt sich nicht hoch über den Kopf.",
    cue: "Wurfarm hoch",
    tip: "Führe den Wurfarm gestreckt nach oben und lass ihn lange oben, bis der Schläger kommt. Das kippt die Schulterachse und hält den Ball im Blick.",
  },
  serve_short_follow: {
    title: "Ausschwung zu kurz",
    detail: "Nach dem Treffpunkt bricht der Schwung ab.",
    cue: "Durchschwingen",
    tip: "Lass den Schläger nach dem Treffen locker an der Gegenseite deines Körpers vorbei bis zur Hüfte durchschwingen. Ein abgebremster Arm kostet Tempo und belastet die Schulter.",
  },
  turn: {
    title: "Zu wenig Schulterdrehung",
    detail: "Beim Ausholen drehst du den Oberkörper kaum ein.",
    cue: "Schultern eindrehen",
    tip: "Dreh beim Ausholen Schultern und Hüfte zur Seite (Unit Turn), bis die nicht-schlagende Schulter Richtung Ball zeigt. Der Schlag entsteht aus der Rückdrehung des Oberkörpers, nicht nur aus dem Arm.",
  },
  ground_knees: {
    title: "Beine zu gestreckt",
    detail: "Du stehst beim Schlag fast gestreckt.",
    cue: "In die Knie",
    tip: "Bleib in leichter Kniebeuge mit breitem Stand. Das gibt Stabilität und lässt dich von unten nach oben durch den Ball schwingen.",
  },
  cramped: {
    title: "Ball zu nah am Körper",
    detail: "Dein Schlagarm ist im Treffpunkt stark angewinkelt.",
    cue: "Mehr Abstand",
    tip: "Stell dich so zum Ball, dass du ihn etwa eine Armlänge seitlich vor dem Körper triffst. Kleine Anpassungsschritte vor dem Schlag helfen.",
  },
  bh_arm_bent: {
    title: "Schlagarm gebeugt",
    detail: "Bei der einhändigen Rückhand ist der Arm im Treffpunkt gebeugt.",
    cue: "Arm strecken",
    tip: "Triff die einhändige Rückhand mit gestrecktem Arm vor dem Körper. Wenn der Ellbogen führt, fehlen Kontrolle und Druck – und der Tennisarm lässt grüßen.",
  },
  low_follow: {
    title: "Ausschwung zu flach",
    detail: "Dein Schlag endet unterhalb der Schulter.",
    cue: "Hoch ausschwingen",
    tip: "Schwing von unten nach oben durch den Ball und beende den Schlag hoch über der Schulter. Das erzeugt Topspin und Sicherheit.",
  },
};
const TENNIS_JOINTS = {
  serve_knees: [25, 26], serve_arm_bent: [13, 14], serve_low_contact: [15, 16], serve_toss_arm: [15, 16],
  serve_short_follow: [15, 16], turn: [11, 12], ground_knees: [25, 26], cramped: [13, 14], bh_arm_bent: [13, 14], low_follow: [15, 16],
};

const REP_UNIT = { one: "Wiederholung", many: "Wiederholungen", dat: "Wiederholung", datMany: "Wiederholungen", none: "Keine Wiederholung erkannt", short: "Wdh." };
const STROKE_UNIT = { one: "Schlag", many: "Schläge", dat: "Schlag", datMany: "Schlägen", none: "Kein Schlag erkannt", short: "Schläge" };

const START_HINT_STAND = "Kurz halten, um zu starten. Danach ruhig hinstellen – seitlich oder frontal.";

export const EXERCISES = {
  squat: {
    id: "squat", name: "Kniebeuge", unit: REP_UNIT, issues: SQUAT_ISSUES, joints: SQUAT_JOINTS,
    usesClassifier: true,
    create: (o) => new SquatAnalyzer(o),
    meter: { max: 1.2, label: "parallel" },
    chart: { line: "Hüfttiefe", ref: 1, refLabel: "parallel", max: 1.3 },
    howto: [
      ["i-phone", "Handy auf Hüfthöhe", "2–3 m Abstand, ganzer Körper inklusive Füße im Bild."],
      ["i-eye", "Perspektive wählen", "<em>Seitlich:</em> Tiefe, Oberkörper, Fersen. <em>Frontal:</em> Knie und Symmetrie."],
      ["i-target", "Kurz stillstehen", "Zu Beginn aufrecht stehen, bis „Kalibriert“ erscheint. Dann loslegen."],
    ],
    startHint: START_HINT_STAND,
    stopHint: "Hand heben = Satz beenden",
    voice: { intro: "Stell dich hin und heb eine Hand über den Kopf, um zu starten.", ready: "Los geht's! Zum Beenden Hand heben.", afterStart: "Satz startet. Stell dich ruhig hin." },
    viewNote: (v) => (v === "side" ? "Seitliche Aufnahme: Knie-nach-innen und Asymmetrie wurden nicht geprüft." : v === "front" ? "Frontale Aufnahme: Oberkörper-Vorlage wurde nicht geprüft." : ""),
    metricLines: (r, view) => {
      const m = r.metrics;
      return [
        fin(m.depth) && `Tiefe: ${m.depth >= 0 ? "unter parallel ✓" : `${Math.round(-m.depth * 100)} % über parallel`}`,
        fin(m.kneeMin) && `Min. Kniewinkel: ${deg(m.kneeMin)}`,
        view !== "front" && fin(m.trunk) && `Oberkörper-Vorlage: ${deg(m.trunk)}`,
        view !== "side" && fin(m.kneeRatio) && `Knie-/Fußbreite: ${Math.round(m.kneeRatio * 100)} % des Stands`,
        fin(m.descentSec) && `Absenken: ${m.descentSec.toFixed(1)} s · gesamt ${m.durationSec.toFixed(1)} s`,
      ];
    },
  },

  pushup: {
    id: "pushup", name: "Liegestütz", unit: REP_UNIT, issues: PUSHUP_ISSUES, joints: PUSHUP_JOINTS,
    create: (o) => new PushupAnalyzer(o),
    meter: { max: 1.2, label: "90°" },
    chart: { line: "Ellbogenbeugung", ref: 1, refLabel: "Ellbogen 90°", max: 1.3 },
    howto: [
      ["i-phone", "Handy seitlich auf Bodenhöhe", "1,5–2,5 m Abstand, flach auf den Boden gestellt. Kopf bis Füße müssen im Bild sein."],
      ["i-eye", "Seitlich zur Kamera", "Nur so lassen sich Ellbogenwinkel und Körperlinie messen."],
      ["i-target", "Start & Pause", "Hand heben, dann in die Liegestütz-Position. Zum Beenden aufstehen und Hand heben."],
    ],
    startHint: "Kurz halten, dann seitlich zur Kamera in die Liegestütz-Position gehen.",
    stopHint: "Aufstehen + Hand heben = Satz beenden",
    voice: { intro: "Heb eine Hand über den Kopf, um zu starten. Dann seitlich in die Liegestütz-Position.", ready: "Position erkannt. Los geht's!", afterStart: "Geh seitlich zur Kamera in die Liegestütz-Position." },
    viewNote: () => "Liegestütze werden von der Seite bewertet: Tiefe, Körperlinie, Kopfhaltung und Strecken der Arme.",
    metricLines: (r) => {
      const m = r.metrics;
      return [
        fin(m.minElbow) && `Ellbogen unten: ${deg(m.minElbow)} (Ziel ≤ 90–100°)`,
        fin(m.topElbow) && `Ellbogen oben: ${deg(m.topElbow)}`,
        fin(m.hipDev) && `Hüfte: ${Math.abs(m.hipDev) < 0.045 ? "in Linie ✓" : m.hipDev > 0 ? `${Math.round(m.hipDev * 100)} % durchgehangen` : `${Math.round(-m.hipDev * 100)} % zu hoch`}`,
        fin(m.descentSec) && `Absenken: ${m.descentSec.toFixed(1)} s · gesamt ${m.durationSec.toFixed(1)} s`,
      ];
    },
  },
};

function tennis(stroke) {
  const serve = stroke === "serve";
  return {
    id: `tennis_${stroke}`, name: `Tennis · ${STROKE_NAMES[stroke]}`, unit: STROKE_UNIT, issues: TENNIS_ISSUES, joints: TENNIS_JOINTS,
    tennis: true, stroke,
    create: (o) => new TennisAnalyzer({ ...o, stroke }),
    meter: { max: 1.6, label: "Schlag" },
    chart: { line: "Handgelenk-Tempo", ref: 1, refLabel: "Schlag-Schwelle", max: 2.2 },
    howto: serve
      ? [
          ["i-phone", "Handy seitlich aufstellen", "Auf Hüfthöhe, 4–6 m entfernt, seitlich zur Aufschlagbewegung. Auch über dem Kopf muss Platz im Bild sein."],
          ["i-eye", "Ganze Bewegung im Bild", "Von der Trophy-Position bis zum Ausschwung – Schläger und Arm dürfen nicht aus dem Bild ragen."],
          ["i-target", "Start & Stopp", "Eine Hand heben = Start. Zum Beenden beide Hände über den Kopf halten."],
        ]
      : [
          ["i-phone", "Handy hinter oder vor dir", "Auf Hüfthöhe, 4–6 m entfernt, in Schlagrichtung – so ist die Schulterdrehung messbar."],
          ["i-eye", "Ganzer Körper im Bild", "Auch beim Ausholen und Ausschwingen. Video-Upload mit Zeitlupe funktioniert besonders gut."],
          ["i-target", "Start & Stopp", "Eine Hand heben = Start. Zum Beenden beide Hände über den Kopf halten."],
        ],
    startHint: "Kurz halten, um zu starten. Danach ganz normal schlagen.",
    stopHint: "Beide Hände heben = Training beenden",
    voice: { intro: "Heb eine Hand über den Kopf, um zu starten.", ready: `Bereit. ${STROKE_NAMES[stroke]}, los geht's! Zum Beenden beide Hände heben.`, afterStart: "Training startet." },
    praise: ["Guter Schlag!", "Sauber!", "Schön!", "Weiter so!"],
    viewNote: (v) => (serve ? "" : v === "side" ? "Seitliche Aufnahme: Die Schulterdrehung ließ sich nicht messen – filme von hinten oder vorne." : ""),
    metricLines: (r) => {
      const m = r.metrics;
      return serve
        ? [
            fin(m.kneeMin) && `Kniewinkel beim Ausholen: ${deg(m.kneeMin)} (Profis ~100–135°)`,
            fin(m.elbowContact) && `Ellbogen im Treffpunkt: ${deg(m.elbowContact)} (gestreckt ≈ 150°+)`,
            fin(m.contactHeight) && `Treffpunkt: ${m.contactHeight.toFixed(2)} Rumpflängen über dem Kopf`,
            fin(m.tossHeight) && `Ballwurfarm: ${m.tossHeight.toFixed(2)} Rumpflängen über dem Kopf`,
            fin(m.peakSpeed) && `Handgelenk-Tempo: ${m.peakSpeed.toFixed(1)} Rumpflängen/s`,
          ]
        : [
            fin(m.turn) ? `Schulterdrehung: ${Math.round(m.turn * 100)} %` : "Schulterdrehung: nicht messbar (Perspektive)",
            fin(m.kneeMin) && `Min. Kniewinkel: ${deg(m.kneeMin)}`,
            fin(m.elbowContact) && `Ellbogen im Treffpunkt: ${deg(m.elbowContact)}${stroke === "backhand" ? (m.twoHanded ? " (beidhändig)" : " (einhändig)") : ""}`,
            fin(m.followHigh) && `Ausschwung: ${m.followHigh >= 0 ? "über Schulterhöhe ✓" : "unter Schulterhöhe"}`,
            fin(m.peakSpeed) && `Handgelenk-Tempo: ${m.peakSpeed.toFixed(1)} Rumpflängen/s`,
          ];
    },
  };
}
EXERCISES.tennis_serve = tennis("serve");
EXERCISES.tennis_forehand = tennis("forehand");
EXERCISES.tennis_backhand = tennis("backhand");

export const exerciseOf = (id) => EXERCISES[id] ?? EXERCISES.squat;
