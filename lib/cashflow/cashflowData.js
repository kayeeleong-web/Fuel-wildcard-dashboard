/**
 * Shared Cash Flow constants (2026-09-07). This file was a deprecated stub from the
 * rejected 2026-08-18 first pass; it now holds the one thing both ReportsPanel.jsx and
 * CashFlowAssumptionsSidebar.jsx need without importing each other.
 *
 * CF_INFLOW_ACCOUNTS — the two revenue cash-in rows on the CF sheet, given synthetic
 * account ids so the Weekly Cash Flow's per-account week-placement override (the same
 * `timingByAccount[id].weekPlacements` mechanism every COGS/OpEx account already has)
 * can be applied to cash COMING IN as well. Default with no entry = last day of the
 * month (Kayee, 2026-09-07: "for the weekly cash flow, you can default it to the last
 * day of the month, and then the user would have the ability to adjust which week or
 * which day of the month they will receive the payment"). Keyed by the CF row's exact
 * label, the same match CF_REVENUE_ROW_FORMULAS in ReportsPanel.jsx uses.
 */
export const CF_INFLOW_ACCOUNTS = {
  'Subscription Revenue': { id: 'inflow_subscription_revenue', label: 'Subscription Revenue (contract cash)', section: 'Cash In' },
  'Transaction Revenue': { id: 'inflow_transaction_revenue', label: 'Transaction Revenue (success fee cash)', section: 'Cash In' },
};

export const CF_INFLOW_ACCOUNT_LIST = Object.values(CF_INFLOW_ACCOUNTS);
