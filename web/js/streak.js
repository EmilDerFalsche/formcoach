// Trainings-Serie ("Streak"): Tage in Folge mit mindestens einem analysierten Satz.
// Gerechnet in lokaler Zeit. Hat man heute noch nicht trainiert, gilt die Serie von gestern
// bis Mitternacht weiter ("in Gefahr").

/** Lokaler Tagesschlüssel YYYY-MM-DD */
export const dayKey = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};
const addDays = (d, n) => { const x = new Date(d); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() + n); return x; };

/**
 * @param {Array<{performed_at: string}>} items Sätze (beliebige Reihenfolge)
 * @param {Date} [now]
 * @returns {{current: number, best: number, today: boolean, atRisk: boolean, week: boolean[]}}
 *   week: die letzten 7 Tage (ältester zuerst, heute zuletzt) – true = trainiert
 */
export function computeStreak(items, now = new Date()) {
  const days = new Set(items.map((i) => dayKey(i.performed_at)));
  const todayKey = dayKey(now);
  const today = days.has(todayKey);
  const yesterday = days.has(dayKey(addDays(now, -1)));

  // aktuelle Serie: ab heute (oder gestern, wenn heute noch offen) rückwärts zählen
  let current = 0;
  if (today || yesterday) {
    let d = today ? addDays(now, 0) : addDays(now, -1);
    while (days.has(dayKey(d))) { current++; d = addDays(d, -1); }
  }

  // Rekord: längste Folge aufeinanderfolgender Tage
  let best = 0, run = 0, prev = null;
  for (const k of [...days].sort()) {
    const d = new Date(`${k}T12:00:00`);
    run = prev && dayKey(addDays(prev, 1)) === k ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }

  const week = Array.from({ length: 7 }, (_, i) => days.has(dayKey(addDays(now, i - 6))));
  return { current, best: Math.max(best, current), today, atRisk: !today && current > 0, week };
}
