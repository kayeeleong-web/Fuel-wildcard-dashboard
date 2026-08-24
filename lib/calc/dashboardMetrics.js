/**
 * Deterministic helpers that turn a FinancialStatementData (from getStatement("PL", ...))
 * into the chart series the Dashboard tab needs. Plain math, no LLM call, no network —
 * this runs on every request against data already fetched, which is exactly right for
 * numbers a client can toggle/re-render instantly (see the "Claude computes offline,
 * code computes live" split documented in lib/data/README.md).
 */

/** Pull one row's trailing-N-month series as [{label, value}], oldest → newest. */
export function seriesForRow(statement, rowKey, trailingMonths = 6) {
  const row = statement.rows.find((r) => r.key === rowKey);
  if (!row) return [];
  const months = statement.months.slice(-trailingMonths);
  return months.map((m) => ({
    label: formatMonthLabel(m),
    value: row.values[m] ?? 0,
    isoMonth: m,
  }));
}

/** Trailing average of a numeric series (excludes the current/last point, per design-rules
 *  "Avg $X" reference line meaning "trailing average", not "average including today"). */
export function trailingAverage(series) {
  const history = series.slice(0, -1);
  if (history.length === 0) return series[series.length - 1]?.value ?? 0;
  return history.reduce((sum, p) => sum + p.value, 0) / history.length;
}

/** % change of the last point vs the point before it. */
export function momPercent(series) {
  if (series.length < 2) return 0;
  const curr = series[series.length - 1].value;
  const prev = series[series.length - 2].value;
  if (!prev) return 0;
  return ((curr - prev) / Math.abs(prev)) * 100;
}

/**
 * Gross-margin-% series, preferring a dedicated percent row (`gross_margin_pct`) if the
 * sheet has one. Falls back to computing it from a dollar margin row ÷ revenue — never
 * falls back further than that, because silently treating an arbitrary dollar row as a
 * percent is exactly the bug this guards against (see design-rules.md §1a / CLAUDE.md
 * "never show a silently wrong number"). Returns null when neither is derivable, so the
 * caller can render a visible "not configured" state instead of a fabricated figure.
 */
export function marginPercentSeries(statement, revenueSeries, trailingMonths = 6) {
  const pctRow = statement.rows.find((r) => r.key === "gross_margin_pct");
  if (pctRow) return seriesForRow(statement, "gross_margin_pct", trailingMonths);

  const dollarRow = statement.rows.find((r) => r.key === "gross_margin" || r.key === "gross_profit");
  if (!dollarRow) return null;

  const dollarSeries = seriesForRow(statement, dollarRow.key, trailingMonths);
  return dollarSeries.map((point, i) => ({
    ...point,
    value: revenueSeries[i]?.value ? (point.value / revenueSeries[i].value) * 100 : 0,
  }));
}

/** "2026-01" -> "Jan-26" — the one month-label format used everywhere a month is shown
 *  to a reader (chart axes, table column headers, the KPI Report month picker). */
export function formatMonthLabel(iso) {
  const parts = iso.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  // Weekly CF columns are week-start DATES ("YYYY-MM-DD"), not months ("YYYY-MM") —
  // 2026-08-24. Without this branch every week in a given month collapsed onto the
  // same "Apr-26" label (the day was silently dropped), so distinguish on part count
  // and show "Apr 1" style instead.
  if (parts.length === 3) {
    const [, m, d] = parts;
    return `${names[Number(m) - 1]} ${Number(d)}`;
  }
  const [y, m] = parts;
  return `${names[Number(m) - 1]}-${String(y).slice(2)}`;
}

/** The trailing `count` ISO "YYYY-MM" months ending at `anchorMonthIso`, oldest first —
 *  used to populate the KPI Report month picker (functionality-spec.md §3) and to build
 *  chart x-axis labels via formatMonthLabel. */
export function isoMonthsBack(anchorMonthIso, count) {
  const [y, m] = anchorMonthIso.split("-").map(Number);
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

export function formatCurrencyK(value) {
  // Explicit locale avoids a server/client hydration mismatch (see formatValue below).
  return `${Math.round(value / 1000).toLocaleString('en-US')}`;
}

export function formatPercent(value, decimals = 2) {
  return `${value.toFixed(decimals)}%`;
}

/** The one value formatter every panel uses for a MetricRow's `current`/`prior`/etc
 *  figures — keeps currency/percent/ratio formatting (and the pinned 'en-US' locale
 *  that avoids a server/client hydration mismatch) identical everywhere a KPI number
 *  is displayed, instead of each panel re-implementing its own slightly-different version. */
export function formatValue(value, unit) {
  if (value === null || value === undefined) return '—';
  if (unit === 'percent') return `${value.toFixed(2)}%`;
  if (unit === 'currency') return `$${Math.round(value).toLocaleString('en-US')}`;
  if (unit === 'ratio') return `${value.toFixed(2)}×`;
  return value.toLocaleString('en-US');
}
