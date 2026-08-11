/**
 * Assumptions tab — data model, seed dataset, and calculation helpers.
 *
 * Structure only, per Kayee's explicit instruction (2026-08-04 conversation): "just
 * create the structure first we will decide on the math later, just follow the
 * calculation." The Revenue formula below IS locked in — it was reverse-verified
 * against Kayee's real summary sheet (Upfront $1,500 x 225 campaigns = $337,500;
 * Per-Meeting $3,500 x round(10% x 135) = $49,000; sum = $386,500; × (1-15%) =
 * $328,525 — all four figures match the source sheet exactly). COGS/OPEX/Other
 * projection (per Kayee, 2026-08-05) is NOT collapsed into generic bucket labels —
 * each Non-Headcount Cost item shows under its own real name (Vetric, Software,
 * Misc, Rent, ...), same as Kayee's actual sheet: COGS = Cost Per Campaign (formula
 * above) + every Cost Item tagged Category=CoGS by name + Headcount (Payroll roster,
 * costType=CoGS); OPEX = every Cost Item tagged Category=OpEx by name + Headcount
 * (Payroll roster, costType=OpEx); Other (Non-Operating) = every Cost Item tagged
 * Category=Other by name. See ProjectionSummaryCard.jsx. Kayee flagged that actual GL
 * months won't break COGS out with a distinct Headcount-CoGS line the way this
 * projection does — this breakdown is projection-only and expected to diverge in
 * structure from actual months.
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

/** Companion to prevMonth, kept as its own function rather than `prevMonth(iso, -n)` —
 *  prevMonth's carry loop only normalizes m < 1, so a negative n (m > 12) would silently
 *  produce a malformed "2026-13"-style string instead of rolling into the next year. */
export function nextMonth(iso, n = 1) {
  let [y, m] = iso.split('-').map(Number);
  m += n;
  while (m > 12) {
    m -= 12;
    y += 1;
  }
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

/** Whether an ACTUAL month's # of Campaigns has been explicitly "switched to
 *  projection" for editing purposes (2026-08-10, Kayee, quoting the Hampton
 *  act-fcst-snapshot-pattern doc: "I want to be able to switch actual month to
 *  projection so that I can input those # of campaign in the earlier month"). This is
 *  narrower than that doc's full generic snapshot vault: Campaigns is a local-only
 *  what-if driver (never GL-sourced, unlike every real $ row in this P&L), so there's
 *  no live-data-overwrite risk to guard against — the only thing this needs to solve
 *  is "let me type a real number into a month that's currently locked read-only
 *  because it's on-or-before the sheet's actual/forecast boundary." `iso in
 *  campaignActualOverrides` is the on/off flag; whether that month's number gets
 *  cleared first (so a stale SEED_CAMPAIGNS_BY_MONTH default can't masquerade as a
 *  real entry) is handled once, the first time a month is ever overridden — see
 *  toggleCampaignActualOverride below. */
export function isCampaignActualOverride(revenue, iso) {
  return !!(revenue.campaignActualOverrides && revenue.campaignActualOverrides[iso]);
}

/** Flips one actual month's override on/off. Turning it ON clears that month's stored
 *  campaignsByMonth entry IF it's still sitting at its exact untouched
 *  SEED_CAMPAIGNS_BY_MONTH default — so the newly-editable box starts genuinely blank
 *  instead of pre-filled with a hardcoded guess (Kayee: "instead of hardcoding them").
 *  A real typed-in number (which won't match the seed constant) is always left alone.
 *
 *  2026-08-10 correction: the original version only cleared the very first time a
 *  month was EVER toggled (tracked via `iso in overrides`), which meant a month
 *  toggled on/off once already — say, while testing — permanently "used up" its one
 *  chance to clear, even though the box was still showing nothing but the untouched
 *  seed number the whole time (exactly what Kayee's screenshot caught: "these 4 are
 *  still hardcoded amount, it needs to be calculation"). Comparing against the actual
 *  seed constant instead of a one-time flag means it keeps offering a clean slate
 *  every time, for as long as nobody's actually replaced the hardcoded guess with a
 *  real number. */
export function toggleCampaignActualOverride(revenue, iso) {
  const overrides = revenue.campaignActualOverrides || {};
  const turningOn = !overrides[iso];
  const nextOverrides = { ...overrides, [iso]: turningOn };
  let nextCampaignsByMonth = revenue.campaignsByMonth;
  if (turningOn && revenue.campaignsByMonth[iso] === SEED_CAMPAIGNS_BY_MONTH[iso]) {
    nextCampaignsByMonth = { ...revenue.campaignsByMonth };
    delete nextCampaignsByMonth[iso];
  }
  return { ...revenue, campaignActualOverrides: nextOverrides, campaignsByMonth: nextCampaignsByMonth };
}

/** Rate-schedule resolver (2026-08-07, Kayee: "if they want to switch from 3500 to
 *  4500 in 2027... start date for jan 2026 to dec 2026 is 3500 then apply it and it
 *  will show up on a monthly basis"). A `schedule` is a sparse map of iso -> value,
 *  each one meaning "effective from this month UNTIL the next entry" (a step
 *  function) — this is the same effective-dated-rate-change pattern real finance
 *  tools use, rather than requiring every single month to carry its own value the way
 *  campaignsByMonth/meetingsByMonth do. `null` at a given month means "revert to the
 *  base/default rate from here on" (how ending a range works — see
 *  buildScheduleRangePatch below). Falls back to `defaultValue` when there's no
 *  schedule yet, or nothing in it applies to `iso` yet — old saved Assumptions state
 *  (from before this feature existed) has no schedule maps at all, and this returns
 *  the exact same flat number those months always showed, so it's a fully backward-
 *  compatible upgrade, not a breaking one. */
export function scheduledValueForMonth(schedule, defaultValue, iso) {
  const fallback = Number(defaultValue) || 0;
  if (!schedule) return fallback;
  const applicable = Object.keys(schedule)
    .filter((k) => k <= iso)
    .sort();
  if (applicable.length === 0) return fallback;
  const v = schedule[applicable[applicable.length - 1]];
  return v === null || v === undefined ? fallback : Number(v) || 0;
}

/** Builds the schedule patch for one "Apply" action covering [fromIso, toIso] (toIso
 *  optional — blank means "ongoing, no end"). Setting `toIso` inserts a `null` marker
 *  the month right after it, so the rate reverts to the base default once the range
 *  ends, exactly like Kayee's "start date for jan 2026 to dec 2026 is 3500" example
 *  (Jan 2027 onward goes back to the base rate unless a later Apply covers it too). */
export function buildScheduleRangePatch(schedule, fromIso, toIso, value) {
  const next = { ...(schedule || {}), [fromIso]: Number(value) || 0 };
  if (toIso) next[nextMonth(toIso, 1)] = null;
  return next;
}

/** A manually-entered count always wins. With no entry yet for this month, this
 *  auto-suggests one from the conversion-rate + lag — same behavior as the source
 *  sheet's "Forecasted" columns (see file header for the verified Jan-2026 example). */
export function meetingsForMonth(revenue, iso) {
  const v = revenue.meetingsByMonth[iso];
  if (v != null) return Number(v) || 0;
  const laggedCampaigns = campaignsForMonth(revenue, prevMonth(iso, revenue.meetingsLagMonths || 0));
  const conversionPct = scheduledValueForMonth(revenue.meetingConversionPctSchedule, revenue.meetingConversionPct, iso);
  return Math.round((conversionPct / 100) * laggedCampaigns);
}

/** Upfront (subscription) revenue = this month's campaign count x Upfront Rate,
 *  where Upfront Rate can now vary by month via upfrontRateSchedule (2026-08-07). */
export function upfrontRevenueForMonth(revenue, iso) {
  const rate = scheduledValueForMonth(revenue.upfrontRateSchedule, revenue.upfrontRate, iso);
  return campaignsForMonth(revenue, iso) * rate;
}

/** Meeting (transactional/success-fee) revenue = this month's meeting count x
 *  Per-Meeting Rate, where Per Meeting Rate can now vary by month (2026-08-07). */
export function meetingRevenueForMonth(revenue, iso) {
  const rate = scheduledValueForMonth(revenue.perMeetingRateSchedule, revenue.perMeetingRate, iso);
  return meetingsForMonth(revenue, iso) * rate;
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
 *  250 x May 2026's 191 campaigns = 47,750 (matches the source sheet exactly).
 *  Campaign Cost Rate can now vary by month via campaignCostRateSchedule (2026-08-07). */
export function costPerCampaignForMonth(revenue, iso) {
  const rate = scheduledValueForMonth(revenue.campaignCostRateSchedule, revenue.campaignCostRate, iso);
  return campaignsForMonth(revenue, prevMonth(iso, 1)) * rate;
}

/* --------------------------- Non-headcount cost items --------------------------- */

function makeCostItem(id, name, amount, cadence, category, startOn = '') {
  return { id, name, amount, cadence, category, startOn };
}

// Transcribed directly from Kayee's "Non-Headcount Costs" sheet (2026-08-04 screenshot).
// 'vetric' and 'misc-cogs' REMOVED (2026-08-10, Kayee: "remove Vetric and Misc in COGS.
// i want to add it myself and drag it") — these two were only ever auto-shown as
// custom-account rows on the P&L (no real GL row to match), which is exactly the
// manual "+ Add account" + drag-and-drop workflow now exists to replace. This only
// affects a BRAND NEW browser's first-ever load — anyone with existing saved
// Assumptions state (localStorage) still has their own Vetric/Misc rows and should
// just delete them by hand via each row's own trash icon if they want them gone too.
export const SEED_COST_ITEMS = [
  makeCostItem('rent', 'Rent', 3000, 'Monthly', 'OpEx'),
  makeCostItem('central-payroll', 'Central - Payroll', 50, 'Monthly', 'OpEx'),
  makeCostItem('central-bookkeeping', 'Central - Bookkeeping', 1500, 'Monthly', 'OpEx'),
  makeCostItem('software', 'Software', 1000, 'Monthly', 'CoGS'),
  makeCostItem('other-software', 'Other Software', 500, 'Monthly', 'OpEx'),
  makeCostItem('office-snacks', 'Office Snacks', 1000, 'Monthly', 'OpEx'),
  makeCostItem('travel', 'Travel', 500, 'Monthly', 'OpEx'),
  makeCostItem('team-lunches', 'Team Lunches', 300, 'Monthly', 'OpEx'),
  makeCostItem('altia', 'Altia', 8000, 'Monthly', 'OpEx'),
  makeCostItem('demand-collective', 'Demand Collective', 15000, 'Quarterly', 'OpEx'),
  makeCostItem('misc-other', 'Misc', 250, 'Monthly', 'Other'),
  makeCostItem('misc-opex', 'Misc', 250, 'Monthly', 'OpEx'),
];

function monthsBetween(fromIso, toIso) {
  const [fy, fm] = fromIso.split('-').map(Number);
  const [ty, tm] = toIso.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

/** Whether a cost item has started yet in a given projected month (Start On is
 *  optional — blank means "always active"). This only gates whether the item has
 *  kicked in at all; it no longer determines WHICH months a Quarterly item lands in
 *  (see costItemAmountForMonth below — 2026-08-05 change per Kayee: "Vetric is
 *  quarterly so you do that total / 3", i.e. spread evenly every month rather than
 *  billed as one lump sum once a quarter). */
export function isCostItemDue(item, iso) {
  if (!item.startOn) return true;
  return monthsBetween(item.startOn.slice(0, 7), iso) >= 0;
}

/** Monthly items show their full $ every active month. Quarterly items show
 *  amount / 3 every active month — the quarterly total spread evenly, not billed as
 *  a lump sum in one month of the quarter (2026-08-05, per Kayee's Vetric example).
 *  `item.amount` can now vary by month via `item.amountSchedule` (2026-08-07, Kayee:
 *  "we should be able to apply to other period just like those revenue assumptions")
 *  — same effective-dated step-function pattern as the Revenue rate schedules above,
 *  reusing the same scheduledValueForMonth resolver. Old items with no
 *  `amountSchedule` at all resolve to the exact same flat `amount` they always did. */
export function costItemAmountForMonth(item, iso) {
  if (!isCostItemDue(item, iso)) return 0;
  const amt = scheduledValueForMonth(item.amountSchedule, item.amount, iso);
  return item.cadence === 'Quarterly' ? amt / 3 : amt;
}

/** Sum of non-headcount cost items in one Category, for one projected month. */
export function costItemsTotalForMonth(costItems, category, iso) {
  return costItems.filter((i) => i.category === category).reduce((sum, i) => sum + costItemAmountForMonth(i, iso), 0);
}

/** Look up a single cost item's monthly amount by its stable id — used for the COGS
 *  five-line breakdown, where Vetric/Software/Misc each need to appear as their own
 *  named line rather than folded into one "Non-Headcount" total (2026-08-05). */
export function costItemAmountById(costItems, id, iso) {
  const item = costItems.find((i) => i.id === id);
  return item ? costItemAmountForMonth(item, iso) : 0;
}

/* ------------------------------ Local state ------------------------------ */

export function seedAssumptionsState() {
  return {
    revenue: {
      ...SEED_REVENUE_RATES,
      campaignsByMonth: { ...SEED_CAMPAIGNS_BY_MONTH },
      meetingsByMonth: { ...SEED_MEETINGS_BY_MONTH },
      // Actual months explicitly "switched to projection" for editing (2026-08-10) —
      // see isCampaignActualOverride/toggleCampaignActualOverride above. Empty until
      // the FCST-side revert toggle on the # of Campaigns row is clicked at least once.
      campaignActualOverrides: {},
      // Sparse effective-dated overrides (2026-08-07) — empty until an "Apply" action
      // (see RateScheduleControl in PLAssumptionsSidebar.jsx) adds a month->value entry.
      upfrontRateSchedule: {},
      perMeetingRateSchedule: {},
      meetingConversionPctSchedule: {},
      campaignCostRateSchedule: {},
    },
    costItems: SEED_COST_ITEMS.map((i) => ({ ...i })),
    // User-created blank P&L lines (2026-08-10, Kayee: "give me the ability to add a
    // new account under each section so i can add other travel and drag travel
    // there") — {id, label, section}. Empty until "+ Add account" is used at least
    // once; see withManualAccountRows in ReportsPanel.jsx for how these render.
    customPLAccounts: [],
  };
}

let idCounter = 0;
export function generateId(prefix) {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}
