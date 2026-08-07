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
} from '../../lib/assumptions/assumptionsData';

// Which Reports section a custom cost item's category rolls up under — matched by the
// live sheet's own `section` string (read verbatim, same as row.key/label — see
// lib/data/sources/googleSheets.ts), with a few common aliases for OpEx since only
// "COGS" has been directly confirmed from a screenshot so far (2026-08-06). A category
// with no matching section present just doesn't get individual rows (safe no-op) —
// its $ still counts in Total COGS/OpEx either way (see cogsTotalForMonth/
// opexTotalForMonth above), so nothing is ever silently missing from the totals, only
// from the optional per-item breakdown.
const CUSTOM_ACCOUNT_SECTION_ALIASES = {
  CoGS: ['COGS'],
  OpEx: ['OPEX', 'OPERATING EXPENSES', 'OPERATING EXPENSE', 'OPEX & OTHER', 'SG&A', 'OPERATING COSTS', 'OPERATING EXPENSES (OPEX)'],
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
  // just to see this year's forecast. "Historical" (6M/12M/24M/∞, all anchored to the
  // last actual month like before) is still one click away in the same toggle group.
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
                together) — everything after it is grouped under one "Historical" label
                since they all anchor to trailing windows off the last actual month
                instead of a fixed calendar year (Kayee, 2026-08-06: "default to the full
                year of 2026 ... if I want to go to historical I click another toggle"). */}
            <button className={range === 'yr2026' ? 'active' : undefined} onClick={() => setRange('yr2026')}>
              2026
            </button>
            <span className="seg-divider" />
            <span className="seg-group-label">Historical</span>
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

/** r6/r12/r24 must anchor to the last ACTUAL month, never to however far the blank
 *  2030 padding stretches — otherwise "6M" silently drifts to mean "the last 6
 *  padded/blank columns" the moment padding is added, which is exactly the bug Kayee
 *  hit (2026-08-04: switching to ∞ then back to 6M showed blank Dec-2030 columns
 *  instead of real recent months). fromEnd is 0 at the last actual month, negative
 *  for every padded month after it — negative values never satisfy any `< N` check
 *  below, so padded months correctly never carry r6/r12/r24, only r-all. */
function rangeClasses(monthIndex, lastActualIndex, month) {
  const fromEnd = lastActualIndex - monthIndex;
  const classes = ['r-all'];
  if (fromEnd >= 0 && fromEnd < 24) classes.push('r24');
  if (fromEnd >= 0 && fromEnd < 12) classes.push('r12');
  if (fromEnd >= 0 && fromEnd < 6) classes.push('r6');
  // Calendar-year tag (independent of how far back/forward this column is from the last
  // actual month) — what the "2026" default view's CSS actually filters on, since a
  // fixed calendar year isn't expressible as a trailing window off lastActualIndex.
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
  return null;
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

/** First matching section name that's actually present in this statement's real rows —
 *  never invents a section that isn't there. */
function findPresentSection(sectionsPresent, aliases) {
  for (const alias of aliases) {
    if (sectionsPresent.has(alias)) return alias;
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
 *  Applied AFTER withCostProjections, so it only ADDS visible rows — it never changes
 *  Total COGS/Total OpEx's numbers (those already sum every cost item internally via
 *  cogsTotalForMonth/opexTotalForMonth), so there's no double-counting risk. */
function withCustomAccountRows(statementType, rows, costItems, months, lastActualIndex) {
  if (statementType !== 'PL' || !costItems || costItems.length === 0) return rows;
  const sectionsPresent = new Set(rows.map((r) => r.section));
  let next = rows;

  for (const category of ['CoGS', 'OpEx']) {
    const section = findPresentSection(sectionsPresent, CUSTOM_ACCOUNT_SECTION_ALIASES[category]);
    if (!section) continue;
    const items = costItems.filter((i) => i.category === category);
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
  const revenueProjectedRows = withRevenueProjections(statement, months, lastActualIndex, revenue);
  const costProjectedRows = withCostProjections(statement.type, revenueProjectedRows, months, lastActualIndex, costCtx);
  const rows = withCustomAccountRows(statement.type, costProjectedRows, costCtx.costItems, months, lastActualIndex);

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
            const calcInfo = isForecast
              ? revenueCalcExplanation(row.key, revenue, m) ||
                costCalcExplanation(row.label, costCtx, m) ||
                (row.custom ? customAccountCalcExplanation(row) : null)
              : null;
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
