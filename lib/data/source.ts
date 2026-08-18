import type {
  KPIReportData,
  StatementType,
  ReportRange,
  FinancialStatementData,
  CustomReportData,
  DashboardSummary,
  GLTab,
  GLTransactionData,
} from "./types";

/**
 * Contract every data backend (Google Sheets today, QBO later, anything else after that)
 * must implement. Pages/components import from `lib/data` (the factory), never from a
 * specific source file — swapping a client's backend is a one-line config change, not a
 * rewrite of the UI.
 */
export interface DataSource {
  getKPIData(): Promise<KPIReportData>;
  getStatement(type: StatementType, range: ReportRange): Promise<FinancialStatementData>;
  getCustomReport(reportId: string): Promise<CustomReportData>;
  listCustomReports(): Promise<Pick<CustomReportData, "id" | "name" | "generatedAt" | "status">[]>;
  /** The Dashboard tab's Executive Summary — see DashboardSummary for why this is
   *  authored offline rather than computed. */
  getDashboardSummary(): Promise<DashboardSummary>;
  /** Raw transaction-level GL export ("GL Cash" / "GL Accrued") for the Customer
   *  Cash Flow waterfall. Throws when the tab is missing/misshapen — callers wrap
   *  the call and surface a visible misconfigured-data state (see app/page.js). */
  getGLTransactions(tab: GLTab): Promise<GLTransactionData>;
}

/** How long fetched data may be served stale before re-fetching, in seconds. */
export const DEFAULT_REVALIDATE_SECONDS = 300;
