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

/** How many of `weeks` share the same primary month as `weekIso`. Still used by
 *  ReportsPanel to pass a count through to the two functions below; no longer used to
 *  divide a total (see isLastWeekOfMonth's header comment for why the even-split this
 *  used to feed was replaced). Kept so those call sites don't need to change. */
export function weeksInSameMonth(weeks, weekIso) {
  const month = primaryMonthForWeek(weekIso);
  return weeks.filter((w) => primaryMonthForWeek(w) === month).length || 1;
}

/** Even-split helper — RETAINED but no longer called by the default path below
 *  (2026-08-24, Kayee: "that's not accrual accounting. it is fundamentally wrong").
 *  Left in place only in case a future explicit "spread evenly" mode is ever added as
 *  a real, opted-into choice rather than the silent default. */
export function evenSplitAcrossWeeks(monthlyTotal, weeksInMonthCount) {
  return (Number(monthlyTotal) || 0) / (weeksInMonthCount || 1);
}

/** True when `weekIso`'s own 7-day span contains `monthIso`'s actual last calendar
 *  day — e.g. the week spanning Jul 27–Aug 2 is the "last week" of July, because July
 *  31 falls inside it, even though 5 of its 7 days are technically in August.
 *  Deliberately a DIFFERENT question from primaryMonthForWeek (majority-of-days
 *  ownership, used to decide which month's $ a week even asks for) — a week can be
 *  "owned" by August for even-split/rollup purposes while still being the correct
 *  landing spot for July's month-end cash movement. Exactly one week in the whole
 *  sequence satisfies this for any given month, since weeks step in contiguous 7-day
 *  strides with no gaps or overlaps. */
export function isLastWeekOfMonth(weekIso, monthIso) {
  const [y, m] = monthIso.split('-').map(Number);
  const monthEndMs = Date.UTC(y, m, 0); // day 0 of "next" month = last day of this one
  const start = new Date(`${weekIso}T00:00:00Z`).getTime();
  const end = start + 6 * DAY_MS;
  return monthEndMs >= start && monthEndMs <= end;
}

/** Cash out the door for one account in one forecast WEEK. `timing.manualByWeek[weekIso]`
 *  wins outright when present — the per-week override this module exists for. Otherwise,
 *  the WHOLE month's cashOutflowForMonth() figure lands in the single week that
 *  contains that month's actual last calendar day; every other week in that month
 *  gets $0 (2026-08-24, Kayee: "when you say cash that's not accrual accounting... you
 *  need to put them all in the last week of the month" — replacing the previous
 *  even-split-across-every-week default, which smeared one real cash movement across
 *  4–5 weeks, not how a bank account actually clears a bill or a payroll run). Applies
 *  the SAME timing config (Follow P&L / Custom interval) Monthly CF already uses — set
 *  it from either tab, it drives both. A per-account "which week" override (first/
 *  middle/last, for quarterly/annual accounts) is the planned next step on top of this
 *  default — not built yet. */
export function cashOutflowForWeek(account, timing, weekIso, weeksInMonthCount, forecastMonthSet, ctx) {
  const manual = timing?.manualByWeek?.[weekIso];
  if (manual != null) return Number(manual) || 0;
  const month = primaryMonthForWeek(weekIso);
  const monthTotal = cashOutflowForMonth(account, timing, month, forecastMonthSet, ctx);
  return isLastWeekOfMonth(weekIso, month) ? monthTotal : 0;
}
