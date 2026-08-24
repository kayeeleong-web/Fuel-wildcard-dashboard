/**
 * Weekly Cash Flow forecast helpers (2026-08-24, Kayee: "both cash flow weekly and
 * monthly has its own assumption... I still want it to sync somehow... the only
 * thing different is in weekly I can choose the specific week").
 *
 * Weekly CF shares the EXACT SAME cash-timing assumptions as Monthly CF —
 * `timingByAccount`, from useCashTimingState (lib/cashflow/useCashTimingState.js).
 * There is no separate weekly config object and no separate sidebar: ReportsPanel
 * mounts a fresh instance per sub-tab, but both instances read/write the SAME
 * localStorage key, and only one CF-family sub-tab is ever mounted at a time — so
 * setting an account's timing from either Monthly or Weekly CF is visible on the
 * other the moment you switch tabs, no extra wiring needed. The one net-new piece of
 * data is `timing.manualByWeek` (parallel to the existing `timing.manualByMonth`) —
 * an account in Manual mode can carry independent per-month AND per-week figures at
 * once; they're different keys on the same object, so neither overwrites the other,
 * and switching between the two views never loses what you typed in the other one.
 *
 * Every OTHER timing mode (Follow P&L, Custom interval) has no separate weekly
 * config at all — this module takes whatever cashOutflowForMonth() already computes
 * for a week's calendar month and splits it evenly across however many forecast
 * weeks that month has. That's a deliberate approximation (real bills don't usually
 * land in perfectly equal weekly slices) — Manual mode + manualByWeek is the escape
 * hatch for a week that should carry more or less than an even split.
 */

import { cashOutflowForMonth } from './cashProjection';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Continues the existing weekly column sequence (7-day steps from the last real
 *  week) forward through `throughIso` (a full "YYYY-MM-DD" date) — pure column
 *  padding, never fabricated data, same rule as ReportsPanel's extendMonthsThrough. */
export function extendWeeksThrough(weeks, throughIso) {
  if (weeks.length === 0) return weeks;
  const extended = [...weeks];
  let last = new Date(`${weeks[weeks.length - 1]}T00:00:00Z`);
  const through = new Date(`${throughIso}T00:00:00Z`);
  while (last.getTime() < through.getTime()) {
    last = new Date(last.getTime() + 7 * DAY_MS);
    extended.push(last.toISOString().slice(0, 10));
  }
  return extended;
}

/** The calendar month (ISO "YYYY-MM") that "owns" a week, by majority-of-days rule —
 *  whichever month most of that week's 7 days actually fall in. Assumes `weekIso` is
 *  the Monday the "Weekly CF" sheet tab's own columns are anchored to (4/1/2024 was a
 *  Monday) — this doesn't re-derive or change that grouping, only reads it. */
export function primaryMonthForWeek(weekIso) {
  const counts = new Map();
  const start = new Date(`${weekIso}T00:00:00Z`);
  for (let i = 0; i < 7; i++) {
    const d = new Date(start.getTime() + i * DAY_MS);
    const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    counts.set(month, (counts.get(month) || 0) + 1);
  }
  let best = null;
  let bestCount = -1;
  for (const [month, count] of counts) {
    if (count > bestCount) {
      best = month;
      bestCount = count;
    }
  }
  return best;
}

/** Date-range label for a week's header, e.g. "Aug 25 – Aug 31". */
export function weekRangeLabel(weekIso) {
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const start = new Date(`${weekIso}T00:00:00Z`);
  const end = new Date(start.getTime() + 6 * DAY_MS);
  const s = `${names[start.getUTCMonth()]} ${start.getUTCDate()}`;
  const e = `${names[end.getUTCMonth()]} ${end.getUTCDate()}`;
  return `${s} – ${e}`;
}

/** How many of `weeks` share the same primary month as `weekIso` — the divisor for
 *  the even-split default described above. Always at least 1. */
export function weeksInSameMonth(weeks, weekIso) {
  const month = primaryMonthForWeek(weekIso);
  return weeks.filter((w) => primaryMonthForWeek(w) === month).length || 1;
}

/** Same even-split rule applied to a plain monthly $ figure — used for revenue rows,
 *  which have no per-account timing config (matches monthly CF's own behavior: there
 *  is no manual override for Transaction/Subscription Revenue there either). */
export function evenSplitAcrossWeeks(monthlyTotal, weeksInMonthCount) {
  return (Number(monthlyTotal) || 0) / (weeksInMonthCount || 1);
}

/** Cash out the door for one account in one forecast WEEK. `timing.manualByWeek[weekIso]`
 *  wins outright when present — the per-week override this module exists for. Otherwise
 *  falls back to that week's even share of cashOutflowForMonth() for its primary month,
 *  applying the SAME timing config (Follow P&L / Custom interval) Monthly CF already
 *  uses — set it from either tab, it drives both. */
export function cashOutflowForWeek(account, timing, weekIso, weeksInMonthCount, forecastMonthSet, ctx) {
  const manual = timing?.manualByWeek?.[weekIso];
  if (manual != null) return Number(manual) || 0;
  const month = primaryMonthForWeek(weekIso);
  const monthTotal = cashOutflowForMonth(account, timing, month, forecastMonthSet, ctx);
  return evenSplitAcrossWeeks(monthTotal, weeksInMonthCount);
}
