'use client';

import { useState, useMemo, useEffect } from 'react';
import { PageHead } from '../ui/PageHead';
import { DrillPopover } from '../ui/DrillPopover';
import { MonthInput } from '../payroll/PayrollTable';
import { PLAssumptionsSidebar } from '../reports/PLAssumptionsSidebar';
import { formatMonthLabel } from '../../lib/calc/dashboardMetrics';
import { useAssumptionsState } from '../../lib/assumptions/useAssumptionsState';
import { usePayrollState } from '../../lib/payroll/usePayrollState';
import { headcountCostByCostType } from '../../lib/payroll/payrollData';
import {
  upfrontRevenueForMonth,
  meetingRevenueForMonth,
  grossCollectedRevenueForMonth,
  netCollectedRevenueForMonth,
  campaignsForMonth,
  meetingsForMonth,
  costPerCampaignForMonth,
  costItemsTotalForMonth,
  costItemAmountForMonth,
  toggleCampaignActualOverride,
  generateId,
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
 *  sum of both streams, net of the Risk Buffer % (2026-08-10 reinstated, reversing the
 *  2026-08-07 "accrual only" cut — Kayee's real sheet screenshot showed the actual
 *  formula: `=(Upfront$+Meeting$) - ((Upfront$+Meeting$)*RiskBuffer%)`, i.e. Gross
 *  Collected Revenue on the sheet already nets this out, it isn't a separate
 *  Cash-Flow-only adjustment the way the earlier correction assumed. Renamed
 *  Uncollectible % -> Risk Buffer per Kayee's own naming, same day). This is exactly
 *  `netCollectedRevenueForMonth` in assumptionsData.js; `grossCollectedRevenueForMonth`
 *  (pre-haircut) is kept only as an internal building block now, not used directly by
 *  any P&L row. These exact key names are transcribed from Kayee's live PL sheet
 *  (2026-08-04 screenshots) — if the sheet's Key column for these rows ever changes,
 *  this silently stops projecting (the row just shows "—" again) rather than
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
  // Net of Risk Buffer % now (2026-08-10 reinstated — see PL_REVENUE_PROJECTIONS'
  // header comment for the full story), matching every downstream margin/profit line
  // on Kayee's real sheet, all of which build on top of the SAME net-of-risk-buffer
  // "Gross Collected Revenue" figure.
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
 * Range toggle (2026-2028 default / Historical) is CSS-driven, not a refetch:
 * `statements` here already holds the full actual range for each statement (fetched
 * once, server-side) plus blank padding columns through PROJECTION_HORIZON —
 * switching range only changes the `data-range` attribute, which globals.css uses to
 * hide month columns tagged outside that range. The always-visible label column never
 * carries a year class, so the design-rules.md "never hide row labels" rule holds by
 * construction, not by convention.
 */
export function ReportsPanel({ statements, customReports }) {
  const [reportType, setReportType] = useState('PL');
  // Defaults to Jan-2026 through Dec-2028 (2026-08-07 rewrite, Kayee: "show 2026 and up
  // until end of 2028 as default... if I want to see historical let me select
  // historical and it will show everything") — replaces the earlier 2026/6M/12M/24M/∞
  // toggle group with just these two states. "default" is the 3-year forward-looking
  // landing view; "all" shows every month, actual and projected, with nothing hidden.
  const [range, setRange] = useState('default');

  // Lifted up from StatementDoc (2026-08-06) so the P&L Assumptions sidebar and the
  // table itself share ONE Assumptions state instead of each reading their own copy —
  // Kayee: "merge assumption into reports... so that everything is being in the same
  // place, no need to switch between assumption and P&L." Sidebar defaults open so the
  // merge is visible immediately; collapses to a slim rail when not needed, per Kayee's
  // "like a lot of major websites... hide it into a hamburger."
  const { state: assumptionsState, setState: setAssumptionsState, hydrated: assumptionsHydrated } = useAssumptionsState();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Auto-scroll the page while dragging a cost item (2026-08-10, Kayee: "i try to
  // drag rent to rent in p&l but it's too far to the bottom... make the drag also
  // scroll when i put it to the bottom of the page"). The P&L table has no internal
  // scrollbar of its own while the Assumptions sidebar is open — `max-height: none`
  // on .table-wrap in that layout lets it grow to full length and the PAGE scrolls
  // instead (see globals.css) — so this listens on the whole document, not just the
  // table, and scrolls the window itself. `dragover` is the only drag event that
  // fires repeatedly while the pointer holds still near an edge (browsers re-fire it
  // on a UA-defined interval for exactly this purpose), which is what makes a
  // continuous auto-scroll possible without any extra timers. Mounted once for the
  // whole panel's lifetime — completely inert outside of an actual drag, so there's
  // no cost to leaving it attached when nothing's being dragged.
  useEffect(() => {
    const EDGE = 90; // px from the top/bottom viewport edge that starts scrolling
    const MAX_SPEED = 26; // px scrolled per dragover tick, right at the very edge
    function handleDragOver(e) {
      const y = e.clientY;
      const vh = window.innerHeight;
      if (y < EDGE) {
        window.scrollBy(0, -MAX_SPEED * (1 - y / EDGE));
      } else if (y > vh - EDGE) {
        window.scrollBy(0, MAX_SPEED * (1 - (vh - y) / EDGE));
      }
    }
    document.addEventListener('dragover', handleDragOver);
    return () => document.removeEventListener('dragover', handleDragOver);
  }, []);

  const showSidebar = reportType === 'PL';

  // Non-Headcount Costs display order, matching their real P&L row positions
  // (2026-08-07, Kayee: "make this align with what they actually are"). Recomputed
  // whenever the P&L statement or cost items change; null (fall back to stored order)
  // until both are actually available.
  const costItemOrder = useMemo(
    () => computeCostItemOrder(statements?.PL, assumptionsHydrated ? assumptionsState?.costItems : null),
    [statements, assumptionsState, assumptionsHydrated]
  );

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
            {/* Two states only (2026-08-07 rewrite): the 3-year default landing view,
                and Historical — everything, actual and forecast alike, no filtering. */}
            <button className={range === 'default' ? 'active' : undefined} onClick={() => setRange('default')}>
              2026 – 2028
            </button>
            <button className={range === 'all' ? 'active' : undefined} onClick={() => setRange('all')}>
              Historical
            </button>
          </div>
        )}
      </div>

      {/* Legend (2026-08-07, Kayee: "give user an indicator on what cell is
          editable") — the blue box style is otherwise unexplained the first time
          someone sees it; this makes explicit what's a real input vs. a computed or
          booked figure. P&L-only, since CF/BS/Custom have no editable cells yet. */}
      {reportType === 'PL' && (
        <div className="report-legend">
          <span className="report-legend-item">
            <span className="report-legend-swatch report-legend-swatch-editable" />
            Editable input
          </span>
          <span className="report-legend-item">
            <span className="report-legend-swatch report-legend-swatch-formula" />
            From formula / actuals
          </span>
        </div>
      )}

      {/* Wide wrapper — same treatment as Payroll's tables (globals.css .page-wide),
          so every wide-table tab behaves consistently (Kayee, 2026-08-05: "all pages
          needs to be consistant"). Toolbar/PageHead above stay at the normal page width. */}
      <div className={`page-wide${showSidebar && !sidebarCollapsed ? ' page-wide-reports-open' : ''}`}>
        {reportType === 'custom' ? (
          <CustomReportsList reports={customReports} />
        ) : showSidebar ? (
          // P&L only, for now (Kayee, 2026-08-06: "we work on P&L first") — a 30/70
          // split when the Assumptions sidebar is open, collapsing back to today's
          // full-width table (the exact same StatementDoc, unchanged) when it's
          // hidden into the hamburger rail. The wrapper above also picks up
          // .page-wide-reports-open while expanded (2026-08-07, Kayee: "use the space
          // on the left and right") so this view alone can borrow the gutter room the
          // normal .page-wide cap reserves everywhere else, instead of squeezing the
          // Non-Headcount Costs table into a narrower column than it needs.
          <div className={`reports-with-sidebar${sidebarCollapsed ? ' is-collapsed' : ''}`}>
            <PLAssumptionsSidebar
              collapsed={sidebarCollapsed}
              onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
              revenue={assumptionsHydrated ? assumptionsState?.revenue : null}
              costItems={assumptionsHydrated ? assumptionsState?.costItems : null}
              onRevenueChange={(revenue) => assumptionsState && setAssumptionsState({ ...assumptionsState, revenue })}
              onCostItemsChange={(costItems) => assumptionsState && setAssumptionsState({ ...assumptionsState, costItems })}
              costItemOrder={costItemOrder}
            />
            <div className="reports-main">
              <StatementDoc
                statement={statements[reportType]}
                range={range}
                assumptionsState={assumptionsState}
                setAssumptionsState={setAssumptionsState}
                assumptionsHydrated={assumptionsHydrated}
              />
            </div>
          </div>
        ) : (
          <StatementDoc
            statement={statements[reportType]}
            range={range}
            assumptionsState={assumptionsState}
            setAssumptionsState={setAssumptionsState}
            assumptionsHydrated={assumptionsHydrated}
          />
        )}
      </div>
    </>
  );
}

/** Every column always carries `.r-all` (data-range="all"/Historical has no hide rule
 *  at all, see globals.css) plus its own calendar-year tag `.y<year>` — what the
 *  default 2026-2028 view's CSS actually filters on (2026-08-07 rewrite; the old
 *  6M/12M/24M trailing-window classes off `lastActualIndex` are gone along with those
 *  toggle buttons). `lastActualIndex`/`monthIndex` are unused now but left as params so
 *  every call site below doesn't need touching. */
function rangeClasses(monthIndex, lastActualIndex, month) {
  const classes = ['r-all'];
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
    .filter((r) => r.key !== row.key && !r.isTotal && !r.driver)
    .map((r) => ({
      label: r.label,
      value: r.values[month] != null ? `$${Math.round(r.values[month]).toLocaleString('en-US')}` : '—',
    }));
}

/** Explains HOW a projected revenue cell's number came about — same idea as the
 *  hover note Kayee showed from another Fuel dashboard build ("Coach Rate, $/session
 *  — entered directly each month... not derived from other rows"). Only meaningful
 *  for a FORECAST cell (an actual month is just whatever the Google Sheet says, no
 *  calc to explain) on one of the three Assumptions-driven rows — every other row
 *  returns null and gets no popover at all, same as before.
 *
 *  2026-08-07: moved from a per-month-cell popover to a single popover on the row's
 *  label (see FragmentRows) — Kayee: "the hover over explanation on the calculation
 *  only needs to appear once at the account title." Also dropped the `components`
 *  breakdown of actual computed $ figures entirely per the same follow-up ("the hover
 *  over calculation explanation only show the formula, no need to show the real
 *  numbers") — this is now pure formula text, independent of which month you're
 *  looking at (no `iso` param anymore), not a per-cell calculation receipt. */
function revenueCalcExplanation(rowKey, revenue) {
  if (!revenue) return null;
  if (rowKey === 'revenue_subscription_revenue') {
    return { calcNote: 'Subscription Revenue = # of Campaigns × Upfront Rate. Both editable on the Assumptions tab.' };
  }
  if (rowKey === 'revenue_transaction_revenue') {
    return {
      calcNote:
        'Transaction Revenue = # of Meetings × Per Meeting Rate. If Meetings isn\'t entered for a month, it\'s auto-suggested as round(Meeting Conversion% × Campaigns from N months ago) — editable on the Assumptions tab.',
    };
  }
  if (rowKey === 'total_revenue') {
    return {
      calcNote:
        'Total Revenue = (Subscription $ + Transaction $) − Risk Buffer % of that sum — same net-of-risk figure as "Gross Collected Revenue" on the real sheet. Risk Buffer % editable on the Assumptions tab.',
    };
  }
  // The embedded driver rows (2026-08-07, Kayee: "# of meeting should also show how
  // the calculation come about as well the meeting conversion time and stuff") — same
  // formula-only convention as every other calc-note here (see file header note on
  // 2026-08-07: no live numbers, just the formula), just attached to these two rows
  // too now that they sit in the P&L instead of only on the Assumptions tab.
  if (rowKey === '__driver_meetings') {
    return {
      calcNote:
        '# of Meetings = round(Meeting Conversion% × # of Campaigns from Meeting Conversion Time months ago) — always a formula for forecast months, never typed in directly. Both rates editable on the Assumptions tab.',
    };
  }
  if (rowKey === '__driver_campaigns') {
    return {
      calcNote:
        '# of Campaigns is the one manual driver here — type a forecast month\'s count directly into its blue box. An actual month has a hamburger toggle to switch it to projection too, so a real count can replace a hardcoded default that\'s feeding # of Meetings\' lag calculation.',
    };
  }
  return null;
}

/** Same idea as revenueCalcExplanation, for the label-matched COGS/OpEx/margin rows
 *  (see PL_COST_PROJECTIONS_BY_LABEL above) — formula-only text on the row label, no
 *  `iso` and no computed component numbers (2026-08-07, same follow-up as above). */
function costCalcExplanation(rowLabel, ctx) {
  if (!ctx.revenue) return null;
  if (rowLabel === 'Total COGS') {
    return { calcNote: 'Total COGS = Cost Per Campaign + Non-Headcount Cost items tagged CoGS + Payroll headcount tagged CoGS. Editable on the Assumptions and Payroll tabs.' };
  }
  if (['Total OpEx', 'Total OPEX', 'Total Operating Expenses'].includes(rowLabel)) {
    return { calcNote: 'Total OpEx = Non-Headcount Cost items tagged OpEx + Payroll headcount tagged OpEx. Editable on the Assumptions and Payroll tabs.' };
  }
  if (['Gross Profit', 'Gross Margin'].includes(rowLabel)) {
    return { calcNote: 'Gross Profit = Total Revenue − Total COGS.' };
  }
  if (['Operating Profit', 'Operating Income', 'Operating Margin'].includes(rowLabel)) {
    return { calcNote: 'Operating Profit = Total Revenue − Total COGS − Total OpEx.' };
  }
  if (rowLabel === 'Cost of campaigns') {
    return { calcNote: "Cost of campaigns = last month's # of Campaigns × Cost Per Campaign rate. Both editable on the Assumptions tab." };
  }
  const matchedItem = matchCostItemToRowLabel(rowLabel, ctx.costItems);
  if (matchedItem) {
    return { calcNote: `Same figure as the "${matchedItem.name}" cost item on the Assumptions tab (${matchedItem.category}) — shown on this line since it's the same cost. Edit the amount there.` };
  }
  return null;
}

/** Finds the Assumptions cost item (if any) that feeds a given real P&L row.
 *
 *  Priority order, highest first:
 *   1. `linkedRowLabel` — an explicit drag-and-drop link Kayee made by hand on the
 *      Reports tab (2026-08-10: "give me the option to drag and drop to match thing
 *      so that you dont have to worry about mapping and if the users want to do it
 *      they could"). Deterministic and immune to text drift — the root cause traced
 *      down that same day was that the "Rent" cost item silently stopped
 *      case-insensitive-matching its real "Rent" row (a stray character or a raw
 *      sheet-label quirk that plain `.trim().toLowerCase()` can't fix), and there was
 *      no way to just tell the app "this one, that one" directly. This link always
 *      wins over any guess below, once it exists.
 *   2. COST_ITEM_ROW_LABEL_OVERRIDES — confirmed name mismatches (Travel -> "Total
 *      Travel", etc.) baked into the code.
 *   3. An exact, case-insensitive name match (e.g. a "Rent" cost item auto-matches a
 *      real "Rent" row with zero extra config) — a reasonable default, but per the
 *      above, not bulletproof; #1 exists specifically so a person can route around a
 *      case where this guess turns out to be wrong or fragile. */
function matchCostItemToRowLabel(rowLabel, costItems) {
  if (!costItems || !rowLabel) return null;
  const linked = costItems.find((i) => i.linkedRowLabel === rowLabel);
  if (linked) return linked;
  const overrideId = Object.keys(COST_ITEM_ROW_LABEL_OVERRIDES).find((id) => COST_ITEM_ROW_LABEL_OVERRIDES[id] === rowLabel);
  if (overrideId) return costItems.find((i) => i.id === overrideId) || null;
  const target = rowLabel.trim().toLowerCase();
  return costItems.find((i) => (i.name || '').trim().toLowerCase() === target) || null;
}

/** Orders the Non-Headcount Costs list to match where each item actually lands on the
 *  P&L (2026-08-07, Kayee: "can you make this align with what they actually are? like
 *  rent should be next to the line right"). Returns an array of cost-item ids in
 *  display order, or null when there's nothing to sort by (no statement yet, wrong
 *  statement type, or no cost items) — CostItemsCard falls back to stored order in
 *  that case.
 *
 *  Two kinds of items land on the P&L, at two different points, so this walks the
 *  real rendered rows once and records both:
 *   1. Items that matched an existing named GL row (matchCostItemToRowLabel) — these
 *      sit exactly where that row sits.
 *   2. Items with no matching row of their own (withCustomAccountRows injects these
 *      right before their section's Total row) — mirrored here the same way, so a
 *      "Vetric" custom row sorts into the same slot it actually renders in.
 *  Anything left over (a section that isn't present in this statement at all) is
 *  appended at the end in its original order rather than dropped. */
function computeCostItemOrder(statement, costItems) {
  if (!statement || statement.type !== 'PL' || !costItems || costItems.length === 0) return null;

  const sectionsPresent = new Set(statement.rows.map((r) => r.section));
  const customSectionByCategory = {};
  for (const category of Object.keys(CUSTOM_ACCOUNT_SECTION_ALIASES)) {
    customSectionByCategory[category] = findPresentSection(sectionsPresent, CUSTOM_ACCOUNT_SECTION_ALIASES[category]);
  }

  const order = [];
  const seen = new Set();

  for (const row of statement.rows) {
    const matchedItem = matchCostItemToRowLabel(row.label, costItems);
    if (matchedItem && !seen.has(matchedItem.id)) {
      order.push(matchedItem.id);
      seen.add(matchedItem.id);
    }
    if (row.isTotal) {
      for (const category of Object.keys(customSectionByCategory)) {
        if (customSectionByCategory[category] !== row.section) continue;
        for (const item of costItems) {
          if (item.category === category && !seen.has(item.id)) {
            order.push(item.id);
            seen.add(item.id);
          }
        }
      }
    }
  }

  for (const item of costItems) {
    if (!seen.has(item.id)) order.push(item.id);
  }

  return order;
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

/** A user-added blank P&L line (2026-08-10, Kayee: "give me the ability to add a new
 *  account under each section so i can add other travel and drag travel there") — a
 *  placeholder in a real section the person picked themselves, with no built-in
 *  matching guesswork at all: it only ever shows a $ once a cost item is explicitly
 *  dragged onto it (see matchCostItemToRowLabel's `linkedRowLabel` priority and
 *  FragmentRows' drop handling in StatementDoc). Forecast-only, same rule as every
 *  other injected row — there's no real GL entry for a line that didn't exist on the
 *  actual sheet. */
function buildManualAccountRow(account, costItems, months, lastActualIndex) {
  const values = {};
  const item = matchCostItemToRowLabel(account.label, costItems);
  if (item) {
    for (let i = lastActualIndex + 1; i < months.length; i++) {
      values[months[i]] = costItemAmountForMonth(item, months[i]);
    }
  }
  return {
    key: `manual_account_${account.id}`,
    label: account.label,
    section: account.section,
    isTotal: false,
    manualAccount: true,
    linkedItemName: item ? item.name : null,
    values,
  };
}

/** Inserts every user-added manual account line into its own section, right before
 *  that section's Total row (same slot convention as buildCustomAccountRow) — falls
 *  back to right after the section's last row if it has no Total row. Unlike
 *  withCustomAccountRows, this needs no CUSTOM_ACCOUNT_SECTION_ALIASES guesswork at
 *  all: the section was captured verbatim from the real row the person clicked "+ Add
 *  account" under, so it's always already a section that's actually present. */
function withManualAccountRows(statementType, rows, customPLAccounts, costItems, months, lastActualIndex) {
  if (statementType !== 'PL' || !customPLAccounts || customPLAccounts.length === 0) return rows;
  let next = rows;
  for (const account of customPLAccounts) {
    let insertAt = next.findIndex((r) => r.section === account.section && r.isTotal);
    if (insertAt === -1) {
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].section === account.section) {
          insertAt = i + 1;
          break;
        }
      }
    }
    if (insertAt === -1) continue;
    const row = buildManualAccountRow(account, costItems, months, lastActualIndex);
    next = [...next.slice(0, insertAt), row, ...next.slice(insertAt)];
  }
  return next;
}

/** Explains a custom account row — there's no further breakdown (it's a single
 *  user-entered $ figure, same as a MonthInput cell on Assumptions), so this is just a
 *  pointer back to where it's actually edited, not a components list. */
function customAccountCalcExplanation(row) {
  if (row.manualAccount) {
    const linkedNote = row.linkedItemName
      ? `Currently fed by the "${row.linkedItemName}" cost item on the Assumptions tab.`
      : 'Nothing linked yet — drag a Non-Headcount Cost item from the sidebar and drop it on this row.';
    return {
      calcNote: `"${row.label}" is a line you added by hand. ${linkedNote} It's already included in this section's Total.`,
    };
  }
  return {
    calcNote: `"${row.label}" is a custom account entered on the Assumptions tab's Non-Headcount Costs table — edit it there. It's already included in this section's Total.`,
    components: [],
  };
}

/** ACTUAL months show NOTHING for the driver row (2026-08-07, Kayee: "where did you
 *  get these numbers, if it's not from actual don't show" — spotted on a screenshot of
 *  Jan-May 2026, all ACT columns). campaignsByMonth/meetingsByMonth are Assumptions-tab
 *  seed/what-if data (lib/assumptions/assumptionsData.js SEED_CAMPAIGNS_BY_MONTH/
 *  SEED_MEETINGS_BY_MONTH), NOT the real Google Sheet-sourced actuals this Reports tab
 *  otherwise shows — there's no live GL-backed campaign/meeting count for actual
 *  months, so showing one here read as real data when it was actually a made-up
 *  forecast seed. A blank cell (2026-08-07 follow-up: dropped the "—" placeholder too,
 *  per Kayee: "if it's zero or blank, just return blank") is the honest answer
 *  (CLAUDE.md: "a wrong number that looks fine is worse than a visible error").
 *
 *  `onCommit` is optional (2026-08-07, Kayee's real-sheet screenshot: "Total # of
 *  Meetings shouldn't be in a blue box if it's a calculation field... it is a
 *  calculation of =round(T9*$R$3)") — Campaigns is the one genuine manual driver on
 *  Kayee's sheet, so it still gets an editable <MonthInput> for forecast months; when
 *  `onCommit` isn't passed (Meetings), forecast months render the SAME computed value
 *  as plain text instead, matching the "From formula / actuals" legend rather than
 *  the "Editable input" one — because on the real sheet, Meetings is always a formula
 *  (Conversion% × Campaigns from N months back), never typed in directly.
 *
 *  `overrides`/`onToggleOverride` (2026-08-10, Kayee, citing the Hampton
 *  act-fcst-snapshot-pattern doc: "I want to be able to switch actual month to
 *  projection so that I can input those # of campaign in the earlier month") — only
 *  meaningful for the Campaigns row (the one with a real `onCommit`). An actual month
 *  that's been switched on renders exactly like a forecast month (editable box); every
 *  actual month gets a small toggle button so switching is always one click away, in
 *  either direction. Meetings never gets these two params — it has nothing to switch,
 *  it's a formula, always. */
function buildDriverRow(key, label, section, months, lastActualIndex, getValue, onCommit, overrides, onToggleOverride) {
  const monthCells = {};
  months.forEach((iso, i) => {
    const isActual = i <= lastActualIndex;
    const isOverridden = overrides && overrides[iso];
    if (isActual && !isOverridden) {
      // Blank, not "—" (2026-08-07, Kayee: "if it's zero or blank, just return blank")
      // — same "no fake indicator character" rule as the rest of the table now. The
      // toggle (when this row supports one) is the only way to change that.
      monthCells[iso] = (
        <span key={iso} className="report-driver-readonly-cell">
          <span className="report-driver-readonly"></span>
          {onCommit && onToggleOverride && (
            <button
              type="button"
              className="report-driver-override-toggle"
              title="Switch this actual month to projection so you can type a real count"
              onClick={() => onToggleOverride(iso)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>
          )}
        </span>
      );
    } else if (onCommit) {
      monthCells[iso] = (
        <span key={iso} className="report-driver-editable-cell">
          <MonthInput value={getValue(iso)} onCommit={(n) => onCommit(iso, n)} />
          {isActual && isOverridden && onToggleOverride && (
            <button
              type="button"
              className="report-driver-override-toggle is-active"
              title="Switch this month back to actual (hides the box again)"
              onClick={() => onToggleOverride(iso)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          )}
        </span>
      );
    } else {
      const rounded = Math.round(getValue(iso));
      monthCells[iso] = <span key={iso} className="report-driver-readonly">{rounded ? rounded.toLocaleString('en-US') : ''}</span>;
    }
  });
  return { key, label, section, isTotal: false, driver: true, values: {}, monthCells };
}

/** Embeds # of Campaigns (editable) and # of Meetings (computed, read-only) directly
 *  under Subscription Revenue / Transaction Revenue in the P&L itself — Kayee
 *  (2026-08-06): "put it inside of revenue so that as the user adjust it, it will
 *  show up directly in revenue... no need to switch between assumption and P&L."
 *  Campaigns is the true manual driver; Meetings is always derived from it (see
 *  buildDriverRow above) — `onSetMeeting` is gone entirely, there's nothing to commit.
 *  Always inserted right after their revenue row regardless of range toggle — the
 *  range CSS classes on rangeClasses() hide/show columns, this only controls which
 *  ROWS exist. */
function withRevenueDriverRows(rows, months, lastActualIndex, revenue, onSetCampaign, onToggleCampaignOverride) {
  if (!revenue || !onSetCampaign) return rows;
  let next = rows;
  const subRow = next.find((r) => r.key === 'revenue_subscription_revenue');
  const txRow = next.find((r) => r.key === 'revenue_transaction_revenue');
  if (subRow) {
    const idx = next.findIndex((r) => r.key === 'revenue_subscription_revenue');
    const driverRow = buildDriverRow(
      '__driver_campaigns',
      '↳ # of Campaigns',
      subRow.section,
      months,
      lastActualIndex,
      (iso) => campaignsForMonth(revenue, iso),
      onSetCampaign,
      revenue.campaignActualOverrides,
      onToggleCampaignOverride
    );
    next = [...next.slice(0, idx + 1), driverRow, ...next.slice(idx + 1)];
  }
  if (txRow) {
    const idx = next.findIndex((r) => r.key === 'revenue_transaction_revenue');
    const driverRow = buildDriverRow(
      '__driver_meetings',
      '↳ # of Meetings',
      txRow.section,
      months,
      lastActualIndex,
      (iso) => meetingsForMonth(revenue, iso),
      null
    );
    next = [...next.slice(0, idx + 1), driverRow, ...next.slice(idx + 1)];
  }
  return next;
}

/** Moves "Services Revenue" to the bottom of the Revenue section, right before that
 *  section's Total row — Kayee (2026-08-07): "I don't like that it's between
 *  Transactional Revenue and Subscription Revenue." Runs LAST, after driver rows are
 *  already inserted, so Services Revenue lands after Subscription's own "↳ # of
 *  Campaigns" row too — genuinely at the bottom of the revenue block, not just above
 *  Subscription Revenue. Purely a display reorder: it moves the row object as-is
 *  (same values, same key), so it can't change any total — only where one real GL line
 *  appears on screen. A safe no-op if the label or a matching Total row isn't found
 *  (e.g. a different client's sheet doesn't have a "Services Revenue" line at all). */
function withReorderedRevenueRows(rows) {
  const idx = rows.findIndex((r) => r.label === 'Services Revenue');
  if (idx === -1) return rows;
  const servicesRow = rows[idx];
  const withoutServices = [...rows.slice(0, idx), ...rows.slice(idx + 1)];
  const totalIdx = withoutServices.findIndex((r) => r.isTotal && r.section === servicesRow.section);
  if (totalIdx === -1) return rows;
  return [...withoutServices.slice(0, totalIdx), servicesRow, ...withoutServices.slice(totalIdx)];
}

function StatementDoc({ statement, range, assumptionsState, setAssumptionsState, assumptionsHydrated }) {
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
  if (statement.type === 'PL') {
    try {
      rows = withManualAccountRows(statement.type, rows, assumptionsState?.customPLAccounts, costCtx.costItems, months, lastActualIndex);
    } catch (err) {
      console.warn('Manual account row injection failed:', err);
    }
  }
  if (statement.type === 'PL' && revenue && setAssumptionsState) {
    try {
      rows = withRevenueDriverRows(
        rows,
        months,
        lastActualIndex,
        revenue,
        (iso, n) =>
          setAssumptionsState({
            ...assumptionsState,
            revenue: { ...assumptionsState.revenue, campaignsByMonth: { ...assumptionsState.revenue.campaignsByMonth, [iso]: n } },
          }),
        (iso) =>
          setAssumptionsState({
            ...assumptionsState,
            revenue: toggleCampaignActualOverride(assumptionsState.revenue, iso),
          })
      );
    } catch (err) {
      console.warn('Revenue driver row injection failed:', err);
    }
  }
  if (statement.type === 'PL') {
    try {
      rows = withReorderedRevenueRows(rows);
    } catch (err) {
      console.warn('Revenue row reorder failed, showing sheet order:', err);
    }
  }

  // Drag-a-cost-item-onto-its-P&L-row linking (2026-08-10, Kayee: "give me the option
  // to drag and drop to match thing so that you dont have to worry about mapping...
  // if it said rent it will allow me to add rent to P&L for projections"). Sets an
  // explicit, un-guessable `linkedRowLabel` on the dropped item — see
  // matchCostItemToRowLabel's priority-order comment for why this exists alongside
  // the automatic name-matching it now overrides. Clears the same rowLabel off any
  // OTHER item first, so exactly one cost item ever feeds a given real P&L row at a
  // time (dropping a second item onto the same row re-points it, it doesn't stack).
  function handleLinkCostItem(itemId, rowLabel) {
    if (!assumptionsState?.costItems) return;
    const nextCostItems = assumptionsState.costItems.map((item) => {
      if (item.id === itemId) return { ...item, linkedRowLabel: rowLabel };
      if (item.linkedRowLabel === rowLabel) return { ...item, linkedRowLabel: null };
      return item;
    });
    setAssumptionsState({ ...assumptionsState, costItems: nextCostItems });
  }

  // "+ Add account" (2026-08-10, Kayee: "give me the ability to add a new account
  // under each section so i can add other travel and drag travel there") — creates a
  // blank placeholder line in whichever section it was added from, ready to receive a
  // dragged cost item. Removing one clears any cost item still linked to it (rather
  // than leaving a dangling linkedRowLabel that no longer matches any real row).
  function handleAddManualAccount(section, label) {
    if (!assumptionsState || !label.trim()) return;
    const account = { id: generateId('acct'), label: label.trim(), section };
    setAssumptionsState({
      ...assumptionsState,
      customPLAccounts: [...(assumptionsState.customPLAccounts || []), account],
    });
  }

  function handleRemoveManualAccount(accountId, label) {
    if (!assumptionsState) return;
    setAssumptionsState({
      ...assumptionsState,
      customPLAccounts: (assumptionsState.customPLAccounts || []).filter((a) => a.id !== accountId),
      costItems: (assumptionsState.costItems || []).map((i) => (i.linkedRowLabel === label ? { ...i, linkedRowLabel: null } : i)),
    });
  }

  return (
    // "report-doc" (not just "table-wrap") is what the range-toggle CSS below actually
    // targets (`#reports[data-range] .report-doc:not([data-doc="custom"])`) — without it
    // the 2026-2028/Historical buttons change `data-range` but nothing was ever selected by it.
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
              onLinkCostItem={statement.type === 'PL' ? handleLinkCostItem : null}
              onAddManualAccount={statement.type === 'PL' ? handleAddManualAccount : null}
              onRemoveManualAccount={statement.type === 'PL' ? handleRemoveManualAccount : null}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FragmentRows({ section, rows, months, currentMonth, lastActualIndex, revenue, costCtx, onLinkCostItem, onAddManualAccount, onRemoveManualAccount }) {
  // Which row (by key) currently has a cost item dragged over it — purely visual
  // feedback for the drag-and-drop cost-item-to-P&L-row linking feature (2026-08-10,
  // see handleLinkCostItem in StatementDoc for the full reasoning). Local to this
  // section's row group; nothing here is persisted, it just paints a highlight while
  // a drag is in progress.
  const [dragOverKey, setDragOverKey] = useState(null);

  // Category boundary for drag-and-drop linking (2026-08-10, Kayee: "divide non
  // headcount cost to cogs and opex... if i add the cost in cogs it will only be
  // allow to get sync to any items in cogs, same with opex"). This client's real
  // sheet has exactly one section literally called "COGS" — everything else that
  // isn't Revenue is some flavor of OpEx (Salaries & Benefits, Travel, Meals,
  // Facilities, etc. — there's no single flat "OpEx" section to check against, same
  // reasoning as CUSTOM_ACCOUNT_SECTION_ALIASES only ever having a CoGS entry).
  // Revenue rows aren't a valid link target for a cost item at all, so that returns
  // null and blocks dropping there entirely.
  const sectionUpper = section.toUpperCase();
  const sectionCategory = sectionUpper === 'REVENUE' ? null : sectionUpper === 'COGS' ? 'CoGS' : 'OpEx';
  const dropMimeType = sectionCategory ? `application/x-cost-item-${sectionCategory.toLowerCase()}` : null;

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
      {rows.map((row) => {
        // Calc-note lookup now runs ONCE per row, not once per month cell (2026-08-07,
        // Kayee: "the hover over explanation on the calculation only needs to appear
        // once at the account title") — the popover moves from every forecast $ cell
        // onto the row's own label, and it's pure formula text with no `iso` dependence
        // any more (see revenueCalcExplanation/costCalcExplanation), so computing it
        // once outside the month loop is strictly correct, not just faster. Same
        // defensive try/catch as the row pipeline above — a bad calc-note lookup should
        // never crash the whole app, just fall back to a plain, non-hoverable label.
        let rowCalcInfo = null;
        try {
          rowCalcInfo =
            revenueCalcExplanation(row.key, revenue) ||
            costCalcExplanation(row.label, costCtx) ||
            (row.custom || row.manualAccount ? customAccountCalcExplanation(row) : null);
        } catch (err) {
          console.warn('Reports calc-note lookup failed for a row label, showing plain label:', err);
        }
        // The Campaigns/Meetings driver rows and any Revenue-section row aren't valid
        // drop targets at all. Everything else — including Total rows (same as the
        // existing COST_ITEM_ROW_LABEL_OVERRIDES precedent, Travel -> "Total Travel")
        // AND a cost item's own already-auto-matched custom row — is fair game, but
        // ONLY for a cost item whose own category matches this row's section
        // (2026-08-10, Kayee: "if i add the cost in cogs it will only be allow to get
        // sync to any items in cogs").
        //
        // `row.custom` used to be excluded here on the theory that dropping onto an
        // item's own auto-generated row was redundant — but that's exactly what made
        // Vetric/Misc (both CoGS items with no real GL row, only ever shown via their
        // own auto-inserted custom row) permanently NOT draggable at all: their only
        // possible drop target WAS their own custom row, and that was the one thing
        // blocked (2026-08-10, Kayee: "i dont drag vetric to cogs or misc to misc in
        // cogs, everything should be draggable"). Dropping an item onto its own
        // already-matching row is harmless — it just makes the existing implicit
        // name-match explicit (a real `linkedRowLabel`, immune to the kind of name
        // drift that broke "Rent" earlier) instead of leaving anything unreachable.
        //
        // `onDragOver` only calls preventDefault (which is what permits a drop at
        // all) when the dragged item's encoded category type matches — for a
        // mismatched category, the browser shows its native "not allowed" cursor and
        // a drop is simply impossible, no separate error state needed. The `onDrop`
        // check against `costCtx.costItems` is a second, authoritative guard for any
        // browser that doesn't expose dataTransfer.types during dragover consistently.
        const isDropTarget = !!onLinkCostItem && !row.driver && !!sectionCategory;
        return (
          <tr key={row.key} className={row.isTotal ? 'total' : row.driver ? 'report-driver-row' : undefined}>
            <td
              className={isDropTarget && dragOverKey === row.key ? 'report-cost-drop-target is-drag-over' : isDropTarget ? 'report-cost-drop-target' : undefined}
              onDragOver={
                isDropTarget
                  ? (e) => {
                      if (!e.dataTransfer.types.includes(dropMimeType)) return;
                      e.preventDefault();
                      if (dragOverKey !== row.key) setDragOverKey(row.key);
                    }
                  : undefined
              }
              onDragLeave={isDropTarget ? () => setDragOverKey((k) => (k === row.key ? null : k)) : undefined}
              onDrop={
                isDropTarget
                  ? (e) => {
                      e.preventDefault();
                      setDragOverKey(null);
                      const itemId = e.dataTransfer.getData('text/plain');
                      if (!itemId) return;
                      const draggedItem = costCtx.costItems?.find((i) => i.id === itemId);
                      if (!draggedItem || draggedItem.category !== sectionCategory) return;
                      onLinkCostItem(itemId, row.label);
                    }
                  : undefined
              }
            >
              {rowCalcInfo ? (
                <DrillPopover label={row.label} value={row.label} calcNote={rowCalcInfo.calcNote} />
              ) : (
                row.label
              )}
              {row.manualAccount && onRemoveManualAccount && (
                <button
                  type="button"
                  className="report-manual-account-remove"
                  title="Remove this line"
                  onClick={() => onRemoveManualAccount(row.key.replace('manual_account_', ''), row.label)}
                >
                  ×
                </button>
              )}
            </td>
            {months.map((m, i) => {
              // A "driver" row (e.g. the embedded # of Campaigns / # of Meetings inputs,
              // 2026-08-06) supplies its own editable cell content directly instead of a
              // computed $ value — same monthCells-override pattern PayrollTable already
              // uses, so this table can hold a real <input>, not just formatted text.
              if (row.monthCells && row.monthCells[m] !== undefined) {
                return (
                  <td key={m} className={`${rangeClasses(i, lastActualIndex, m)}${m === currentMonth ? ' active-col' : ''}`}>
                    {row.monthCells[m]}
                  </td>
                );
              }
              // Zero AND missing both render as a plain blank cell now (2026-08-07,
              // Kayee: "if it's zero or blank, just return blank, don't know it so the
              // report look more clean") — a page of "$0"/"—" everywhere a real GL
              // month simply had no activity in that account was noise, not
              // information; an actually-missing figure and a genuine zero now read
              // identically (empty), which is the tradeoff Kayee explicitly asked for.
              const rounded = row.values[m] != null ? Math.round(row.values[m]) : 0;
              const cellText = rounded ? `$${rounded.toLocaleString('en-US')}` : '';
              const isForecast = i > lastActualIndex;
              return (
                <td
                  key={m}
                  className={`${rangeClasses(i, lastActualIndex, m)}${m === currentMonth ? ' active-col' : ''}${isForecast ? ' pr-fcst' : ''}`}
                >
                  {/* A Total row's per-month breakdown (what real line items sum to it
                      THIS month) is a separate feature from the calc-note above — it's
                      inherently monthly, real numbers, so it stays exactly where it was.
                      Skipped for a blank cell — nothing to break down. */}
                  {row.isTotal && cellText !== '' ? (
                    <DrillPopover label={row.label} value={cellText} components={siblingValuesAtMonth(rows, row, m)} />
                  ) : (
                    cellText
                  )}
                </td>
              );
            })}
          </tr>
        );
      })}
      {onAddManualAccount && <AddAccountRow section={section} months={months} onAdd={onAddManualAccount} />}
    </>
  );
}

/** The "+ Add account" trigger at the bottom of every P&L section (2026-08-10, Kayee:
 *  "give me the ability to add a new account under each section so i can add other
 *  travel and drag travel there") — a plain text link until clicked, then a one-line
 *  inline name field, same collapsed-by-default convention as the rate-schedule
 *  controls elsewhere on this tab. Submitting inserts a new blank row into THIS
 *  section (via withManualAccountRows, right before its Total row), ready to be a
 *  drag-and-drop target for any Non-Headcount Cost item. */
function AddAccountRow({ section, months, onAdd }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');

  function submit() {
    if (!name.trim()) return;
    onAdd(section, name);
    setName('');
    setAdding(false);
  }

  return (
    <tr className="report-add-account-row">
      <td colSpan={months.length + 1}>
        {!adding ? (
          <button type="button" className="report-add-account-link" onClick={() => setAdding(true)}>
            + Add account
          </button>
        ) : (
          <span className="report-add-account-form">
            <input
              type="text"
              className="pr-input"
              autoFocus
              placeholder="e.g. Other Travel"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
                if (e.key === 'Escape') {
                  setName('');
                  setAdding(false);
                }
              }}
            />
            <button type="button" className="btn primary" onClick={submit} disabled={!name.trim()}>
              Add
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setName('');
                setAdding(false);
              }}
            >
              Cancel
            </button>
          </span>
        )}
      </td>
    </tr>
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
