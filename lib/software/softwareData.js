/**
 * Software tab — driver-type data model + calculation helpers.
 *
 * Started as a skeleton (2026-08-27, Kayee: "you can build out a skeleton and then we
 * will make changes"), extended the same day once she saw it live: "I want it more like
 * it has a month over month on the right so i can scroll and see how each 1000 apply to
 * each month... it needs to have period like ok monthly but 1000 from which month to
 * ongoing or an end date and if i need to add a second row for another amount... I want
 * the user to be very very comfortable doing this planning." That's `periods` (below)
 * and the Planning table's always-visible month grid in SoftwarePanel.jsx.
 *
 * Software vendor rows live INSIDE the same shared `assumptions.costItems`
 * array the Non-Headcount Costs (Assumptions sidebar) already uses — not a separate
 * store — so every software item automatically gets the existing P&L linking
 * (linkedRowLabel / matchedCostItemsForRowLabel), the existing Cash Flow timing system
 * (followPL / interval / manual + weekly split), and the existing drag-and-drop-to-P&L-
 * row UX for free, with zero changes to ReportsPanel's or cashProjection.js's core
 * math. Each software item carries `isSoftware: true` so:
 *   - CostItemsCard (Assumptions sidebar) filters these OUT of its own list — vendors
 *     are managed from the Software tab now, not duplicated in two places.
 *   - This file's `recomputeSoftwareSchedules` is the ONLY thing that ever writes to a
 *     software item's `amountSchedule` — for every driver type, the monthly dollar
 *     figure gets pre-computed here and written as an EXPLICIT value for every single
 *     month (not the sparse step-function the schedule format was originally designed
 *     for) — since `scheduledValueForMonth` just resolves "the latest entry <= iso",
 *     an explicit entry for every month behaves as an exact per-month value, and the
 *     item's own `cadence` stays 'Monthly' so `costItemAmountForMonth` never re-divides
 *     it — so the existing P&L accrual + CF engine reads it as if it were a plain
 *     already-computed monthly cost, without needing to know anything about driver
 *     types, usage rates, or seat counts.
 *
 * Four driver types (Kayee's spec, 2026-08-27):
 *   - fixed: one or more PERIODS (2026-08-27 rewrite — see makePeriod/periodForMonth
 *     below), each its own $ amount + Monthly/Quarterly/Annual cadence + From/To month
 *     range (To blank = ongoing). A vendor whose price changed, or that's only
 *     contracted for a stretch of months, is a second period in the same list, visible
 *     alongside the first — not a value hidden behind a "Period" schedule icon, which is
 *     what the original skeleton shipped with for about ten minutes before this rewrite.
 *     Annual is new (the existing Non-Headcount Cost cadence only had Monthly/Quarterly);
 *     paid once a year in cash (Cash Flow's own per-account "interval" timing already
 *     models this — see CashFlowAssumptionsSidebar.jsx), accrued evenly across the year
 *     on the P&L (amount / 12 every month, same "spread the total" logic as Quarterly/3).
 *   - usage: $/unit x units this month (e.g. $3/token x tokens used) — units are a
 *     manual monthly input for now (a skeleton; wiring "units per $ of revenue" is a
 *     follow-up, not built here).
 *   - percentRevenue: a % of that month's Total Revenue (e.g. 2% of revenue) — reads
 *     the same Revenue Assumptions the P&L Revenue section already computes from
 *     (lib/assumptions/assumptionsData.js's netCollectedRevenueForMonth), so it always
 *     matches whatever the P&L's own Total Revenue line shows, month to month, up or
 *     down with revenue — the Planning table's month grid shows that fluctuation
 *     directly, with no separate step to "bring in" a revenue projection.
 *   - perSeat: $/seat x however many Payroll roster rows are active that month in a
 *     chosen Department (title is too inconsistently populated across the real roster
 *     to use as the grouping key — see payrollData.js's own note on this; Department is
 *     the reliable one) — reuses isActiveInMonth/cumulativeHeadcountFor from the
 *     Payroll data layer so ramp roles count correctly too.
 *
 * Usage/percentRevenue/perSeat are still a single flat rate each (not yet split into
 * periods the way Fixed now is) — a real, scoped-down decision for this pass, not an
 * oversight: Kayee's period request was specifically about a $ amount changing over
 * time ("1000 from which month..."), and the other three driver types already vary
 * month to month on their own (usage count, revenue, headcount) without needing a
 * second axis of change. Worth revisiting the same way if a rate itself needs to step
 * up mid-year.
 */

import { generateId, netCollectedRevenueForMonth } from '../assumptions/assumptionsData';
import { isActiveInMonth, cumulativeHeadcountFor, DEPARTMENT_OPTIONS, MONTHS, currentIsoMonth } from '../payroll/payrollData';

export const SOFTWARE_DRIVER_TYPES = ['fixed', 'usage', 'percentRevenue', 'perSeat'];
export const SOFTWARE_CADENCES = ['Monthly', 'Quarterly', 'Annual'];

// Shortened 2026-08-31 (Kayee: layout was "quite ugly and got cut off") — the driver
// column is narrow by design (the month grid is the star of this table), and the old
// "Variable — % of Revenue" / "Per Seat (linked to Payroll)" labels didn't fit without
// truncating mid-word. The Terms column right next to it already spells out the actual
// rate/detail (e.g. "2% of revenue", "$40/seat · Engineering"), so nothing is lost by
// shortening the driver-type label itself down to just the category name.
export const DRIVER_TYPE_LABELS = {
  fixed: 'Fixed',
  usage: 'Usage',
  percentRevenue: '% of Revenue',
  perSeat: 'Per Seat',
};

// Auto-linking (2026-08-31, Kayee: "no need to drag no more. just automatically make
// it — if you choose cogs it will go into the software in cogs and then opex if they
// chose opex") — every software vendor now goes straight to its category's fixed P&L
// row, the same two rows the Actual Spend GL mapping already uses (see
// lib/data/softwareSpendData.js's SOFTWARE_GL_ACCOUNTS comment: 52000 "Software - Cost
// of Revenue" / 66200 "Software - Operating Expense"). There is deliberately only ONE
// destination row per category — replaces the old drag-to-any-P&L-row mechanic
// (matchedCostItemsForRowLabel in ReportsPanel.jsx still just reads whatever
// `linkedRowLabel` is stored here; it doesn't know or care that the value is now
// derived instead of dragged).
export const SOFTWARE_ROW_LABELS = {
  CoGS: 'Software - Cost of Revenue',
  OpEx: 'Software - Operating Expense',
};

export function softwareRowLabelForCategory(category) {
  return SOFTWARE_ROW_LABELS[category] || null;
}

function monthsBetween(fromIso, toIso) {
  const [fy, fm] = fromIso.split('-').map(Number);
  const [ty, tm] = toIso.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

function isSoftwareItemDue(item, iso) {
  if (!item.startOn) return true;
  return monthsBetween(item.startOn.slice(0, 7), iso) >= 0;
}

/** One Fixed-driver period: a $ amount + cadence effective from `fromMonth` through
 *  `toMonth` inclusive, or ongoing if `toMonth` is blank. Replaces the original
 *  single-amount + effective-dated-schedule shape (2026-08-27, Kayee: "1000 from which
 *  month to ongoing or an end date and if i need to add a second row for another
 *  amount") — a vendor whose price changed, or that's only contracted for a stretch of
 *  months, is now literally a second row in the same list rather than a hidden
 *  step-function entry, which is what "very very comfortable doing this planning"
 *  actually calls for: the user should be able to SEE every period at once, not have to
 *  remember what's queued behind a schedule icon. */
export function makePeriod(overrides = {}) {
  return { id: generateId('period'), fromMonth: '', toMonth: '', amount: 0, cadence: 'Monthly', ...overrides };
}

/** Which of an item's periods applies to a given month, if any — a period with a blank
 *  fromMonth is treated as "always started," a blank toMonth as "ongoing, no end yet."
 *  Periods are meant to be entered non-overlapping (that's what the UI's own "starts
 *  where the last one stopped" nudge is for), but if two do overlap the one with the
 *  LATEST fromMonth wins — the most recently added / most specific period, same
 *  "newest entry wins" convention scheduledValueForMonth used before this rewrite. */
function periodForMonth(periods, iso) {
  const matches = (periods || []).filter(
    (p) => (!p.fromMonth || p.fromMonth <= iso) && (!p.toMonth || iso <= p.toMonth)
  );
  if (!matches.length) return null;
  return matches.reduce((latest, p) => ((p.fromMonth || '0000-00') > (latest.fromMonth || '0000-00') ? p : latest));
}

/** Fixed driver: full period amount every month (Monthly), amount/3 (Quarterly), or
 *  amount/12 (Annual) — same "spread the cadence total evenly" convention as the
 *  existing Non-Headcount Cost items, extended with the new Annual option — for
 *  whichever period covers this month. No covering period = $0, same as any other gap. */
function fixedAmountForMonth(item, iso) {
  const period = periodForMonth(item.periods, iso);
  if (!period) return 0;
  const amt = Number(period.amount) || 0;
  if (period.cadence === 'Quarterly') return amt / 3;
  if (period.cadence === 'Annual') return amt / 12;
  return amt;
}

/** Skeleton simplification: a flat units/month figure (not a per-month grid) — Kayee's
 *  spec ("is it $3 per token... how many token") is captured here as $/unit x a flat
 *  monthly unit count; a per-month-editable units grid (and/or deriving units from
 *  revenue — "for certain usage how many revenue you need") is a real follow-up, not
 *  built in this first pass. */
function usageAmountForMonth(item, iso) {
  if (!isSoftwareItemDue(item, iso)) return 0;
  const units = Number(item.unitsPerMonth) || 0;
  const rate = Number(item.unitRate) || 0;
  return units * rate;
}

function percentRevenueAmountForMonth(item, iso, revenue) {
  if (!isSoftwareItemDue(item, iso)) return 0;
  const pct = Number(item.revenuePercent) || 0;
  const monthlyRevenue = revenue ? netCollectedRevenueForMonth(revenue, iso) : 0;
  return (pct / 100) * monthlyRevenue;
}

function perSeatAmountForMonth(item, iso, roster) {
  if (!isSoftwareItemDue(item, iso)) return 0;
  const rate = Number(item.seatRate) || 0;
  if (!item.seatDepartment || !roster) return 0;
  let seats = 0;
  for (const emp of roster) {
    if (emp.department !== item.seatDepartment) continue;
    if (emp.isRamp) {
      seats += cumulativeHeadcountFor(emp, iso) > 0 ? cumulativeHeadcountFor(emp, iso) : 0;
    } else if (isActiveInMonth(emp, iso)) {
      seats += 1;
    }
  }
  return seats * rate;
}

/** One software item's monthly $ for its own driver type — the single formula this
 *  whole file exists to compute. `ctx` = { revenue, roster } (Payroll roster + the
 *  Revenue Assumptions object; either can be omitted if that driver type isn't used). */
export function softwareAmountForMonth(item, iso, ctx = {}) {
  if (item.active === false) return 0;
  switch (item.driverType) {
    case 'usage':
      return usageAmountForMonth(item, iso);
    case 'percentRevenue':
      return percentRevenueAmountForMonth(item, iso, ctx.revenue);
    case 'perSeat':
      return perSeatAmountForMonth(item, iso, ctx.roster);
    case 'fixed':
    default:
      return fixedAmountForMonth(item, iso);
  }
}

/** Re-derives every software item's `amountSchedule` (the field the shared P&L/CF
 *  engine actually reads) from its own driver-type inputs, for the full MONTHS
 *  horizon — see the file header for why writing into amountSchedule is what wires a
 *  software item into the existing cost-item engine with no changes to it. Called
 *  whenever any software-tab input changes; leaves every non-software cost item in
 *  the array completely untouched. */
export function recomputeSoftwareSchedules(costItems, ctx = {}) {
  return costItems.map((item) => {
    if (!item.isSoftware) return item;
    const amountSchedule = {};
    for (const iso of MONTHS) {
      amountSchedule[iso] = softwareAmountForMonth(item, iso, ctx);
    }
    // Always re-derive the link from the category — see SOFTWARE_ROW_LABELS above.
    // Self-healing here (not just on create) means changing the Category dropdown is
    // the only control anyone ever needs; nothing can drift out of sync with no
    // drag-and-drop step to forget.
    return {
      ...item,
      cadence: 'Monthly',
      amount: 0,
      amountSchedule,
      linkedRowLabel: softwareRowLabelForCategory(item.category),
    };
  });
}

function makeSoftwareItem(overrides) {
  return {
    id: overrides.id,
    name: overrides.name || '',
    category: overrides.category || 'OpEx',
    isSoftware: true,
    active: true,
    driverType: 'fixed',
    // Fixed: one open-ended period to start ("From [this month], ongoing, $0") — the
    // user's very first edit is just filling in the amount, not also discovering they
    // need to add a period before the row does anything.
    periods: [makePeriod({ fromMonth: currentIsoMonth(), amount: 0 })],
    // Usage:
    unitLabel: '',
    unitRate: 0,
    unitsPerMonth: 0,
    // % of revenue:
    revenuePercent: 0,
    // Per seat:
    seatRate: 0,
    seatDepartment: DEPARTMENT_OPTIONS[0],
    startOn: '',
    linkedRowLabel: null,
    // Fields the shared engine reads directly (recomputed on every change, see above):
    cadence: 'Monthly',
    amount: 0,
    amountSchedule: {},
    ...overrides,
  };
}

export { makeSoftwareItem };
