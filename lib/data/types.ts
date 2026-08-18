/**
 * Fuel Finance — Client Dashboard Data Layer
 * Shared types every DataSource implementation (Google Sheets, QBO, ...) must return.
 * UI components consume these shapes only — never a raw sheet row or raw API payload.
 */

export type Unit = "currency" | "percent" | "number" | "ratio";

/** One row of the KPI Report tab's metrics table. */
export interface MetricRow {
  key: string; // stable id, e.g. "new_mrr"
  label: string; // e.g. "New MRR"
  section: string; // e.g. "Pipeline & Growth" — used for the green section-band grouping
  unit: Unit;
  current: number | null;
  prior: number | null; // prior month
  priorYear: number | null; // same month, prior year
  ytd: number | null;
  ttm: number | null;
  benchmark: number | null; // null => render em dash, never blank
  isTotal?: boolean; // true => bold "total" row styling (black band, green borders)
  /** Trailing 12 months, oldest → newest, for the KPI Report hero chart's metric
   *  dropdown (design-rules.md §3). Not every metric needs to be charted, but the
   *  data must exist for any metric the dropdown offers — never show a metric in the
   *  dropdown whose trend array is empty. */
  trend?: number[];
}

export interface KPIReportData {
  /** ISO month this report is anchored on, e.g. "2026-06" */
  month: string;
  rows: MetricRow[];
}

export type StatementType = "PL" | "CF" | "BS";
export type ReportRange = "6M" | "12M" | "24M";

/**
 * One line item of a financial statement (P&L / Cash Flow / Balance Sheet).
 * `values` is keyed by ISO month ("2026-06") so the range toggle can hide columns
 * without ever touching `label` — label/section/isTotal must stay visible at every range.
 */
export interface FinancialStatementRow {
  key: string;
  label: string;
  section: string;
  isTotal: boolean;
  values: Record<string, number | null>;
}

export interface FinancialStatementData {
  type: StatementType;
  months: string[]; // ordered ISO months actually available, oldest → newest
  rows: FinancialStatementRow[];
}

/** Ad-hoc / custom report (e.g. AR Aging) — free-form columns, no month-range toggle. */
export interface CustomReportData {
  id: string;
  name: string;
  generatedAt: string; // ISO timestamp
  status: "Ready" | "In Review" | "Scheduled" | "Draft";
  columns: string[];
  rows: Record<string, string | number | null>[];
}

/** Which raw GL export tab a transaction set came from. */
export type GLTab = "GL Cash" | "GL Accrued";

/** One raw GL transaction row, already normalized (columns located by header name,
 *  never by hardcoded index — the export's column order is not part of any contract). */
export interface GLTransaction {
  date: string; // raw date string as it appears in the sheet
  month: string; // ISO "YYYY-MM" derived from date
  account: string; // GL account number/name — customer revenue accounts start with "4"
  counterparty: string; // Counterparty Name — the customer
  amount: number;
}

/**
 * Transaction-level GL export ("GL Cash" / "GL Accrued" tabs) feeding the Customer
 * Cash Flow waterfall. `error` is set instead of throwing when the tab is missing or
 * a required column can't be located, so ONE misconfigured GL tab degrades to a
 * visible "data source misconfigured" notice in its section rather than taking down
 * the whole page (CLAUDE.md: never silently wrong, never silently zeroed).
 */
export interface GLTransactionData {
  tab: string;
  transactions: GLTransaction[];
  error?: string;
}

/**
 * The Dashboard tab's Executive Summary narrative — the one piece of genuinely
 * *written* content in the data layer. This is authored offline (an FM running a
 * Claude analysis skill against raw transactions, per the close-cycle workflow — see
 * lib/data/README.md "Where the narrative comes from"), never generated live by an
 * LLM call at page-render time. `criticalPhrase`, if present, must be a verbatim
 * substring of `narrative` — the panel bolds/pinks exactly that phrase, nothing else.
 */
export interface DashboardSummary {
  month: string;
  narrative: string;
  criticalPhrase?: string;
}
