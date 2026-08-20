'use client';

import { useState, useMemo, useEffect } from 'react';
import { DrillPopover } from '../ui/DrillPopover';
import { MonthInput } from '../payroll/PayrollTable';
import { PLAssumptionsSidebar } from '../reports/PLAssumptionsSidebar';
import { CashFlowAssumptionsSidebar } from './CashFlowAssumptionsSidebar';
import { formatMonthLabel } from '../../lib/calc/dashboardMetrics';
import { useAssumptionsState } from '../../lib/assumptions/useAssumptionsState';
import { usePayrollState } from '../../lib/payroll/usePayrollState';
import { useCashTimingState } from '../../lib/cashflow/useCashTimingState';
import {
  plExpenseAccounts,
  plAccrualForMonth,
  cashOutflowForMonth,
  readCustomerInflowTotals,
} from '../../lib/cashflow/cashProjection';
import {
  headcountCostByCostType,
  headcountSalariesByCostType,
  headcountPayrollTaxesByCostType,
  headcountBenefitsByCostType,
  headcountBonusByCostType,
} from '../../lib/payroll/payrollData';
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

// ALL automatic cost-item-to-row matching REMOVED (2026-08-10) — this used to hold
// hardcoded name-mismatch overrides (software -> 'Software - Cost of Revenue',
// team-lunches -> 'Meals (Office)') and, before that, an exact-name-match fallback,
// on top of the explicit drag-and-drop `linkedRowLabel`. Kayee flagged both as the
// same underlying bug from two angles on 2026-08-10: first "why total travel has 500?
// it shouldn't think [link] travel already before i drag it" (the travel entry was
// removed that same day), then "when i remove the link for vetric and misc and
// software in cogs the amount is still there. the logic is wrong. the amount should
// be removed if i remove the link in assumption and when i drag over it should get
// added" — i.e. ANY automatic match that isn't the explicit link she set herself is
// the bug, not just Travel's. `linkedRowLabel` (set only by actually dragging a cost
// item onto a P&L row, cleared only by actually unlinking or deleting it) is now the
// ONLY thing that puts a cost item's $ on the P&L at all — see
// matchedCostItemsForRowLabel below, which no longer falls back to anything else.
const COST_ITEM_ROW_LABEL_OVERRIDES = {};

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
  // Moved onto the "Cost of Product" row (2026-08-20, Kayee: "move the calculation for
  // cost of campaign into cost of product") — "Cost of campaigns" now stays actuals-only
  // (blank in forecast months, same as every other unwired row), and its forecast
  // number shows up on "Cost of Product" instead. Total COGS is untouched either way,
  // since it sums costPerCampaignForMonth directly rather than reading this row.
  'Cost of Product': (ctx, iso) => costPerCampaignForMonth(ctx.revenue, iso),
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
// 2026-08-17 (Kayee: "let's separate projection with reports... in report it will
// only show actual"). `mode` is the actual/projection split: 'actual' (default) is
// this same Reports tab, but with NO forecast pipeline run at all — just the real
// months the sheet returned, no Assumptions sidebar, no drag-and-drop cost-item
// linking, no Payroll rows injected. 'projection' is a full StatementDoc exactly as
// it always worked, just now mounted from the new Projection tab
// (ProjectionPanel.jsx) instead of here. `fixedType` (Projection's P&L/Cash Flow
// sub-tabs) skips the PL/CF/BS toolbar entirely — the sub-tab click already picked
// the statement type, so a second selector here would be redundant. Custom is gone
// entirely (both as a main-bar tab and as a 4th button here) — Kayee: "remove the
// custom tab in the main bar and inside of reports."
export function ReportsPanel({ statements, customReports, mode = 'actual', fixedType }) {
  // If fixedType is set (Projection sub-tabs), lock the type to that value;
  // otherwise, allow the user to toggle via buttons (Reports tab)
  const [reportType, setReportType] = useState(fixedType || 'PL');

  // Keep reportType in sync with fixedType if it changes (e.g., switching Projection sub-tabs)
  useEffect(() => {
    if (fixedType) setReportType(fixedType);
  }, [fixedType]);
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

  // Cash Flow timing state (2026-08-18 rebuild) — per-P&L-account cash-timing config
  // (Follow P&L / custom interval / manual), persisted to localStorage via the same
  // hydrate-then-save pattern as Assumptions/Payroll. The old cashFlowState "Revenue
  // Inflow" fields (currentCustomers/upfrontPerCustomer/...) are GONE — customer cash-in
  // inputs live on the Customer Cash Flow tab now, which writes its computed monthly
  // totals to localStorage (CUSTOMER_INFLOW_STORAGE_KEY) for this panel to read below.
  const { state: cashTimingState, setState: setCashTimingState, hydrated: cashTimingHydrated } = useCashTimingState();

  // Payroll state is needed at THIS level (not just inside StatementDoc) because the
  // CF sidebar's per-account accrual reference and the CF projection's outflow math
  // both fold in Payroll's headcount costs, same as the P&L projection does.
  const { state: cfPayrollState, hydrated: cfPayrollHydrated } = usePayrollState();

  // 2026-08-20 (reverted back, same day — Kayee: "this is not coming from p&l
  // projection it's coming from customer tab... I put some dummy numbers in July 2026
  // just to see if you bring it over"): CF's Transaction/Subscription Revenue rows and
  // the "Customer Cash Inflow" summary read the Customer tab's live localStorage
  // handoff (CUSTOMER_INFLOW_STORAGE_KEY) again, for any forecast month the Customer
  // tab has actually saved a number for — editing Customer really does flow into CF,
  // as originally asked for. Falls back to the P&L Assumptions calc
  // (meetingRevenueForMonth/upfrontRevenueForMonth) ONLY for a month the Customer tab
  // has never saved anything for in this browser, so CF isn't blank before anyone has
  // ever opened the Customer tab. Read once on mount — CustomerPanel and this panel are
  // sibling sub-tabs that unmount on switch, so mount-time read always sees the latest
  // save.
  const [customerInflow, setCustomerInflow] = useState(null);
  useEffect(() => {
    setCustomerInflow(readCustomerInflowTotals());
  }, []);

  // The COGS/OpEx account lists the CF sidebar shows timing controls for — the actual
  // chart-of-account rows from the live P&L statement (plus Payroll's injected COGS
  // headcount line and any user-added manual P&L accounts).
  const expenseAccounts = useMemo(
    () => plExpenseAccounts(statements?.PL, assumptionsHydrated ? assumptionsState?.customPLAccounts : null),
    [statements, assumptionsState, assumptionsHydrated]
  );

  // Context for computing one account's projected P&L accrual in a forecast month —
  // the same hydrated Assumptions + Payroll state the P&L projection pipeline reads.
  const cfAccrualCtx = {
    revenue: assumptionsHydrated ? assumptionsState?.revenue : null,
    costItems: assumptionsHydrated ? assumptionsState?.costItems || [] : [],
    payrollState: cfPayrollHydrated ? cfPayrollState : null,
    sbSection: expenseAccounts.sbSection,
  };

  // Forecast months the sidebar's Manual-input mode exposes for typing — after the
  // P&L's last actual month, capped at 2028-12 (the app's default forward window;
  // typing 50+ cells out to the 2030 horizon would be noise, and untyped months are
  // simply $0 cash out).
  const cfManualMonths = useMemo(() => {
    const pl = statements?.PL;
    if (!pl || pl.months.length === 0) return [];
    const lastActual = pl.months[pl.months.length - 1];
    return extendMonthsThrough(pl.months, PROJECTION_HORIZON).filter((m) => m > lastActual && m <= '2028-12');
  }, [statements]);

  function handleSetTiming(accountId, timing) {
    if (!cashTimingState) return;
    const next = { ...(cashTimingState.timingByAccount || {}) };
    if (timing == null) delete next[accountId];
    else next[accountId] = timing;
    setCashTimingState({ ...cashTimingState, timingByAccount: next });
  }

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

  // Show sidebar for P&L (Assumptions) and CF (Cash Timing) in projection mode
  const showSidebar = mode === 'projection' && (reportType === 'PL' || reportType === 'CF');

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
      <div className="toolbar">
        {/* Type selector only shown on Reports (actual) tab — Projection has its own
            sub-tab nav so a second selector here would be redundant. Custom removed
            entirely (Kayee, 2026-08-17: "remove the custom tab in the main bar and
            inside of reports"). */}
        {!fixedType && (
          <div className="seg">
            {['PL', 'CF', 'BS'].map((type) => (
              <button
                key={type}
                className={reportType === type ? 'active' : undefined}
                onClick={() => setReportType(type)}
              >
                {STATEMENT_LABELS[type]}
              </button>
            ))}
          </div>
        )}
        {!fixedType && (
          <div className="seg right">
            {/* Two states only (2026-08-07 rewrite): the 3-year default landing view,
                and All — everything, actual and forecast alike, no filtering. Labeled
                "All" not "Historical" (2026-08-20, Kayee: "historical is not the right
                word if you also show 2026" — correct, this state still includes
                2026-2028, so "historical" undersold what it actually shows). */}
            <button className={range === 'default' ? 'active' : undefined} onClick={() => setRange('default')}>
              2026 – 2028
            </button>
            <button className={range === 'all' ? 'active' : undefined} onClick={() => setRange('all')}>
              All
            </button>
          </div>
        )}
      </div>

      {/* Wide wrapper — same treatment as Payroll's tables (globals.css .page-wide),
          so every wide-table tab behaves consistently (Kayee, 2026-08-05: "all pages
          needs to be consistant"). Toolbar/PageHead above stay at the normal page width. */}
      <div className={`page-wide${showSidebar && !sidebarCollapsed ? ' page-wide-reports-open' : ''}`}>
        {showSidebar ? (
          // P&L only, for now (Kayee, 2026-08-06: "we work on P&L first") — a 30/70
          // split when the Assumptions sidebar is open, collapsing back to today's
          // full-width table (the exact same StatementDoc, unchanged) when it's
          // hidden into the hamburger rail. The wrapper above also picks up
          // .page-wide-reports-open while expanded (2026-08-07, Kayee: "use the space
          // on the left and right") so this view alone can borrow the gutter room the
          // normal .page-wide cap reserves everywhere else, instead of squeezing the
          // Non-Headcount Costs table into a narrower column than it needs.
          <div className={`reports-with-sidebar${sidebarCollapsed ? ' is-collapsed' : ''}`}>
            {reportType === 'PL' ? (
              <PLAssumptionsSidebar
                collapsed={sidebarCollapsed}
                onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
                revenue={assumptionsHydrated ? assumptionsState?.revenue : null}
                costItems={assumptionsHydrated ? assumptionsState?.costItems : null}
                onRevenueChange={(revenue) => assumptionsState && setAssumptionsState({ ...assumptionsState, revenue })}
                onCostItemsChange={(costItems) => assumptionsState && setAssumptionsState({ ...assumptionsState, costItems })}
                costItemOrder={costItemOrder}
              />
            ) : reportType === 'CF' ? (
              <CashFlowAssumptionsSidebar
                collapsed={sidebarCollapsed}
                onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
                cogsAccounts={cashTimingHydrated ? expenseAccounts.cogsAccounts : null}
                opexAccounts={cashTimingHydrated ? expenseAccounts.opexAccounts : null}
                timingByAccount={cashTimingState?.timingByAccount || {}}
                onSetTiming={handleSetTiming}
                manualMonths={cfManualMonths}
                accrualFor={(account, iso) => plAccrualForMonth(account, iso, cfAccrualCtx)}
              />
            ) : null}
            <div className="reports-main">
              {/* Legend (2026-08-07, Kayee: "give user an indicator on what cell is
                  editable"). Moved INTO the table column (2026-08-20, Kayee: "i dont
                  like it when something got cut off like this") — it used to sit
                  above the sidebar+table flex row at full page width, where the
                  sticky sidebar (top:140px) slid over it on scroll and half-covered
                  the text. In this column the sidebar can never overlap it.
                  Projection-P&L only ("we shouldnt have this text anymore since this
                  only apply to the projection section"): the Reports (actual) tab has
                  no editable cells to explain. */}
              {mode === 'projection' && reportType === 'PL' && (
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
              <StatementDoc
                statement={statements[reportType]}
                range={range}
                assumptionsState={assumptionsState}
                setAssumptionsState={setAssumptionsState}
                assumptionsHydrated={assumptionsHydrated}
                mode={mode}
                cfProjection={
                  reportType === 'CF'
                    ? {
                        expenseAccounts,
                        timingByAccount: (cashTimingHydrated && cashTimingState?.timingByAccount) || {},
                        accrualCtx: cfAccrualCtx,
                        onSetTiming: handleSetTiming,
                        customerInflow,
                      }
                    : null
                }
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
            mode={mode}
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
  // Kayee, 2026-08-19: "the toggle of 2026-2028 is pretty much useless. because it's
  // showing historical even if i selected 2026-2028" — the toggle only ever filtered
  // which months are hidden, it never colored anything, so historical (pre-2026) months
  // mixed into the 2026-2028 view read as if the toggle wasn't doing anything. Instead
  // of relying on the toggle to hide them, every header cell for a month before Jan-2026
  // now gets a distinct dark-grey treatment (see .r-historical in globals.css) so
  // historical vs. 2026+ columns are visually obvious no matter which toggle is active.
  if (month && month < '2026-01') classes.push('r-historical');
  // Kayee, 2026-08-19: "put some line between the year. and then the year should be
  // center align" — a vertical divider at every year boundary, running the full height
  // of the table (header + every body row), not just the year-band row itself. Months
  // here are always a continuous monthly sequence, so "first month of a year" is simply
  // January — no need to compare against the previous month.
  if (month && month.endsWith('-01') && monthIndex > 0) classes.push('y-boundary');
  return classes.join(' ');
}

/** Which month-index in each calendar-year run should carry the year label, so it
 *  reads as roughly centered over that year's columns (2026-08-19, Kayee: "the year
 *  should be center align"). Deliberately NOT a <th colSpan> across the year — a
 *  colSpan year cell was tried before and reintroduced a real bug (2026-08-04: a
 *  range-toggle hide could desync the colSpan cell from the individual month columns
 *  below it once some months in the run were hidden). Keeping one <th> per month and
 *  just moving WHICH cell shows the text keeps the exact same column structure as the
 *  row below it — zero desync risk — while still visually centering the label. */
function yearLabelIndices(months) {
  const indices = new Set();
  let runStart = 0;
  for (let i = 1; i <= months.length; i++) {
    if (i === months.length || months[i].slice(0, 4) !== months[runStart].slice(0, 4)) {
      indices.add(runStart + Math.floor((i - runStart - 1) / 2));
      runStart = i;
    }
  }
  return indices;
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
    return { calcNote: 'Subscription Revenue = # of Campaigns × Upfront Rate' };
  }
  if (rowKey === 'revenue_transaction_revenue') {
    return { calcNote: 'Transaction Revenue = # of Meetings × Per Meeting Rate' };
  }
  if (rowKey === 'total_revenue') {
    return { calcNote: 'Total Revenue = (Subscription + Transaction) × (1 − Risk Buffer %)' };
  }
  // The embedded driver rows (2026-08-07, Kayee: "# of meeting should also show how
  // the calculation come about as well the meeting conversion time and stuff") — same
  // formula-only convention as every other calc-note here, condensed 2026-08-20 (Kayee:
  // "keep it precise, like a math formula, what multiplied by what") to just the
  // expression itself, no surrounding prose.
  if (rowKey === '__driver_meetings') {
    return { calcNote: '# of Meetings = round(Meeting Conversion % × Campaigns, N months ago)' };
  }
  if (rowKey === '__driver_campaigns') {
    return { calcNote: '# of Campaigns — manual input' };
  }
  return null;
}

/** Same idea as revenueCalcExplanation, for the label-matched COGS/OpEx/margin rows
 *  (see PL_COST_PROJECTIONS_BY_LABEL above) — formula-only text on the row label, no
 *  `iso` and no computed component numbers (2026-08-07, same follow-up as above). */
function costCalcExplanation(rowLabel, ctx) {
  if (!ctx) return null;
  // CASH PROJECTION rows (CF projection only, 2026-08-18) — see
  // withCashFlowProjectionRows for where these rows come from.
  if (rowLabel === 'Customer Cash Inflow') {
    return { calcNote: 'Customer Cash Inflow = Σ(Campaigns × Campaign Price + Meetings × Meeting Price)' };
  }
  // "COGS Cash Outflow" / "OpEx Cash Outflow" notes removed 2026-08-19 along with the
  // rows themselves — each real COGS/OpEx line now carries its own cash-out $ (see
  // withCFExpenseCashOutflowRows), summed by the statement's own Total bands.
  if (rowLabel === 'Net Projected Cash Flow') {
    return { calcNote: 'Net Projected Cash Flow = Customer Cash Inflow − Total COGS/OpEx Cash Outflow' };
  }
  if (!ctx.revenue) return null;
  if (rowLabel === 'Total COGS') {
    return { calcNote: 'Total COGS = Cost of Campaigns + Non-Headcount CoGS + Payroll CoGS' };
  }
  if (['Total OpEx', 'Total OPEX', 'Total Operating Expenses'].includes(rowLabel)) {
    return { calcNote: 'Total OpEx = Non-Headcount OpEx + Payroll OpEx' };
  }
  if (['Gross Profit', 'Gross Margin'].includes(rowLabel)) {
    return { calcNote: 'Gross Profit = Total Revenue − Total COGS' };
  }
  if (['Operating Profit', 'Operating Income', 'Operating Margin'].includes(rowLabel)) {
    return { calcNote: 'Operating Profit = Total Revenue − Total COGS − Total OpEx' };
  }
  if (rowLabel === 'Gross Profit Margin %') {
    return { calcNote: 'Gross Profit Margin % = Gross Profit ÷ Total Revenue × 100' };
  }
  if (rowLabel === 'Cost of Product') {
    return { calcNote: 'Cost of Product (forecast) = Campaigns (prior month) × Cost Per Campaign' };
  }
  // Plural now (2026-08-10, Kayee: "I dragged Central - Bookkeeping and Central -
  // Payroll both to Tax and Accounting... it will add the amount") — more than one
  // cost item can feed the same real row, summed together.
  const matchedItems = matchedCostItemsForRowLabel(rowLabel, ctx.costItems);
  if (matchedItems.length > 0) {
    const names = matchedItems.map((i) => `"${i.name}"`).join(' + ');
    return { calcNote: `= ${names}` };
  }
  return null;
}

/** Finds EVERY Assumptions cost item that feeds a given real P&L row — plural,
 *  because more than one item can now feed the same line (2026-08-10, Kayee: "I
 *  dragged Central - Bookkeeping and Central - Payroll both to Tax and Accounting...
 *  I want to assign both, in P&L it will add the amount"). Returns an array (possibly
 *  empty), never a single item, so every caller sums/lists rather than picking one.
 *
 *  Priority order, highest first:
 *   1. `linkedRowLabel` — explicit drag-and-drop links Kayee made by hand on the
 *      Reports tab (2026-08-10: "give me the option to drag and drop to match thing
 *      so that you dont have to worry about mapping and if the users want to do it
 *      they could"). Deterministic and immune to text drift — the root cause traced
 *      down that same day was that the "Rent" cost item silently stopped
 *      case-insensitive-matching its real "Rent" row (a stray character or a raw
 *      sheet-label quirk that plain `.trim().toLowerCase()` can't fix), and there was
 *      no way to just tell the app "this one, that one" directly. ALL items linked to
 *      this exact label are returned together.
 *
 *  This is now the ONLY way a cost item's $ ever lands on a P&L row — the earlier
 *  fallbacks (COST_ITEM_ROW_LABEL_OVERRIDES' hardcoded name-mismatch map, and before
 *  that a plain exact-name match) were both removed the same day, 2026-08-10, after
 *  Kayee flagged the same bug twice from two angles: first Travel showing $500 before
 *  she'd ever dragged it anywhere ("it shouldn't think [link] travel already before i
 *  drag it"), then Vetric/Misc/Software's $ persisting right after she explicitly
 *  removed their link badge ("the amount should be removed if i remove the link in
 *  assumption and when i drag over it should get added") — any automatic match that
 *  isn't the explicit link she set herself is the same bug, not a convenience worth
 *  keeping. `linkedRowLabel` set/cleared only by CostItemsCard's drag-and-drop /
 *  unlink button is now the single source of truth. */
function matchedCostItemsForRowLabel(rowLabel, costItems) {
  if (!costItems || !rowLabel) return [];
  return costItems.filter((i) => i.linkedRowLabel === rowLabel);
}

/** Single-item convenience wrapper over matchedCostItemsForRowLabel, for the handful
 *  of call sites that only need to know "is ANYTHING matched here" (picks the first
 *  when more than one item shares a link). */
function matchCostItemToRowLabel(rowLabel, costItems) {
  return matchedCostItemsForRowLabel(rowLabel, costItems)[0] || null;
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
    // Plural now (2026-08-10) — more than one cost item can share the same P&L row
    // (Kayee: "Central - Bookkeeping and Central - Payroll both to Tax and
    // Accounting"), and both should sort next to that same row, not just the first.
    for (const matchedItem of matchedCostItemsForRowLabel(row.label, costItems)) {
      if (!seen.has(matchedItem.id)) {
        order.push(matchedItem.id);
        seen.add(matchedItem.id);
      }
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
    // Plural now (2026-08-10, Kayee: "I dragged Central - Bookkeeping and Central -
    // Payroll both to Tax and Accounting... it will add the amount") — every item
    // linked (or matched) to this row's label gets SUMMED into it, not just the first.
    const items = matchedCostItemsForRowLabel(row.label, costItems);
    if (items.length === 0) return row;
    items.forEach((item) => matchedIds.add(item.id));
    const patchedValues = { ...row.values };
    for (let i = lastActualIndex + 1; i < months.length; i++) {
      patchedValues[months[i]] = items.reduce((sum, item) => sum + costItemAmountForMonth(item, months[i]), 0);
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

// Which real Total row each Payroll line falls back to sitting above, if no real
// "Salaries & Benefits" row is found to anchor under instead (see
// withPayrollHeadcountRows below) — matched by label, not a section alias, since OpEx
// has no single section string to key off of (see CUSTOM_ACCOUNT_SECTION_ALIASES's own
// comment above for why).
const PAYROLL_HEADCOUNT_TOTAL_LABELS = {
  CoGS: ['Total COGS'],
  OpEx: ['Total OpEx', 'Total OPEX', 'Total Operating Expenses'],
};

// "Salaries & Benefits" is a real named SUB-SECTION on Kayee's own OpEx (a section
// band like "COGS", grouping several of its own leaf rows — Salaries, Payroll Taxes,
// Benefits, Payroll & Benefits Processing Fees, Bonuses — under one green header band,
// confirmed against her screenshot 2026-08-10), NOT a single leaf row with its own $
// column. COGS has no equivalent nested sub-section (it's one flat "COGS" section per
// CUSTOM_ACCOUNT_SECTION_ALIASES's own comment above), so only OpEx's payroll
// breakdown needs to find it; COGS's lump line just sits above the flat section's own
// Total COGS row, same as before this fix.
const SALARIES_BENEFITS_SECTION_NAMES = ['salaries & benefits', 'salaries and benefits'];

/** Returns the exact raw `.section` string used by the "Salaries & Benefits" sub-
 *  section's rows, or null if no row anywhere carries it (falls back to the grand
 *  Total OpEx in that case — see withPayrollHeadcountRows below). Matching by SECTION
 *  value, not row label, is the fix for the 2026-08-10 bug Kayee flagged ("you have it
 *  at the bottom, it should align with the actual Salaries & Benefits section") — the
 *  original version searched for a leaf ROW literally labeled "Salaries & Benefits",
 *  which doesn't exist (it's a section band, not a line item), so it always silently
 *  fell through to sitting above the grand Total OpEx at the very bottom of the whole
 *  OpEx block instead of inside this specific sub-section. */
function findSalariesBenefitsSection(rows) {
  const match = rows.find((r) => SALARIES_BENEFITS_SECTION_NAMES.includes(String(r.section).trim().toLowerCase()));
  return match ? match.section : null;
}

function buildPayrollLineRow(key, label, section, costType, kind, values) {
  return { key, label, section, isTotal: false, payrollHeadcount: true, costType, payrollLineKind: kind, values };
}

/** Kayee, 2026-08-10: "Headcount (Payroll) should be under salaries & benefit... get
 *  the salaries, payroll taxes and benefit separated... in cogs payroll no need to
 *  have division for benefit and payroll tax, only in opex you need." Payroll's
 *  headcount cost was already folded into Total COGS/Total OpEx's own math
 *  (cogsTotalForMonth/opexTotalForMonth above, since 2026-08-06) — these rows only make
 *  that already-included number VISIBLE, same read-only/no-double-count convention as
 *  withCustomAccountRows (a display of a number the Total already contains, not an
 *  addition to it).
 *
 *  COGS gets ONE lump "Headcount (Payroll)" line, right above the flat COGS section's
 *  own Total COGS row (Kayee's own call — no need to split it there, and COGS has no
 *  further named sub-section to place it inside anyway). OpEx gets three separate
 *  lines — Salaries (base + Bonus $, since bonus carries no tax/benefit load of its
 *  own), Payroll Taxes, and Benefits — inserted directly inside the real "Salaries &
 *  Benefits" sub-section, right above ITS OWN "Total Salaries & Benefits" row (not the
 *  grand Total OpEx). Falls back to sitting above the grand Total OpEx if that named
 *  sub-section can't be found at all (worded differently on Kayee's live sheet), so
 *  the figures are never silently dropped. */
function withPayrollHeadcountRows(statementType, rows, payrollState, months, lastActualIndex) {
  if (statementType !== 'PL') return rows;
  let next = rows;

  // --- COGS: one lump line, right above the flat COGS section's own Total ---
  const cogsTotalIdx = next.findIndex((r) => r.isTotal && PAYROLL_HEADCOUNT_TOTAL_LABELS.CoGS.includes(r.label));
  if (cogsTotalIdx !== -1) {
    const section = next[cogsTotalIdx].section;
    const values = {};
    for (let i = lastActualIndex + 1; i < months.length; i++) {
      values[months[i]] = payrollState
        ? headcountCostByCostType(payrollState.roster, payrollState.bonuses, payrollState.assumptions, 'CoGS', months[i])
        : 0;
    }
    const row = buildPayrollLineRow('payroll_headcount_cogs', 'Headcount (Payroll)', section, 'CoGS', 'lump', values);
    next = [...next.slice(0, cogsTotalIdx), row, ...next.slice(cogsTotalIdx)];
  }

  // --- OpEx: 4 lines, each aligned directly under ITS OWN matching real row inside the
  // "Salaries & Benefits" sub-section (2026-08-10, Kayee, pointing at her real sheet's
  // Salaries/Payroll Taxes/Benefits/Bonuses rows with arrows: "this is how it should
  // get match up and also divide out bonus then") — rather than grouping all of them
  // together in one block. Each line is searched for and inserted independently, in
  // its own loop iteration, always against the just-updated `next` — so an earlier
  // insertion in this same loop can never leave a later one looking at a stale index. */
  const sbSection = findSalariesBenefitsSection(next);
  const OPEX_PAYROLL_LINES = [
    { key: 'payroll_salaries_opex', label: 'Salaries (Payroll)', kind: 'salaries', anchorLabels: ['salaries'], calc: headcountSalariesByCostType },
    { key: 'payroll_taxes_opex', label: 'Payroll Taxes (Payroll)', kind: 'taxes', anchorLabels: ['payroll taxes', 'taxes'], calc: headcountPayrollTaxesByCostType },
    { key: 'payroll_benefits_opex', label: 'Benefits (Payroll)', kind: 'benefits', anchorLabels: ['benefits'], calc: headcountBenefitsByCostType },
    { key: 'payroll_bonus_opex', label: 'Bonuses (Payroll)', kind: 'bonus', anchorLabels: ['bonuses', 'bonus'], calc: headcountBonusByCostType },
  ];
  for (const line of OPEX_PAYROLL_LINES) {
    // PATCH the real anchor row's own forecast cells directly (2026-08-10, Kayee,
    // looking at "Salaries (Payroll)" sitting as its own separate line right under
    // the real "Salaries" row: "NO! Salaries is the SAME LINE as Salaries (Payroll)
    // and the others too!") — same live-row-patching convention
    // withNamedCostItemProjections already uses for a linked cost item, just applied
    // to Payroll's own math instead. No new row gets added when a real anchor row
    // exists; only falls back to inserting a genuinely NEW "X (Payroll)" line (right
    // above the "Salaries & Benefits" sub-section's own Total, or the grand Total
    // OpEx) when there's truly no matching real row to patch — so the figures are
    // never silently dropped if Kayee's sheet doesn't have, say, a "Bonuses" row.
    const anchorIdx =
      sbSection != null
        ? next.findIndex((r) => !r.isTotal && r.section === sbSection && line.anchorLabels.includes(String(r.label).trim().toLowerCase()))
        : -1;
    if (anchorIdx !== -1) {
      const anchorRow = next[anchorIdx];
      const patchedValues = { ...anchorRow.values };
      for (let i = lastActualIndex + 1; i < months.length; i++) {
        const iso = months[i];
        patchedValues[iso] = payrollState ? line.calc(payrollState.roster, payrollState.bonuses, payrollState.assumptions, 'OpEx', iso) : 0;
      }
      const patchedRow = { ...anchorRow, values: patchedValues, payrollHeadcount: true, costType: 'OpEx', payrollLineKind: line.kind };
      next = [...next.slice(0, anchorIdx), patchedRow, ...next.slice(anchorIdx + 1)];
      continue;
    }
    const insertAt =
      sbSection != null
        ? next.findIndex((r) => r.section === sbSection && r.isTotal)
        : next.findIndex((r) => r.isTotal && PAYROLL_HEADCOUNT_TOTAL_LABELS.OpEx.includes(r.label));
    const section = insertAt !== -1 ? next[insertAt].section : null;
    if (insertAt === -1 || !section) continue;
    const values = {};
    for (let i = lastActualIndex + 1; i < months.length; i++) {
      const iso = months[i];
      values[iso] = payrollState ? line.calc(payrollState.roster, payrollState.bonuses, payrollState.assumptions, 'OpEx', iso) : 0;
    }
    const row = buildPayrollLineRow(line.key, line.label, section, 'OpEx', line.kind, values);
    next = [...next.slice(0, insertAt), row, ...next.slice(insertAt)];
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
  // Plural now (2026-08-10, Kayee: "I want to assign both... it will add the amount")
  // — a manual account can be fed by more than one linked cost item, summed together.
  const items = matchedCostItemsForRowLabel(account.label, costItems);
  if (items.length > 0) {
    for (let i = lastActualIndex + 1; i < months.length; i++) {
      values[months[i]] = items.reduce((sum, item) => sum + costItemAmountForMonth(item, months[i]), 0);
    }
  }
  return {
    key: `manual_account_${account.id}`,
    label: account.label,
    section: account.section,
    isTotal: false,
    manualAccount: true,
    linkedItemNames: items.map((i) => i.name),
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
  if (row.payrollHeadcount) {
    const kindNote = {
      lump: `Σ Payroll rows tagged "${row.costType}" (base + bonus)`,
      salaries: `(Base ÷ 12) + Bonus, rows tagged "${row.costType}"`,
      taxes: `(Base ÷ 12) × Tax Rate %, rows tagged "${row.costType}"`,
      benefits: `(Base ÷ 12) × Benefits %, rows tagged "${row.costType}"`,
    }[row.payrollLineKind] || `Σ Payroll rows tagged "${row.costType}"`;
    return { calcNote: kindNote };
  }
  if (row.manualAccount) {
    // Plural now (2026-08-10, Kayee: "I want to assign both... here it will show both
    // are linked") — list every linked item's name, summed together on this line.
    const names = row.linkedItemNames || [];
    return {
      calcNote: names.length > 0 ? `= ${names.map((n) => `"${n}"`).join(' + ')}` : 'Not linked — drag a cost item here',
    };
  }
  return {
    calcNote: `"${row.label}" — set on Assumptions tab`,
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

const CASH_ROW_PATTERNS = {
  beginning: /beginning.*cash/i,
  netChange: /net (change|increase|decrease)(\s*\/\s*decrease)?.*cash/i,
  ending: /ending.*cash/i,
};

/** Moves Beginning Cash / Net Change in Cash / Ending Cash to the very top of the Cash
 *  Flow statement, in that fixed order — Kayee (2026-08-17): "move the beginning cash
 *  and ending cash to all the way to the top... beginning cash and then net change in
 *  cash and then followed by ending cash." These three normally sit wherever the sheet
 *  puts its cash-reconciliation block (often the bottom), burying the one number
 *  (ending cash) most people open a Cash Flow statement to check first. Purely a
 *  display reorder — same row objects/values, so no total can change, only where these
 *  three lines render. All three are forced onto ONE shared section (the first found
 *  row's own section) so they render as a single clean group up top instead of
 *  fragmenting across whatever separate sections they originally lived in on the
 *  sheet. Safe no-op if none of the three labels are found on this client's CF sheet. */
function withReorderedCashFlowRows(rows) {
  const beginningIdx = rows.findIndex((r) => CASH_ROW_PATTERNS.beginning.test(r.label));
  const netChangeIdx = rows.findIndex((r) => CASH_ROW_PATTERNS.netChange.test(r.label));
  const endingIdx = rows.findIndex((r) => CASH_ROW_PATTERNS.ending.test(r.label));
  const pickedIdxs = [beginningIdx, netChangeIdx, endingIdx].filter((i) => i !== -1);
  if (pickedIdxs.length === 0) return rows;

  const topSection = rows[pickedIdxs[0]].section;
  // Style the block as the formula it is — Kayee (2026-08-18): "it's like a formula
  // right. the beginning cash plus the net cash activity equal to ending cash."
  // Beginning and Net Change render as plain rows (isTotal stripped — the sheet often
  // marks Net Change as a total, which drops a heavy black band mid-formula); only
  // Ending Cash keeps the total band, prefixed "=" so the sum reads at a glance.
  const formulaStyle = [
    { idx: beginningIdx, isTotal: false, prefix: '' },
    { idx: netChangeIdx, isTotal: false, prefix: '+ ' },
    { idx: endingIdx, isTotal: true, prefix: '= ' },
  ];
  const orderedTopRows = formulaStyle
    .filter((s) => s.idx !== -1)
    .map((s) => ({
      ...rows[s.idx],
      section: topSection,
      isTotal: s.isTotal,
      label: `${s.prefix}${rows[s.idx].label}`,
    }));

  const removeSet = new Set(pickedIdxs);
  const rest = rows.filter((_, i) => !removeSet.has(i));
  return [...orderedTopRows, ...rest];
}

/** CF expense rows follow the P&L by default (2026-08-19, Kayee: "I want the
 *  projection to fill in the numbers from p&l projection. by default. but only cash
 *  out... all of the cogs and opex. by default follow the same pattern. and only if i
 *  want to change cash timing i use the hamburger on the left hand side").
 *
 *  Patches the CF statement's own REAL COGS/OpEx line items (Processor Fees, Cost of
 *  campaigns, etc. — the same account labels the P&L carries) with
 *  cashOutflowForMonth() for every FORECAST month, exactly the same
 *  live-row-patching convention withPayrollHeadcountRows / withNamedCostItemProjections
 *  use on the P&L side. With no timing override, cashOutflowForMonth defaults to
 *  `followPL` → plAccrualForMonth(), so each row shows the identical $ its P&L
 *  projection row shows for that month; a per-account timing config from the CF
 *  sidebar (interval / manual) is the ONLY thing that makes it differ. Matching is by
 *  exact row label — the same `account.label ===` rule plAccrualForMonth itself uses —
 *  so a CF-only row with no P&L twin (nothing to follow) is left completely alone
 *  rather than fabricated. Actual months are never touched: real GL cash history stays
 *  exactly as the sheet reported it.
 *
 *  The synthetic "Headcount (Payroll)" COGS account (id `payroll_headcount_cogs`) has
 *  no real sheet row by definition — the P&L injects that row itself
 *  (withPayrollHeadcountRows, which is PL-only). So when no real CF row matches it,
 *  this injects the same "Headcount (Payroll)" line right above CF's own Total COGS
 *  band (same slot convention as the P&L injection) — that keeps CF's Total COGS
 *  reconcilable with P&L's Total COGS instead of silently missing the payroll cash
 *  out. Falls back to the end of the COGS section if no Total COGS row exists; if the
 *  CF sheet has no COGS section at all, the row is skipped here and the $ still lands
 *  in "Net Projected Cash Flow" below (never silently dropped from the net). */
/** Builds BOTH the real numeric value (always — Total rollups, the calc popover, and
 *  the Net Change in Cash math all need a real number, never a React node) and, for an
 *  account explicitly set to Manual in the sidebar, a `monthCells` override with a live
 *  editable <MonthInput> for that cell — 2026-08-19, Kayee: "manual input should be
 *  like in the screenshot... if I input manual then I should be able to put it in the
 *  cash flow monthly section" — instead of typing into a separate list of month rows
 *  buried in the sidebar card. Both places read/write the exact same
 *  `timing.manualByMonth`, so switching a row between the sidebar and inline editing
 *  never loses or forks the data. Non-manual accounts get no monthCells entry, so the
 *  table's usual formatted-$ rendering applies unchanged. */
function cfOutflowCell(account, timing, iso, forecastSet, accrualCtx, onSetTiming) {
  const value = cashOutflowForMonth(account, timing, iso, forecastSet, accrualCtx);
  if (timing?.mode !== 'manual' || !onSetTiming) return { value, cell: undefined };
  const cell = (
    <MonthInput
      value={Number(timing?.manualByMonth?.[iso]) || 0}
      onCommit={(n) =>
        onSetTiming(account.id, { ...timing, mode: 'manual', manualByMonth: { ...(timing?.manualByMonth || {}), [iso]: n } })
      }
    />
  );
  return { value, cell };
}

// Maps each CF revenue row label to (a) which customerInflow breakdown field is its
// live Customer-tab source, and (b) the P&L Assumptions fallback calc for any month
// the Customer tab hasn't saved a number for yet.
const CF_REVENUE_ROW_FORMULAS = {
  'Transaction Revenue': { customerField: 'transactionByMonth', fallback: meetingRevenueForMonth },
  'Subscription Revenue': { customerField: 'subscriptionByMonth', fallback: upfrontRevenueForMonth },
};

/** Patches the CF sheet's own "Transaction Revenue" / "Subscription Revenue" rows for
 *  forecast months (2026-08-20, Kayee: "transactional revenue is the calculation with
 *  the # of meeting * price per meeting and the subscription is the other... it needs
 *  to be link from the customer live"). Reads the Customer Cash Flow tab's live
 *  localStorage handoff (cfProjection.customerInflow, from readCustomerInflowTotals())
 *  first — a dummy number typed into Customer for July really does show up here for
 *  July, confirmed 2026-08-20. Falls back to meetingRevenueForMonth/
 *  upfrontRevenueForMonth off the P&L Assumptions revenue object ONLY for a forecast
 *  month the Customer tab has never saved a value for in this browser (customerInflow
 *  is null before its first visit, or a specific iso is simply absent from its
 *  totals) — so this never goes blank just because nobody has opened Customer tab yet,
 *  but a real Customer-tab number always wins once one exists.
 *  Runs BEFORE withSectionTotalRollups so CF's "Total Cash In from Operations" band
 *  (blank for forecast months otherwise) picks these up automatically. */
function withCFRevenueInflowRows(rows, months, lastActualIndex, cfProjection) {
  const { accrualCtx, customerInflow } = cfProjection;
  const forecastMonths = months.slice(lastActualIndex + 1);
  if (forecastMonths.length === 0) return rows;

  return rows.map((row) => {
    if (row.isTotal) return row;
    const formula = CF_REVENUE_ROW_FORMULAS[String(row.label ?? '').trim()];
    if (!formula) return row;
    const values = { ...row.values };
    for (const iso of forecastMonths) {
      const fromCustomer = customerInflow?.[formula.customerField]?.[iso];
      values[iso] = fromCustomer != null ? fromCustomer : accrualCtx?.revenue ? formula.fallback(accrualCtx.revenue, iso) || 0 : 0;
    }
    return { ...row, values };
  });
}

function withCFExpenseCashOutflowRows(rows, months, lastActualIndex, cfProjection) {
  const { expenseAccounts, timingByAccount, accrualCtx, onSetTiming } = cfProjection;
  const forecastMonths = months.slice(lastActualIndex + 1);
  if (forecastMonths.length === 0) return rows;
  const forecastSet = new Set(forecastMonths);

  const accountByLabel = new Map();
  for (const account of [...expenseAccounts.cogsAccounts, ...expenseAccounts.opexAccounts]) {
    const label = String(account.label ?? '').trim();
    if (label && !accountByLabel.has(label)) accountByLabel.set(label, account);
  }

  const matchedIds = new Set();
  let next = rows.map((row) => {
    if (row.isTotal) return row;
    const account = accountByLabel.get(String(row.label ?? '').trim());
    if (!account) return row;
    matchedIds.add(account.id);
    const values = { ...row.values };
    const monthCells = { ...(row.monthCells || {}) };
    let hasManualCell = false;
    for (const iso of forecastMonths) {
      const { value, cell } = cfOutflowCell(account, timingByAccount[account.id], iso, forecastSet, accrualCtx, onSetTiming);
      values[iso] = value;
      if (cell !== undefined) {
        monthCells[iso] = cell;
        hasManualCell = true;
      } else {
        delete monthCells[iso];
      }
    }
    // `cfManualRow` flag (2026-08-20, Kayee: "when i add the manual input boxes the
    // boxes make the height of the row taller. i want to keep it the [same] height as
    // the other rows") — lets the <tr> rendering below apply the same compact-padding
    // treatment already used for P&L's # of Campaigns/Meetings driver rows
    // (tr.report-driver-row), instead of the MonthInput's normal (taller) size showing
    // through unchanged.
    return hasManualCell || row.monthCells
      ? { ...row, values, monthCells, cfManualRow: hasManualCell || row.cfManualRow }
      : { ...row, values };
  });

  const payrollAccount = expenseAccounts.cogsAccounts.find((a) => a.synthetic === 'payrollCogs');
  if (payrollAccount && !matchedIds.has(payrollAccount.id)) {
    let insertAt = -1;
    let section = null;
    const totalIdx = next.findIndex((r) => r.isTotal && PAYROLL_HEADCOUNT_TOTAL_LABELS.CoGS.includes(r.label));
    if (totalIdx !== -1) {
      insertAt = totalIdx;
      section = next[totalIdx].section;
    } else {
      for (let i = next.length - 1; i >= 0; i--) {
        if (String(next[i].section ?? '').trim().toUpperCase() === 'COGS') {
          insertAt = i + 1;
          section = next[i].section;
          break;
        }
      }
    }
    if (insertAt !== -1) {
      const values = {};
      const monthCells = {};
      for (const iso of forecastMonths) {
        const { value, cell } = cfOutflowCell(payrollAccount, timingByAccount[payrollAccount.id], iso, forecastSet, accrualCtx, onSetTiming);
        values[iso] = value;
        if (cell !== undefined) monthCells[iso] = cell;
      }
      next = [
        ...next.slice(0, insertAt),
        { key: 'cf_payroll_headcount_cogs', label: 'Headcount (Payroll)', section, isTotal: false, values, monthCells },
        ...next.slice(insertAt),
      ];
    }
  }

  // Manual/custom P&L accounts (2026-08-20, Kayee: "no account or expenses should be
  // missed from here" — spotted "Vetric", an account she added via P&L's "+ Add
  // account" and gave a Quarterly cash-timing override to in this very sidebar, never
  // showing up anywhere in the CF table). The loop above only knew how to insert ONE
  // specific synthetic row (Payroll's headcount line); every other account this
  // function patches has to already exist as a real row on the CF Google Sheet tab. A
  // manual account never has one — it's not a real GL line, it only exists because the
  // user typed a name into the P&L. Same fix as withManualAccountRows already applies
  // to the P&L statement (that function is PL-only, gated at its very first line), now
  // generalized here for CF: insert a row for any manual account nothing above already
  // matched, right before its section's own Total row (falling back to right after the
  // section's last row), then fill it the same cfOutflowCell way as every other line —
  // so its sidebar cash-timing config (interval/manual) actually has somewhere to land. */
  for (const account of [...expenseAccounts.cogsAccounts, ...expenseAccounts.opexAccounts]) {
    if (!account.manual || matchedIds.has(account.id)) continue;
    let insertAt = next.findIndex((r) => r.isTotal && r.section === account.section);
    if (insertAt === -1) {
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].section === account.section) {
          insertAt = i + 1;
          break;
        }
      }
    }
    if (insertAt === -1) continue;
    const values = {};
    const monthCells = {};
    for (const iso of forecastMonths) {
      const { value, cell } = cfOutflowCell(account, timingByAccount[account.id], iso, forecastSet, accrualCtx, onSetTiming);
      values[iso] = value;
      if (cell !== undefined) monthCells[iso] = cell;
    }
    next = [
      ...next.slice(0, insertAt),
      { key: `cf_${account.id}`, label: account.label, section: account.section, isTotal: false, values, monthCells },
      ...next.slice(insertAt),
    ];
  }

  return next;
}

/** Cash Flow forecast summary rows (2026-08-18, reshaped 2026-08-19). Originally this
 *  appended FOUR rows because the real CF sheet rows weren't being patched at all;
 *  now that withCFExpenseCashOutflowRows above fills every real COGS/OpEx line item
 *  (and withSectionTotalRollups sums them into CF's own Total COGS / Total OpEx
 *  bands), the old "COGS Cash Outflow" / "OpEx Cash Outflow" rollup rows here were
 *  REMOVED — they duplicated the statement's own Total bands and showing the same $
 *  twice invites double-count readings. What remains, forecast months only:
 *
 *   - Customer Cash Inflow — meeting + upfront revenue for the month, computed from
 *     the same Assumptions-tab revenue object the P&L projection itself reads
 *     (cfAccrualCtx.revenue — see the 2026-08-20 rewrite below). Drives the
 *     Beginning/Net Change/Ending Cash rollforward below. Revenue-side wiring was
 *     scoped OUT of the 2026-08-19 reshape (Kayee: "only cash out... all of the cogs
 *     and opex") but added back 2026-08-20 as its own row-level link —
 *     withCFRevenueInflowRows (above withCFExpenseCashOutflowRows) patches the CF
 *     sheet's real "Transaction Revenue" / "Subscription Revenue" rows from the exact
 *     same source, so this "Customer Cash Inflow" summary line and those two real rows
 *     are always the same $ two different ways. (First tried reading a Customer Cash
 *     Flow tab localStorage handoff instead — dropped the same day once it was clear
 *     that tab only has real numbers if someone fills in its own separate driver grid,
 *     which isn't how Kayee actually forecasts revenue.)
 *   - Net Projected Cash Flow — inflow − total COGS/OpEx cash out, kept as a Total
 *     band. Still computed by summing cashOutflowForMonth over every expense account
 *     (not by re-reading the displayed Total rows) — mathematically identical to the
 *     displayed totals for every account that has a CF row, and it also still counts
 *     an account with NO matching CF row (whose $ has nowhere visible to land), so
 *     the net is never understated by a missing sheet row.
 *
 *  Actual months are never touched — real GL cash history stays exactly as the sheet
 *  reported it. */
function withCashFlowProjectionRows(rows, months, lastActualIndex, cfProjection) {
  const { expenseAccounts, timingByAccount, accrualCtx, customerInflow } = cfProjection;
  const forecastMonths = months.slice(lastActualIndex + 1);
  if (forecastMonths.length === 0) return rows;
  const forecastSet = new Set(forecastMonths);

  const netValues = {};
  for (const iso of forecastMonths) {
    // Same source/fallback as withCFRevenueInflowRows above — Customer tab's live
    // saved total first, P&L Assumptions calc only for a month Customer hasn't saved.
    const fromCustomer = customerInflow?.totalsByMonth?.[iso];
    const inflow =
      fromCustomer != null
        ? fromCustomer
        : accrualCtx?.revenue
        ? meetingRevenueForMonth(accrualCtx.revenue, iso) + upfrontRevenueForMonth(accrualCtx.revenue, iso)
        : null;
    let outflow = 0;
    for (const account of [...expenseAccounts.cogsAccounts, ...expenseAccounts.opexAccounts]) {
      outflow += cashOutflowForMonth(account, timingByAccount[account.id], iso, forecastSet, accrualCtx);
    }
    if (inflow != null) inflowValues[iso] = inflow;
    netValues[iso] = (inflow || 0) - outflow;
  }

  // Roll Beginning/Net Change/Ending Cash forward through every forecast month
  // (2026-08-19, Kayee: "the beginning cash of july is the ending cash of june...
  // beginning cash of august is ending cash of july... net cash activity is the total
  // cash in and cash out"). Chains off the SAME netValues this function already
  // computed just above, so "Net Change in Cash" here is always identical to the
  // "Net Projected Cash Flow" total appended below it — never two competing numbers.
  // Seeds from the Ending Cash row's own last ACTUAL month (real GL balance), then
  // walks forward: beginning[this month] = ending[prior month]; ending[this month] =
  // beginning[this month] + netChange[this month]. Only touches forecast months —
  // real GL history for Beginning/Net Change/Ending stays exactly as reported.
  const rowsWithRollforward = (() => {
    const beginningIdx = rows.findIndex((r) => CASH_ROW_PATTERNS.beginning.test(r.label));
    const netChangeIdx = rows.findIndex((r) => CASH_ROW_PATTERNS.netChange.test(r.label));
    const endingIdx = rows.findIndex((r) => CASH_ROW_PATTERNS.ending.test(r.label));
    if (beginningIdx === -1 || netChangeIdx === -1 || endingIdx === -1) return rows;

    const lastActualMonth = months[lastActualIndex];
    let priorEnding = lastActualMonth != null ? Number(rows[endingIdx].values?.[lastActualMonth]) || 0 : 0;

    const beginningValues = { ...rows[beginningIdx].values };
    const netChangeValues = { ...rows[netChangeIdx].values };
    const endingValues = { ...rows[endingIdx].values };
    for (const iso of forecastMonths) {
      const netChange = Number(netValues[iso]) || 0;
      beginningValues[iso] = priorEnding;
      netChangeValues[iso] = netChange;
      endingValues[iso] = priorEnding + netChange;
      priorEnding = endingValues[iso];
    }

    const next = [...rows];
    next[beginningIdx] = { ...rows[beginningIdx], values: beginningValues };
    next[netChangeIdx] = { ...rows[netChangeIdx], values: netChangeValues };
    next[endingIdx] = { ...rows[endingIdx], values: endingValues };
    return next;
  })();

  // The appended "CASH PROJECTION" section (Customer Cash Inflow + Net Projected
  // Cash Flow rows) was REMOVED 2026-08-20 (Kayee: "this is confusing. can you
  // remove" — Customer Cash Inflow read as a misplaced Financing-section line, when
  // customer receipts are Operating activity that the statement's own Transaction/
  // Subscription Revenue rows already show, and Net Projected Cash Flow duplicated
  // the Net Change in Cash rollforward row). The inflow/net math above still runs —
  // it's what drives the Beginning/Net Change/Ending Cash rollforward, which is now
  // the ONLY place the projected net appears.
  return rowsWithRollforward;
}

/** Generic fallback so every fine-grained section Total (e.g. "Total Meals &
 *  Entertainment", "Total Professional Services") also projects forward, not just the
 *  handful of labels PL_COST_PROJECTIONS_BY_LABEL knows a bespoke formula for (Total
 *  COGS/Total OpEx/Gross Profit/etc.). Kayee, 2026-08-10, pointing at a screenshot
 *  where "Tax and Accounting" (linked to a cost item) showed $1,550 for July 2026 but
 *  "Total Professional Services" right below it showed blank: "all of these total
 *  should add up the total for projection too, like total professional services
 *  should be 1550 for july 2026." Nothing in the pipeline before this ever computed a
 *  forecast value for a Total row like this one — it simply isn't one of the labels
 *  PL_COST_PROJECTIONS_BY_LABEL matches, so it stayed blank even once its own visible
 *  children had real numbers.
 *
 *  Runs LAST (after every other row transform — named cost items, custom accounts,
 *  payroll rows, manual accounts), summing whatever's ALREADY on screen for every
 *  other (non-Total) row sharing this Total row's exact `.section`, for every forecast
 *  month only (an actual/booked month is never touched). A Total row that ALREADY has
 *  a real number here (Total COGS, Total OpEx — both computed by their own dedicated
 *  formula above, which by construction already equals the sum of their own section's
 *  rows) is left completely alone; this only ever fills a genuinely blank cell, never
 *  overwrites one, so it can't clash with or double up on an existing formula. */
function withSectionTotalRollups(statementType, rows, months, lastActualIndex) {
  // CF allowed too as of 2026-08-19 — once withCFExpenseCashOutflowRows fills the CF
  // statement's real COGS/OpEx line items for forecast months, the exact same
  // fill-only-blank-Total-cells rollup makes CF's own Total COGS / Total OpEx bands
  // sum them, same as it always did for the P&L. Still can't clash with real data:
  // it only ever fills a genuinely blank forecast cell, never an actual month's.
  if (statementType !== 'PL' && statementType !== 'CF') return rows;
  return rows.map((row) => {
    if (!row.isTotal) return row;
    const siblings = rows.filter((r) => !r.isTotal && r.section === row.section);
    if (siblings.length === 0) return row;
    const patchedValues = { ...row.values };
    for (let i = lastActualIndex + 1; i < months.length; i++) {
      const iso = months[i];
      if (patchedValues[iso] != null) continue;
      let sum = 0;
      let sawAny = false;
      for (const sib of siblings) {
        if (sib.values[iso] != null) {
          sum += sib.values[iso];
          sawAny = true;
        }
      }
      if (sawAny) patchedValues[iso] = sum;
    }
    return { ...row, values: patchedValues };
  });
}

const TOTAL_REVENUE_ROW_LABELS = ['Total Revenue', 'TOTAL REVENUE'];
const GROSS_PROFIT_ROW_LABELS = ['Gross Profit'];

/** Kayee, 2026-08-10: "add gross profit margin % below gross profit both actual and
 *  projection" — unlike every other injected row on this tab, this one is NOT
 *  forecast-only: it's computed for every month, actual and projected alike, straight
 *  from whichever "Total Revenue" and "Gross Profit" values are ALREADY on screen for
 *  that month (real booked $ for an actual month, formula-projected $ for a forecast
 *  one) — so it's automatically correct either way without needing its own separate
 *  actual-vs-forecast logic. Runs LAST, after every other row transform, so it's
 *  reading each row's truly final value. A percentage, not a dollar figure — flagged
 *  `isPercent` so the cell renderer below formats it as "42.3%" instead of "$42". Safe
 *  no-op if "Gross Profit" isn't found on this sheet at all. */
function withGrossProfitMarginRow(rows, months) {
  const gpIdx = rows.findIndex((r) => GROSS_PROFIT_ROW_LABELS.includes(r.label));
  if (gpIdx === -1) return rows;
  const gpRow = rows[gpIdx];
  const revenueRow = rows.find((r) => TOTAL_REVENUE_ROW_LABELS.includes(r.label));
  const values = {};
  for (const iso of months) {
    const revenueVal = revenueRow ? revenueRow.values[iso] : null;
    const gpVal = gpRow.values[iso];
    if (revenueVal != null && gpVal != null && revenueVal !== 0) {
      values[iso] = (gpVal / revenueVal) * 100;
    }
  }
  const marginRow = {
    key: 'gross_profit_margin_pct',
    label: 'Gross Profit Margin %',
    section: gpRow.section,
    isTotal: false,
    isPercent: true,
    values,
  };
  return [...rows.slice(0, gpIdx + 1), marginRow, ...rows.slice(gpIdx + 1)];
}

function StatementDoc({ statement, range, assumptionsState, setAssumptionsState, assumptionsHydrated, mode = 'projection', cfProjection = null }) {
  const { state: payrollState, hydrated: payrollHydrated } = usePayrollState();

  if (!statement) return <div className="cap">No data for this statement yet.</div>;
  // currentMonth = the last ACTUAL month (before any blank padding), so "active-col"
  // still marks the latest real reporting month, not the padded 2030 horizon.
  const currentMonth = statement.months[statement.months.length - 1];
  // In actual mode (2026-08-17, Kayee: "in report it will only show actual"), never
  // extend beyond what the real data has — no forecast columns, no padding. In
  // projection mode, extend through PROJECTION_HORIZON same as always.
  const months = mode === 'actual' ? statement.months : extendMonthsThrough(statement.months, PROJECTION_HORIZON);
  const lastActualIndex = statement.months.length - 1;
  const revenue = assumptionsHydrated ? assumptionsState?.revenue : null;
  const costCtx = {
    revenue,
    costItems: assumptionsHydrated ? assumptionsState?.costItems || [] : [],
    payrollState: payrollHydrated ? payrollState : null,
  };
  // Projection pipeline (2026-08-17, Kayee: "in report it will only show actual" —
  // skip ALL of this in actual mode, show just the real months with no forecast)
  // — every step below is derived from whatever's saved in THIS browser's
  // Assumptions/Payroll localStorage. This Reports panel mounts unconditionally
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
  const yearLabels = yearLabelIndices(months);
  if (mode !== 'projection') {
    // Actual mode — skip all projection logic, return just the real rows.
    // No forecast columns to render, no sidebar, no Assumptions-driven values.
    return (
      <div id="reports" data-range={range} className="table-wrap report-doc" data-doc={statement.type}>
        <table>
          <thead>
            <tr className="report-year-row">
              <th></th>
              {months.map((m, i) => (
                <th key={m} className={rangeClasses(i, lastActualIndex, m)}>
                  {yearLabels.has(i) ? m.slice(0, 4) : ''}
                </th>
              ))}
            </tr>
            <tr>
              <th>Account / Line Item</th>
              {months.map((m, i) => (
                <th key={m} className={`${rangeClasses(i, lastActualIndex, m)}${m === currentMonth ? ' active-col' : ''}`}>
                  <div className="report-month-label">{formatMonthLabel(m)}</div>
                  <div className="report-month-status">ACT</div>
                </th>
              ))}
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
                revenue={null}
                costCtx={null}
                onLinkCostItem={null}
                onAddManualAccount={null}
                onRemoveManualAccount={null}
                onRemoveCostItem={null}
              />
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  // Projection mode — run all the forecast pipelines.
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
    // withCustomAccountRows (auto-inserting a new row for any CoGS cost item with no
    // real GL row match, e.g. Vetric/Misc) is DISABLED as of 2026-08-10 — Kayee: "when
    // i remove the link for vetric and misc and software in cogs the amount is still
    // there. the amount should be removed if i remove the link in assumption and when
    // i drag over it should get added." That auto-insert is exactly what made an
    // unlinked item's $ reappear right away (just as its own new row instead of the
    // one it used to be linked to) — with `matchedCostItemsForRowLabel` now ONLY
    // matching an explicit `linkedRowLabel` (see its own comment above), a cost item
    // with no link should show NOTHING on the P&L at all, not fall back to an
    // auto-generated row of its own. Confirmed again the same day, phrased as a
    // COGS-specific ask: "for cogs assumption you need to apply the same logic as
    // opex assumption. do not auto create account when an account is created in
    // assumption cogs. just let me drag and link them" — this single change already
    // covers both COGS and OpEx identically (COGS was previously the ONLY category
    // with an alias in CUSTOM_ACCOUNT_SECTION_ALIASES, so it was the only one that
    // ever got an auto-row in the first place; OpEx never did). `withNamedCostItemProjections`
    // alone still handles the case that DOES matter — an item's $ patching onto
    // whatever real row it's explicitly linked to, CoGS or OpEx alike.
    const { rows: namedItemRows } = withNamedCostItemProjections(statement.type, rows, costCtx.costItems, months, lastActualIndex);
    rows = namedItemRows;
  } catch (err) {
    console.warn('Custom cost-item row projection failed:', err);
  }
  try {
    rows = withPayrollHeadcountRows(statement.type, rows, costCtx.payrollState, months, lastActualIndex);
  } catch (err) {
    console.warn('Payroll headcount row injection failed:', err);
  }
  if (statement.type === 'PL') {
    try {
      rows = withManualAccountRows(statement.type, rows, assumptionsState?.customPLAccounts, costCtx.costItems, months, lastActualIndex);
    } catch (err) {
      console.warn('Manual account row injection failed:', err);
    }
  }
  if (statement.type === 'PL') {
    try {
      rows = withSectionTotalRollups(statement.type, rows, months, lastActualIndex);
    } catch (err) {
      console.warn('Section Total rollup failed:', err);
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
  if (statement.type === 'PL') {
    try {
      rows = withGrossProfitMarginRow(rows, months);
    } catch (err) {
      console.warn('Gross Profit Margin % row injection failed:', err);
    }
  }
  if (statement.type === 'CF') {
    try {
      rows = withReorderedCashFlowRows(rows);
    } catch (err) {
      console.warn('Cash Flow row reorder failed, showing sheet order:', err);
    }
  }
  if (statement.type === 'CF' && cfProjection) {
    // Order matters: fill the real COGS/OpEx rows first, then roll those into CF's own
    // Total bands, then append the summary section — each step guarded separately,
    // same isolation rule as the P&L pipeline above.
    try {
      rows = withCFRevenueInflowRows(rows, months, lastActualIndex, cfProjection);
    } catch (err) {
      console.warn('Cash Flow revenue inflow projection failed:', err);
    }
    try {
      rows = withCFExpenseCashOutflowRows(rows, months, lastActualIndex, cfProjection);
    } catch (err) {
      console.warn('Cash Flow expense cash-outflow projection failed:', err);
    }
    try {
      rows = withSectionTotalRollups(statement.type, rows, months, lastActualIndex);
    } catch (err) {
      console.warn('Cash Flow section Total rollup failed:', err);
    }
    try {
      rows = withCashFlowProjectionRows(rows, months, lastActualIndex, cfProjection);
    } catch (err) {
      console.warn('Cash Flow projection row injection failed:', err);
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
    // No longer clears any OTHER item's link to this same row (2026-08-10, Kayee: "I
    // dragged Central - Bookkeeping and Central - Payroll both to Tax and Accounting
    // ... I want to assign both, in P&L it will add the amount, and here it will show
    // both are linked") — more than one cost item can now feed the same P&L line at
    // once; matchedCostItemsForRowLabel sums all of them together wherever this row's
    // value is computed. Only THIS item's own link changes here.
    const nextCostItems = assumptionsState.costItems.map((item) =>
      item.id === itemId ? { ...item, linkedRowLabel: rowLabel } : item
    );
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

  // Delete a Non-Headcount Cost item directly from its auto-generated `row.custom`
  // line on the P&L itself (2026-08-10, Kayee: "there's no trash icon for vetric and
  // misc, i want to delete it here inside of cogs") — previously the ONLY way to
  // delete one of these was the trash icon on the Assumptions sidebar's own
  // Non-Headcount Cost table; this is the exact same deletion, just reachable from
  // where Kayee is actually looking at it. Deletes the item outright (not just an
  // unlink) — a `row.custom` row only exists in the first place because this cost item
  // has no real GL row to attach to, so "remove this row" and "delete this cost item"
  // are the same action here (unlike a manual account, which can outlive the item that
  // was linked to it).
  function handleRemoveCostItem(itemId, label) {
    if (!assumptionsState?.costItems) return;
    // Same confirm() guard every other row-delete in the app already has (Roster,
    // Bonus, Hiring Plan, Customer tab rows, and the Assumptions sidebar's own trash
    // icon for this exact item) — this entry point was missing it (2026-08-19 audit).
    if (
      typeof window !== 'undefined' &&
      !window.confirm(`Delete ${label || 'this cost item'}? This removes it everywhere it's used.`)
    ) {
      return;
    }
    setAssumptionsState({
      ...assumptionsState,
      costItems: assumptionsState.costItems.filter((i) => i.id !== itemId),
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
            {months.map((m, i) => (
              // One real cell per month — same column model as the row below, so a
              // range-toggle hide can never desync the two rows (a colSpan cell here
              // previously caused exactly that: see 2026-08-04 bug where a hidden
              // month left this row's year label sitting over the wrong column).
              // The year TEXT only renders on the center month of its year's run
              // (yearLabelIndices, 2026-08-19: "the year should be center align") —
              // every cell in the run still shares the same background, so
              // consecutive same-year cells read as one continuous band either way.
              <th key={m} className={rangeClasses(i, lastActualIndex, m)}>
                {yearLabels.has(i) ? m.slice(0, 4) : ''}
              </th>
            ))}
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
              onRemoveCostItem={statement.type === 'PL' ? handleRemoveCostItem : null}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FragmentRows({ section, rows, months, currentMonth, lastActualIndex, revenue, costCtx, onLinkCostItem, onAddManualAccount, onRemoveManualAccount, onRemoveCostItem }) {
  // Which row (by key) currently has a cost item dragged over it — purely visual
  // feedback for the drag-and-drop cost-item-to-P&L-row linking feature (2026-08-10,
  // see handleLinkCostItem in StatementDoc for the full reasoning). Local to this
  // section's row group; nothing here is persisted, it just paints a highlight while
  // a drag is in progress.
  const [dragOverKey, setDragOverKey] = useState(null);

  // Per-section collapse (2026-08-10, Kayee: "have it collapsable for anything under
  // each section... in cogs you will collapse everything until the total cogs, keep
  // cogs and total cogs") — clicking the section band (e.g. "COGS") hides every
  // non-Total row in between, leaving just the section header and its own Total row
  // visible, same idea as the Payroll tab's own collapsible outer sections. Expanded
  // by default so nothing changes for anyone who hasn't touched this yet. Local to
  // this one section's row group, same as dragOverKey above — collapsing COGS has no
  // effect on OpEx's own state.
  const [collapsed, setCollapsed] = useState(false);

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
  // Non-operating sections (NON OPEX, NON-OPERATING INCOME & EXPENSES, UNCATEGORIZED
  // EXPENSES — the COA's 80000/90000 "NOpex" range) map to the 'Other' cost-item
  // category (2026-08-20, Kayee: "why wont it let me drag to non opex misc from the
  // other misc" — these sections used to fall into the default OpEx bucket, so a
  // "Non-Headcount Cost - Other" item's application/x-cost-item-other drag was
  // rejected by the only rows it actually belongs on).
  const sectionCategory =
    sectionUpper === 'REVENUE'
      ? null
      : sectionUpper === 'COGS'
      ? 'CoGS'
      : /NON[ -]?OP|UNCATEGORIZED/.test(sectionUpper)
      ? 'Other'
      : 'OpEx';
  const dropMimeType = sectionCategory ? `application/x-cost-item-${sectionCategory.toLowerCase()}` : null;

  // Skip the section header band entirely when a section contains ONLY Total rows
  // (2026-08-20, Kayee, pointing at CF's "CASH IN" band sitting alone above "Total
  // Cash In": "is this row needed? if not it's redundant. remove") — a band with no
  // line items under it to collapse/label is pure noise; the Total row it introduces
  // is already self-labeling ("Total Cash In").
  const hasLineItems = rows.some((r) => !r.isTotal);

  return (
    <>
      {/* Two cells, not one colSpan cell — position:sticky on a <td> with colspan doesn't
          reliably stick in table layout (a well-known cross-browser limitation), which
          was letting the section band's label scroll away with the rest of the row. A
          real single-column first cell sticks the same way a normal data row's does. */}
      {hasLineItems && (
      <tr className="section report-section-toggle" onClick={() => setCollapsed((c) => !c)}>
        <td>
          <span className={`report-section-chevron${collapsed ? '' : ' open'}`}>▸</span>
          {section}
        </td>
        <td colSpan={months.length}></td>
      </tr>
      )}
      {/* "+ Add account" now renders right BEFORE this section's own Total row
          (2026-08-10 fix, Kayee: "i click add account above travel thinking that it
          will get added to travel but then it was added to the one above") — it used
          to sit after every row INCLUDING Total, which put it visually sandwiched
          between "Total [This Section]" and the NEXT section's header/first row
          (e.g. right above where "Travel" happened to sit), even though clicking it
          actually added the new line to THIS section (the one whose Total just
          printed above it) — exactly backwards from what it looked like. Splitting
          the rows into non-Total / Total groups and inserting the trigger between
          them puts it inside its own section, immediately above that section's own
          Total, matching where a newly added account actually lands
          (withManualAccountRows already inserts right before the section's Total). */}
      {(() => {
        // Margin-% rows render AFTER the section's Total row, not before (2026-08-20,
        // Kayee: "move grpm% between gross profit and salaries") — PROFITABILITY's
        // "Gross Profit Margin %" used to land above "Gross Profit" purely because of
        // the non-Total-rows-first split below, which read backwards: the % is derived
        // FROM the total, so it belongs directly under it.
        const isMarginRow = (r) => /margin\s*%/i.test(String(r.label));
        const nonTotalRows = rows.filter((r) => !r.isTotal && !isMarginRow(r));
        const marginRows = rows.filter((r) => !r.isTotal && isMarginRow(r));
        const totalRows = rows.filter((r) => r.isTotal);
        return (
          <>
            {!collapsed && nonTotalRows.map(renderRow)}
            {!collapsed && onAddManualAccount && <AddAccountRow section={section} months={months} onAdd={onAddManualAccount} />}
            {totalRows.map(renderRow)}
            {!collapsed && marginRows.map(renderRow)}
          </>
        );
      })()}
    </>
  );

  function renderRow(row) {
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
            (row.custom || row.manualAccount || row.payrollHeadcount ? customAccountCalcExplanation(row) : null);
        } catch (err) {
          console.warn('Reports calc-note lookup failed for a row label, showing plain label:', err);
        }
        // The Campaigns/Meetings driver rows and any Revenue-section row aren't valid
        // drop targets at all. Everything else — including Total rows — is fair game,
        // but ONLY for a cost item whose own category matches this row's section
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
        // `row.payrollHeadcount` excluded (2026-08-10) — this row's $ comes straight
        // from the Payroll tab's roster/bonus totals, not from a linked cost item, so
        // dropping a cost item on it would silently do nothing rather than actually
        // add the $ anywhere.
        const isDropTarget = !!onLinkCostItem && !row.driver && !row.payrollHeadcount && !row.isPercent && !!sectionCategory;
        return (
          <tr
            key={row.key}
            className={row.isTotal ? 'total' : row.driver ? 'report-driver-row' : row.cfManualRow ? 'cf-manual-row' : undefined}
          >
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
              {/* Delete a Non-Headcount Cost item straight from its own auto-generated
                  P&L row (2026-08-10, Kayee: "there's no trash icon for vetric and
                  misc, i want to delete it here inside of cogs") — deletes the item
                  outright, same as the Assumptions sidebar's own trash icon does,
                  just reachable from right here too. */}
              {row.custom && onRemoveCostItem && (
                <button
                  type="button"
                  className="report-manual-account-remove"
                  title="Delete this cost item"
                  onClick={() => onRemoveCostItem(row.key.replace('custom_cost_', ''), row.label)}
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
              // A percent row (currently just Gross Profit Margin %, 2026-08-10) shows
              // "42.3%" instead of a dollar figure — and unlike every $ row, a genuine
              // 0.0% is still a real, worth-showing number, not noise to blank out.
              let cellText;
              if (row.isPercent) {
                cellText = row.values[m] != null ? `${row.values[m].toFixed(2)}%` : '';
              } else {
                const rounded = row.values[m] != null ? Math.round(row.values[m]) : 0;
                cellText = rounded ? `$${rounded.toLocaleString('en-US')}` : '';
              }
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
  }
}

/** The "+ Add account" trigger, rendered right above each P&L section's own Total row
 *  (2026-08-10, Kayee: "give me the ability to add a new account under each section so
 *  i can add other travel and drag travel there"; moved up from below Total the same
 *  day — see FragmentRows above) — a plain text link until clicked, then a one-line
 *  inline name field, same collapsed-by-default convention as the rate-schedule
 *  controls elsewhere on this tab. Submitting inserts a new blank row into THIS
 *  section (via withManualAccountRows, right before its Total row — matching exactly
 *  where this trigger itself now sits), ready to be a drag-and-drop target for any
 *  Non-Headcount Cost item. */
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
