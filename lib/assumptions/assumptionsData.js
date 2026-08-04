/**
 * Assumptions tab — data model, seed dataset, and calculation helpers.
 *
 * Structure only, per Kayee's explicit instruction (2026-08-04 conversation): "just
 * create the structure first we will decide on the math later, just follow the
 * calculation." The Revenue formula below IS locked in — it was reverse-verified
 * against Kayee's real summary sheet (Upfront $1,500 x 225 campaigns = $337,500;
 * Per-Meeting $3,500 x round(10% x 135) = $49,000; sum = $386,500; × (1-15%) =
 * $328,525 — all four figures match the source sheet exactly). The COGS/OPEX
 * "Misc"/"Vetric" reconciliation between the summary tab and the Non-Headcount Costs
 * table was flagged as unresolved and is NOT guessed at here — those items are
 * carried through as plain, editable cost-item rows with no hidden formula.
 *
 * Like Payroll, this is a forecast/what-if layer: state is saved to this browser's
 * localStorage (see useAssumptionsState.js), not written back to Wildcard's Google
 * Sheet. Per Kayee: this tab only produces PROJECTED months (July 2026 onward).
 * Actual months (June 2026 and earlier) always come from the Google Sheet and are
 * never touched or overridden by anything computed here.
 *
 * Headcount cost is deliberately NOT re-entered on this tab — it's read from the
 * Payroll tab's own roster/bonus state (each employee already carries a CoGS/OpEx
 * costType there). Duplicating headcount data entry across two tabs would be exactly
 * the kind of extra-maintenance problem Kayee has been steering away from throughout
 * this build.
 */

export const FIRST_PROJECTED_MONTH = '2026-07'; // first month with no Google Sheet actuals yet

export const COST_CATEGORIES = ['CoGS', 'OpEx', 'Other'];
export const COST_CADENCES = ['Monthly', 'Quarterly'];

/* ------------------------------ Revenue ------------------------------ */

export const SEED_REVENUE_ASSUMPTIONS = {
  uncollectiblePct: 15,
  upfrontPerCampaign: 1500,
  currentMonthCampaigns: 225,
  perMeeting: 3500,
  meetingConversionPct: 10,
  meetingsLagMonths: 2,
  meetingsLagCount: 135,
  // COGS-side campaign driver — kept here since it shares the same campaign-count
  // input family as Revenue, matching how Kayee's own sheet groups these drivers.
  campaignCost: 250,
  lastMonthCampaigns: 191,
};

/** Upfront-based revenue = Upfront $ x this month's campaign count.
 *  Verified: 1,500 x 225 = 337,500 (matches source sheet). */
export function upfrontRevenue(rev) {
  return (Number(rev.upfrontPerCampaign) || 0) * (Number(rev.currentMonthCampaigns) || 0);
}

/** Meeting-based revenue = Per-Meeting $ x round(Meeting Conversion% x lagged meeting
 *  count). Verified: 3,500 x round(10% x 135) = 3,500 x 14 = 49,000 (matches source
 *  sheet). The lagged count is the "Total of Meeting # campaign from N months ago"
 *  input — a manual figure Kayee tracks from a different sheet, not derived here. */
export function meetingRevenue(rev) {
  const converted = Math.round(((Number(rev.meetingConversionPct) || 0) / 100) * (Number(rev.meetingsLagCount) || 0));
  return (Number(rev.perMeeting) || 0) * converted;
}

/** Gross Collected Revenue before the uncollectible haircut. Verified: 337,500 +
 *  49,000 = 386,500 (matches source sheet). */
export function grossCollectedRevenue(rev) {
  return upfrontRevenue(rev) + meetingRevenue(rev);
}

/** Gross Collected Revenue net of Uncollectible %. Verified: 386,500 x (1 - 15%) =
 *  328,525 (matches source sheet). */
export function netCollectedRevenue(rev) {
  return grossCollectedRevenue(rev) * (1 - (Number(rev.uncollectiblePct) || 0) / 100);
}

/** Cost Per Campaign = Campaign Cost $ x last month's campaign count. Verified:
 *  250 x 191 = 47,750 (matches source sheet). */
export function costPerCampaign(rev) {
  return (Number(rev.campaignCost) || 0) * (Number(rev.lastMonthCampaigns) || 0);
}

/* --------------------------- Non-headcount cost items --------------------------- */

function makeCostItem(id, name, amount, cadence, category, startOn = '') {
  return { id, name, amount, cadence, category, startOn };
}

// Transcribed directly from Kayee's "Non-Headcount Costs" sheet (2026-08-04 screenshot).
export const SEED_COST_ITEMS = [
  makeCostItem('rent', 'Rent', 3000, 'Monthly', 'OpEx'),
  makeCostItem('central-payroll', 'Central - Payroll', 50, 'Monthly', 'OpEx'),
  makeCostItem('central-bookkeeping', 'Central - Bookkeeping', 1500, 'Monthly', 'OpEx'),
  makeCostItem('vetric', 'Vetric', 5250, 'Quarterly', 'CoGS'),
  makeCostItem('software', 'Software', 1000, 'Monthly', 'CoGS'),
  makeCostItem('other-software', 'Other Software', 500, 'Monthly', 'OpEx'),
  makeCostItem('office-snacks', 'Office Snacks', 1000, 'Monthly', 'OpEx'),
  makeCostItem('travel', 'Travel', 500, 'Monthly', 'OpEx'),
  makeCostItem('team-lunches', 'Team Lunches', 300, 'Monthly', 'OpEx'),
  makeCostItem('altia', 'Altia', 8000, 'Monthly', 'OpEx'),
  makeCostItem('demand-collective', 'Demand Collective', 15000, 'Quarterly', 'OpEx'),
  makeCostItem('misc-other', 'Misc', 250, 'Monthly', 'Other'),
  makeCostItem('misc-cogs', 'Misc', 250, 'Monthly', 'CoGS'),
  makeCostItem('misc-opex', 'Misc', 250, 'Monthly', 'OpEx'),
];

function monthsBetween(fromIso, toIso) {
  const [fy, fm] = fromIso.split('-').map(Number);
  const [ty, tm] = toIso.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

/** Whether a cost item is due in a given projected month.
 *  - Monthly: due every month from its Start On date onward (or always, if no Start
 *    On is set).
 *  - Quarterly: due every 3rd month counted from Start On. If Start On is blank, the
 *    timing genuinely can't be determined — this returns `false` (not due) rather
 *    than guessing, so it renders as $0 until Kayee sets a Start On date. */
export function isCostItemDue(item, iso) {
  if (item.cadence === 'Monthly') {
    if (!item.startOn) return true;
    return monthsBetween(item.startOn.slice(0, 7), iso) >= 0;
  }
  if (item.cadence === 'Quarterly') {
    if (!item.startOn) return false; // unscheduled — needs a Start On date, see note above
    const diff = monthsBetween(item.startOn.slice(0, 7), iso);
    return diff >= 0 && diff % 3 === 0;
  }
  return false;
}

export function costItemAmountForMonth(item, iso) {
  return isCostItemDue(item, iso) ? Number(item.amount) || 0 : 0;
}

/** Sum of non-headcount cost items in one Category, for one projected month. */
export function costItemsTotalForMonth(costItems, category, iso) {
  return costItems.filter((i) => i.category === category).reduce((sum, i) => sum + costItemAmountForMonth(i, iso), 0);
}

/* ------------------------------ Local state ------------------------------ */

export function seedAssumptionsState() {
  return {
    revenue: { ...SEED_REVENUE_ASSUMPTIONS },
    costItems: SEED_COST_ITEMS.map((i) => ({ ...i })),
  };
}

let idCounter = 0;
export function generateId(prefix) {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}
