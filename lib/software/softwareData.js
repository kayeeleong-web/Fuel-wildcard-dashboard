/**
 * Software tab — driver-type data model + calculation helpers.
 *
 * SKELETON (2026-08-27, Kayee: "you can build out a skeleton and then we will make
 * changes"). Software vendor rows live INSIDE the same shared `assumptions.costItems`
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
 *   - fixed: a flat $ amount, on a Monthly/Quarterly/Annual cadence — Annual is new
 *     (the existing Non-Headcount Cost cadence only had Monthly/Quarterly); paid once a
 *     year in cash (Cash Flow's own per-account "interval" timing already models this —
 *     see CashFlowAssumptionsSidebar.jsx), accrued evenly across the year on the P&L
 *     (amount / 12 every month, same "spread the total" logic as the existing
 *     Quarterly / 3).
 *   - usage: $/unit x units this month (e.g. $3/token x tokens used) — units are a
 *     manual monthly input for now (a skeleton; wiring "units per $ of revenue" is a
 *     follow-up, not built here).
 *   - percentRevenue: a % of that month's Total Revenue (e.g. 2% of revenue) — reads
 *     the same Revenue Assumptions the P&L Revenue section already computes from
 *     (lib/assumptions/assumptionsData.js's netCollectedRevenueForMonth), so it always
 *     matches whatever the P&L's own Total Revenue line shows.
 *   - perSeat: $/seat x however many Payroll roster rows are active that month in a
 *     chosen Department (title is too inconsistently populated across the real roster
 *     to use as the grouping key — see payrollData.js's own note on this; Department is
 *     the reliable one) — reuses isActiveInMonth/cumulativeHeadcountFor from the
 *     Payroll data layer so ramp roles count correctly too.
 */

import { scheduledValueForMonth, netCollectedRevenueForMonth } from '../assumptions/assumptionsData';
import { isActiveInMonth, cumulativeHeadcountFor, DEPARTMENT_OPTIONS, MONTHS } from '../payroll/payrollData';

export const SOFTWARE_DRIVER_TYPES = ['fixed', 'usage', 'percentRevenue', 'perSeat'];
export const SOFTWARE_CADENCES = ['Monthly', 'Quarterly', 'Annual'];

export const DRIVER_TYPE_LABELS = {
  fixed: 'Fixed',
  usage: 'Variable — Usage',
  percentRevenue: 'Variable — % of Revenue',
  perSeat: 'Per Seat (linked to Payroll)',
};

function monthsBetween(fromIso, toIso) {
  const [fy, fm] = fromIso.split('-').map(Number);
  const [ty, tm] = toIso.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

function isSoftwareItemDue(item, iso) {
  if (!item.startOn) return true;
  return monthsBetween(item.startOn.slice(0, 7), iso) >= 0;
}

/** Fixed driver: full amount every month (Monthly), amount/3 (Quarterly), or amount/12
 *  (Annual) — same "spread the cadence total evenly" convention as the existing
 *  Non-Headcount Cost items, extended with the new Annual option. */
function fixedAmountForMonth(item, iso) {
  if (!isSoftwareItemDue(item, iso)) return 0;
  const amt = scheduledValueForMonth(item.softwareAmountSchedule, item.softwareAmount, iso);
  if (item.softwareCadence === 'Quarterly') return amt / 3;
  if (item.softwareCadence === 'Annual') return amt / 12;
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
    return { ...item, cadence: 'Monthly', amount: 0, amountSchedule };
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
    // Fixed:
    softwareAmount: 0,
    softwareCadence: 'Monthly',
    softwareAmountSchedule: {},
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
