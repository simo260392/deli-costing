// Financial-year KPI calendar used by the Kitchen Manager KPI tracker.
//
// • The financial year starts on the Monday on or before 1 July.
//   (FY2026-27 starts Monday 29 June 2026.)
// • Weeks run Monday → Sunday.
// • 13 periods of 4 weeks (52 weeks). In the occasional 53-week year the
//   extra week is treated as week 5 of period 13.
//
// All dates are plain "YYYY-MM-DD" strings in Perth time; arithmetic is done
// in UTC on those calendar dates so time zones can't shift a day.

export interface KpiWeek {
  number: number;     // 1–4 within the period (5 only in a 53-week year)
  fyWeek: number;     // 1–53 within the financial year
  start: string;      // Monday
  end: string;        // Sunday
}

export interface KpiPeriod {
  fyLabel: string;    // e.g. "FY2026–27"
  period: number;     // 1–13
  start: string;      // Monday of week 1
  end: string;        // Sunday of the last week
  weeks: KpiWeek[];
}

const DAY = 86_400_000;
const toDate = (s: string) => new Date(s + "T00:00:00Z");
const fmt = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => fmt(new Date(toDate(s).getTime() + n * DAY));

/** Monday on or before 1 July of the given calendar year. */
export function fyStart(year: number): string {
  const jul1 = new Date(Date.UTC(year, 6, 1));
  const back = (jul1.getUTCDay() + 6) % 7; // days since Monday
  return fmt(new Date(jul1.getTime() - back * DAY));
}

/** Today's date in Perth (AWST, UTC+8, no daylight saving). */
export function todayPerth(): string {
  return fmt(new Date(Date.now() + 8 * 3_600_000));
}

/** The KPI period containing `date` (defaults to today in Perth). */
export function periodFor(date: string = todayPerth()): KpiPeriod {
  const y = toDate(date).getUTCFullYear();
  let fyYear = y;
  if (date < fyStart(y)) fyYear = y - 1;
  const start = fyStart(fyYear);
  const nextStart = fyStart(fyYear + 1);
  const totalWeeks = Math.round((toDate(nextStart).getTime() - toDate(start).getTime()) / (7 * DAY)); // 52 or 53

  const fyWeekIdx = Math.floor((toDate(date).getTime() - toDate(start).getTime()) / (7 * DAY)); // 0-based
  const period = Math.min(13, Math.floor(fyWeekIdx / 4) + 1);
  const firstWeekIdx = (period - 1) * 4;
  const weekCount = period === 13 ? totalWeeks - 48 : 4;

  const weeks: KpiWeek[] = [];
  for (let i = 0; i < weekCount; i++) {
    const wStart = addDays(start, (firstWeekIdx + i) * 7);
    weeks.push({ number: i + 1, fyWeek: firstWeekIdx + i + 1, start: wStart, end: addDays(wStart, 6) });
  }
  const yy = (n: number) => String(n % 100).padStart(2, "0");
  return {
    fyLabel: `FY${fyYear}–${yy(fyYear + 1)}`,
    period,
    start: weeks[0].start,
    end: weeks[weeks.length - 1].end,
    weeks,
  };
}

/** Which week of `p` contains `date` (1-based), or null if outside the period. */
export function weekOf(p: KpiPeriod, date: string): number | null {
  const w = p.weeks.find((w) => date >= w.start && date <= w.end);
  return w ? w.number : null;
}

/** The period immediately before / after `p`. */
export function previousPeriod(p: KpiPeriod): KpiPeriod {
  return periodFor(addDays(p.start, -1));
}
export function nextPeriod(p: KpiPeriod): KpiPeriod {
  return periodFor(addDays(p.end, 1));
}
