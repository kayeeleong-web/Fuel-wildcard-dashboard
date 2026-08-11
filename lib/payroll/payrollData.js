/**
 * Payroll tab — data model, seed dataset, and calculation helpers.
 *
 * This tab is a forecast/what-if calculator, not GL-backed data — everything here is
 * genuinely interactive (functionality-spec.md's "Real" bar applies), it just isn't
 * sourced through lib/data/getDataSource() like the other tabs. State is saved to the
 * browser's localStorage (see usePayrollState.js) rather than written back to Wildcard's
 * Google Sheet — see the Payroll tab's build notes for why (Kayee's call: browser-saved,
 * no service-account/write-access changes needed).
 *
 * Seed data below is transcribed from Kayee's actual Wildcard payroll planning sheet —
 * name/department/CoGS-or-OpEx/title/start/end/employment/base salary are all directly
 * visible in that sheet and copied exactly. Monthly $ costs are NOT transcribed
 * cell-by-cell from the sheet's history (that sheet has manual mid-year adjustments —
 * e.g. a raise applied starting a specific month — that can't be reliably
 * reverse-engineered from a screenshot); instead every month defaults to the standard
 * loaded-cost formula below, and every cell is fully editable so any specific month can
 * be corrected by hand — the source sheet already requires the same manual touch-up
 * ("changing start/end dates means you manually update base and bonus").
 */

import { formatMonthLabel } from '../calc/dashboardMetrics';

export const EMPLOYMENT_STATUSES = ['Active', 'TBD', 'Dismissed'];

export const DEPARTMENT_OPTIONS = ['G&A', 'Production', 'Creative', 'Engineering', 'S&M'];

/** Multi-year forecast timeline — Jan 2025 through Dec 2027, oldest -> newest. */
export function buildMonthRange(startYear = 2025, endYear = 2027) {
  const months = [];
  for (let y = startYear; y <= endYear; y++) {
    for (let m = 1; m <= 12; m++) months.push(`${y}-${String(m).padStart(2, '0')}`);
  }
  return months;
}

// Extended through 2028 (2026-08-10) to match Reports' own default forward window —
// was 2025-2027 (buildMonthRange's own defaults) since this tab's build; every
// calculation function here (cumulativeHeadcountFor, monthlyCostFor, etc.) already
// iterates the full MONTHS constant directly rather than a passed-in range, so
// widening it needs no other change to any formula, only to what's DISPLAYED (see
// monthsForRange below).
export const MONTHS = buildMonthRange(2025, 2028);

export function currentIsoMonth(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** Kayee, 2026-08-10: "give me a hide button also for [older years] so that now I
 *  only see 2026 to 2028... that button work in sync for all sections in payroll as
 *  well as the summary tab" — same default-forward-window idea as the Reports tab's
 *  own 2026-2028/Historical toggle, applied here by filtering which months actually
 *  get PASSED to every card (PayrollSummaryCard, TotalCompCard, RosterCard, BonusCard,
 *  HiringPlanCard all just render whatever `months` array they're given), rather than
 *  Reports' CSS column-hiding approach — simpler here since every one of those cards
 *  already takes `months` as a plain prop instead of reading a shared table-wide
 *  constant. Passing the SAME filtered array to every card from one place in
 *  PayrollPanel is what keeps every section "in sync" for free — there's only one
 *  source of truth for which months are visible. */
export function monthsForRange(range) {
  if (range === 'all') return MONTHS;
  return MONTHS.filter((m) => m >= '2026-01' && m <= '2028-12');
}

/** Past/current months read as "actual" (muted); anything after today's month reads as
 *  "forecast" (blue tint) — same ACT/FCST convention as the Payroll build notes, using
 *  Wildcard's own --blue token rather than introducing a new color. */
export function isForecastMonth(iso, todayIso = currentIsoMonth()) {
  return iso > todayIso;
}

export function isYearStart(iso) {
  return iso.endsWith('-01');
}

function toIsoMonth(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Whether an employee is "in service" for a given month — gates the default cost
 *  formula only. A manual override on that exact cell (see monthlyCostFor) always wins
 *  regardless of this. A "ramp" row (see cumulativeHeadcountFor below) is active in a
 *  month whenever its running headcount total is above zero — it has no start/end date
 *  at all, since it represents however many people of that role are planned to exist by
 *  that month, not one specific hire. */
export function isActiveInMonth(employee, iso) {
  if (employee.isRamp) return cumulativeHeadcountFor(employee, iso) > 0;
  if (employee.employment === 'Dismissed' && !employee.endDate) return false;
  const startIso = toIsoMonth(employee.startDate);
  const endIso = toIsoMonth(employee.endDate);
  if (startIso && iso < startIso) return false;
  if (endIso && iso > endIso) return false;
  if (employee.employment === 'TBD' && !startIso) return false;
  return true;
}

/** Standard fully-loaded monthly cost: (Base / 12) x (1 + Tax Rate% + Benefits%) —
 *  matches the source sheet's own formula (verified against Kayee's screenshot: a
 *  $150,000 base loads to $12,500/mo x 1.15 = $14,375/mo). */
export function defaultMonthlyCost(baseSalary, assumptions) {
  const loadFactor = 1 + (assumptions.taxRate || 0) / 100 + (assumptions.benefits || 0) / 100;
  return ((Number(baseSalary) || 0) / 12) * loadFactor;
}

/** A "ramp" row's INCREMENTAL new-hire count for one month — the number actually typed
 *  into that month's cell (usually 0, occasionally 1+ the month a hire starts). This is
 *  the editable figure on the Hiring Plan card; it is NOT the running headcount total —
 *  see cumulativeHeadcountFor for that (Kayee, 2026-08-05: "I want to be able to plug in
 *  the number month over month and it will count", after reviewing a reference sheet
 *  where each hire is flagged only in its own start month, not retyped every month
 *  after). 0/missing for a non-ramp employee. */
export function newHiresFor(employee, iso) {
  if (!employee?.isRamp) return 0;
  const v = employee.newHiresByMonth && employee.newHiresByMonth[iso];
  return Math.max(0, Math.round(Number(v) || 0));
}

/** A "ramp" row's running headcount total as of one month — the sum of every
 *  newHiresFor() value up through and including that month. This is what actually
 *  drives cost/bonus (see monthlyCostFor/bonusMonthlyFlow below): typing "1" once in,
 *  say, June means headcount (and cost) stays at that new higher level every month
 *  afterward too, not just in June — the user never has to retype the same running
 *  total across every subsequent month by hand. 0 for a non-ramp employee. */
export function cumulativeHeadcountFor(employee, iso) {
  if (!employee?.isRamp) return 0;
  let total = 0;
  for (const m of MONTHS) {
    if (m > iso) break;
    total += newHiresFor(employee, m);
  }
  return total;
}

/** An employee's cost for one month. A manual override on that cell always wins (this is
 *  what makes every month genuinely editable). For a "ramp" row the default is running
 *  headcount total x per-person loaded cost (matching the source sheet's `count x
 *  (Base/12) x load factor` formula) — otherwise the default loaded-cost formula applies
 *  while the employee is active, or 0 (renders blank, never "$0") otherwise. */
export function monthlyCostFor(employee, iso, assumptions) {
  const override = employee.monthlyOverrides && employee.monthlyOverrides[iso];
  if (override != null) return override;
  if (employee.isRamp) {
    const count = cumulativeHeadcountFor(employee, iso);
    return count > 0 ? count * defaultMonthlyCost(employee.baseSalary, assumptions) : 0;
  }
  if (!isActiveInMonth(employee, iso)) return 0;
  return defaultMonthlyCost(employee.baseSalary, assumptions);
}

/** Bonus monthly flow = (Bonus $ x global Bonus Attainment %) / 12 — verified against
 *  Kayee's sheet (Hannah Merrill: $40,000 x 100% / 12 = $3,333/mo). Only flows in months
 *  the linked employee is actually active. That's a deliberate improvement over the
 *  source sheet, which requires manually keeping bonus dates in sync with roster dates
 *  (see that sheet's own "Notes" column) — here it's derived automatically from the one
 *  roster row instead of duplicated. For a "ramp" row, this same per-person bonus figure
 *  gets multiplied by that month's running headcount total too — matching the source
 *  sheet's own "CC Hires" bonus formula (`headcount x bonus$ x attainment% / 12`),
 *  verified against Kayee's screenshot (2026-08-05). */
export function bonusMonthlyFlow(bonus, employee, iso, assumptions) {
  if (!employee || !isActiveInMonth(employee, iso)) return 0;
  const override = bonus.monthlyOverrides && bonus.monthlyOverrides[iso];
  if (override != null) return override;
  const perPerson = ((Number(bonus.bonusAmount) || 0) * (assumptions.bonusAttainment || 0)) / 100 / 12;
  return employee.isRamp ? perPerson * cumulativeHeadcountFor(employee, iso) : perPerson;
}

export function oteFor(bonus, employee) {
  return (employee ? Number(employee.baseSalary) || 0 : 0) + (Number(bonus.bonusAmount) || 0);
}

/** Headcount cost (base + bonus, loaded) for one costType ('CoGS' | 'OpEx'), one
 *  month, summed across the whole roster — the shared formula behind Assumptions'
 *  "Headcount" projection line (ProjectionSummaryCard.jsx) AND Reports' Total
 *  COGS/OpEx forecast projection (ReportsPanel.jsx, 2026-08-06), so both stay in sync
 *  automatically instead of risking two copies of this formula drifting apart. */
export function headcountCostByCostType(roster, bonuses, assumptions, costType, iso) {
  let total = 0;
  for (const emp of roster) {
    if (emp.costType !== costType) continue;
    total += monthlyCostFor(emp, iso, assumptions);
  }
  for (const bonus of bonuses) {
    const emp = roster.find((r) => r.id === bonus.employeeId);
    if (!emp || emp.costType !== costType) continue;
    total += bonusMonthlyFlow(bonus, emp, iso, assumptions);
  }
  return total;
}

/** Currency formatter for the payroll grids specifically: zero renders as an empty
 *  string, never "$0" — a wall of "$0" across three years of unused months reads as a
 *  distracting data smell rather than "no cost here" (Payroll build notes: "Zero renders
 *  as blank, everywhere"). This is deliberately different from the KPI/Reports tables
 *  elsewhere in this app, which use an em dash for a genuinely missing figure — those
 *  mean "data not available", this means "genuinely zero this month". */
export function formatPayrollAmount(value) {
  const n = Number(value) || 0;
  if (n === 0) return '';
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

export { formatMonthLabel };

/* ------------------------------ Seed data ------------------------------ */

export const SEED_ASSUMPTIONS = {
  yearlyMeritIncrease: 0, // blank/unused in the source sheet too
  taxRate: 7.5,
  benefits: 7.5,
  bonusAttainment: 100,
};

function makeEmployee(id, name, department, costType, title, startDate, endDate, employment, baseSalary) {
  return {
    id,
    name,
    department,
    costType,
    title,
    startDate,
    endDate,
    employment,
    baseSalary,
    monthlyOverrides: {},
  };
}

/** Expands a role's Jan-Dec 2026 INCREMENTAL new-hire counts (12 numbers — how many
 *  people start in that role that month, usually 0 or 1) into a full newHiresByMonth
 *  map covering every month this app tracks (2025-2027): 0 outside 2026, since nobody
 *  else is currently planned to join beyond what's given (editable by hand if that
 *  changes). Deltas transcribed from the source sheet's "New Hires per Month" table
 *  (Headcount + Summary tabs) by taking the month-over-month difference of its
 *  cumulative counts — e.g. Junior Creative's 0,0,0,0,0,1,1,2,2,3,3,3 becomes a single
 *  +1 in June, +1 in August, +1 in October. */
function expandNewHireSchedule(y2026Deltas) {
  const schedule = {};
  for (const iso of MONTHS) {
    const year = Number(iso.slice(0, 4));
    const month = Number(iso.slice(5, 7));
    schedule[iso] = year === 2026 ? y2026Deltas[month - 1] : 0;
  }
  return schedule;
}

/** A "ramp" roster row — a role we don't have anyone in yet, planned to fill with
 *  several people over time (Kayee, 2026-08-05: "build a real headcount-ramp feature";
 *  reviewed against the source sheet's Headcount + Summary tabs), living on its own
 *  Hiring Plan card rather than mixed into the regular Roster (Kayee: "create a separate
 *  section for hiring plan, leave current employees in their own sections"). No
 *  start/end date; newHiresByMonth (see expandNewHireSchedule) drives cost/bonus
 *  instead — see newHiresFor/cumulativeHeadcountFor/monthlyCostFor/bonusMonthlyFlow
 *  above. */
function makeRampRole(id, name, department, costType, baseSalary, y2026Deltas) {
  return {
    id,
    name,
    department,
    costType,
    title: '',
    startDate: '',
    endDate: '',
    employment: 'TBD',
    baseSalary,
    isRamp: true,
    newHiresByMonth: expandNewHireSchedule(y2026Deltas),
    monthlyOverrides: {},
  };
}

export const SEED_ROSTER = [
  makeEmployee('brennan-keough', 'Brennan Keough', 'G&A', 'OpEx', 'Co-founder', '2024-05-01', '', 'Active', 150000),
  makeEmployee('shane-kovalsky', 'Shane Kovalsky', 'G&A', 'OpEx', 'Co-founder', '2024-05-01', '', 'Active', 150000),
  makeEmployee('hannah-merrill', 'Hannah Merrill', 'Production', 'CoGS', 'Production Lead', '2024-05-01', '', 'Active', 110000),
  makeEmployee('chelsea-faith', 'Chelsea Faith', 'Creative', 'CoGS', 'Creative Lead', '2025-06-17', '2025-08-05', 'Dismissed', 135000),
  makeEmployee('matthew-intern', 'Matthew Intern', 'Production', 'CoGS', 'Intern', '', '2025-08-31', 'Dismissed', 36400),
  makeEmployee('charlotte-intern', 'Charlotte Intern', 'Production', 'CoGS', 'Intern', '', '2025-08-14', 'Dismissed', 36400),
  makeEmployee('charlotte-pt', 'Charlotte PT', 'Production', 'CoGS', 'Intern', '2025-09-01', '2026-06-01', 'Dismissed', 18200),
  makeEmployee('vaughn', 'Vaughn', 'Production', 'CoGS', 'Production Coordinator', '2025-09-01', '', 'Active', 60000),
  makeEmployee('cristina', 'Cristina', 'Production', 'CoGS', 'Production Coordinator', '2025-11-03', '', 'Active', 45000),
  makeEmployee('alex', 'Alex', 'Production', 'CoGS', 'Production Coordinator', '2025-11-13', '2025-12-15', 'Dismissed', 50000),
  // Ramp roles — one row per not-yet-hired role, on the Hiring Plan card. Each array is
  // INCREMENTAL new hires per month (Jan-Dec 2026), not a running total — e.g. CC Hires'
  // [.. 1,1,1 ..] means "1 more Campaign Coordinator starts each of Jun/Jul/Aug", which
  // the app accumulates into a running headcount of 1, then 2, then 3 automatically.
  makeRampRole('cc-hires', 'CC Hires', 'Production', 'CoGS', 45000, [0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0]),
  makeEmployee('dylan-smith', 'Dylan Smith', 'Creative', 'CoGS', 'Creative Coordinator', '2025-09-08', '', 'Active', 60000),
  makeRampRole('head-of-ops', 'Head of Ops', 'Production', 'CoGS', 150000, [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0]),
  makeEmployee('el', 'El', 'Engineering', 'OpEx', '', '2026-03-01', '', 'TBD', 100000),
  makeRampRole('sales-hires', 'Sales Hires', 'S&M', 'OpEx', 150000, [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0]),
  makeRampRole('junior-creative-hire', 'Junior Creative Hire', 'Creative', 'CoGS', 45000, [0, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0]),
  makeRampRole('cs-hires', 'CS Hires', 'G&A', 'OpEx', 125000, [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0]),
  makeEmployee('naama', "Na'ama", 'S&M', 'OpEx', '', '', '', 'Active', 150000),
  makeEmployee('ethan', 'Ethan', 'Creative', 'CoGS', '', '', '', 'TBD', 45000),
  makeEmployee('britton', 'Britton', 'Production', 'CoGS', '', '', '', 'Active', 48000),
  makeEmployee('neel', 'Neel', 'Production', 'CoGS', 'Designer', '', '', 'Active', 70000),
  makeEmployee('mia', 'Mia', 'Production', 'CoGS', '', '', '', 'Active', 40000),
];

function makeBonus(employeeId, bonusAmount) {
  return { id: `bonus-${employeeId}`, employeeId, bonusAmount, monthlyOverrides: {} };
}

export const SEED_BONUSES = [
  makeBonus('brennan-keough', 0),
  makeBonus('shane-kovalsky', 0),
  makeBonus('hannah-merrill', 40000),
  makeBonus('vaughn', 12000),
  makeBonus('cristina', 12000),
  makeBonus('cc-hires', 12000),
  makeBonus('dylan-smith', 12000),
  makeBonus('head-of-ops', 50000),
  makeBonus('el', 50000),
  makeBonus('sales-hires', 150000),
  makeBonus('junior-creative-hire', 12000),
  makeBonus('cs-hires', 50000),
  makeBonus('naama', 150000),
  makeBonus('ethan', 12000),
  makeBonus('britton', 12000),
  makeBonus('neel', 30000),
  makeBonus('mia', 12000),
];

/** Retrofits the current headcount-ramp shape (isRamp + newHiresByMonth) onto a roster
 *  loaded from an OLDER localStorage save. Two generations of "older" get handled:
 *  1) pre-ramp saves, where the 5 role rows are still flat single-person rows — every
 *     other field already saved for that row (name, base salary, department, any $
 *     overrides) is left exactly as-is; only the ramp shape gets bolted on.
 *  2) saves from the very first ramp version (2026-08-05), which tracked a CUMULATIVE
 *     running headcountByMonth total instead of incremental newHiresByMonth deltas —
 *     converted here by differencing month-over-month so cost/bonus keep computing the
 *     same totals as before under the new (simpler-to-edit) incremental model.
 *  Used by usePayrollState — a brand-new browser skips this entirely, since
 *  seedPayrollState() already includes the current ramp shape from the start. */
export function migrateRampRoles(roster) {
  if (!Array.isArray(roster)) return roster;
  const seedById = Object.fromEntries(SEED_ROSTER.filter((r) => r.isRamp).map((r) => [r.id, r]));
  return roster.map((r) => {
    if (!r) return r; // guard against a corrupted/null entry rather than throwing on r.isRamp
    if (!r.isRamp && !seedById[r.id]) return r;
    if (!r.isRamp) {
      // Generation 1: pre-ramp flat row -> bolt on the current seed's ramp schedule.
      const seed = seedById[r.id];
      return { ...r, isRamp: true, startDate: '', endDate: '', newHiresByMonth: { ...seed.newHiresByMonth } };
    }
    if (r.newHiresByMonth) return r; // already on the current incremental shape
    // Generation 2: old cumulative headcountByMonth -> incremental newHiresByMonth via
    // a month-over-month difference (clamped at 0 so a manual decrease never goes
    // negative — treated as "no new hire that month" rather than a layoff).
    const cumulative = r.headcountByMonth || {};
    const newHiresByMonth = {};
    let prev = 0;
    for (const m of MONTHS) {
      const current = Number(cumulative[m]) || 0;
      newHiresByMonth[m] = Math.max(0, current - prev);
      prev = current;
    }
    const { headcountByMonth, ...rest } = r;
    return { ...rest, newHiresByMonth };
  });
}

export function seedPayrollState() {
  return {
    assumptions: { ...SEED_ASSUMPTIONS },
    roster: SEED_ROSTER.map((r) => ({
      ...r,
      monthlyOverrides: { ...r.monthlyOverrides },
      ...(r.isRamp ? { newHiresByMonth: { ...r.newHiresByMonth } } : {}),
    })),
    bonuses: SEED_BONUSES.map((b) => ({ ...b, monthlyOverrides: { ...b.monthlyOverrides } })),
  };
}

let idCounter = 0;
export function generateId(prefix) {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}
