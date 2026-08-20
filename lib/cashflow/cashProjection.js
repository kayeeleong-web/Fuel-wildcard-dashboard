/**
 * Cash Flow projection building blocks (2026-08-18 rebuild — Kayee rejected the first
 * cosmetic-only CF sidebar: "the controls must actually drive the projection").
 *
 * Three responsibilities, all consumed by ReportsPanel's CF projection pipeline and by
 * CashFlowAssumptionsSidebar:
 *
 *  1. plExpenseAccounts() — turns the live P&L statement's own chart-of-account rows
 *     into the COGS/OpEx account lists the CF sidebar shows per-account cash-timing
 *     controls for. Same section-categorization rule as ReportsPanel's FragmentRows:
 *     section "REVENUE" is skipped, section "COGS" is COGS, every other section is
 *     some flavor of OpEx (this client's sheet has no single flat "OpEx" section).
 *
 *  2. plAccrualForMonth() — the projected P&L accrual $ for ONE account in ONE
 *     forecast month, computed from the exact same building blocks the P&L projection
 *     pipeline itself uses (linked Non-Headcount Cost items, Cost of campaigns'
 *     campaign-count formula, Payroll's salaries/taxes/benefits/bonus calcs). An
 *     account nothing feeds projects $0 accrual — same "blank, never fabricated"
 *     honesty rule as the P&L table itself.
 *
 *  3. cashOutflowForMonth() — applies the user's per-account cash-timing config
 *     (Follow P&L / custom interval / manual) to that accrual series, producing the
 *     actual cash-out $ for a month. Quarterly/annual intervals aggregate the accruals
 *     of the whole cycle into the single chosen payment month (e.g. $400/mo accrual
 *     paid quarterly in month 3 → $1,200 in Mar/Jun/Sep/Dec, $0 in between).
 *
 * CUSTOMER_INFLOW_STORAGE_KEY is the CustomerPanel → CF projection handoff: the
 * Customer Cash Flow tab writes its computed monthly "Cash Coming In" TOTALs to this
 * localStorage key whenever its inputs change (see CustomerPanel.jsx); the CF
 * projection reads it on mount via readCustomerInflowTotals(). The two panels are
 * sibling sub-tabs that unmount on tab switch, so read-on-mount always sees the
 * latest save — no live cross-component wiring needed.
 */

import {
  costItemAmountForMonth,
  costPerCampaignForMonth,
} from '../assumptions/assumptionsData';
import {
  headcountCostByCostType,
  headcountSalariesByCostType,
  headcountPayrollTaxesByCostType,
  headcountBenefitsByCostType,
  headcountBonusByCostType,
} from '../payroll/payrollData';

export const CUSTOMER_INFLOW_STORAGE_KEY = 'fuel_wildcard_customer_inflow_v1';

/** Reads the Customer tab's saved monthly cash-in — both the combined TOTAL (used for
 *  the Beginning/Ending Cash rollforward math, unchanged) and, as of the 2026-08-20
 *  breakdown (Kayee: "transactional revenue is the calculation with the # of meeting *
 *  price per meeting and the subscription is the other... it needs to be link from the
 *  customer live"), the same total split into `transactionByMonth` (meetings × per-
 *  meeting price, feeds the CF sheet's own "Transaction Revenue" row) and
 *  `subscriptionByMonth` (campaigns × upfront price, feeds "Subscription Revenue") —
 *  matching the exact same Meeting $ / Upfront $ naming the P&L projection already
 *  uses for these two revenue streams. Returns null (not zeros) when the Customer tab
 *  has never saved in this browser, so CF rows render visibly blank instead of a
 *  silently-wrong $0. Still reads version-1 saves (pre-breakdown) fine — the two new
 *  fields just come back null in that case, so only the combined total/rollforward
 *  keeps working until the Customer tab re-saves. */
export function readCustomerInflowTotals() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CUSTOMER_INFLOW_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || (parsed.version !== 1 && parsed.version !== 2) || typeof parsed.totalsByMonth !== 'object' || !parsed.totalsByMonth) {
      return null;
    }
    return {
      totalsByMonth: parsed.totalsByMonth,
      transactionByMonth: parsed.transactionByMonth && typeof parsed.transactionByMonth === 'object' ? parsed.transactionByMonth : null,
      subscriptionByMonth: parsed.subscriptionByMonth && typeof parsed.subscriptionByMonth === 'object' ? parsed.subscriptionByMonth : null,
    };
  } catch {
    return null;
  }
}

// Same raw-section-string matching as ReportsPanel's findSalariesBenefitsSection —
// the payroll calcs patch these OpEx rows on the P&L, so the CF accrual for them must
// come from the same payroll math, not from a (nonexistent) linked cost item.
const SB_SECTION_NAMES = ['salaries & benefits', 'salaries and benefits'];

// Computed profit/margin lines share expense sections on some sheets without carrying
// isTotal — they are NOT cash-outflow accounts, so they never belong in the sidebar's
// account lists. "Total ..." also caught here for sheets that don't flag totals.
const NON_EXPENSE_LABEL = /^(total\s|gross (profit|margin)|operating (profit|income|margin)|net (income|profit|margin|change)|ebitda|beginning.*cash|ending.*cash)/i;

/**
 * COGS/OpEx account lists straight from the live P&L statement's rows, plus any
 * user-added manual P&L accounts (customPLAccounts, from the P&L projection's
 * "+ Add account"). Returns { cogsAccounts, opexAccounts, sbSection }.
 *
 * A synthetic "Headcount (Payroll)" COGS account is appended because the P&L
 * projection injects that row itself (withPayrollHeadcountRows) — it's a real
 * projected cost that must flow to cash even though it isn't a sheet row.
 */
export function plExpenseAccounts(plStatement, customPLAccounts) {
  const cogsAccounts = [];
  const opexAccounts = [];
  let sbSection = null;

  if (plStatement && plStatement.type === 'PL') {
    for (const row of plStatement.rows) {
      const sectionUpper = String(row.section ?? '').trim().toUpperCase();
      if (sectionUpper === 'REVENUE') continue;
      if (row.isTotal) continue;
      if (NON_EXPENSE_LABEL.test(String(row.label ?? '').trim())) continue;
      if (sbSection == null && SB_SECTION_NAMES.includes(String(row.section ?? '').trim().toLowerCase())) {
        sbSection = row.section;
      }
      const account = { id: row.key || row.label, label: row.label, section: row.section };
      if (sectionUpper === 'COGS') cogsAccounts.push(account);
      else opexAccounts.push(account);
    }
    cogsAccounts.push({
      id: 'payroll_headcount_cogs',
      label: 'Headcount (Payroll)',
      section: 'COGS',
      synthetic: 'payrollCogs',
    });
  }

  for (const acct of customPLAccounts || []) {
    const sectionUpper = String(acct.section ?? '').trim().toUpperCase();
    if (sectionUpper === 'REVENUE') continue;
    const account = { id: `manual_${acct.id}`, label: acct.label, section: acct.section, manual: true };
    if (sectionUpper === 'COGS') cogsAccounts.push(account);
    else opexAccounts.push(account);
  }

  return { cogsAccounts, opexAccounts, sbSection };
}

/**
 * Projected P&L accrual $ for one account in one forecast month. `ctx` is
 * { revenue, costItems, payrollState, sbSection } — the same hydrated Assumptions +
 * Payroll state the P&L projection pipeline reads. Returns 0 for an account nothing
 * feeds (matching the blank cell the projected P&L itself would show).
 */
export function plAccrualForMonth(account, iso, ctx) {
  const { revenue, costItems, payrollState, sbSection } = ctx || {};

  if (account.synthetic === 'payrollCogs') {
    return payrollState
      ? headcountCostByCostType(payrollState.roster, payrollState.bonuses, payrollState.assumptions, 'CoGS', iso)
      : 0;
  }

  let total = 0;

  // "Cost of campaigns" is Kayee's confirmed formula row (last month's campaigns ×
  // campaign cost rate) — same source as PL_COST_PROJECTIONS_BY_LABEL in ReportsPanel.
  if (account.label === 'Cost of campaigns' && revenue) {
    total += costPerCampaignForMonth(revenue, iso);
  }

  // Payroll-anchored OpEx rows inside the "Salaries & Benefits" sub-section — the P&L
  // projection patches these rows' forecast cells from Payroll's own math
  // (withPayrollHeadcountRows), so cash must follow the same figures.
  if (sbSection != null && account.section === sbSection && payrollState) {
    const label = String(account.label ?? '').trim().toLowerCase();
    const calc =
      label === 'salaries'
        ? headcountSalariesByCostType
        : label === 'payroll taxes' || label === 'taxes'
          ? headcountPayrollTaxesByCostType
          : label === 'benefits'
            ? headcountBenefitsByCostType
            : label === 'bonuses' || label === 'bonus'
              ? headcountBonusByCostType
              : null;
    if (calc) {
      total += calc(payrollState.roster, payrollState.bonuses, payrollState.assumptions, 'OpEx', iso);
    }
  }

  // Explicitly linked Non-Headcount Cost items (linkedRowLabel is the drag-and-drop
  // link Kayee sets on the P&L projection — the ONLY thing that puts a cost item's $
  // on a P&L row, per the 2026-08-10 no-auto-matching rule).
  for (const item of costItems || []) {
    if (item.linkedRowLabel === account.label) {
      total += costItemAmountForMonth(item, iso);
    }
  }

  return total;
}

/**
 * Cash out the door for one account in one forecast month, per its timing config:
 *  - no config / mode 'followPL' → cash equals that month's P&L accrual, 1:1
 *  - mode 'interval'  → frequency 'monthly' | 'quarterly' | 'annually'; payMonth is
 *    which month of the cycle payment lands in (1–3 within a calendar quarter, or a
 *    calendar month 1–12 for annual). The payment month carries the SUM of the whole
 *    cycle's forecast accruals; every other month of the cycle is $0.
 *  - mode 'manual'    → exactly what the user typed for that month (0 if untyped)
 *
 * `forecastSet` bounds cycle aggregation to forecast months only — an actual month's
 * cash is already real GL data, never re-charged into a forecast payment month.
 */
export function cashOutflowForMonth(account, timing, iso, forecastSet, ctx) {
  const mode = timing?.mode || 'followPL';

  if (mode === 'manual') {
    return Number(timing?.manualByMonth?.[iso]) || 0;
  }

  if (mode === 'interval') {
    const frequency = timing?.frequency || 'monthly';
    if (frequency === 'monthly') return plAccrualForMonth(account, iso, ctx);

    const [y, m] = iso.split('-').map(Number);

    if (frequency === 'quarterly') {
      const posInQuarter = ((m - 1) % 3) + 1;
      const payMonth = Math.min(3, Math.max(1, Number(timing?.payMonth) || 3));
      if (posInQuarter !== payMonth) return 0;
      const quarterStart = m - posInQuarter + 1;
      let sum = 0;
      for (let mm = quarterStart; mm < quarterStart + 3; mm++) {
        const cycleIso = `${y}-${String(mm).padStart(2, '0')}`;
        if (forecastSet.has(cycleIso)) sum += plAccrualForMonth(account, cycleIso, ctx);
      }
      return sum;
    }

    // annually — payMonth is a calendar month (1 = Jan … 12 = Dec)
    const payMonth = Math.min(12, Math.max(1, Number(timing?.payMonth) || 1));
    if (m !== payMonth) return 0;
    let sum = 0;
    for (let mm = 1; mm <= 12; mm++) {
      const cycleIso = `${y}-${String(mm).padStart(2, '0')}`;
      if (forecastSet.has(cycleIso)) sum += plAccrualForMonth(account, cycleIso, ctx);
    }
    return sum;
  }

  // followPL (default): cash outflow mirrors the P&L accrual month-by-month.
  return plAccrualForMonth(account, iso, ctx);
}
