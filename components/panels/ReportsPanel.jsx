'use client';

import { useState } from 'react';
import { PageHead } from '../ui/PageHead';
import { DrillPopover } from '../ui/DrillPopover';
import { formatMonthLabel } from '../../lib/calc/dashboardMetrics';
import { useAssumptionsState } from '../../lib/assumptions/useAssumptionsState';
import { usePayrollState } from '../../lib/payroll/usePayrollState';
import { headcountCostByCostType } from '../../lib/payroll/payrollData';
import {
  upfrontRevenueForMonth,
  meetingRevenueForMonth,
  netCollectedRevenueForMonth,
  campaignsForMonth,
  meetingsForMonth,
  costPerCampaignForMonth,
  costItemsTotalForMonth,
  costItemAmountForMonth,
  prevMonth,
} from '../../lib/assumptions/assumptionsData';

// Which Reports section a NOT-YET-matched custom cost item's category rolls up under
// — matched by the live sheet's own `section` string (read verbatim, same as
// row.key/label — see lib/data/sources/googleSheets.ts). COGS is confirmed to be one
// flat section, so unmatched CoGS items land there. OpEx is NOT one flat section on
// Kayee's real sheet (2026-08-06 screenshot: it's split into granular sections like
// FACILITIES, each with its own Total row) — there's no single safe place to drop an
// unmatched OpEx item, so it's deliberately left out here. An unmatched OpEx item still
// counts in Total OpEx (cogsTotalForMonth/opexTotalForMonth already sum every item
// regardless), it just won't get its own visible row until it's matched to a real row
// below or a real OpEx section is confirmed.
const CUSTOM_ACCOUNT_SECTION_ALIASES = {
  CoGS: ['COGS'],
};

// Cost items that are the SAME cost as an existing real P&L row, just named
// differently on Assumptions than the row's actual label — these feed that existing
// row directly instead of getting their own new custom-account row (which would
// double it up on-screen). Exact-name matches (e.g. the "Rent" cost item -> a real
// "Rent" row) are handled automatically below (matchCostItemToExistingRow) and don't
// need an entry here — this map is only for name MISMATCHES Kayee's confirmed by hand:
//   - software -> 'Software - Cost of Revenue' (2026-08-06: "they are the same")
//   - travel -> 'Total Travel' (2026-08-06: "Travel is the total travel")
//   - team-lunches -> 'Meals (Office)' (2026-08-06: "Team Lunches is Meals (Office)")
// Keyed by the Assumptions cost item's stable `id` (see SEED_COST_ITEMS in
// assumptionsData.js) -> the real P&L row's exact label.
const COST_ITEM_ROW_LABEL_OVERRIDES = {
  software: 'Software - Cost of Revenue',
  travel: 'Total Travel',
  'team-lunches': 'Meals (Office)',
};

/** Which PL rows get their projected (post-actual) months filled from the
 *  Assumptions tab, and which Assumptions calculation feeds each one — per Kayee
 *  (2026-08-04): "if I change something [in Assumptions] it should reflect in the
 *  P&L projection." Subscription Revenue = Upfront $ (campaigns x Upfront Rate),
 *  Transaction Revenue = Meeting $ (meetings x Per-Meeting Rate), Total Revenue = the
 *  Uncollectible-adjusted net (both streams already get the same haircut individually
 *  before summing, since (a x (1-r)) + (b x (1-r)) = (a+b) x (1-r) — mathematically
 *  identical either way). These exact key names are transcribed from Kayee's live PL
 *  sheet (2026-08-04 screenshots) — if the sheet's Key column for these rows ever
 *  changes, this silently stops projecting (the row just shows "—" again) rather than
 *  crashing, which is the safe failure mode for a keyed lookup like this. */
const PL_REVENUE_PROJECTIONS = {
  revenue_subscription_revenue: (rev, iso) => upfrontRevenueForMonth(rev, iso),
  revenue_transaction_revenue: (rev, iso) => meetingRevenueForMonth(rev, iso),
  total_revenue: (rev, iso) => netCollectedRevenueForMonth(rev, iso),
};

/** Total COGS = Cost Per Campaign + every Assumptions Cost Item tagged CoGS +
 *  Payroll headcount (base+bonus) tagged costType=CoGS — this is Kayee's own stated
 *  definition (see lib/assumptions/assumptionsData.js header, 2026-08-05) and the
 *  exact same formula the Assumptions tab's Projection Preview already computes
 *  (components/assumptions/ProjectionSummaryCard.jsx), just reused here. */
function cogsTotalForMonth(revenue, costItems, payrollState, iso) {
  return (
    costPerCampaignForMonth(revenue, iso) +
    costItemsTotalForMonth(costItems, 'CoGS', iso) +
    (payrollState ? headcountCostByCostType(payrollState.roster, payrollState.bonuses, payrollState.assumptions, 'CoGS', iso) : 0)
  );
}

/** Total OpEx = every Assumptions Cost Item tagged OpEx + Payroll headcount tagged
 *  costType=OpEx — same definition/source as ProjectionSummaryCard's OPEX line. */
function opexTotalForMonth(costItems, payrollState, iso) {
  return (
    costItemsTotalForMonth(costItems, 'OpEx', iso) +
    (payrollState ? headcountCostByCostType(payrollState.roster, payrollState.bonuses, payrollState.assumptions, 'OpEx', iso) : 0)
  );
}

/** COGS/OpEx projection, matched by row LABEL rather than row.key (2026-08-06) — unlike
 *  Revenue's keys, the live sheet's actual Key-column strings for Total COGS/OpEx
 *  haven't been confirmed yet, but these exact LABELS are directly visible in Kayee's
 *  own P&L screenshot (2026-08-06), and label text is read verbatim from the sheet the
 *  same way key is (lib/data/sources/googleSheets.ts), so matching on it carries no
 *  extra risk. A few common aliases are included for the OpEx/margin rows, which
 *  weren't visible in that screenshot — a non-matching alias is a safe no-op (the cell
 *  just stays "—", never a fabricated wrong number).
 *
 *  Deliberately NOT wired: any "Net Income" row — that may include non-operating items
 *  (interest, taxes, D&A, other income) this tab has no data for at all, and a
 *  plausible-looking-but-incomplete number there would be worse than the current blank
 *  (CLAUDE.md: "a wrong number that looks fine is worse than a visible error"). */
const PL_COST_PROJECTIONS_BY_LABEL = {
  // Confirmed by Kayee (2026-08-06): "cost for campaign in cogs is last month's # of
  // campaign multiply by campaign cost of 250 in the assumption" — this row IS
  // costPerCampaignForMonth, not a generic custom account.
  'Cost of campaigns': (ctx, iso) => costPerCampaignForMonth(ctx.revenue, iso),
  'Total COGS': (ctx, iso) => cogsTotalForMonth(ctx.revenue, ctx.costItems, ctx.payrollState, iso),
  'Total OpEx': (ctx, iso) => opexTotalForMonth(ctx.costItems, ctx.payrollState, iso),
  'Total OPEX': (ctx, iso) => opexTotalForMonth(ctx.costItems, ctx.payrollState, iso),
  'Total Operating Expenses': (ctx, iso) => opexTotalForMonth(ctx.costItems, ctx.payrollState, iso),
  'Gross Profit': (ctx, iso) => netCollectedRevenueForMonth(ctx.revenue, iso) - cogsTotalForMonth(ctx.revenue, ctx.costItems, ctx.payrollState, iso),
  'Gross Margin': (ctx, iso) => netCollectedRevenueForMonth(ctx.revenue, iso) - cogsTotalForMonth(ctx.revenue, ctx.costItems, ctx.payrollState, iso),
  'Operating Profit': (ctx, iso) =>
    netCollectedRevenueForMonth(ctx.revenue, iso) -
    cogsTotalForMonth(ctx.revenue, ctx.costItems, ctx.payrollState, iso) -
    opexTotalForMonth(ctx.costItems, ctx.payrollState, iso),
  'Operating Income': (ctx, iso) =>
    netCollectedRevenueForMonth(ctx.revenue, iso) -
    cogsTotalForMonth(ctx.revenue, ctx.costItems, ctx.payrollState, iso) -
    opexTotalForMonth(ctx.costItems, ctx.payrollState, iso),
  'Operating Margin': (ctx, iso) =>
    netCollectedRevenueForMonth(ctx.revenue, iso) -
    cogsTotalForMonth(ctx.revenue, ctx.costItems, ctx.payrollState, iso) -
    opexTotalForMonth(ctx.costItems, ctx.payrollState, iso),
};

const STATEMENT_LABELS = { PL: 'P&L', CF: 'Cash Flow', BS: 'Balance Sheet' };
const STATUS_CLASS = { Ready: 'good', 'In Review': undefined, Scheduled: undefined, Draft: undefined };

// The last projected column every statement is padded out to, so there's column
// space to start building projections into (Assumptions tab, etc.) before any of
// those months have real numbers — per Kayee (2026-08-04): "extend the date to 2030
// ... you can leave it blank." Only actual months (whatever the Google Sheet/GL
// actually returned) ever carry a value; every padded month renders "—" via the same
// `row.values[m] != null` check already used for a genuinely missing actual figure.
const PROJECTION_HORIZON = '2030-12';

/** Appends blank placeholder months after the last real month, through `throughIso` —
 *  pure column padding, never fabricated data. */
function extendMonthsThrough(months, throughIso) {
  if (months.length === 0) return months;
  const extended = [...months];
  let [y, m] = months[months.length - 1].split('-').map(Number);
  const [ty, tm] = throughIso.split('-').map(Number);
  while (y < ty || (y === ty && m < tm)) {
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    extended.push(`${y}-${String(m).padStart(2, '0')}`);
  }
  return extended;
}

/**
 * Reports tab — design-rules.md §5 / functionality-spec.md §5.
 *
 * Range toggle (6M/12M/24M/∞) is CSS-driven, not a refetch: `statements` here already
 * holds the full actual range for each statement (fetched once, server-side) plus
 * blank padding columns through PROJECTION_HORIZON — switching range only changes the
 * `data-range` attribute, which globals.css uses to hide month columns tagged outside
 * that range. The always-visible label column never carries an r6/r12/r24 class, so
 * the design-rules.md "never hide row labels" rule holds by construction, not by
 * convention.
 */
export function ReportsPanel({ statements, customReports }) {
  const [reportType, setReportType] = useState('PL');
  // Defaults to the full 2026 calendar year (Jan-Dec) rather than a trailing window off
  // the last actual month — per Kayee (2026-08-06): opening Reports used to always land
  // on old months, requiring the ∞ toggle + a scroll past 2024/2025 every single refresh
  // just to see this year's forecast. 6M/12M/24M/∞ are one click away in the same toggle
  // group — each is a window CENTERED on today (half real history, half forecast), not
  // a historical-only look-back (2026-08-06 fix, Kayee: "12m or 24m it's only showing
  // actual not projection").
  const [range, setRange] = useState('yr2026');

  return (
    <>
      <PageHead title="Reports" subtitle="P&L, Cash Flow, Balance Sheet, and saved custom reports" />

      <div className="toolbar">
        <div className="seg">
          {['PL', 'CF', 'BS', 'custom'].map((type) => (
            <button
              key={type}
              className={reportType === type ? 'active' : undefined}
              onClick={() => setReportType(type)}
            >
              {type === 'custom' ? 'Custom' : STATEMENT_LABELS[type]}
            </button>
          ))}
        </div>
        {reportType !== 'custom' && (
          <div className="seg right">
            {/* "2026" is the default landing view (full Jan-Dec 2026, actual + forecast
                together). 6M/12M/24M/∞ are windows centered on today — half actual
                history, half forecast — not historical-only (2026-08-06 fix). */}
            <button className={range === 'yr2026' ? 'active' : undefined} onClick={() => setRange('yr2026')}>
              2026
            </button>
            <span className="seg-divider" />
            <span className="seg-group-label">Other Ranges</span>
            {[
              { id: '6', label: '6M' },
              { id: '12', label: '12M' },
              { id: '24', label: '24M' },
              { id: 'all', label: '∞' },
            ].map((r) => (
              <button key={r.id} className={range === r.id ? 'active' : undefined} onClick={() => setRange(r.id)}>
                {r.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Wide wrapper — same treatment as Payroll's tables (globals.css .page-wide),
          so every wide-table tab behaves consistently (Kayee, 2026-08-05: "all pages
          needs to be consistant"). Toolbar/PageHead above stay at the normal page width. */}
      <div className="page-wide">
        {reportType !== 'custom' ? (
          <StatementDoc statement={statements[reportType]} range={range} />
        ) : (
          <CustomReportsList reports={customReports} />
        )}
      </div>
    </>
  );
}

/** 6M/12M/24M are windows CENTERED on today (half the months back as real history,
 *  half forward as forecast) — not a pure trailing/historical-only window (2026-08-06
 *  fix, Kayee: "when I toggle over to 12m or 24m it's only showing actual not
 *  projection"). `distance` is 0 at the last actual month ("today"), negative for
 *  history, positive for forecast — using its absolute value (instead of only ever
 *  checking the positive/history side, the old bug) is what lets these windows include
 *  forecast columns at all now that forecast months carry real projected numbers. */
function rangeClasses(monthIndex, lastActualIndex, month) {
  const distance = monthIndex - lastActualIndex;
  const classes = ['r-all'];
  if (Math.abs(distance) <= 12) classes.push('r24');
  if (Math.abs(distance) <= 6) classes.push('r12');
  if (Math.abs(distance) <= 3) classes.push('r6');
  // Calendar-year tag (independent of how far back/forward this column is from the last
  // actual month) — what the "2026" default view's CSS actually filters on, since a
  // fixed calendar year isn't expressible as a window off lastActualIndex.
  if (month) classes.push(`y${month.slice(0, 4)}`);
  return classes.join(' ');
}

/** Other line items in the same section as `row`, at one specific month — the real
 *  components that sum to a total/subtotal row's figure for that column (design-rules.md
 *  §5 / functionality-spec.md §6: popover numbers must come from the same data as the
 *  visible figure). Leaf (non-total) rows have no further breakdown in this data model,
 *  so they don't get a popover — never fabricate a composition that isn't there. */
function siblingValuesAtMonth(rows, row, month) {
  return rows
    .filter((r) => r.key !== row.key && !r.isTotal)
    .map((r) => ({
      label: r.label,
      value: r.values[month] != null ? `$${Math.round(r.values[month]).toLocaleString('en-US')}` : '—',
    }));
}

/** Explains HOW a projected revenue cell's number came about — same idea as the
 *  hover note Kayee showed from another Fuel dashboard build ("Coach Rate, $/session
 *  — entered directly each month... not derived from other rows"). Only meaningful
 *  for a FORECAST cell (an actual month is just whatever the Google Sheet says, no
 *  calc to explain) on one of the three Assumptions-driven rows — every other cell
 *  returns null and renders as plain text, same as before. */
function revenueCalcExplanation(rowKey, revenue, iso) {
  if (!revenue) return null;
  if (rowKey === 'revenue_subscription_revenue') {
    return {
      calcNote: 'Subscription Revenue = # of Campaigns × Upfront Rate. Both editable on the Assumptions tab.',
      components: [
        { label: '# of Campaigns', value: campaignsForMonth(revenue, iso).toLocaleString('en-US') },
        { label: 'Upfront Rate', value: `$${Number(revenue.upfrontRate).toLocaleString('en-US')}` },
      ],
    };
  }
  if (rowKey === 'revenue_transaction_revenue') {
    const hasManualEntry = revenue.meetingsByMonth[iso] != null;
    return {
      calcNote: hasManualEntry
        ? 'Transaction Revenue = # of Meetings × Per Meeting Rate. Meetings entered directly for this month — editable on the Assumptions tab.'
        : `Transaction Revenue = # of Meetings × Per Meeting Rate. No Meetings figure entered for this month yet, so it's auto-suggested as round(Meeting Conversion% × Campaigns from ${revenue.meetingsLagMonths}mo ago) — editable on the Assumptions tab.`,
      components: [
        { label: '# of Meetings', value: meetingsForMonth(revenue, iso).toLocaleString('en-US') },
        { label: 'Per Meeting Rate', value: `$${Number(revenue.perMeetingRate).toLocaleString('en-US')}` },
      ],
    };
  }
  if (rowKey === 'total_revenue') {
    return {
      calcNote: `Total Revenue = Subscription $ + Transaction $, net of ${revenue.uncollectiblePct}% Uncollectible. Rates editable on the Assumptions tab.`,
      components: [
        { label: 'Subscription Revenue (gross)', value: `$${Math.round(upfrontRevenueForMonth(revenue, iso)).toLocaleString('en-US')}` },
        { label: 'Transaction Revenue (gross)', value: `$${Math.round(meetingRevenueForMonth(revenue, iso)).toLocaleString('en-US')}` },
      ],
    };
  }
  return null;
}

/** Same idea as revenueCalcExplanation, for the label-matched COGS/OpEx/margin rows
 *  (see PL_COST_PROJECTIONS_BY_LABEL above) — shows what actually fed the number
 *  instead of the generic same-section-siblings popover, since those siblings (the
 *  individual GL-category COGS lines) aren't populated by this projection and would
 *  otherwise show as a confusing wall of "—" under a real total. */
function costCalcExplanation(rowLabel, ctx, iso) {
  if (!ctx.revenue) return null;
  const cogs = cogsTotalForMonth(ctx.revenue, ctx.costItems, ctx.payrollState, iso);
  const opex = opexTotalForMonth(ctx.costItems, ctx.payrollState, iso);
  const totalRevenue = netCollectedRevenueForMonth(ctx.revenue, iso);
  const headcountCogs = ctx.payrollState
    ? headcountCostByCostType(ctx.payrollState.roster, ctx.payrollState.bonuses, ctx.payrollState.assumptions, 'CoGS', iso)
    : 0;
  const headcountOpex = ctx.payrollState
    ? headcountCostByCostType(ctx.payrollState.roster, ctx.payrollState.bonuses, ctx.payrollState.assumptions, 'OpEx', iso)
    : 0;
  const fmt = (n) => `$${Math.round(n).toLocaleString('en-US')}`;

  if (rowLabel === 'Total COGS') {
    return {
      calcNote: 'Total COGS = Cost Per Campaign + Non-Headcount Cost items tagged CoGS + Payroll headcount tagged CoGS. Editable on the Assumptions and Payroll tabs.',
      components: [
        { label: 'Cost Per Campaign', value: fmt(costPerCampaignForMonth(ctx.revenue, iso)) },
        { label: 'Non-Headcount Costs (CoGS)', value: fmt(costItemsTotalForMonth(ctx.costItems, 'CoGS', iso)) },
        { label: 'Payroll Headcount (CoGS)', value: fmt(headcountCogs) },
      ],
    };
  }
  if (['Total OpEx', 'Total OPEX', 'Total Operating Expenses'].includes(rowLabel)) {
    return {
      calcNote: 'Total OpEx = Non-Headcount Cost items tagged OpEx + Payroll headcount tagged OpEx. Editable on the Assumptions and Payroll tabs.',
      components: [
        { label: 'Non-Headcount Costs (OpEx)', value: fmt(costItemsTotalForMonth(ctx.costItems, 'OpEx', iso)) },
        { label: 'Payroll Headcount (OpEx)', value: fmt(headcountOpex) },
      ],
    };
  }
  if (['Gross Profit', 'Gross Margin'].includes(rowLabel)) {
    return {
      calcNote: 'Gross Profit = Total Revenue − Total COGS.',
      components: [
        { label: 'Total Revenue', value: fmt(totalRevenue) },
        { label: 'Total COGS', value: fmt(cogs) },
      ],
    };
  }
  if (['Operating Profit', 'Operating Income', 'Operating Margin'].includes(rowLabel)) {
    return {
      calcNote: 'Operating Profit = Total Revenue − Total COGS − Total OpEx.',
      components: [
        { label: 'Total Revenue', value: fmt(totalRevenue) },
        { label: 'Total COGS', value: fmt(cogs) },
        { label: 'Total OpEx', value: fmt(opex) },
      ],
    };
  }
  if (rowLabel === 'Cost of campaigns') {
    return {
      calcNote: "Cost of campaigns = last month's # of Campaigns × Cost Per Campaign rate. Both editable on the Assumptions tab.",
      components: [
        { label: 'Campaigns (last month)', value: campaignsForMonth(ctx.revenue, prevMonth(iso, 1)).toLocaleString('en-US') },
        { label: 'Cost Per Campaign Rate', value: fmt(Number(ctx.revenue.campaignCostRate) || 0) },
      ],
    };
  }
  const matchedItem = matchCostItemToRowLabel(rowLabel, ctx.costItems);
  if (matchedItem) {
    return {
      calcNote: `Same figure as the "${matchedItem.name}" cost item on the Assumptions tab (${matchedItem.category}) — shown on this line since it's the same cost. Edit the amount there.`,
      components: [{ label: `${matchedItem.name} (Assumptions)`, value: fmt(costItemAmountForMonth(matchedItem, iso)) }],
    };
  }
  return null;
}

/** Finds the Assumptions cost item (if any) that feeds a given real P&L row — an
 *  explicit COST_ITEM_ROW_LABEL_OVERRIDES entry always wins (for confirmed name
 *  mismatches like Travel -> "Total Travel"); otherwise falls back to an exact,
 *  case-insensitive name match (e.g. a "Rent" cost item auto-matches a real "Rent"
 *  row with zero extra config) — a safe default since an exact name match is about as
 *  strong a "these are the same thing" signal as this data model can give without a
 *  dedicated GL-account-id field on either side. */
function matchCostItemToRowLabel(rowLabel, costItems) {
  if (!costItems || !rowLabel) return null;
  const overrideId = Object.keys(COST_ITEM_ROW_LABEL_OVERRIDES).find((id) => COST_ITEM_ROW_LABEL_OVERRIDES[id] === rowLabel);
  if (overrideId) return costItems.find((i) => i.id === overrideId) || null;
  const target = rowLabel.trim().toLowerCase();
  return costItems.find((i) => (i.name || '').trim().toLowerCase() === target) || null;
}

/** Returns `statement.rows` unchanged, except any row in PL_REVENUE_PROJECTIONS gets
 *  its PROJECTED months (index > lastActualIndex) filled from the Assumptions tab's
 *  live state instead of left blank. Actual months are never touched — only indices
 *  past the real data get patched, and only for the PL statement (CF/BS are
 *  untouched; only Revenue is modeled today, per Kayee's "structure first" build). */
function withRevenueProjections(statement, months, lastActualIndex, revenue) {
  if (statement.type !== 'PL' || !revenue) return statement.rows;
  return statement.rows.map((row) => {
    const projectFn = PL_REVENUE_PROJECTIONS[row.key];
    if (!projectFn) return row;
    const patchedValues = { ...row.values };
    for (let i = lastActualIndex + 1; i < months.length; i++) {
      patchedValues[months[i]] = projectFn(revenue, months[i]);
    }
    return { ...row, values: patchedValues };
  });
}

/** Same idea as withRevenueProjections, matched by row LABEL instead of row.key (see
 *  PL_COST_PROJECTIONS_BY_LABEL for why) — Total COGS/OpEx and the margin rows
 *  derived from them (2026-08-06, Kayee: "you should have cogs payroll from the
 *  payroll tab and the expenses from assumptions... did you link it?" — this is that
 *  link). `rows` here is already the output of withRevenueProjections, so Total
 *  Revenue is already patched before Gross Profit/Operating Profit read it. */
function withCostProjections(statementType, rows, months, lastActualIndex, ctx) {
  if (statementType !== 'PL' || !ctx.revenue) return rows;
  return rows.map((row) => {
    const projectFn = PL_COST_PROJECTIONS_BY_LABEL[row.label];
    if (!projectFn) return row;
    const patchedValues = { ...row.values };
    for (let i = lastActualIndex + 1; i < months.length; i++) {
      patchedValues[months[i]] = projectFn(ctx, months[i]);
    }
    return { ...row, values: patchedValues };
  });
}

/** Patches every Assumptions cost item that matches an EXISTING real P&L row (via
 *  matchCostItemToRowLabel — either an explicit override or an exact name match, e.g.
 *  Rent -> Rent) directly onto that row, instead of adding a new one — for cost items
 *  that are literally the same line as something already on the sheet, just possibly
 *  named differently on Assumptions (2026-08-06: Software, Travel, Team Lunches).
 *  Same forecast-only rule as everything else here. Returns { rows, matchedIds } —
 *  matchedIds is used by withCustomAccountRows below so a matched item never ALSO
 *  shows up as a duplicate new row. */
function withNamedCostItemProjections(statementType, rows, costItems, months, lastActualIndex) {
  if (statementType !== 'PL' || !costItems || costItems.length === 0) return { rows, matchedIds: new Set() };
  const matchedIds = new Set();
  const patchedRows = rows.map((row) => {
    // Not excluding isTotal here on purpose — "Travel" maps onto a real "Total Travel"
    // row (2026-08-06: "Travel is the total travel"), which is itself a section total,
    // not a leaf line. `row.custom` IS excluded so this can never match onto a row we
    // ourselves injected (this runs before that injection anyway, but harmless either way).
    if (row.custom) return row;
    const item = matchCostItemToRowLabel(row.label, costItems);
    if (!item) return row;
    matchedIds.add(item.id);
    const patchedValues = { ...row.values };
    for (let i = lastActualIndex + 1; i < months.length; i++) {
      patchedValues[months[i]] = costItemAmountForMonth(item, months[i]);
    }
    return { ...row, values: patchedValues };
  });
  return { rows: patchedRows, matchedIds };
}

/** First matching section name that's actually present in this statement's real rows —
 *  never invents a section that isn't there. Case-insensitive (2026-08-06 fix): section
 *  band text always renders uppercase on screen via CSS (`tbody tr.section td {
 *  text-transform: uppercase }`), which made it look like "OPERATING EXPENSES" should've
 *  matched when it actually didn't — the underlying raw string from the sheet can be
 *  any case, and the alias list was being compared exact-case against it. Returns the
 *  REAL raw section string (not the alias) so injected custom rows carry the exact
 *  value everything else groups by. */
function findPresentSection(sectionsPresent, aliases) {
  if (!Array.isArray(aliases)) return null;
  const upperAliases = aliases.map((a) => a.toUpperCase());
  for (const raw of sectionsPresent) {
    if (upperAliases.includes(String(raw).toUpperCase())) return raw;
  }
  return null;
}

function buildCustomAccountRow(item, section, months, lastActualIndex) {
  const values = {};
  // Forecast-only, same rule as Hampton's original (never masks a real booked GL
  // month) — a custom account has no GL entry of its own, so actual months stay "—".
  for (let i = lastActualIndex + 1; i < months.length; i++) {
    values[months[i]] = costItemAmountForMonth(item, months[i]);
  }
  return {
    key: `custom_cost_${item.id}`,
    label: item.name || 'Untitled',
    section,
    isTotal: false,
    custom: true,
    values,
  };
}

/** Ports Hampton's "Custom Accounts" pattern (custom-accounts-feature-reference.md,
 *  2026-08-06): every Non-Headcount Cost item Kayee has already created on the
 *  Assumptions tab shows up as its own named row in the matching COGS/OpEx section
 *  here, instead of only being folded into the Total. No new "create account" UI
 *  needed in Reports — Assumptions' existing "+ Add Cost" IS the creation flow; this
 *  just makes what's already created visible where the P&L actually lives. Reports
 *  stays read-only (unlike Hampton's inline-editable version) — editing still only
 *  happens on the Assumptions tab, one source of truth, no dual-edit risk.
 *
 *  Applied AFTER withNamedCostItemProjections, so it only ADDS visible rows for items
 *  that DIDN'T already find a real row home — it never changes Total COGS/Total OpEx's
 *  numbers (those already sum every cost item internally via cogsTotalForMonth/
 *  opexTotalForMonth), so there's no double-counting risk. */
function withCustomAccountRows(statementType, rows, costItems, months, lastActualIndex, matchedIds) {
  if (statementType !== 'PL' || !costItems || costItems.length === 0) return rows;
  const sectionsPresent = new Set(rows.map((r) => r.section));
  let next = rows;

  // Iterate whatever categories actually HAVE an alias list — not a hardcoded
  // ['CoGS', 'OpEx'] — so removing OpEx's alias list (2026-08-06, once it turned out
  // OpEx isn't one flat section) can't silently pass `undefined` to
  // findPresentSection's `.map` below and crash the whole app. This was the actual
  // root cause of the "Cannot read properties of undefined (reading 'map')" error —
  // every projection (including Revenue, which was never broken) got caught by the
  // try/catch in StatementDoc and fell back to blank, which is why forecast numbers
  // disappeared entirely rather than just the OpEx custom rows.
  for (const category of Object.keys(CUSTOM_ACCOUNT_SECTION_ALIASES)) {
    const section = findPresentSection(sectionsPresent, CUSTOM_ACCOUNT_SECTION_ALIASES[category]);
    if (!section) continue;
    // Skip any item already merged onto an existing real row by
    // withNamedCostItemProjections — otherwise it'd show up twice.
    const items = costItems.filter((i) => i.category === category && !matchedIds.has(i.id));
    if (items.length === 0) continue;

    // Insert right before this section's Total row (so custom rows sit below the
    // built-in GL line items, above the Total, same order Hampton uses) — falls back
    // to right after the section's last row if it has no Total row of its own.
    let insertAt = next.findIndex((r) => r.section === section && r.isTotal);
    if (insertAt === -1) {
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].section === section) {
          insertAt = i + 1;
          break;
        }
      }
    }
    if (insertAt === -1) continue;

    const customRows = items.map((item) => buildCustomAccountRow(item, section, months, lastActualIndex));
    next = [...next.slice(0, insertAt), ...customRows, ...next.slice(insertAt)];
  }
  return next;
}

/** Explains a custom account row — there's no further breakdown (it's a single
 *  user-entered $ figure, same as a MonthInput cell on Assumptions), so this is just a
 *  pointer back to where it's actually edited, not a components list. */
function customAccountCalcExplanation(row) {
  return {
    calcNote: `"${row.label}" is a custom account entered on the Assumptions tab's Non-Headcount Costs table — edit it there. It's already included in this section's Total.`,
    components: [],
  };
}

function StatementDoc({ statement, range }) {
  const { state: assumptionsState, hydrated: assumptionsHydrated } = useAssumptionsState();
  const { state: payrollState, hydrated: payrollHydrated } = usePayrollState();

  if (!statement) return <div className="cap">No data for this statement yet.</div>;
  // currentMonth = the last ACTUAL month (before any blank padding), so "active-col"
  // still marks the latest real reporting month, not the padded 2030 horizon.
  const currentMonth = statement.months[statement.months.length - 1];
  const months = extendMonthsThrough(statement.months, PROJECTION_HORIZON);
  const lastActualIndex = statement.months.length - 1;
  const revenue = assumptionsHydrated ? assumptionsState?.revenue : null;
  const costCtx = {
    revenue,
    costItems: assumptionsHydrated ? assumptionsState?.costItems || [] : [],
    payrollState: payrollHydrated ? payrollState : null,
  };
  // Every projection step below is derived from whatever's saved in THIS browser's
  // Assumptions/Payroll localStorage — this Reports panel mounts unconditionally
  // alongside every other tab (design note at the top of DashboardApp.jsx), so an
  // uncaught error anywhere in this pipeline would crash the ENTIRE app on every page
  // load, not just Reports (already hit once, 2026-08-06). Each step is guarded
  // SEPARATELY (not one big try/catch around all four) — a bug in the newer
  // custom-account logic should never also wipe out Revenue's projection, which has
  // worked correctly since 2026-08-04. This is exactly the regression that happened
  // once already today: a bug in withCustomAccountRows made every step's result
  // (including Revenue's) fall back to blank, because one shared try/catch treated a
  // failure anywhere as a failure everywhere.
  let rows = statement.rows;
  try {
    rows = withRevenueProjections(statement, months, lastActualIndex, revenue);
  } catch (err) {
    console.warn('Revenue forecast projection failed, showing unprojected data:', err);
  }
  try {
    rows = withCostProjections(statement.type, rows, months, lastActualIndex, costCtx);
  } catch (err) {
    console.warn('COGS/OpEx total forecast projection failed:', err);
  }
  try {
    const { rows: namedItemRows, matchedIds } = withNamedCostItemProjections(
      statement.type,
      rows,
      costCtx.costItems,
      months,
      lastActualIndex
    );
    rows = withCustomAccountRows(statement.type, namedItemRows, costCtx.costItems, months, lastActualIndex, matchedIds);
  } catch (err) {
    console.warn('Custom cost-item row projection failed:', err);
  }

  return (
    // "report-doc" (not just "table-wrap") is what the range-toggle CSS below actually
    // targets (`#reports[data-range] .report-doc:not([data-doc="custom"])`) — without it
    // the 6M/12M/24M/∞ buttons change `data-range` but nothing was ever selected by it.
    <div id="reports" data-range={range} className="table-wrap report-doc" data-doc={statement.type}>
      <table>
        <thead>
          <tr className="report-year-row">
            <th></th>
            {months.map((m, i) => {
              // One real cell per month — same column model as the row below, so a
              // range-toggle hide can never desync the two rows (a colSpan cell
              // here previously caused exactly that: see 2026-08-04 bug where a
              // hidden month left this row's year label sitting over the wrong
              // column). Only the first month of each year run shows the year
              // text; every cell in that run shares the same background, so
              // consecutive same-year cells still read as one continuous band.
              const year = m.slice(0, 4);
              const isFirstOfYear = i === 0 || months[i - 1].slice(0, 4) !== year;
              return (
                <th key={m} className={rangeClasses(i, lastActualIndex, m)}>
                  {isFirstOfYear ? year : ''}
                </th>
              );
            })}
          </tr>
          <tr>
            <th>Account / Line Item</th>
            {months.map((m, i) => {
              const isForecast = i > lastActualIndex;
              return (
                <th
                  key={m}
                  className={`${rangeClasses(i, lastActualIndex, m)}${m === currentMonth ? ' active-col' : ''}${isForecast ? ' pr-fcst' : ''}`}
                >
                  <div className="report-month-label">{formatMonthLabel(m)}</div>
                  <div className={`report-month-status${isForecast ? ' fcst' : ''}`}>
                    {isForecast ? 'FCST' : 'ACT'}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {groupBySection(rows).map(([section, sectionRows]) => (
            <FragmentRows
              key={section}
              section={section}
              rows={sectionRows}
              months={months}
              currentMonth={currentMonth}
              lastActualIndex={lastActualIndex}
              revenue={revenue}
              costCtx={costCtx}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FragmentRows({ section, rows, months, currentMonth, lastActualIndex, revenue, costCtx }) {
  return (
    <>
      {/* Two cells, not one colSpan cell — position:sticky on a <td> with colspan doesn't
          reliably stick in table layout (a well-known cross-browser limitation), which
          was letting the section band's label scroll away with the rest of the row. A
          real single-column first cell sticks the same way a normal data row's does. */}
      <tr className="section">
        <td>{section}</td>
        <td colSpan={months.length}></td>
      </tr>
      {rows.map((row) => (
        <tr key={row.key} className={row.isTotal ? 'total' : undefined}>
          <td>{row.label}</td>
          {months.map((m, i) => {
            const cellText = row.values[m] != null ? `$${Math.round(row.values[m]).toLocaleString('en-US')}` : '—';
            const isForecast = i > lastActualIndex;
            // Same defensive rule as the row pipeline above (StatementDoc) — a bad
            // calc-note lookup should never crash the whole app, just fall back to
            // plain cell text for that one cell.
            let calcInfo = null;
            if (isForecast) {
              try {
                calcInfo =
                  revenueCalcExplanation(row.key, revenue, m) ||
                  costCalcExplanation(row.label, costCtx, m) ||
                  (row.custom ? customAccountCalcExplanation(row) : null);
              } catch (err) {
                console.warn('Reports calc-note lookup failed for a cell, showing plain value:', err);
              }
            }
            return (
              <td
                key={m}
                className={`${rangeClasses(i, lastActualIndex, m)}${m === currentMonth ? ' active-col' : ''}${isForecast ? ' pr-fcst' : ''}`}
              >
                {calcInfo ? (
                  <DrillPopover
                    label={row.label}
                    value={cellText}
                    components={calcInfo.components}
                    calcNote={calcInfo.calcNote}
                  />
                ) : row.isTotal && row.values[m] != null ? (
                  <DrillPopover label={row.label} value={cellText} components={siblingValuesAtMonth(rows, row, m)} />
                ) : (
                  cellText
                )}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}

function groupBySection(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.section)) map.set(row.section, []);
    map.get(row.section).push(row);
  }
  return Array.from(map.entries());
}

function CustomReportsList({ reports }) {
  if (!reports || reports.length === 0) {
    return <div className="cap">No custom reports saved yet — build one from the Custom tab.</div>;
  }
  return (
    <div className="table-wrap" style={{ padding: '4px 0' }}>
      {reports.map((r) => (
        <div key={r.id} className="toolbar" style={{ padding: '12px 18px', margin: 0 }}>
          <div>
            <b>{r.name}</b>
            <div className="cap">
              {r.generatedAt} · <span className={`health-badge ${STATUS_CLASS[r.status] ?? ''}`}>{r.status}</span>
            </div>
          </div>
          <button className="btn">Export</button>
        </div>
      ))}
    </div>
  );
}
