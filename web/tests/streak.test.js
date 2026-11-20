// Tests der Serien-Berechnung
import { computeStreak } from "../js/streak.js";

const at = (y, m, d, h = 18) => ({ performed_at: new Date(y, m - 1, d, h, 0, 0).toISOString() });
const NOW = new Date(2026, 10, 20, 15, 0, 0); // 20.11.2026, 15:00 lokal

export function runStreakTests() {
  const out = [];
  const check = (name, got, exp) => out.push({ name, ok: JSON.stringify(got) === JSON.stringify(exp), info: `${JSON.stringify(got)} ≠ ${JSON.stringify(exp)}` });

  check("Keine Sätze → 0", computeStreak([], NOW).current, 0);

  const three = [at(2026, 11, 18), at(2026, 11, 19), at(2026, 11, 20)];
  check("3 Tage in Folge inkl. heute → 3", computeStreak(three, NOW).current, 3);
  check("… heute erledigt", computeStreak(three, NOW).today, true);

  const untilYesterday = [at(2026, 11, 17), at(2026, 11, 18), at(2026, 11, 19)];
  const s2 = computeStreak(untilYesterday, NOW);
  check("Bis gestern trainiert → Serie läuft noch (3)", s2.current, 3);
  check("… und ist heute in Gefahr", s2.atRisk, true);

  check("Vorgestern zuletzt → Serie gerissen (0)", computeStreak([at(2026, 11, 17), at(2026, 11, 18)], NOW).current, 0);

  const gap = [at(2026, 11, 10), at(2026, 11, 11), at(2026, 11, 12), at(2026, 11, 13), at(2026, 11, 19), at(2026, 11, 20)];
  const s3 = computeStreak(gap, NOW);
  check("Lücke unterbricht: aktuell 2", s3.current, 2);
  check("Rekord bleibt 4", s3.best, 4);

  const several = [at(2026, 11, 20, 8), at(2026, 11, 20, 19), at(2026, 11, 19, 7)];
  check("Mehrere Sätze am selben Tag zählen einmal (2)", computeStreak(several, NOW).current, 2);

  const lateNight = [at(2026, 11, 19, 23), at(2026, 11, 20, 0)]; // 23:00 und 00:00 → zwei Tage
  check("23 Uhr und Mitternacht = zwei Tage (2)", computeStreak(lateNight, NOW).current, 2);

  check("Woche: letzte 7 Tage", computeStreak(gap, NOW).week, [false, false, false, false, false, true, true]);

  // Monatswechsel
  const monthEdge = [at(2026, 10, 30), at(2026, 10, 31), at(2026, 11, 1)];
  check("Über Monatsgrenze (Rekord 3)", computeStreak(monthEdge, NOW).best, 3);
  return out;
}
