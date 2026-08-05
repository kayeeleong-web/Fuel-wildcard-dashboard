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
/*
 * Restructured 2026-08-04 per Kayee: "Upfront is subscription revenue and meeting is
 * transactional revenue... how many campaigns will I get month over month and then
 * total # of meetings... the user will be able to plug in the # every month."
 *
 * Wildcard's real pricing (per Kayee, same conversation): an upfront cost per
 * campaign ($1,500 — subscription-style, billed monthly per campaign run) plus a
 * success fee per campaign that results in a booked+attended meeting ($4,000 — this
 * replaces an earlier $3,500 figure pulled from an older sheet snapshot, corrected by
 * Kayee). There's also a second, flat-fee pricing option ($2,000–2,500/campaign, no
 * success fee) used for some customers — NOT modeled separately yet (no per-customer
 * segment data to split by), so this is one blended rate for now, same as the rest of
 * this tab's "structure first" approach.
 *
 * campaignsByMonth / meetingsByMonth are the two genuinely-monthly drivers, editable
 * per month (RevenueAssumptionsCard renders them as PayrollTable month-grids, same UI
 * as the Roster/Bonus cards). Seed values below are transcribed directly from Kayee's
 * real campaign-detail sheet (2026-08-04 screenshots).
 *
 * meetingsForMonth() auto-suggests a figure (Meeting Conversion% x campaigns from
 * `meetingsLagMonths` ago) for any month with no manually-entered count yet — this
 * mirrors the source sheet's own "Forecasted" columns, which use the same formula
 * once a month moves past its "Manual Calcs" period. Verified: Jan 2026's 8 meetings
 * = round(10% x Nov 2025's 80 campaigns) = 8 (matches the source sheet's own linked
 * 10% conversion rate — a separate ~15% figure appears in one reference box on the
 * sheet, but every actual linked formula there uses 10%, so that's what's used here).
 */

export const SEED_REVENUE_RATES = {
  upfrontRate: 1500, // $/campaign, subscription-style upfront fee
  perMeetingRate: 4000, // $ success fee per campaign that results in an attended meeting
  meetingConversionPct: 10, // used only to auto-suggest a not-yet-entered month's meeting count
  meetingsLagMonths: 2,
  uncollectiblePct: 15,
  campaignCostRate: 250, // COGS: $ cost per campaign run, billed the month after
};

// Transcribed from Kayee's real campaign-detail sheet (2026-08-04 screenshots).
export const SEED_CAMPAIGNS_BY_MONTH = {
  '2025-07': 50,
  '2025-08': 60,
  '2025-09': 60,
  '2025-10': 75,
  '2025-11': 80,
  '2025-12': 80,
  '2026-01': 80,
  '2026-02': 95,
  '2026-03': 113,
  '2026-04': 135,
  '2026-05': 191,
  '2026-06': 225,
  '2026-07': 250,
  '2026-08': 300,
  '2026-09': 350,
  '2026-10': 400,
};

export const SEED_MEETINGS_BY_MONTH = {
  '2025-07': 5,
  '2025-08': 7,
  '2025-09': 5,
  '2025-10': 6,
  '2025-11': 6,
  '2025-12': 8,
  '2026-01': 8,
  '2026-02': 8,
  '2026-03': 8,
  '2026-04': 10,
  '2026-05': 11,
  '2026-06': 14,
  '2026-07': 19,
  '2026-08': 23,
  '2026-09': 25,
  '2026-10': 30,
};

export function prevMonth(iso, n = 1) {
  let [y, m] = iso.split('-').map(Number);
  m -= n;
  while (m < 1) {
    m += 12;
    y -= 1;
  }
  return `${y}-${String(m).padStart(2, '0')}`;
}

export function campaignsForMonth(revenue, iso) {
  const v = revenue.campaignsByMonth[iso];
  return v != null ? Number(v) || 0 : 0;
}

/** A manually-entered count always wins. With no entry yet for this month, this
 *  auto-suggests one from the conversion-rate + lag — same behavior as the source
 *  sheet's "Forecasted" columns (see file header for the verified Jan-2026 example). */
export function meetingsForMonth(revenue, iso) {
  const v = revenue.meetingsByMonth[iso];
  if (v != null) return Number(v) || 0;
  const laggedCampaigns = campaignsForMonth(revenue, prevMonth(iso, revenue.meetingsLagMonths || 0));
  return Math.round(((Number(revenue.meetingConversionPct) || 0) / 100) * laggedCampaigns);
}

/** Upfront (subscription) revenue = this month's campaign count x Upfront Rate. */
export function upfrontRevenueForMonth(revenue, iso) {
  return campaignsForMonth(revenue, iso) * (Number(revenue.upfrontRate) || 0);
}

/** Meeting (transactional/success-fee) revenue = this month's meeting count x
 *  Per-Meeting Rate. */
export function meetingRevenueForMonth(revenue, iso) {
  return meetingsForMonth(revenue, iso) * (Number(revenue.perMeetingRate) || 0);
}

/** Gross Collected Revenue for one month, before the Uncollectible haircut. */
export function grossCollectedRevenueForMonth(revenue, iso) {
  return upfrontRevenueForMonth(revenue, iso) + meetingRevenueForMonth(revenue, iso);
}

/** Gross Collected Revenue for one month, net of Uncollectible %. */
export function netCollectedRevenueForMonth(revenue, iso) {
  return grossCollectedRevenueForMonth(revenue, iso) * (1 - (Number(revenue.uncollectiblePct) || 0) / 100);
}

/** Cost Per Campaign for one month = Campaign Cost Rate x LAST month's campaign
 *  count (campaigns run one month bill as COGS the next). Verified: June 2026 =
 *  250 x May 2026's 191 campaigns = 47,750 (matches the source sheet exactly). */
export function costPerCampaignForMonth(revenue, iso) {
  return campaignsForMonth(revenue, prevMonth(iso, 1)) * (Number(revenue.campaignCostRate) || 0);
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
    revenue: {
      ...SEED_REVENUE_RATES,
      campaignsByMonth: { ...SEED_CAMPAIGNS_BY_MONTH },
      meetingsByMonth: { ...SEED_MEETINGS_BY_MONTH },
    },
    costItems: SEED_COST_ITEMS.map((i) => ({ ...i })),
  };
}

let idCounter = 0;
export function generateId(prefix) {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}
