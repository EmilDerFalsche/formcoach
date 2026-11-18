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
// Hilfen für verständliche Angaben (eine Rumpflänge ≈ 50 cm, nur grobe Schätzung)
const cm = (v) => `ca. ${Math.max(5, Math.round((Math.abs(v) * 50) / 5) * 5)} cm`;
const aboveBelow = (v, ref) => (v >= 0 ? `${cm(v)} über ${ref}` : `${cm(v)} unter ${ref}`);

const TENNIS_ISSUES = {
  // ---------- Aufschlag ----------
  serve_knees: {
    title: "Zu wenig Beinarbeit",
    cue: "Knie beugen",
    seen: (m) => `Dein Knie war beim Ausholen auf ${deg(m.kneeMin)} gebeugt (180° = gestreckt). Gute Aufschläge liegen bei etwa 100–135°.`,
    why: "Ein großer Teil der Aufschlagkraft kommt aus den Beinen. Ohne Kniebeuge schlägst du nur mit Arm und Schulter – das kostet Tempo und belastet die Schulter.",
    fix: ["Während der Ball hochfliegt, beide Knie deutlich beugen (Gewicht auf die Fußballen).", "Wenn der Schläger hinter dem Rücken ist, explosiv nach oben zum Ball strecken – du darfst dabei abspringen."],
    drill: "Schattenaufschläge ohne Ball: Ausholen, 1 Sekunde tief in den Knien halten, dann nach oben explodieren. 3×10.",
  },
  serve_arm_bent: {
    title: "Arm im Treffpunkt gebeugt",
    cue: "Hoch strecken",
    seen: (m) => `Dein Ellbogen war im Treffpunkt auf ${deg(m.elbowContact)} – gestreckt wären etwa 150–180°.`,
    why: "Mit gebeugtem Arm triffst du den Ball tiefer als nötig. Dadurch wird das Aufschlagfeld kleiner und du verlierst Tempo.",
    fix: ["Den Ball am höchsten Punkt treffen, den du mit gestrecktem Arm erreichst.", "Ball etwas höher und leicht vor dich werfen, damit du dich zum Ball strecken kannst."],
    drill: "Stell dich an eine Wand, strecke den Schlagarm mit Schläger maximal nach oben und merke dir die Höhe – genau dort soll der Treffpunkt sein.",
  },
  serve_low_contact: {
    title: "Treffpunkt zu tief",
    cue: "Höher treffen",
    seen: (m) => (fin(m.racketTopHeight)
      ? `Die Schlägeroberkante war im Treffpunkt nur ${cm(m.racketTopHeight)} über deinem Kopf. Mit gestrecktem Arm und Schläger sind es etwa 110–130 cm.`
      : `Deine Schlaghand war im Treffpunkt nur ${aboveBelow(m.contactHeight, "deinem Kopf")}. Mit gestrecktem Arm sind es etwa 35–50 cm.`),
    why: "Je höher der Treffpunkt, desto steiler kannst du ins Feld schlagen – der Ball geht sicherer über das Netz und landet trotzdem im Feld.",
    fix: ["Ball höher werfen (knapp über die Reichweite des gestreckten Schlägers).", "Aus den Beinen über die Hüfte bis in die Schlagschulter nach oben strecken."],
    drill: "Ballwurf-Übung: Ball werfen, nicht schlagen, sondern mit dem gestreckten Schläger am höchsten Punkt antippen. 15 Wiederholungen.",
  },
  serve_toss_arm: {
    title: "Ballwurfarm zu niedrig",
    cue: "Wurfarm hoch",
    seen: (m) => `Dein Wurfarm kam nur ${aboveBelow(m.tossHeight, "deinen Kopf")}. Ideal: gestreckt hoch über den Kopf, Richtung Ball.`,
    why: "Der hoch gestreckte Wurfarm kippt die Schulterachse und spannt den Körper vor. Bleibt er unten, fehlt diese Vorspannung und der Wurf wird ungenau.",
    fix: ["Den Ball mit gestrecktem Arm loslassen – die Hand zieht weiter nach oben, bis der Arm senkrecht ist.", "Den Wurfarm oben lassen, bis der Schläger nach vorne kommt."],
    drill: "Nur Ballwurf: 10× werfen, Arm oben halten und den Ball wieder auf die offene Hand fallen lassen.",
  },
  serve_short_follow: {
    title: "Ausschwung zu kurz",
    cue: "Durchschwingen",
    seen: () => "Nach dem Treffpunkt kam deine Schlaghand nicht bis unter die Hüfte – der Schwung wurde abgebremst.",
    why: "Ein abgebremster Arm kostet Tempo und belastet Schulter und Ellbogen, weil die Muskeln die Bewegung aktiv stoppen müssen.",
    fix: ["Den Schläger nach dem Treffen locker weiterschwingen lassen.", "Er endet an der Gegenseite deines Körpers, etwa auf Höhe der Hüfte."],
    drill: "Schattenaufschläge mit Fokus nur auf den Ausschwung: Schläger fallen lassen statt bremsen.",
  },
  toss_low: {
    title: "Ballwurf zu niedrig",
    cue: "Höher werfen",
    seen: (m) => `Der Ball kam höchstens ${aboveBelow(m.tossAboveContact, "deinen Treffpunkt")}. Er sollte etwa 10–30 cm darüber steigen.`,
    why: "Fliegt der Ball nicht über deinen Treffpunkt hinaus, musst du ihn im Aufwärtsflug oder zu tief treffen – das macht den Aufschlag hektisch.",
    fix: ["Ball etwas höher werfen, sodass er kurz über deiner Reichweite stillsteht.", "Die Wurfhand führt bis über den Kopf, statt den Ball früh loszulassen."],
    drill: "Ballwurf neben einem Zaun oder Mast: Markiere die Zielhöhe und triff sie 10× hintereinander.",
  },
  toss_high: {
    title: "Ballwurf zu hoch",
    cue: "Tiefer werfen",
    seen: (m) => `Der Ball stieg ${cm(m.tossAboveContact)} über deinen Treffpunkt – du musst lange warten.`,
    why: "Ein sehr hoher Ballwurf fällt schnell und ist schwer zu timen; Wind macht ihn zusätzlich unberechenbar.",
    fix: ["Ball nur so hoch werfen, dass er knapp über deinem gestreckten Schläger umkehrt.", "Gleichmäßiger Rhythmus: Ausholen und Wurf gleichzeitig beginnen."],
    drill: "10 Würfe mit dem Ziel, dass der Ball nach dem Umkehrpunkt genau auf deinen gestreckten Schläger fällt.",
  },

  // ---------- Vorhand / Rückhand ----------
  turn: {
    title: "Zu wenig Schulterdrehung",
    cue: "Schultern eindrehen",
    seen: (m) => `Deine Schultern haben sich beim Ausholen nur um ${Math.round(m.turn * 100)} % eingedreht (gemessen an der sichtbaren Schulterbreite). Gut sind 30 % und mehr.`,
    why: "Die Kraft eines Grundschlags entsteht aus der Rückdrehung des Oberkörpers. Schlägst du nur aus dem Arm, fehlen Tempo und Kontrolle.",
    fix: ["Sobald du den Ball kommen siehst: Schultern und Hüfte zur Seite drehen (Unit Turn).", "Die nicht-schlagende Hand zeigt dabei zum Ball und hilft beim Eindrehen."],
    drill: "Schattenschläge: Vor jedem Schlag „Drehen – Stopp – Schlagen“ ansagen. Beim „Stopp“ muss deine Schulter Richtung Netz zeigen.",
  },
  ground_knees: {
    title: "Beine zu gestreckt",
    cue: "In die Knie",
    seen: (m) => `Dein Knie war während des Schlags höchstens auf ${deg(m.kneeMin)} gebeugt (180° = gestreckt). Gut sind etwa 140–160°.`,
    why: "Aus gestreckten Beinen kannst du nicht von unten nach oben durch den Ball schwingen – Topspin und Stabilität fehlen.",
    fix: ["Breiter stehen und in eine leichte Kniebeuge gehen, bevor der Ball kommt.", "Beim Schlagen aus den Beinen nach oben drücken."],
    drill: "Schattenschläge in breiter Grätsche: Die Knie bleiben über die ganze Bewegung leicht gebeugt.",
  },
  cramped: {
    title: "Ball zu nah am Körper",
    cue: "Mehr Abstand",
    seen: (m) => (fin(m.racketReach)
      ? `Die Schlägermitte war im Treffpunkt nur ${cm(m.racketReach)} von deiner Brust entfernt. Mit Armlänge plus Schläger sind etwa 80–110 cm üblich.`
      : `Dein Arm war im Treffpunkt stark angewinkelt (${deg(m.elbowContact)}) und die Hand nur ${cm(m.reach)} von der Brust entfernt.`),
    why: "Steht der Ball zu nah, kannst du nicht frei durchschwingen. Der Schlag wird eng, kurz und unkontrolliert.",
    fix: ["Mit kleinen Anpassungsschritten so zum Ball stellen, dass du ihn eine Armlänge seitlich vor dem Körper triffst.", "Lieber einen Schritt zu weit weg als zu nah – nach vorne in den Ball zu gehen ist leichter."],
    drill: "Ball aus der Hand fallen lassen, eine Armlänge seitlich vom Körper, und nach dem Aufspringen schlagen. 15×.",
  },
  low_contact_gs: {
    title: "Treffpunkt sehr tief",
    cue: "Tiefer gehen",
    seen: (m) => `Der Treffpunkt lag deutlich unter deiner Hüfte. Ideal ist ein Treffpunkt zwischen Hüfte und Schulter.`,
    why: "Tief getroffene Bälle musst du nach oben schaufeln – das macht sie langsam und hoch.",
    fix: ["Bei tiefen Bällen mit den Knien tiefer gehen statt den Oberkörper zu beugen.", "Den Ball früher (im Steigen) oder später (wieder auf Hüfthöhe) nehmen."],
    drill: "Zuspieler wirft flache Bälle: Jeden Ball mit gebeugten Knien zwischen Hüfte und Schulter treffen.",
  },
  bh_arm_bent: {
    title: "Schlagarm gebeugt",
    cue: "Arm strecken",
    seen: (m) => `Dein Schlagarm war bei der einhändigen Rückhand auf ${deg(m.elbowContact)} gebeugt – gestreckt wären 150–180°.`,
    why: "Wenn der Ellbogen führt, fehlen Kontrolle und Druck, und die Belastung landet im Unterarm (Tennisarm).",
    fix: ["Den Ball vor dem Körper mit gestrecktem Arm treffen.", "Die Schulter der Schlaghand zeigt beim Ausholen Richtung Netz."],
    drill: "Schattenschläge in Zeitlupe: Im Treffpunkt stoppen und prüfen, ob der Arm gerade ist.",
  },
  low_follow: {
    title: "Ausschwung zu flach",
    cue: "Hoch ausschwingen",
    seen: (m) => `Deine Schlaghand endete ${aboveBelow(m.followHigh, "deiner Schulter")}. Sie sollte über der Schulter enden.`,
    why: "Ein hoher Ausschwung bedeutet, dass du von unten nach oben durch den Ball geschwungen hast – das gibt Topspin und Sicherheit.",
    fix: ["Den Schläger nach dem Treffpunkt nach vorne-oben weiterführen.", "Vorhand: Er endet über der gegenüberliegenden Schulter. Rückhand: hoch auf der Schlagseite."],
    drill: "Nach jedem Schattenschlag in der Endposition 2 Sekunden einfrieren – die Hand muss über Schulterhöhe sein.",
  },
  no_racket_drop: {
    title: "Kein Topspin-Schwung",
    cue: "Schlägerkopf fallen lassen",
    seen: (m) => `Der Schlägerkopf war vor dem Treffpunkt höchstens ${aboveBelow(-m.racketDrop, "deiner Hand")} – er sollte darunter fallen.`,
    why: "Topspin entsteht, wenn der Schläger von unterhalb des Balls nach oben schwingt. Dafür muss der Schlägerkopf vor dem Treffpunkt kurz unter die Hand fallen.",
    fix: ["Nach dem Ausholen den Schlägerkopf locker hinter dir nach unten fallen lassen.", "Dann von unten nach oben durch den Ball schwingen."],
    drill: "Schattenschläge: bewusst „Schlägerkopf runter – hoch durch“ sagen. Später mit Ball gegen eine Wand.",
  },
};
// Rückwärtskompatibel: kurze Texte für Live-Anzeige und alte Darstellung
for (const v of Object.values(TENNIS_ISSUES)) { v.detail ??= v.why; v.tip ??= v.fix.join(" "); }

const TENNIS_JOINTS = {
  toss_low: [15, 16], toss_high: [15, 16], low_contact_gs: [25, 26], no_racket_drop: [15, 16],
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
      const SRC = { ball: "Ball am Schläger erkannt", racket: "über die Schlägerbewegung", wrist: "über die Handbewegung (geschätzt)" };
      const seen = [
        m.racketSeen > 0 && `Schläger erkannt in ${Math.round(m.racketSeen * 100)} % der Bilder${m.ballSeen > 0 ? `, Ball in ${Math.round(m.ballSeen * 100)} %` : ""}`,
        m.contactSource && `Treffpunkt bestimmt ${SRC[m.contactSource] ?? ""}`,
      ];
      return serve
        ? [
            fin(m.kneeMin) && `Kniebeuge beim Ausholen: ${deg(m.kneeMin)} (gute Aufschläge ≈ 100–135°)`,
            fin(m.elbowContact) && `Ellbogen im Treffpunkt: ${deg(m.elbowContact)} (gestreckt ≈ 150–180°)`,
            fin(m.racketTopHeight) ? `Schlägeroberkante im Treffpunkt: ${cm(m.racketTopHeight)} über dem Kopf`
              : fin(m.contactHeight) && `Hand im Treffpunkt: ${aboveBelow(m.contactHeight, "dem Kopf")}`,
            fin(m.tossAboveContact) && `Ballwurf: höchster Punkt ${aboveBelow(m.tossAboveContact, "dem Treffpunkt")}`,
            fin(m.tossHeight) && `Wurfarm: ${aboveBelow(m.tossHeight, "dem Kopf")}`,
            ...seen,
          ]
        : [
            fin(m.turn) ? `Schulterdrehung beim Ausholen: ${Math.round(m.turn * 100)} % (gut ≥ 30 %)` : "Schulterdrehung: aus dieser Perspektive nicht messbar",
            fin(m.kneeMin) && `Kniebeuge: ${deg(m.kneeMin)} (gut ≈ 140–160°)`,
            fin(m.contactZone) && `Treffpunkt-Höhe: ${m.contactZone < -0.2 ? "unter Hüfthöhe" : m.contactZone > 1.2 ? "über Schulterhöhe" : "zwischen Hüfte und Schulter ✓"}`,
            fin(m.racketReach) ? `Abstand Schläger–Brust im Treffpunkt: ${cm(m.racketReach)}`
              : fin(m.elbowContact) && m.elbowContact >= 60 && `Ellbogen im Treffpunkt: ${deg(m.elbowContact)}${stroke === "backhand" ? (m.twoHanded ? " (beidhändig)" : " (einhändig)") : ""}`,
            fin(m.racketDrop) && `Schlägerkopf vor dem Treffpunkt: ${aboveBelow(-m.racketDrop, "der Hand")}`,
            fin(m.followHigh) && `Ausschwung endet ${aboveBelow(m.followHigh, "der Schulter")}`,
            ...seen,
          ];
    },
  };
}
EXERCISES.tennis_serve = tennis("serve");
EXERCISES.tennis_forehand = tennis("forehand");
EXERCISES.tennis_backhand = tennis("backhand");

export const exerciseOf = (id) => EXERCISES[id] ?? EXERCISES.squat;

// ---------- Verständliche Erklärungen für Kniebeuge & Liegestütz ----------
const pct = (v) => `${Math.round(Math.abs(v) * 100)} %`;
Object.assign(SQUAT_ISSUES.shallow, {
  seen: (m) => `Deine Hüfte blieb im tiefsten Punkt über Kniehöhe (Kniewinkel ${deg(m.kneeMin)}). Ziel: Hüftfalte mindestens auf Kniehöhe.`,
  why: "Erst ab paralleler Tiefe arbeiten Gesäß und Oberschenkel über den vollen Bewegungsumfang – flache Kniebeugen trainieren nur einen Teil.",
});
Object.assign(SQUAT_ISSUES.forward_lean, {
  seen: (m) => `Dein Oberkörper war im tiefsten Punkt um ${deg(m.trunk)} nach vorne geneigt. Bis etwa 45° ist normal.`,
  why: "Starke Vorlage verlagert die Last auf den unteren Rücken statt auf die Beine.",
});
Object.assign(SQUAT_ISSUES.hips_first, {
  seen: (m) => `Beim Aufstehen kippte dein Oberkörper um zusätzliche ${deg(m.hipsFirst)} nach vorne – die Hüfte kam zuerst hoch.`,
  why: "So wird aus der Kniebeuge eine Art Kreuzheben – der Rücken übernimmt Arbeit, die die Beine machen sollten.",
});
Object.assign(SQUAT_ISSUES.knees_in, {
  seen: (m) => `Deine Knie standen in der Hocke nur noch ${pct(m.kneeRatio)} so weit auseinander wie im Stand. Sie sollten mindestens gleich weit bleiben.`,
  why: "Nach innen fallende Knie belasten Bänder und Meniskus und kosten Kraft.",
});
Object.assign(SQUAT_ISSUES.heels_up, {
  seen: (m) => `Deine Fersen hoben sich im tiefsten Punkt um ca. ${Math.max(1, Math.round(m.heelLift * 45))} cm vom Boden.`,
  why: "Ohne Fersenkontakt verlagert sich das Gewicht auf die Zehen – du wirst instabil und die Knie werden stärker belastet.",
});
Object.assign(SQUAT_ISSUES.asymmetric, {
  seen: () => "Dein Becken stand in der Hocke schief oder war zu einer Seite verschoben.",
  why: "Einseitige Belastung führt langfristig zu Dysbalancen und kann Hüfte und Rücken reizen.",
});
Object.assign(SQUAT_ISSUES.too_fast, {
  seen: (m) => `Du hast dich in ${m.descentSec.toFixed(1)} s abgesenkt. Ziel: etwa 2 s.`,
  why: "Kontrolliertes Absenken verbessert die Technik und hält die Muskeln unter Spannung.",
});
Object.assign(PUSHUP_ISSUES.shallow, {
  seen: (m) => `Deine Ellbogen beugten sich nur bis ${deg(m.minElbow)}. Ziel: 90° oder weniger.`,
  why: "Erst in der Tiefe arbeiten Brust und Trizeps über den vollen Bewegungsumfang.",
});
Object.assign(PUSHUP_ISSUES.hip_sag, {
  seen: (m) => `Deine Hüfte hing ca. ${Math.max(1, Math.round(m.hipDev * 150))} cm unter der Linie Schulter–Fuß.`,
  why: "Ein durchhängendes Becken belastet den unteren Rücken und nimmt der Übung die Rumpfspannung.",
});
Object.assign(PUSHUP_ISSUES.hip_pike, {
  seen: (m) => `Deine Hüfte war ca. ${Math.max(1, Math.round(-m.hipDev * 150))} cm über der Linie Schulter–Fuß.`,
  why: "Mit hohem Po verlagert sich das Gewicht auf die Schultern und die Brust trainiert weniger mit.",
});
Object.assign(PUSHUP_ISSUES.no_lockout, {
  seen: (m) => `Oben waren deine Arme nur auf ${deg(m.topElbow)} gestreckt. Ziel: über 160°.`,
  why: "Volle Streckung oben gehört zur kompletten Wiederholung und trainiert die Schulterstabilität.",
});
Object.assign(PUSHUP_ISSUES.head_drop, {
  seen: () => "Dein Kopf sank unter die Linie deines Körpers.",
  why: "Ein hängender Kopf belastet den Nacken und führt oft dazu, dass auch der Rücken rund wird.",
});
Object.assign(PUSHUP_ISSUES.too_fast, {
  seen: (m) => `Du hast dich in ${m.descentSec.toFixed(1)} s abgesenkt. Ziel: 1–2 s.`,
  why: "Fallenlassen belastet die Schultern und verschenkt Trainingsreiz.",
});

// ---------- Übungsfotos (Unsplash-Lizenz) – nur als Platzhalter, solange es keine eigenen Standbilder gibt ----------
const PHOTOS = {
  squat: "fTbktIYS6sg",
  pushup: "P3wsv-msSgw",
  tennis_serve: "AldB5IWh8l4",
  tennis_forehand: "n9RZ0dCunpY",
  tennis_backhand: "WqI-PbYugn4",
  tennis: "n9RZ0dCunpY",
};
export const photoUrl = (exId, w = 400) => (PHOTOS[exId] ? `https://unsplash.com/photos/${PHOTOS[exId]}/download?w=${w}` : null);
/** Karten auf der Startseite: Tennis ist EINE Karte, die Schlagart wird erst beim Start gewählt */
export const HOME_EXERCISES = [
  { id: "squat", label: "Kniebeuge", ex: ["squat"], sel: { exercise: "squat" } },
  { id: "pushup", label: "Liegestütz", ex: ["pushup"], sel: { exercise: "pushup" } },
  { id: "tennis", label: "Tennis", ex: ["tennis_forehand", "tennis_backhand", "tennis_serve"], sel: { exercise: "tennis" } },
];
export const groupOf = (exId) => HOME_EXERCISES.find((g) => g.ex.includes(exId))?.id ?? exId;
