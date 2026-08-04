'use client';

import { useState } from 'react';
import { PageHead } from '../ui/PageHead';
import { DrillPopover } from '../ui/DrillPopover';
import { formatMonthLabel } from '../../lib/calc/dashboardMetrics';

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
 * Range toggle (6M/12M/24M/∞) is CSS-driven, not a refetch: `statements` here already
 * holds the full actual range for each statement (fetched once, server-side) plus
 * blank padding columns through PROJECTION_HORIZON — switching range only changes the
 * `data-range` attribute, which globals.css uses to hide month columns tagged outside
 * that range. The always-visible label column never carries an r6/r12/r24 class, so
 * the design-rules.md "never hide row labels" rule holds by construction, not by
 * convention.
 */
export function ReportsPanel({ statements, customReports }) {
  const [reportType, setReportType] = useState('PL');
  const [range, setRange] = useState('6');

  return (
    <>
      <PageHead title="Reports" subtitle="P&L, Cash Flow, Balance Sheet, and saved custom reports" />

      <div className="toolbar">
        <div className="seg">
          {['PL', 'CF', 'BS', 'custom'].map((type) => (
            <button
              key={type}
              className={reportType === type ? 'active' : undefined}
              onClick={() => setReportType(type)}
            >
              {type === 'custom' ? 'Custom' : STATEMENT_LABELS[type]}
            </button>
          ))}
        </div>
        {reportType !== 'custom' && (
          <div className="seg right">
            {[
              { id: '6', label: '6M' },
              { id: '12', label: '12M' },
              { id: '24', label: '24M' },
              { id: 'all', label: '∞' },
            ].map((r) => (
              <button key={r.id} className={range === r.id ? 'active' : undefined} onClick={() => setRange(r.id)}>
                {r.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {reportType !== 'custom' ? (
        <StatementDoc statement={statements[reportType]} range={range} />
      ) : (
        <CustomReportsList reports={customReports} />
      )}
    </>
  );
}

function rangeClasses(monthIndex, totalMonths) {
  // Tag from the END (most recent months first) — r6 = last 6, r12 = last 12,
  // r24 = last 24. r-all is on every column unconditionally (the ∞ toggle), same
  // trick r24 used to rely on back when the whole array WAS 24 months long.
  const fromEnd = totalMonths - monthIndex;
  const classes = ['r-all'];
  if (fromEnd <= 24) classes.push('r24');
  if (fromEnd <= 12) classes.push('r12');
  if (fromEnd <= 6) classes.push('r6');
  return classes.join(' ');
}

/** Other line items in the same section as `row`, at one specific month — the real
 *  components that sum to a total/subtotal row's figure for that column (design-rules.md
 *  §5 / functionality-spec.md §6: popover numbers must come from the same data as the
 *  visible figure). Leaf (non-total) rows have no further breakdown in this data model,
 *  so they don't get a popover — never fabricate a composition that isn't there. */
function siblingValuesAtMonth(rows, row, month) {
  return rows
    .filter((r) => r.key !== row.key && !r.isTotal)
    .map((r) => ({
      label: r.label,
      value: r.values[month] != null ? `$${Math.round(r.values[month]).toLocaleString('en-US')}` : '—',
    }));
}

/** Consecutive months grouped by year, for the year-band header row —
 *  [{ year: '2026', count: 12 }, ...], oldest first, in column order. */
function yearBands(months) {
  const bands = [];
  for (const m of months) {
    const year = m.slice(0, 4);
    const last = bands[bands.length - 1];
    if (last && last.year === year) last.count += 1;
    else bands.push({ year, count: 1 });
  }
  return bands;
}

function StatementDoc({ statement, range }) {
  if (!statement) return <div className="cap">No data for this statement yet.</div>;
  // currentMonth = the last ACTUAL month (before any blank padding), so "active-col"
  // still marks the latest real reporting month, not the padded 2030 horizon.
  const currentMonth = statement.months[statement.months.length - 1];
  const months = extendMonthsThrough(statement.months, PROJECTION_HORIZON);
  const lastActualIndex = statement.months.length - 1;

  return (
    // "report-doc" (not just "table-wrap") is what the range-toggle CSS below actually
    // targets (`#reports[data-range] .report-doc:not([data-doc="custom"])`) — without it
    // the 6M/12M/24M/∞ buttons change `data-range` but nothing was ever selected by it.
    <div id="reports" data-range={range} className="table-wrap report-doc" data-doc={statement.type}>
      <table>
        <thead>
          <tr className="report-year-row">
            <th></th>
            {yearBands(months).map((b) => (
              // Carries every range class unconditionally so this row is never
              // hidden by the 6M/12M/24M range-toggle CSS (see globals.css) — its
              // colSpan just shrinks to whichever sub-columns remain visible.
              <th key={b.year} colSpan={b.count} className="r6 r12 r24 r-all">
                {b.year}
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
                  className={`${rangeClasses(i, months.length)}${m === currentMonth ? ' active-col' : ''}${isForecast ? ' pr-fcst' : ''}`}
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
          {groupBySection(statement.rows).map(([section, rows]) => (
            <FragmentRows
              key={section}
              section={section}
              rows={rows}
              months={months}
              currentMonth={currentMonth}
              lastActualIndex={lastActualIndex}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FragmentRows({ section, rows, months, currentMonth, lastActualIndex }) {
  return (
    <>
      {/* Two cells, not one colSpan cell — position:sticky on a <td> with colspan doesn't
          reliably stick in table layout (a well-known cross-browser limitation), which
          was letting the section band's label scroll away with the rest of the row. A
          real single-column first cell sticks the same way a normal data row's does. */}
      <tr className="section">
        <td>{section}</td>
        <td colSpan={months.length}></td>
      </tr>
      {rows.map((row) => (
        <tr key={row.key} className={row.isTotal ? 'total' : undefined}>
          <td>{row.label}</td>
          {months.map((m, i) => {
            const cellText = row.values[m] != null ? `$${Math.round(row.values[m]).toLocaleString('en-US')}` : '—';
            const isForecast = i > lastActualIndex;
            return (
              <td
                key={m}
                className={`${rangeClasses(i, months.length)}${m === currentMonth ? ' active-col' : ''}${isForecast ? ' pr-fcst' : ''}`}
              >
                {row.isTotal && row.values[m] != null ? (
                  <DrillPopover label={row.label} value={cellText} components={siblingValuesAtMonth(rows, row, m)} />
                ) : (
                  cellText
                )}
              </td>
            );
          })}
        </tr>
      ))}
    </>
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
