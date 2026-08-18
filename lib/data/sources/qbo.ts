import type { DataSource } from "../source";
import type {
  KPIReportData,
  StatementType,
  ReportRange,
  FinancialStatementData,
  CustomReportData,
  DashboardSummary,
  GLTab,
  GLTransactionData,
} from "../types";

/**
 * QuickBooks Online DataSource — PLACEHOLDER.
 *
 * Not implemented yet. Wiring it in is the reason `DataSource` exists as an interface
 * instead of every page importing `GoogleSheetsDataSource` directly: once this class is
 * filled in (using the existing QBO connector's report endpoints — P&L, Cash Flow,
 * Balance Sheet, AP/AR aging map cleanly onto `getStatement` / `getCustomReport`), any
 * client repo switches source by changing `dataSource.type` in `client.config.ts` —
 * zero changes to pages/components, because they only ever talk to the DataSource
 * interface, never to Sheets or QBO directly.
 *
 * TODO before using in a client repo:
 *  - Map QBO's ProfitAndLoss/CashFlow/BalanceSheet report endpoints to FinancialStatementData
 *  - Decide the KPI source (QBO alone doesn't have "KPI_Report" — likely still Sheets-fed,
 *    meaning some clients may end up on a *mixed* source; revisit the interface if so)
 *  - Auth model per client (QBO uses OAuth + refresh tokens, not a static service-account key —
 *    this is a different credential-lifecycle problem than Sheets, don't assume it's the same)
 */
export class QBODataSource implements DataSource {
  constructor(_realmId?: string) {
    // realmId identifies the QBO company per client; wire up when this source is built.
  }

  async getKPIData(): Promise<KPIReportData> {
    throw new Error("QBODataSource.getKPIData() not implemented yet.");
  }

  async getStatement(_type: StatementType, _range: ReportRange): Promise<FinancialStatementData> {
    throw new Error("QBODataSource.getStatement() not implemented yet.");
  }

  async listCustomReports(): Promise<
    Pick<CustomReportData, "id" | "name" | "generatedAt" | "status">[]
  > {
    throw new Error("QBODataSource.listCustomReports() not implemented yet.");
  }

  async getCustomReport(_reportId: string): Promise<CustomReportData> {
    throw new Error("QBODataSource.getCustomReport() not implemented yet.");
  }

  async getDashboardSummary(): Promise<DashboardSummary> {
    throw new Error("QBODataSource.getDashboardSummary() not implemented yet.");
  }

  async getGLTransactions(_tab: GLTab): Promise<GLTransactionData> {
    // QBO's TransactionList report maps onto this when the source is built.
    throw new Error("QBODataSource.getGLTransactions() not implemented yet.");
  }
}
