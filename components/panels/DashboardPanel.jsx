'use client';

import { useMemo } from 'react';
import { PageHead } from '../ui/PageHead';
import { TrendChart } from '../ui/TrendChart';
import { DrillPopover } from '../ui/DrillPopover';
import { seriesForRow, trailingAverage, momPercent, marginPercentSeries, formatCurrencyK, formatValue } from '../../lib/calc/dashboardMetrics';

function pickRow(statement, preferredKeys) {
  for (const key of preferredKeys) {
    const row = statement.rows.find((r) => r.key === key);
    if (row) return row;
  }
  return statement.rows.find((r) => !r.isTotal) ?? statement.rows[0];
}

function renderNarrative(narrative, criticalPhrase) {
  if (!criticalPhrase || !narrative.includes(criticalPhrase)) return narrative;
  const [before, after] = narrative.split(criticalPhrase);
  return (
    <>
      {before}
      <span className="crit">{criticalPhrase}</span>
      {after}
    </>
  );
}

/** Other line items in the same statement section as `row` — the real components that
 *  sum to it, used for the chart drill-down panel (functionality-spec.md §6: popover
 *  numbers must come from the same data as the visible figure, never placeholder text). */
function sectionComponents(statement, row, currentMonth) {
  return statement.rows
    .filter((r) => r.section === row.section && r.key !== row.key && !r.isTotal)
    .map((r) => ({ label: r.label, value: `$${Math.round(r.values[currentMonth] ?? 0).toLocaleString('en-US')}` }));
}

function pctVsAverage(series) {
  const last = series[series.length - 1]?.value ?? 0;
  const avg = trailingAverage(series);
  const diff = last - avg;
  const pct = avg !== 0 ? (diff / Math.abs(avg)) * 100 : 0;
  return { diff, pct, dir: diff >= 0 ? 'up' : 'down' };
}

/**
 * Dashboard tab — design-rules.md §4 / functionality-spec.md §4.
 * The narrative (Executive Summary) is read verbatim from getDashboardSummary() —
 * authored offline, never generated here (see lib/data/README.md). Everything else
 * (cards, charts) is computed live from the PL statement already fetched server-side.
 */
export function DashboardPanel({ summary, plStatement, kpiData }) {
  const revenueRow = pickRow(plStatement, ['revenue', 'total_revenue']);
  const ebitdaRow = pickRow(plStatement, ['ebitda']);
  const currentMonth = plStatement.months[plStatement.months.length - 1];

  const revenueSeries = useMemo(() => seriesForRow(plStatement, revenueRow.key, 6), [plStatement, revenueRow.key]);
  const marginSeries = useMemo(() => marginPercentSeries(plStatement, revenueSeries, 6), [plStatement, revenueSeries]);
  const ebitdaSeries = useMemo(() => seriesForRow(plStatement, ebitdaRow.key, 6), [plStatement, ebitdaRow.key]);

  const revenueMoM = momPercent(revenueSeries);
  const ebitdaTrend = pctVsAverage(ebitdaSeries);

  const summaryCards = kpiData.rows.slice(0, 6);

  return (
    <>
      <PageHead title="Dashboard">
        <button className="btn" onClick={() => window.print()}>Export PDF</button>
      </PageHead>

      <div className="exec-summary">
        <div className="icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="var(--green-dark)" strokeWidth="2">
            <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
          </svg>
        </div>
        <div>
          <div className="exec-label">Executive Summary — {summary.month}</div>
          <div className="exec-text">{renderNarrative(summary.narrative, summary.criticalPhrase)}</div>
        </div>
      </div>

      <div className="grid-summary">
        {summaryCards.map((row) => (
          <div className="sum-card" key={row.key}>
            <div className="lbl">{row.label}</div>
            <div className="val">
              <DrillPopover
                label={row.label}
                value={formatValue(row.current, row.unit)}
                components={[
                  { label: 'Prior month', value: formatValue(row.prior, row.unit) },
                  { label: 'YTD', value: formatValue(row.ytd, row.unit) },
                ]}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="grid-dash-charts">
        <div className="chart-panel">
          <h3>
            Revenue {revenueMoM >= 0 ? <span className="hl-up">grew {revenueMoM.toFixed(2)}%</span> : <span className="hl-down">dropped {Math.abs(revenueMoM).toFixed(2)}%</span>} vs prior month
          </h3>
          <div className="cap">Monthly revenue vs 6-month average · hover the last bar for detail</div>
          <TrendChart
            data={revenueSeries}
            color="var(--blue)"
            referenceOptions={[{ key: 'avg', name: 'Avg', value: trailingAverage(revenueSeries) }]}
            valueFormat={(v) => formatCurrencyK(v)}
            drillDown={{
              components: sectionComponents(plStatement, revenueRow, currentMonth),
              calcNote: `Sum of ${revenueRow.section} line items.`,
            }}
          />
        </div>
        <div className="chart-panel">
          {marginSeries ? (
            <>
              <h3>Gross margin at {marginSeries[marginSeries.length - 1].value.toFixed(2)}% this period</h3>
              <div className="cap">Monthly gross margin % vs 6-month average · hover the last bar for detail</div>
              <TrendChart
                data={marginSeries}
                color="var(--teal)"
                referenceOptions={[{ key: 'avg', name: 'Avg', value: trailingAverage(marginSeries) }]}
                valueFormat={(v) => `${v.toFixed(2)}%`}
                drillDown={{
                  components: [
                    { label: 'Revenue', value: `$${Math.round(revenueSeries[revenueSeries.length - 1]?.value ?? 0).toLocaleString('en-US')}` },
                  ],
                  calcNote: `Calculated as: Gross Profit ÷ Revenue × 100.`,
                }}
              />
            </>
          ) : (
            <>
              <h3>Gross margin % — not available</h3>
              <div className="cap">
                Data source misconfigured: add a <code>gross_margin_pct</code> (or <code>gross_margin</code>) row to the PL
                sheet — see lib/data/sources/googleSheets.ts for the tab contract.
              </div>
            </>
          )}
        </div>
      </div>

      <div className="chart-panel chart-panel-lg">
        <h3>
          {ebitdaRow.label} is {ebitdaTrend.dir === 'up' ? <span className="hl-up">up {Math.abs(ebitdaTrend.pct).toFixed(2)}%</span> : <span className="hl-down">down {Math.abs(ebitdaTrend.pct).toFixed(2)}%</span>} vs its trailing average
        </h3>
        <div className="cap">Trailing 6 months · hover the last bar for the component breakdown</div>
        <TrendChart
          data={ebitdaSeries}
          color="var(--purple)"
          viewBoxWidth={1280}
          viewBoxHeight={300}
          referenceOptions={[{ key: 'avg', name: 'Avg', value: trailingAverage(ebitdaSeries) }]}
          valueFormat={(v) => formatCurrencyK(v)}
          drillDown={{
            components: sectionComponents(plStatement, ebitdaRow, currentMonth),
            calcNote: `Sum of ${ebitdaRow.section} line items.`,
          }}
        />
      </div>

      {/* Three small supporting charts (design-rules.md §4: trend / new-vs-churned / aging
          composition). The third slot (composition donut) needs its own chart component —
          TrendChart only does bar/line — build that when a client actually needs it. */}
      <div className="grid-mini-charts">
        {plStatement.rows
          .filter((r) => !r.isTotal && r.key !== revenueRow.key)
          .slice(0, 2)
          .map((row) => {
            const series = seriesForRow(plStatement, row.key, 6);
            const first = series[0]?.value ?? 0;
            const last = series[series.length - 1]?.value ?? 0;
            const pct = first !== 0 ? ((last - first) / Math.abs(first)) * 100 : 0;
            const dir = last - first >= 0 ? 'up' : 'down';
            return (
              <div className="chart-panel mini" key={row.key}>
                <h3>
                  {row.label} is {dir === 'up' ? <span className="hl-up">up {Math.abs(pct).toFixed(2)}%</span> : <span className="hl-down">down {Math.abs(pct).toFixed(2)}%</span>} over 6 months
                </h3>
                <div className="cap">Trailing 6 months</div>
                <TrendChart
                  data={series}
                  color="var(--green)"
                  mini
                  viewBoxWidth={420}
                  viewBoxHeight={110}
                  referenceOptions={[{ key: 'avg', name: 'Avg', value: trailingAverage(series) }]}
                  valueFormat={(v) => formatCurrencyK(v)}
                />
              </div>
            );
          })}
        <div className="chart-panel mini">
          <h3>Composition — TODO</h3>
          <div className="cap">Donut/composition chart component not built yet</div>
        </div>
      </div>
    </>
  );
}
