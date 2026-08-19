'use client';

import { useMemo, useState } from 'react';
import { PageHead } from '../ui/PageHead';
import { TrendChart } from '../ui/TrendChart';
import { DrillPopover } from '../ui/DrillPopover';
import { formatValue as fmt, formatMonthLabel, isoMonthsBack } from '../../lib/calc/dashboardMetrics';

function trailingMonthLabels(anchorMonthIso, count) {
  return isoMonthsBack(anchorMonthIso, count).map(formatMonthLabel);
}

/**
 * Re-derive a row's current/prior figures for an earlier selected month, using the
 * row's own trailing-12 `trend` array — the KPI_Report sheet only ever holds one
 * reported month's Prior Year/YTD/TTM/Benchmark (see lib/data/sources/googleSheets.ts),
 * so those can't be recomputed for a past month without a backend change; they render
 * as "—" instead of a wrong/stale number when a past month is selected. Rows with no
 * trend data (most of the KPI set) are unaffected by the picker, since there's nothing
 * to recompute them from.
 */
function rowForMonth(row, monthsBack) {
  if (monthsBack === 0 || !row.trend || row.trend.length === 0) return row;
  const idx = row.trend.length - 1 - monthsBack;
  if (idx < 0) return row;
  return {
    ...row,
    current: row.trend[idx],
    prior: idx > 0 ? row.trend[idx - 1] : null,
    priorYear: null,
    ytd: null,
    ttm: null,
  };
}

function deltaCell(current, prior, unit) {
  if (current == null || prior == null) return { varText: undefined, pctText: undefined, cls: undefined };
  const diff = current - prior;
  const pct = prior !== 0 ? (diff / Math.abs(prior)) * 100 : 0;
  const cls = diff > 0 ? 'g' : diff < 0 ? 'r' : 'm';
  return { varText: `${diff > 0 ? '+' : ''}${fmt(diff, unit === 'percent' ? 'number' : unit)}`, pctText: `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`, cls };
}

/** How far current sits from benchmark, in the metric's own unit — same +/- convention
 *  as deltaCell, so it reads consistently next to the MoM/YoY variance columns. */
function benchDelta(current, benchmark, unit) {
  if (current == null || benchmark == null) return null;
  const diff = current - benchmark;
  return { text: `${diff > 0 ? '+' : ''}${fmt(diff, unit)}`, cls: diff > 0 ? 'g' : diff < 0 ? 'r' : 'm' };
}

/** Chart title rule (design-rules.md §4): a full sentence stating the finding, never
 *  just the metric name — applies to the KPI hero chart the same as every Dashboard chart. */
function heroSentence(row) {
  if (row.current == null || row.prior == null) return `${row.label} — trailing 12 months`;
  const diff = row.current - row.prior;
  const pct = row.prior !== 0 ? (diff / Math.abs(row.prior)) * 100 : 0;
  const dir = diff >= 0 ? 'up' : 'down';
  return `${row.label} is ${dir} ${Math.abs(pct).toFixed(2)}% vs prior month, now at ${fmt(row.current, row.unit)}`;
}

/** Real components backing the hero chart's current value, for the hover drill-down
 *  (functionality-spec.md §6) — every figure here is already on the row, never invented. */
function heroComponents(row) {
  const items = [];
  if (row.prior != null) {
    items.push({ label: 'Prior month', value: fmt(row.prior, row.unit) });
    if (row.current != null) {
      const diff = row.current - row.prior;
      const pct = row.prior !== 0 ? (diff / Math.abs(row.prior)) * 100 : 0;
      items.push({ label: 'vs prior month', value: `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`, negative: pct < 0 });
    }
  }
  if (row.priorYear != null) items.push({ label: 'Prior year', value: fmt(row.priorYear, row.unit) });
  if (row.ytd != null) items.push({ label: 'YTD', value: fmt(row.ytd, row.unit) });
  if (row.benchmark != null) items.push({ label: 'Benchmark', value: fmt(row.benchmark, row.unit) });
  return items;
}

/** "Healthy" stays a green text badge; the at-risk state is an icon only (an attention
 *  triangle reads faster at a glance than the word "Watch" repeated down a column). */
function HealthBadge({ ok }) {
  if (ok) {
    return <span className="health-badge good"><i className="dot" />Healthy</span>;
  }
  return (
    <span className="health-badge bad" title="Below benchmark — needs attention">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3 1.5 21h21L12 3z" />
        <line x1="12" y1="10" x2="12" y2="14.5" />
        <circle cx="12" cy="17.5" r="0.6" fill="currentColor" stroke="none" />
      </svg>
    </span>
  );
}

const TOTAL_COLUMNS = 9; // KPI Metric, current, {prior/var/%} x3, YTD, TTM, Benchmark, vs Benchmark

/**
 * KPI Report tab — design-rules.md §3 / functionality-spec.md §3.
 * MoM / YoY is a real segmented control (`.seg`, same pattern as the Reports tab's
 * report-type toggle) — exactly one mode is visibly active at a time, and it drives
 * which comparison-column group the table renders. The month picker is a real control
 * too: picking an earlier month re-renders the hero chart, cards, and table's
 * current/prior figures from each row's trend history (see rowForMonth above).
 */
export function KPIReportPanel({ kpiData }) {
  const [comparisonMode, setComparisonMode] = useState('mom');
  const monthOptions = useMemo(() => isoMonthsBack(kpiData.month, 12), [kpiData.month]);
  const [selectedMonth, setSelectedMonth] = useState(kpiData.month);
  const monthsBack = Math.max(0, monthOptions.length - 1 - monthOptions.indexOf(selectedMonth));

  const displayRows = useMemo(
    () => kpiData.rows.map((r) => rowForMonth(r, monthsBack)),
    [kpiData.rows, monthsBack]
  );

  const chartable = useMemo(() => displayRows.filter((r) => r.trend && r.trend.length > 0), [displayRows]);
  const [selectedKey, setSelectedKey] = useState(chartable[0]?.key);
  const selectedMetric = chartable.find((r) => r.key === selectedKey) ?? chartable[0];

  const sections = useMemo(() => {
    const map = new Map();
    for (const row of displayRows) {
      if (!map.has(row.section)) map.set(row.section, []);
      map.get(row.section).push(row);
    }
    return Array.from(map.entries());
  }, [displayRows]);

  // Always 6 KPI cards next to the hero chart — 3 columns × 2 rows (design-rules.md §3).
  const featuredCards = displayRows.slice(0, 6);

  const heroReferenceOptions = selectedMetric
    ? [
        { key: 'avg', name: 'Avg', value: average(selectedMetric.trend) },
        ...(selectedMetric.benchmark != null ? [{ key: 'benchmark', name: 'Benchmark', value: selectedMetric.benchmark }] : []),
      ]
    : [];

  return (
    <>
      <PageHead title="KPI Report">
        <div className="kpi-controls">
          <div className="seg">
            {['mom', 'yoy'].map((mode) => (
              <button
                key={mode}
                className={comparisonMode === mode ? 'active' : undefined}
                onClick={() => setComparisonMode(mode)}
              >
                {mode === 'mom' ? 'MoM' : 'YoY'}
              </button>
            ))}
          </div>
          <div className="divider-v" />
          <select
            className="month-chip"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            aria-label="Select month"
          >
            {monthOptions.map((m) => (
              <option key={m} value={m}>{formatMonthLabel(m)}</option>
            ))}
          </select>
        </div>
        <button className="btn" onClick={() => window.print()}>Export PDF</button>
      </PageHead>

      <div className="kpi-top-row">
        <div className="chart-panel">
          <div className="chart-head">
            <div>
              <h3>{selectedMetric ? heroSentence(selectedMetric) : 'Select a metric'}</h3>
              <div className="cap">Trailing 12 months · dashed line is the comparison you pick below</div>
            </div>
            {chartable.length > 1 && (
              <select
                className="mini-dropdown"
                value={selectedKey}
                onChange={(e) => setSelectedKey(e.target.value)}
              >
                {chartable.map((r) => (
                  <option key={r.key} value={r.key}>{r.label}</option>
                ))}
              </select>
            )}
          </div>
          {selectedMetric && (
            <TrendChart
              variant="line"
              color="var(--blue)"
              data={trailingMonthLabels(kpiData.month, selectedMetric.trend.length).map((label, i) => ({
                label,
                value: selectedMetric.trend[i],
              }))}
              currentIndex={Math.max(0, selectedMetric.trend.length - 1 - monthsBack)}
              referenceOptions={heroReferenceOptions}
              valueFormat={(v) => fmt(v, selectedMetric.unit)}
              drillDown={{ components: heroComponents(selectedMetric) }}
            />
          )}
        </div>

        <div className="grid-kpi">
          {featuredCards.map((row) => {
            const isHealthy = row.benchmark == null || (row.current ?? 0) >= row.benchmark;
            const bd = benchDelta(row.current, row.benchmark, row.unit);
            return (
              <div className="kpi-card" key={row.key}>
                <div className="lbl">{row.label}</div>
                <div className="val">
                  <DrillPopover value={fmt(row.current, row.unit)} label={row.label} components={heroComponents(row)} />
                </div>
                <div className="kpi-bench">
                  <span className="bench-label">
                    Benchmark <b>{row.benchmark != null ? fmt(row.benchmark, row.unit) : '—'}</b>
                  </span>
                  <span className="bench-delta-row">
                    {bd && <span className={bd.cls}>{bd.text}</span>}
                    <HealthBadge ok={isHealthy} />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>KPI Metric</th>
              <th className="active-col">{formatMonthLabel(selectedMonth)}</th>
              {comparisonMode === 'mom' && (
                <>
                  <th>Prior month</th>
                  <th>MoM Var</th>
                  <th>MoM %</th>
                </>
              )}
              {comparisonMode === 'yoy' && (
                <>
                  <th>Prior year</th>
                  <th>YoY Var</th>
                  <th>YoY %</th>
                </>
              )}
              <th>YTD</th>
              <th>TTM</th>
              <th>Benchmark</th>
              <th>vs Benchmark</th>
            </tr>
          </thead>
          <tbody>
            {sections.map(([section, rows]) => (
              <SectionRows key={section} section={section} rows={rows} comparisonMode={comparisonMode} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function SectionRows({ section, rows, comparisonMode }) {
  return (
    <>
      {/* Two cells, not one colSpan cell — position:sticky on a <td> with colspan doesn't
          reliably stick (a cross-browser table-layout limitation), which let the section
          band's label scroll away with the rest of the row. A real single-column first
          cell sticks the same way a normal data row's does — see ReportsPanel.jsx. */}
      <tr className="section">
        <td>{section}</td>
        <td colSpan={TOTAL_COLUMNS - 1}></td>
      </tr>
      {rows.map((row) => {
        const mom = deltaCell(row.current, row.prior, row.unit);
        const yoy = deltaCell(row.current, row.priorYear, row.unit);
        const bd = benchDelta(row.current, row.benchmark, row.unit);
        const isHealthy = row.benchmark == null || (row.current ?? 0) >= row.benchmark;
        return (
          <tr key={row.key} className={row.isTotal ? 'total' : undefined}>
            <td>{row.label}</td>
            <td className="active-col">
              <DrillPopover value={fmt(row.current, row.unit)} label={row.label} components={heroComponents(row)} />
            </td>
            {comparisonMode === 'mom' && (
              <>
                <td>{fmt(row.prior, row.unit)}</td>
                <td className={mom.cls}>{mom.varText ?? '—'}</td>
                <td className={mom.cls}>{mom.pctText ?? '—'}</td>
              </>
            )}
            {comparisonMode === 'yoy' && (
              <>
                <td>{fmt(row.priorYear, row.unit)}</td>
                <td className={yoy.cls}>{yoy.varText ?? '—'}</td>
                <td className={yoy.cls}>{yoy.pctText ?? '—'}</td>
              </>
            )}
            <td>{fmt(row.ytd, row.unit)}</td>
            <td>{fmt(row.ttm, row.unit)}</td>
            <td>{row.benchmark != null ? fmt(row.benchmark, row.unit) : '—'}</td>
            <td>
              {row.benchmark != null && row.current != null ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span className={bd?.cls}>{bd?.text}</span>
                  <HealthBadge ok={isHealthy} />
                </span>
              ) : '—'}
            </td>
          </tr>
        );
      })}
    </>
  );
}

function average(values) {
  if (!values || values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
