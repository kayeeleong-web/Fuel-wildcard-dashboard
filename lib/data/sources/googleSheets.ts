import { google } from "googleapis";
import type { DataSource } from "../source";
import { DEFAULT_REVALIDATE_SECONDS } from "../source";
import type {
  KPIReportData,
  MetricRow,
  StatementType,
  ReportRange,
  FinancialStatementData,
  FinancialStatementRow,
  CustomReportData,
  DashboardSummary,
  Unit,
  GLTab,
  GLTransaction,
  GLTransactionData,
} from "../types";

/**
 * Google Sheets DataSource.
 *
 * ⚠️ Runs on the Node.js runtime only (the `googleapis` package needs Node APIs) —
 * any route/page that calls this must NOT set `export const runtime = "edge"`.
 *
 * Auth: ONE Google Service Account PER CLIENT (never share one account across clients —
 * see fuel-vercel-dashboard-design-rules.md). The client's Sheet is shared with this
 * client's own service-account email as Viewer, and only this repo's env vars hold its key.
 *
 * Required env vars (per client repo):
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL
 *   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY   (base64-encoded — decode before use, see below)
 *   GOOGLE_SHEET_ID
 *
 * Sheet contract (fixed tab names + header rows — do not rename per client):
 *
 *   KPI_Report
 *     Row 1 (headers): Section | Key | Label | Unit | Current | Prior | PriorYear | YTD | TTM |
 *       Benchmark | IsTotal | Trend1..Trend12 (cols L–W, oldest → newest, trailing 12 months —
 *       feeds the hero chart's metric dropdown; leave blank for a metric that isn't chartable)
 *     Cell Y1: the report month as ISO "YYYY-MM" (e.g. "2026-06")
 *     Data starts row 2.
 *
 *   PL / CF / BS
 *     Row 1 (headers): Section | Key | Label | IsTotal | <month columns as ISO "YYYY-MM", oldest → newest>
 *     Data starts row 2.
 *
 *   Custom_Reports_Index
 *     Row 1 (headers): Id | Name | GeneratedAt | Status | SheetTab
 *     Each row points at another tab (SheetTab) holding that custom report's own
 *     Row 1 headers + data — columns are whatever that report needs.
 *
 *   Dashboard_Data
 *     Row 1 (headers): Month | Narrative | CriticalPhrase
 *     Exactly one data row (row 2) — the current month's Executive Summary text,
 *     authored offline (see lib/data/README.md). CriticalPhrase must be a verbatim
 *     substring of Narrative; the Dashboard panel bolds/pinks exactly that phrase.
 *     The rest of the Dashboard tab (summary cards, trend charts) is NOT stored here —
 *     it's computed client-side from the PL statement already fetched via getStatement,
 *     see lib/calc/dashboardMetrics.js.
 */

function getAuthClient() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const encodedKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;

  if (!email || !encodedKey) {
    throw new Error(
      "Missing GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY env vars."
    );
  }

  const privateKey = Buffer.from(encodedKey, "base64").toString("utf-8");

  return new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
}

async function getValues(sheetId: string, range: string): Promise<string[][]> {
  const auth = getAuthClient();
  const token = await auth.getAccessToken();

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(
      range
    )}`,
    {
      headers: { Authorization: `Bearer ${token.token}` },
      next: { revalidate: DEFAULT_REVALIDATE_SECONDS },
    }
  );

  if (!res.ok) {
    throw new Error(
      `Google Sheets fetch failed for range "${range}" (${res.status}). Check the sheet is shared with ${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL} and that the tab exists.`
    );
  }

  const json = (await res.json()) as { values?: string[][] };
  return json.values ?? [];
}

function toNumberOrNull(v: string | undefined): number | null {
  if (v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[,$%]/g, ""));
  return Number.isNaN(n) ? null : n;
}

/** Parse a GL date cell to an ISO "YYYY-MM" month key, or null when unparseable.
 *  Handles ISO ("2026-08-14"), US ("8/14/2026"), and anything Date() accepts. */
function toIsoMonth(raw: string | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})/); // ISO "YYYY-MM..."
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})/); // US "M/D/YYYY"
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}`;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  return null;
}

/** Parse a header cell that's a full DATE (not just a month) to ISO "YYYY-MM-DD" —
 *  2026-08-24, found via the Weekly CF tab rendering completely empty: the Sheets
 *  values API returns a date-formatted cell as whatever DISPLAY format the sheet uses
 *  (this client's Weekly CF tab shows "4/1/2024", not ISO), not a raw ISO string. The
 *  app's week-math (weeklyCashProjection.js) and its "is this weekly data" check in
 *  ReportsPanel (`month.length === 10`) both require the real ISO shape — without this,
 *  headers silently failed that check, fell through to the MONTHLY code path, and every
 *  column/value quietly disappeared instead of erroring loudly. Returns the raw string
 *  unchanged if it doesn't match a recognized shape, so a genuinely malformed header
 *  still fails visibly downstream instead of being silently coerced into a wrong date. */
function toIsoDate(raw: string | undefined): string {
  const s = (raw ?? "").trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/); // already ISO
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})$/); // US "M/D/YYYY"
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return s;
}

function toUnit(v: string | undefined): Unit {
  const u = (v ?? "number").toLowerCase();
  if (u === "currency" || u === "percent" || u === "ratio") return u;
  return "number";
}

export class GoogleSheetsDataSource implements DataSource {
  private sheetId: string;

  constructor(sheetId?: string) {
    const id = sheetId ?? process.env.GOOGLE_SHEET_ID;
    if (!id) throw new Error("Missing GOOGLE_SHEET_ID env var.");
    this.sheetId = id;
  }

  /**
   * KPI_Report — rebuilt 2026-08-20 onto the SAME wide "one column per month" schema
   * PL/CF/BS already use, replacing the old fixed Current/Prior/PriorYear/YTD/TTM/
   * Benchmark columns + a Y1 report-month cell. Row 1 is now:
   *   Section | Key | Label | Unit | Type | Benchmark | IsTotal | <month 1> | <month 2>...
   * (cols A-G, then H onward — Type is "flow" [sum for YTD/TTM], "stock" [point-in-time,
   * never summed], or "ratio" [%, also point-in-time]). There is no longer a Y1 cell to
   * read the report month from — the app determines "current month" itself.
   *
   * 2026-08-20 follow-up bug (Kayee: "why do you only show 2028... should only show Jan
   * 2026 up until last close month which is June 2026"): the first version of this
   * anchored on the LAST column ANY row had a non-null value in — but rows like New
   * Customers/Churn Rate/Expansion MRR (COUNTIF/SUMPRODUCT-based formulas) don't error
   * out for a future month with no real GL data yet, they just correctly compute a real
   * "0" — which is non-null, so that logic kept walking all the way to the sheet's last
   * header column (however far the month headers happen to extend, e.g. Dec-2028) even
   * though nothing real had happened there yet. Anchoring on "total_revenue" specifically
   * instead — its formula is an IFERROR(...,"") lookup straight off the PL sheet, which
   * genuinely goes BLANK (not zero) once real GL data runs out — so it can only ever
   * point at a month that's actually closed. Falls back to the old "any row" logic only
   * if no total_revenue row exists at all, so a sheet missing that exact Key still gets
   * *a* current month instead of none. */
  async getKPIData(): Promise<KPIReportData> {
    const header = await getValues(this.sheetId, "KPI_Report!1:1");
    const monthCols = (header[0] ?? []).slice(7); // columns after Section|Key|Label|Unit|Type|Benchmark|IsTotal
    if (monthCols.length === 0) return { month: "", rows: [] };

    const body = await getValues(this.sheetId, `KPI_Report!A2:${colLetter(6 + monthCols.length)}`);

    const anchorRow = body.find((r) => String(r[1] ?? "").trim().toLowerCase() === "total_revenue");

    let currentIdx = -1;
    for (let i = monthCols.length - 1; i >= 0; i--) {
      const hasData = anchorRow
        ? toNumberOrNull(anchorRow[7 + i]) !== null
        : body.some((r) => toNumberOrNull(r[7 + i]) !== null);
      if (hasData) {
        currentIdx = i;
        break;
      }
    }
    const month = currentIdx >= 0 ? monthCols[currentIdx] : "";

    const metricRows: MetricRow[] = body
      .filter((r) => r[1]) // has a Key
      .map((r) => {
        const type = (r[4] ?? "flow").toLowerCase();
        const valueAt = (idx: number) => (idx >= 0 && idx < monthCols.length ? toNumberOrNull(r[7 + idx]) : null);

        const trendStart = Math.max(0, currentIdx - 11);
        const trend = currentIdx >= 0
          ? Array.from({ length: currentIdx - trendStart + 1 }, (_, i) => valueAt(trendStart + i)).filter(
              (v): v is number => v !== null
            )
          : [];

        const current = valueAt(currentIdx);
        const prior = valueAt(currentIdx - 1);
        const priorYear = valueAt(currentIdx - 12);

        // YTD/TTM only mean anything for a "flow" metric (summed) — a "stock" balance
        // or a "ratio" summed across months would be a fabricated, meaningless number,
        // so those render "—" instead (CLAUDE.md: blank beats a wrong-looking figure).
        let ytd: number | null = null;
        let ttm: number | null = null;
        if (type === "flow" && currentIdx >= 0) {
          const [, currentMonthNum] = monthCols[currentIdx].split("-").map(Number);
          const yearStart = currentIdx - (currentMonthNum - 1);
          const ytdValues = Array.from({ length: currentIdx - yearStart + 1 }, (_, i) => valueAt(yearStart + i)).filter(
            (v): v is number => v !== null
          );
          ytd = ytdValues.length > 0 ? ytdValues.reduce((a, b) => a + b, 0) : null;

          const ttmStart = Math.max(0, currentIdx - 11);
          const ttmValues = Array.from({ length: currentIdx - ttmStart + 1 }, (_, i) => valueAt(ttmStart + i)).filter(
            (v): v is number => v !== null
          );
          ttm = ttmValues.length > 0 ? ttmValues.reduce((a, b) => a + b, 0) : null;
        }

        return {
          section: r[0] ?? "Uncategorized",
          key: r[1],
          label: r[2] ?? r[1],
          unit: toUnit(r[3]),
          current,
          prior,
          priorYear,
          ytd,
          ttm,
          benchmark: toNumberOrNull(r[5]),
          isTotal: (r[6] ?? "").toLowerCase() === "true",
          trend: trend.length > 0 ? trend : undefined,
        };
      });

    return { month, rows: metricRows };
  }

  async getStatement(type: StatementType, range: ReportRange): Promise<FinancialStatementData> {
    const header = await getValues(this.sheetId, `${type}!1:1`);
    const monthCols = (header[0] ?? []).slice(4); // columns after Section|Key|Label|IsTotal
    const monthsWanted = monthsForRange(monthCols, range);

    const body = await getValues(this.sheetId, `${type}!A2:${colLetter(3 + monthCols.length)}`);

    const rows: FinancialStatementRow[] = body
      .filter((r) => r[1])
      .map((r) => {
        const values: Record<string, number | null> = {};
        monthCols.forEach((month, i) => {
          if (monthsWanted.includes(month)) {
            values[month] = toNumberOrNull(r[4 + i]);
          }
        });
        return {
          key: r[1],
          label: r[2] ?? r[1],
          section: r[0] ?? "Uncategorized",
          isTotal: (r[3] ?? "").toLowerCase() === "true",
          values,
        };
      });

    // Merge duplicate same-label Total rows within a section into ONE summed row
    // (2026-08-20, Kayee, pointing at the CF's two stacked "Total Other Cash In"
    // bands: "you can combine these two correct?") — the sheet's CF tab carries two
    // separate Total rows with the identical label, which rendered as two identical
    // black bands showing two partial totals. Summing them here (null + null stays
    // null, so blank months stay blank rather than becoming $0) shows one true total
    // while leaving the sheet untouched. Non-total line items are never merged — two
    // real accounts sharing a name would be a data problem to surface, not to hide.
    const mergedRows: FinancialStatementRow[] = [];
    const totalsByKey = new Map<string, FinancialStatementRow>();
    for (const row of rows) {
      const mergeKey = row.isTotal ? `${row.section}|${row.label}` : null;
      const existing = mergeKey ? totalsByKey.get(mergeKey) : undefined;
      if (existing) {
        for (const month of monthsWanted) {
          const a = existing.values[month];
          const b = row.values[month];
          existing.values[month] = a === null && b === null ? null : (a ?? 0) + (b ?? 0);
        }
        continue;
      }
      if (mergeKey) totalsByKey.set(mergeKey, row);
      mergedRows.push(row);
    }

    return { type, months: monthsWanted, rows: mergedRows };
  }

  /**
   * Weekly Cash Flow (2026-08-24, Kayee) — a separate "Weekly CF" tab the client
   * authors alongside the monthly CF tab, same Section|Key|Label|IsTotal|<period
   * columns> contract, but each period column is a week-start ISO date
   * ("YYYY-MM-DD") instead of a month ("YYYY-MM"). Tab name has a space, so the A1
   * range must be single-quoted (same reason as getGLTransactions above).
   *
   * Deliberately returned with `type: "CF"` even though this isn't really the
   * monthly CF statement — ReportsPanel/StatementDoc key ALL their Cash-Flow-specific
   * rendering (hero total rows, the boxed Beginning/Net Change/Ending Cash treatment,
   * green section bands) off `statement.type`, not off which tab it came from. Since
   * this tab is rendered with mode="projection" (see ProjectionPanel's "Weekly CF"
   * sub-tab), it DOES get a full forecast pipeline — but a separate, weekly-native one
   * (lib/cashflow/weeklyCashProjection.js + ReportsPanel's `isWeekly` branch), which
   * StatementDoc picks by checking whether these period keys are dates ("YYYY-MM-DD",
   * length 10) rather than months ("YYYY-MM", length 7) — never by `statement.type`,
   * since that's 'CF' for both. The monthly CF forecast pipeline is never invoked
   * against this data.
   *
   * No range slicing (unlike getStatement) — fetches every week column the tab has.
   * If this tab grows very large, add a trailing-N-weeks slice here the same way
   * monthsForRange() does for the monthly statements.
   */
  async getWeeklyCashFlow(): Promise<FinancialStatementData> {
    const tab = "Weekly CF";
    const header = await getValues(this.sheetId, `'${tab}'!1:1`);
    // Normalized to ISO "YYYY-MM-DD" here — see toIsoDate's comment for why this is
    // required, not cosmetic (the sheet's own display format is "4/1/2024", not ISO).
    const periodCols = (header[0] ?? []).slice(4).map((p) => toIsoDate(String(p ?? ""))); // after Section|Key|Label|IsTotal
    if (periodCols.length === 0) return { type: "CF", months: [], rows: [] };

    const body = await getValues(this.sheetId, `'${tab}'!A2:${colLetter(3 + periodCols.length)}`);

    const rows: FinancialStatementRow[] = body
      .filter((r) => r[1])
      .map((r) => {
        const values: Record<string, number | null> = {};
        periodCols.forEach((period, i) => {
          values[period] = toNumberOrNull(r[4 + i]);
        });
        return {
          key: r[1],
          label: r[2] ?? r[1],
          section: r[0] ?? "Uncategorized",
          isTotal: (r[3] ?? "").toLowerCase() === "true",
          values,
        };
      });

    // Same duplicate-Total merge as getStatement (see the CF comment above) — in case
    // this tab inherits the same two-stacked-Total-rows pattern from the monthly one.
    const mergedRows: FinancialStatementRow[] = [];
    const totalsByKey = new Map<string, FinancialStatementRow>();
    for (const row of rows) {
      const mergeKey = row.isTotal ? `${row.section}|${row.label}` : null;
      const existing = mergeKey ? totalsByKey.get(mergeKey) : undefined;
      if (existing) {
        for (const period of periodCols) {
          const a = existing.values[period];
          const b = row.values[period];
          existing.values[period] = a === null && b === null ? null : (a ?? 0) + (b ?? 0);
        }
        continue;
      }
      if (mergeKey) totalsByKey.set(mergeKey, row);
      mergedRows.push(row);
    }

    return { type: "CF", months: periodCols, rows: mergedRows };
  }

  /**
   * Raw transaction-level GL export ("GL Cash" / "GL Accrued") for the Customer Cash
   * Flow waterfall. These tabs are bookkeeping-tool exports, so unlike KPI_Report/PL/
   * CF/BS the exact column ORDER is not part of the sheet contract — columns are
   * located by header name (case-insensitive contains match) from row 1, never by
   * hardcoded index. A required column that can't be found throws with a message
   * naming the tab and the header it looked for; app/page.js catches that into a
   * visible "data source misconfigured" state (CLAUDE.md: never silently zeroed).
   *
   * Amount: prefers a single "Amount" column; if the export only has Debit/Credit
   * pairs, amount = credit − debit (revenue accounts are credit-positive, and every
   * consumer filters to accounts starting with "4").
   *
   * Served through the same getValues() → fetch cache as every other tab, so it
   * auto-refreshes on the standard DEFAULT_REVALIDATE_SECONDS window.
   */
  async getGLTransactions(tab: GLTab): Promise<GLTransactionData> {
    // Tab names contain a space — must be single-quoted in A1 notation.
    const headerRows = await getValues(this.sheetId, `'${tab}'!1:1`);
    const headers = (headerRows[0] ?? []).map((h) => String(h ?? "").trim().toLowerCase());
    if (headers.length === 0) {
      throw new Error(`GL tab "${tab}" has no header row (row 1 is empty).`);
    }

    const findCol = (...needles: string[]) =>
      headers.findIndex((h) => needles.some((n) => h.includes(n)));

    const counterpartyCol = findCol("counterparty");
    const accountCol = findCol("account");
    const dateCol = findCol("date");
    const amountCol = findCol("amount");
    const debitCol = findCol("debit");
    const creditCol = findCol("credit");

    const missing: string[] = [];
    if (counterpartyCol === -1) missing.push('"Counterparty"');
    if (accountCol === -1) missing.push('"Account"');
    if (dateCol === -1) missing.push('"Date"');
    if (amountCol === -1 && debitCol === -1 && creditCol === -1) {
      missing.push('"Amount" (or "Debit"/"Credit")');
    }
    if (missing.length > 0) {
      throw new Error(
        `GL tab "${tab}" is missing required column header(s): ${missing.join(", ")}. ` +
          `Row 1 must contain them (case-insensitive) — found: ${
            (headerRows[0] ?? []).filter(Boolean).join(" | ") || "(none)"
          }.`
      );
    }

    const body = await getValues(this.sheetId, `'${tab}'!A2:ZZ`);

    const transactions: GLTransaction[] = [];
    for (const r of body) {
      const account = String(r[accountCol] ?? "").trim();
      const counterparty = String(r[counterpartyCol] ?? "").trim();
      const date = String(r[dateCol] ?? "").trim();
      const month = toIsoMonth(date);
      if (!account || !month) continue; // blank/subtotal/unparseable rows

      let amount: number;
      if (amountCol !== -1) {
        amount = toNumberOrNull(r[amountCol]) ?? 0;
      } else {
        const debit = debitCol !== -1 ? toNumberOrNull(r[debitCol]) ?? 0 : 0;
        const credit = creditCol !== -1 ? toNumberOrNull(r[creditCol]) ?? 0 : 0;
        amount = credit - debit; // revenue (4xxxx) accounts are credit-positive
      }
      if (amount === 0) continue;

      transactions.push({ date, month, account, counterparty, amount });
    }

    return { tab, transactions };
  }

  async getDashboardSummary(): Promise<DashboardSummary> {
    const row = await getValues(this.sheetId, "Dashboard_Data!A2:C2");
    const [month, narrative, criticalPhrase] = row[0] ?? [];
    return {
      month: month ?? "",
      narrative: narrative ?? "",
      criticalPhrase: criticalPhrase || undefined,
    };
  }

  async listCustomReports() {
    const rows = await getValues(this.sheetId, "Custom_Reports_Index!A2:E");
    return rows
      .filter((r) => r[0])
      .map((r) => ({
        id: r[0],
        name: r[1] ?? r[0],
        generatedAt: r[2] ?? "",
        status: (r[3] ?? "Draft") as CustomReportData["status"],
      }));
  }

  async getCustomReport(reportId: string): Promise<CustomReportData> {
    const index = await getValues(this.sheetId, "Custom_Reports_Index!A2:E");
    const meta = index.find((r) => r[0] === reportId);
    if (!meta) throw new Error(`No custom report "${reportId}" in Custom_Reports_Index.`);

    const sheetTab = meta[4];
    const header = await getValues(this.sheetId, `${sheetTab}!1:1`);
    const columns = header[0] ?? [];
    const body = await getValues(
      this.sheetId,
      `${sheetTab}!A2:${colLetter(columns.length)}`
    );

    const rows = body.map((r) => {
      const row: Record<string, string | number | null> = {};
      columns.forEach((c, i) => {
        const raw = r[i];
        const n = toNumberOrNull(raw);
        row[c] = n !== null && raw !== undefined && raw !== "" ? n : raw ?? null;
      });
      return row;
    });

    return {
      id: reportId,
      name: meta[1] ?? reportId,
      generatedAt: meta[2] ?? "",
      status: (meta[3] ?? "Draft") as CustomReportData["status"],
      columns,
      rows,
    };
  }
}

function monthsForRange(allMonths: string[], range: ReportRange): string[] {
  const n = range === "6M" ? 6 : range === "12M" ? 12 : 24;
  return allMonths.slice(-n);
}

/** 0-indexed column count → spreadsheet column letter (0 => A, 25 => Z, 26 => AA...). */
function colLetter(count: number): string {
  let n = count;
  let s = "";
  while (n >= 0) {
    s = String.fromCharCode((n % 26) + 65) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}
