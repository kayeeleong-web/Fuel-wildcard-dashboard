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

/** Parses a date string as a LOCAL calendar date. `new Date('2025-11-01')` is UTC
 *  midnight, which in any US timezone is still Oct 31 local — so getMonth()/getDate()
 *  came back one day early (a May 1 start read as April; a Nov 3 start prorated as
 *  Nov 2). Date-only ISO strings are split by hand; anything else falls back to Date. */
export function parseLocalDate(dateStr) {
  if (!dateStr) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr));
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(dateStr);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toIsoMonth(dateStr) {
  const d = parseLocalDate(dateStr);
  if (!d) return null;
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
  const startIso = toIsoMonth(employee.startDate);
  // No start date = no cost, for EVERY status (2026-09-15, Kayee: "there are a few
  // people that has no start date but you have the amount in there. That's not right.
  // If there's no start date, there's no amount"). Previously only TBD rows were
  // gated this way; Active rows with a blank start silently cost a full month forever.
  if (!startIso) return false;
  if (employee.employment === 'Dismissed' && !employee.endDate) return false;
  const endIso = toIsoMonth(employee.endDate);
  if (iso < startIso) return false;
  if (endIso && iso > endIso) return false;
  return true;
}

/** Standard fully-loaded monthly cost: (Base / 12) x (1 + Tax Rate% + Benefits%) —
 *  matches the source sheet's own formula (verified against Kayee's screenshot: a
 *  $150,000 base loads to $12,500/mo x 1.15 = $14,375/mo). */
export function defaultMonthlyCost(baseSalary, assumptions) {
  const loadFactor = 1 + (assumptions.taxRate || 0) / 100 + (assumptions.benefits || 0) / 100;
  return ((Number(baseSalary) || 0) / 12) * loadFactor;
}

function daysInIsoMonth(iso) {
  const [y, m] = iso.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

/** Fraction (0-1) of a month an employee is on payroll, prorated by calendar days
 *  (2026-09-15, Kayee: "if the start date is May 1st, why didn't the amount start on
 *  May 1st... it should prorate — someone who starts November 3rd, November should be
 *  prorated to only the 3rd through the 30th"). A full month in service = 1; the start
 *  month counts days from the start date through month-end; the end month counts
 *  days from the 1st through the end date; a month outside the employment window = 0.
 *  Ramp rows have no dates and are always 1 (their headcount count already handles
 *  when people exist). */
export function activeFractionFor(employee, iso) {
  if (employee.isRamp) return 1;
  if (!isActiveInMonth(employee, iso)) return 0;
  const days = daysInIsoMonth(iso);
  let first = 1;
  let last = days;
  const start = parseLocalDate(employee.startDate);
  const end = parseLocalDate(employee.endDate);
  if (start && toIsoMonth(employee.startDate) === iso) first = start.getDate();
  if (end && toIsoMonth(employee.endDate) === iso) last = end.getDate();
  if (last < first) return 0;
  return (last - first + 1) / days;
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
  // 2026-09-15 (Kayee): monthly $ cells are DERIVED from Base Salary + start/end dates,
  // never typed — per-cell monthlyOverrides are no longer read. This is also what was
  // behind "Brennan's base is $1 but January still shows $14,375": a stale override
  // saved on that one cell from the old editable grid kept winning over the new base.
  if (employee.isRamp) {
    const count = cumulativeHeadcountFor(employee, iso);
    return count > 0 ? count * defaultMonthlyCost(employee.baseSalary, assumptions) : 0;
  }
  return defaultMonthlyCost(employee.baseSalary, assumptions) * activeFractionFor(employee, iso);
}

/* ------------------------------ Bonus plans ------------------------------ */

/** Bonus plan TYPES (2026-09-15 redesign, Kayee: "bonus is not going to be a type-in
 *  situation... give the user the freedom to adjust it, but also refer to data coming
 *  from other tabs"). Sourced from the Sept 10 Wildcard sync + Hannah Merrill's Slack
 *  reply the same week:
 *   - fixed      : the original model — annual Bonus $ × global Bonus Attainment % ÷ 12.
 *   - milestone  : campaign-output milestones. Coordinators earn $X (Hannah: $1k) every
 *                  N campaigns THEY send (Hannah: 55 for juniors = avg monthly output per
 *                  coordinator). Driven by the Customer tab's projected campaigns/month
 *                  (see resolveBonusDrivers) × this person's % share of team campaigns,
 *                  ÷ N × $X × the global Milestone Hit Rate (Hannah: "90% is a fair
 *                  buffer"). Team-level milestones for seniors use the same shape with
 *                  a bigger N — the per-day metric bonuses Hannah mentioned are out of
 *                  scope for now, per her own "focus on campaign output to start".
 *   - perMeeting : $X (Brennan/Hannah: $100) per campaign that turns into a meeting,
 *                  only for campaigns the person worked on → projected meetings/month ×
 *                  % share × $X. Same for junior and senior.
 *   - quarterly  : $X per quarter (Brennan: Hannah ≈ $10k/quarter when her team hits
 *                  its goals). Accrues ÷3 each month on the P&L; cash lands in the
 *                  quarter's last month (see bonusCashFlow). Her plan is expected to
 *                  change in a few months — hence the plan-level start/end dates below.
 *  Every plan also carries its own optional startDate/endDate (bounds ON TOP of the
 *  employee's own dates) and a `payout` ('monthly' | 'quarterly') for cash timing. */
export const BONUS_TYPES = [
  { id: 'fixed', label: 'Fixed annual' },
  { id: 'milestone', label: 'Campaign milestone' },
  { id: 'perMeeting', label: 'Per meeting' },
  { id: 'quarterly', label: 'Quarterly fixed' },
];

export function bonusTypeOf(bonus) {
  return BONUS_TYPES.some((t) => t.id === bonus?.type) ? bonus.type : 'fixed';
}

const DEAL_PROJECTION_KEY_FOR_BONUS = 'fuel_wildcard_deal_projection_v1'; // = lib/deals/dealsData DEAL_PROJECTION_STORAGE_KEY (not imported: dealsData imports this file)
let driverCacheRaw = null;
let driverCacheValue = null;

/** Campaign/meeting drivers for the milestone/perMeeting plans. Callers that already
 *  have the Customer tab's deal projection (ReportsPanel, cashProjection via
 *  ctx.revenue.dealProjection) pass it in; otherwise this reads the same localStorage
 *  handoff the P&L uses, memoised on the raw string so per-cell calls stay cheap.
 *  Returns { campaignsByMonth, meetingsByMonth } (empty maps when no deals yet — a
 *  milestone/meeting plan then contributes $0, visibly, rather than a made-up number). */
export function resolveBonusDrivers(drivers) {
  if (drivers && (drivers.campaignsByMonth || drivers.meetingsByMonth)) {
    return { campaignsByMonth: drivers.campaignsByMonth || {}, meetingsByMonth: drivers.meetingsByMonth || {} };
  }
  if (typeof window === 'undefined') return { campaignsByMonth: {}, meetingsByMonth: {} };
  try {
    const raw = window.localStorage.getItem(DEAL_PROJECTION_KEY_FOR_BONUS);
    if (raw !== driverCacheRaw) {
      driverCacheRaw = raw;
      const parsed = raw ? JSON.parse(raw) : null;
      driverCacheValue =
        parsed && parsed.version === 3 && Number(parsed.dealCount) > 0
          ? { campaignsByMonth: parsed.campaignsByMonth || {}, meetingsByMonth: parsed.meetingsByMonth || {} }
          : { campaignsByMonth: {}, meetingsByMonth: {} };
    }
    return driverCacheValue;
  } catch {
    return { campaignsByMonth: {}, meetingsByMonth: {} };
  }
}

/** Plan-level date window (in addition to the employee's own start/end). */
function bonusWindowAllows(bonus, iso) {
  const startIso = toIsoMonth(bonus.startDate);
  const endIso = toIsoMonth(bonus.endDate);
  if (startIso && iso < startIso) return false;
  if (endIso && iso > endIso) return false;
  return true;
}

/** Bonus ACCRUAL for one month (what the P&L books). For a "ramp" row the per-person
 *  figure is multiplied by that month's running headcount (2026-08-05 "CC Hires"
 *  rule). Per-cell monthlyOverrides are no longer read (2026-09-15: derived, not typed
 *  — same call as the roster's monthly cells). */
export function bonusMonthlyFlow(bonus, employee, iso, assumptions, drivers) {
  if (!employee || !isActiveInMonth(employee, iso)) return 0;
  if (!bonusWindowAllows(bonus, iso)) return 0;
  const headcount = employee.isRamp ? cumulativeHeadcountFor(employee, iso) : 1;
  const type = bonusTypeOf(bonus);

  if (type === 'fixed') {
    const perPerson = ((Number(bonus.bonusAmount) || 0) * (assumptions.bonusAttainment || 0)) / 100 / 12;
    return perPerson * headcount;
  }
  if (type === 'quarterly') {
    return ((Number(bonus.amountPerQuarter) || 0) / 3) * headcount;
  }

  const d = resolveBonusDrivers(drivers);
  const share = (Number(bonus.sharePct) || 0) / 100;
  if (type === 'milestone') {
    const campaigns = (Number(d.campaignsByMonth[iso]) || 0) * share * headcount;
    const per = Number(bonus.campaignsPerMilestone) || 0;
    if (per <= 0) return 0;
    const hitRate = (assumptions.milestoneHitRate == null ? 90 : Number(assumptions.milestoneHitRate) || 0) / 100;
    return (campaigns / per) * (Number(bonus.amountPerMilestone) || 0) * hitRate;
  }
  // perMeeting
  const meetings = (Number(d.meetingsByMonth[iso]) || 0) * share * headcount;
  return meetings * (Number(bonus.amountPerMeeting) || 0);
}

/** Bonus CASH for one month (what the Cash Flow pays out). payout 'monthly' = same as
 *  accrual; 'quarterly' = the whole quarter's accrual lands in the quarter's last
 *  month (Mar/Jun/Sep/Dec), $0 in the other two — Brennan: Hannah "usually gets paid
 *  out quarterly", coordinators "the same month" they hit it. */
export function bonusCashFlow(bonus, employee, iso, assumptions, drivers) {
  const payout = bonus.payout || (bonusTypeOf(bonus) === 'quarterly' ? 'quarterly' : 'monthly');
  if (payout !== 'quarterly') return bonusMonthlyFlow(bonus, employee, iso, assumptions, drivers);
  const [y, m] = iso.split('-').map(Number);
  if (m % 3 !== 0) return 0;
  let sum = 0;
  for (let mm = m - 2; mm <= m; mm++) {
    sum += bonusMonthlyFlow(bonus, employee, `${y}-${String(mm).padStart(2, '0')}`, assumptions, drivers);
  }
  return sum;
}

/** One-line description of a plan for the Bonus card's subtitle/tooltips. */
export function describeBonus(bonus) {
  const type = bonusTypeOf(bonus);
  const money = (n) => `$${Math.round(Number(n) || 0).toLocaleString('en-US')}`;
  if (type === 'fixed') return `${money(bonus.bonusAmount)}/yr × attainment`;
  if (type === 'quarterly') return `${money(bonus.amountPerQuarter)}/quarter`;
  if (type === 'milestone') return `${money(bonus.amountPerMilestone)} per ${bonus.campaignsPerMilestone || 0} campaigns · ${bonus.sharePct || 0}% of campaigns`;
  return `${money(bonus.amountPerMeeting)}/meeting · ${bonus.sharePct || 0}% of meetings`;
}

/** Annual target bonus for the OTE column — only defined for the two fixed-amount plan
 *  types; a campaign-driven plan (milestone / perMeeting) has no fixed annual figure, so
 *  this returns null and the card shows "varies" instead of a fake number. */
export function annualBonusTarget(bonus) {
  const type = bonusTypeOf(bonus);
  if (type === 'fixed') return Number(bonus.bonusAmount) || 0;
  if (type === 'quarterly') return (Number(bonus.amountPerQuarter) || 0) * 4;
  return null;
}

export function oteFor(bonus, employee) {
  const target = annualBonusTarget(bonus);
  if (target == null) return null;
  return (employee ? Number(employee.baseSalary) || 0 : 0) + target;
}

/** An employee's % allocated to CoGS (0-100) — the real, continuous version of the
 *  old binary costType tag (2026-09-15, Kayee: per the Sept 10 Wildcard sync, roles
 *  like Designer/Founding Designer are 75% CoGS/25% OpEx, and a Last Mile Lead-style
 *  role is roughly 50/50, rather than cleanly one bucket or the other). Falls back to
 *  100/0 from the legacy costType field when cogsPercent hasn't been set on a row yet,
 *  so every pre-existing roster entry (and anything loaded from an older localStorage
 *  save) keeps computing exactly the same totals as before — this is additive, not a
 *  breaking migration. */
export function cogsPercentFor(employee) {
  if (employee.cogsPercent != null) return Math.max(0, Math.min(100, Number(employee.cogsPercent) || 0));
  return employee.costType === 'CoGS' ? 100 : 0;
}

/** The fraction (0-1) of an employee's cost that lands under the given costType
 *  bucket ('CoGS' | 'OpEx') — CoGS uses cogsPercentFor directly, OpEx uses the
 *  remainder, so the two always sum to exactly 100% of the person's cost with no
 *  double-counting or gap. */
function costTypeShare(employee, costType) {
  const cogsPct = cogsPercentFor(employee);
  return (costType === 'CoGS' ? cogsPct : 100 - cogsPct) / 100;
}

/** Headcount cost (base + bonus, loaded) for one costType ('CoGS' | 'OpEx'), one
 *  month, summed across the whole roster — the shared formula behind Assumptions'
 *  "Headcount" projection line (ProjectionSummaryCard.jsx) AND Reports' Total
 *  COGS/OpEx forecast projection (ReportsPanel.jsx, 2026-08-06), so both stay in sync
 *  automatically instead of risking two copies of this formula drifting apart.
 *  2026-09-15: now weights by costTypeShare instead of an exact costType match, so a
 *  split role (e.g. Designer 75/25) contributes its correct fraction to BOTH buckets
 *  instead of landing 100% in whichever one its single costType tag happened to say. */
export function headcountCostByCostType(roster, bonuses, assumptions, costType, iso, drivers) {
  let total = 0;
  for (const emp of roster) {
    const share = costTypeShare(emp, costType);
    if (share <= 0) continue;
    total += monthlyCostFor(emp, iso, assumptions) * share;
  }
  return total + headcountBonusByCostType(roster, bonuses, assumptions, costType, iso, drivers);
}

/** The "base" portion of an employee's monthly cost, BEFORE the tax/benefit load
 *  factor is applied — same active/ramp gating as monthlyCostFor, but deliberately
 *  skips any manual override on that cell (an override replaces the WHOLE loaded
 *  number as one lump figure, so it can't be decomposed into base/tax/benefit parts —
 *  see headcountSalariesByCostType below for how an overridden month is handled
 *  instead: the whole override amount is counted as "Salaries", nothing double-counted
 *  under Taxes/Benefits). */
function baseSalaryMonthlyFor(employee, iso) {
  if (employee.isRamp) {
    const count = cumulativeHeadcountFor(employee, iso);
    return count > 0 ? count * ((Number(employee.baseSalary) || 0) / 12) : 0;
  }
  return ((Number(employee.baseSalary) || 0) / 12) * activeFractionFor(employee, iso);
}

/** Headcount cost split into its 4 components, one costType at a time (2026-08-10,
 *  Kayee: "get the salaries, payroll taxes and benefit separated... in cogs payroll no
 *  need to have division for benefit and payroll tax, only in opex you need" — then,
 *  after seeing her real sheet already has Salaries / Payroll Taxes / Benefits /
 *  Bonuses as four separate lines: "this is how it should get match up and also
 *  divide out bonus then"). These four always sum back to exactly
 *  headcountCostByCostType's own total for the same costType/month — same
 *  roster/bonus loop, just split by which part of the formula produced each dollar
 *  instead of returning one lump sum:
 *   - Salaries = base ÷ 12 (or the whole manual override, if that cell has one).
 *   - Payroll Taxes = base ÷ 12 × Tax Rate%.
 *   - Benefits = base ÷ 12 × Benefits%.
 *   - Bonuses = every linked Bonus $ flow (see headcountBonusByCostType below) — split
 *     out into its own line now that Kayee's real sheet has a dedicated "Bonuses" row
 *     to align it under (originally folded into Salaries, on the theory that Bonus
 *     carries no tax/benefit load of its own and there was no obvious 4th bucket for
 *     it — a real anchor row removed that ambiguity).
 *  An overridden cell's entire figure lands in Salaries, with 0 for that employee's
 *  Taxes/Benefits that month — there's no way to know how a manually typed number
 *  should split, so it's kept out of Total COGS/OpEx's math changing at all (still
 *  exactly equals monthlyCostFor's own override handling). */
export function headcountSalariesByCostType(roster, bonuses, assumptions, costType, iso) {
  let total = 0;
  for (const emp of roster) {
    const share = costTypeShare(emp, costType);
    if (share <= 0) continue;
    total += baseSalaryMonthlyFor(emp, iso) * share;
  }
  return total;
}

export function headcountBonusByCostType(roster, bonuses, assumptions, costType, iso, drivers) {
  let total = 0;
  for (const bonus of bonuses) {
    const emp = roster.find((r) => r.id === bonus.employeeId);
    if (!emp) continue;
    const share = costTypeShare(emp, costType);
    if (share <= 0) continue;
    total += bonusMonthlyFlow(bonus, emp, iso, assumptions, drivers) * share;
  }
  return total;
}

/** Cash-basis twin of headcountBonusByCostType — respects each plan's `payout`
 *  (quarterly plans land in the quarter's last month). Used by the Cash Flow
 *  projection's Bonuses row in Follow-P&L mode (lib/cashflow/cashProjection.js). */
export function headcountBonusCashByCostType(roster, bonuses, assumptions, costType, iso, drivers) {
  let total = 0;
  for (const bonus of bonuses) {
    const emp = roster.find((r) => r.id === bonus.employeeId);
    if (!emp) continue;
    const share = costTypeShare(emp, costType);
    if (share <= 0) continue;
    total += bonusCashFlow(bonus, emp, iso, assumptions, drivers) * share;
  }
  return total;
}

export function headcountPayrollTaxesByCostType(roster, bonuses, assumptions, costType, iso) {
  let total = 0;
  for (const emp of roster) {
    const share = costTypeShare(emp, costType);
    if (share <= 0) continue;
    total += baseSalaryMonthlyFor(emp, iso) * ((assumptions.taxRate || 0) / 100) * share;
  }
  return total;
}

export function headcountBenefitsByCostType(roster, bonuses, assumptions, costType, iso) {
  let total = 0;
  for (const emp of roster) {
    const share = costTypeShare(emp, costType);
    if (share <= 0) continue;
    total += baseSalaryMonthlyFor(emp, iso) * ((assumptions.benefits || 0) / 100) * share;
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
  // % of coordinators expected to hit their campaign milestone in a month (Hannah,
  // Sept 2026 Slack: "I think 90% is a fair buffer"). Applies to 'milestone' plans only.
  milestoneHitRate: 90,
};

// cogsPercent is optional (2026-09-15 split-allocation feature) — omit it for a clean
// 100% CoGS or 100% OpEx row (cogsPercentFor falls back to costType in that case), or
// pass a number for a split role like Designer (75) or a Last Mile Lead-style split (50).
function makeEmployee(id, name, department, costType, title, startDate, endDate, employment, baseSalary, cogsPercent) {
  return {
    id,
    name,
    department,
    costType,
    ...(cogsPercent != null ? { cogsPercent } : {}),
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
  // Corrected CoGS -> OpEx (2026-09-15, per the Sept 10 Wildcard/FuelFinance sync):
  // Hannah manages the production team but doesn't do the production work herself —
  // Brennan's own words, "probably more OpEx than CoGS, realistically," which Kayee
  // confirmed on the call ("if someone's head of something, we consider it an
  // operation because they are really organizing the entire operation").
  makeEmployee('hannah-merrill', 'Hannah Merrill', 'Production', 'OpEx', 'Production Lead', '2024-05-01', '', 'Active', 110000),
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
  // Corrected CoGS -> OpEx (2026-09-15, same reasoning as Hannah Merrill above — a
  // Head of Ops manages the team rather than producing campaigns directly).
  makeRampRole('head-of-ops', 'Head of Ops', 'Production', 'OpEx', 150000, [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0]),
  makeEmployee('el', 'El', 'Engineering', 'OpEx', '', '2026-03-01', '', 'TBD', 100000),
  makeRampRole('sales-hires', 'Sales Hires', 'S&M', 'OpEx', 150000, [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0]),
  makeRampRole('junior-creative-hire', 'Junior Creative Hire', 'Creative', 'CoGS', 45000, [0, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0]),
  makeRampRole('cs-hires', 'CS Hires', 'G&A', 'OpEx', 125000, [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0]),
  makeEmployee('naama', "Na'ama", 'S&M', 'OpEx', '', '', '', 'Active', 150000),
  makeEmployee('ethan', 'Ethan', 'Creative', 'CoGS', '', '', '', 'TBD', 45000),
  makeEmployee('britton', 'Britton', 'Production', 'CoGS', '', '', '', 'Active', 48000),
  // 75% CoGS / 25% OpEx split (2026-09-15, per the Sept 10 sync): Brennan described a
  // Designer's work as "partially campaign contribution, partially company stuff...
  // 75% for campaigns, 25% for just OpEx company stuff" (webpage, sales materials,
  // general design work not tied to a specific campaign) — Founding Designer gets the
  // same treatment per Brennan, same title/role either way.
  makeEmployee('neel', 'Neel', 'Production', 'CoGS', 'Designer', '', '', 'Active', 70000, 75),
  makeEmployee('mia', 'Mia', 'Production', 'CoGS', '', '', '', 'Active', 40000),
];

function makeBonus(employeeId, bonusAmount, extra = {}) {
  return { id: `bonus-${employeeId}${extra.type && extra.type !== 'fixed' ? `-${extra.type}` : ''}`, employeeId, type: 'fixed', bonusAmount, payout: 'monthly', startDate: '', endDate: '', monthlyOverrides: {}, ...extra };
}

/** Coordinator plan pair per Hannah (Sept 2026): $1k per 55 campaigns sent (junior
 *  individual milestone) + $100 per meeting from their own campaigns. `sharePct` is
 *  this person's share of the team's projected campaigns/meetings — seeded as an even
 *  split across the 5 coordinator rows (20% each); adjust in the Bonus card. */
function coordinatorPlans(employeeId, sharePct) {
  return [
    makeBonus(employeeId, 0, { type: 'milestone', amountPerMilestone: 1000, campaignsPerMilestone: 55, sharePct }),
    makeBonus(employeeId, 0, { type: 'perMeeting', amountPerMeeting: 100, sharePct }),
  ];
}

export const SEED_BONUSES = [
  makeBonus('brennan-keough', 0),
  makeBonus('shane-kovalsky', 0),
  // Hannah: ~$10k per quarter when her team hits its goals, paid quarterly (Brennan,
  // Sept 10 sync). Plan expected to change in ~2-3 months — set the End Date here when
  // known; her replacement plan then gets its own row.
  makeBonus('hannah-merrill', 0, { type: 'quarterly', amountPerQuarter: 10000, payout: 'quarterly' }),
  ...coordinatorPlans('vaughn', 20),
  ...coordinatorPlans('cristina', 20),
  ...coordinatorPlans('cc-hires', 20),
  ...coordinatorPlans('britton', 20),
  ...coordinatorPlans('mia', 20),
  // Creative team milestones are Shane's — structure not yet confirmed, so these stay
  // on the original fixed-annual model until he weighs in.
  makeBonus('dylan-smith', 12000),
  makeBonus('head-of-ops', 50000),
  makeBonus('el', 50000),
  makeBonus('sales-hires', 150000),
  makeBonus('junior-creative-hire', 12000),
  makeBonus('cs-hires', 50000),
  makeBonus('naama', 150000),
  makeBonus('ethan', 12000),
  makeBonus('neel', 30000),
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

/** One-shot migration of a saved payroll state onto the 2026-09-15 model — runs from
 *  usePayrollState on hydrate. Idempotent: each step only fires when the saved data
 *  is still in the pre-change shape, so re-running never clobbers a later manual edit.
 *   1. Bonus plans: a save with NO `type` on any bonus predates plan types. Hannah's
 *      fixed $40k becomes the confirmed $10k/quarter plan; the five coordinator rows'
 *      fixed $12k become the milestone + per-meeting pair Hannah described; every
 *      other bonus is tagged 'fixed' and keeps computing exactly as before.
 *   2. Assumptions: adds milestoneHitRate (90) when missing.
 *   3. Roster: the Sept 10 sync corrections (Hannah + Head of Ops → OpEx, Designer
 *      75/25) applied only where the row still carries the old seed classification. */
export function migratePayrollState(loaded) {
  if (!loaded || typeof loaded !== 'object') return loaded;
  let next = loaded;

  if (Array.isArray(next.bonuses) && next.bonuses.length && !next.bonuses.some((b) => b && b.type)) {
    const converted = [];
    for (const b of next.bonuses) {
      if (!b) continue;
      if (b.employeeId === 'hannah-merrill') {
        converted.push(makeBonus('hannah-merrill', 0, { type: 'quarterly', amountPerQuarter: 10000, payout: 'quarterly' }));
      } else if (['vaughn', 'cristina', 'cc-hires', 'britton', 'mia'].includes(b.employeeId)) {
        converted.push(...coordinatorPlans(b.employeeId, 20));
      } else {
        converted.push({ ...b, type: 'fixed', payout: b.payout || 'monthly', startDate: b.startDate || '', endDate: b.endDate || '' });
      }
    }
    next = { ...next, bonuses: converted };
  }

  if (next.assumptions && next.assumptions.milestoneHitRate == null) {
    next = { ...next, assumptions: { ...next.assumptions, milestoneHitRate: 90 } };
  }

  if (Array.isArray(next.roster)) {
    next = {
      ...next,
      roster: next.roster.map((r) => {
        if (!r) return r;
        if ((r.id === 'hannah-merrill' || r.id === 'head-of-ops') && r.costType === 'CoGS' && r.cogsPercent == null) {
          return { ...r, costType: 'OpEx' };
        }
        if (r.id === 'neel' && r.costType === 'CoGS' && r.cogsPercent == null) return { ...r, cogsPercent: 75 };
        return r;
      }),
    };
  }
  return next;
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
