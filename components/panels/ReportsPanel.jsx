'use client';

import { useState } from 'react';
import { PageHead } from '../ui/PageHead';
import { DrillPopover } from '../ui/DrillPopover';
import { formatMonthLabel } from '../../lib/calc/dashboardMetrics';
import { useAssumptionsState } from '../../lib/assumptions/useAssumptionsState';
import {
  upfrontRevenueForMonth,
  meetingRevenueForMonth,
  netCollectedRevenueForMonth,
  campaignsForMonth,
  meetingsForMonth,
} from '../../lib/assumptions/assumptionsData';

/** Which PL rows get their projected (post-actual) months filled from the
 *  Assumptions tab, and which Assumptions calculation feeds each one — per Kayee
 *  (2026-08-04): "if I change something [in Assumptions] it should reflect in the
 *  P&L projection." Subscription Revenue = Upfront $ (campaigns x Upfront Rate),
 *  Transaction Revenue = Meeting $ (meetings x Per-Meeting Rate), Total Revenue = the
 *  Uncollectible-adjusted net (both streams already get the same haircut individually
 *  before summing, since (a x (1-r)) + (b x (1-r)) = (a+b) x (1-r) — mathematically
 *  identical either way). These exact key names are transcribed from Kayee's live PL
 *  sheet (2026-08-04 screenshots) — if the sheet's Key column for these rows ever
 *  changes, this silently stops projecting (the row just shows "—" again) rather than
 *  crashing, which is the safe failure mode for a keyed lookup like this. */
const PL_REVENUE_PROJECTIONS = {
  revenue_subscription_revenue: (rev, iso) => upfrontRevenueForMonth(rev, iso),
  revenue_transaction_revenue: (rev, iso) => meetingRevenueForMonth(rev, iso),
  total_revenue: (rev, iso) => netCollectedRevenueForMonth(rev, iso),
};

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

/** r6/r12/r24 must anchor to the last ACTUAL month, never to however far the blank
 *  2030 padding stretches — otherwise "6M" silently drifts to mean "the last 6
 *  padded/blank columns" the moment padding is added, which is exactly the bug Kayee
 *  hit (2026-08-04: switching to ∞ then back to 6M showed blank Dec-2030 columns
 *  instead of real recent months). fromEnd is 0 at the last actual month, negative
 *  for every padded month after it — negative values never satisfy any `< N` check
 *  below, so padded months correctly never carry r6/r12/r24, only r-all. */
function rangeClasses(monthIndex, lastActualIndex) {
  const fromEnd = lastActualIndex - monthIndex;
  const classes = ['r-all'];
  if (fromEnd >= 0 && fromEnd < 24) classes.push('r24');
  if (fromEnd >= 0 && fromEnd < 12) classes.push('r12');
  if (fromEnd >= 0 && fromEnd < 6) classes.push('r6');
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

/** Explains HOW a projected revenue cell's number came about — same idea as the
 *  hover note Kayee showed from another Fuel dashboard build ("Coach Rate, $/session
 *  — entered directly each month... not derived from other rows"). Only meaningful
 *  for a FORECAST cell (an actual month is just whatever the Google Sheet says, no
 *  calc to explain) on one of the three Assumptions-driven rows — every other cell
 *  returns null and renders as plain text, same as before. */
function revenueCalcExplanation(rowKey, revenue, iso) {
  if (!revenue) return null;
  if (rowKey === 'revenue_subscription_revenue') {
    return {
      calcNote: 'Subscription Revenue = # of Campaigns × Upfront Rate. Both editable on the Assumptions tab.',
      components: [
        { label: '# of Campaigns', value: campaignsForMonth(revenue, iso).toLocaleString('en-US') },
        { label: 'Upfront Rate', value: `$${Number(revenue.upfrontRate).toLocaleString('en-US')}` },
      ],
    };
  }
  if (rowKey === 'revenue_transaction_revenue') {
    const hasManualEntry = revenue.meetingsByMonth[iso] != null;
    return {
      calcNote: hasManualEntry
        ? 'Transaction Revenue = # of Meetings × Per Meeting Rate. Meetings entered directly for this month — editable on the Assumptions tab.'
        : `Transaction Revenue = # of Meetings × Per Meeting Rate. No Meetings figure entered for this month yet, so it's auto-suggested as round(Meeting Conversion% × Campaigns from ${revenue.meetingsLagMonths}mo ago) — editable on the Assumptions tab.`,
      components: [
        { label: '# of Meetings', value: meetingsForMonth(revenue, iso).toLocaleString('en-US') },
        { label: 'Per Meeting Rate', value: `$${Number(revenue.perMeetingRate).toLocaleString('en-US')}` },
      ],
    };
  }
  if (rowKey === 'total_revenue') {
    return {
      calcNote: `Total Revenue = Subscription $ + Transaction $, net of ${revenue.uncollectiblePct}% Uncollectible. Rates editable on the Assumptions tab.`,
      components: [
        { label: 'Subscription Revenue (gross)', value: `$${Math.round(upfrontRevenueForMonth(revenue, iso)).toLocaleString('en-US')}` },
        { label: 'Transaction Revenue (gross)', value: `$${Math.round(meetingRevenueForMonth(revenue, iso)).toLocaleString('en-US')}` },
      ],
    };
  }
  return null;
}

/** Returns `statement.rows` unchanged, except any row in PL_REVENUE_PROJECTIONS gets
 *  its PROJECTED months (index > lastActualIndex) filled from the Assumptions tab's
 *  live state instead of left blank. Actual months are never touched — only indices
 *  past the real data get patched, and only for the PL statement (CF/BS are
 *  untouched; only Revenue is modeled today, per Kayee's "structure first" build). */
function withRevenueProjections(statement, months, lastActualIndex, revenue) {
  if (statement.type !== 'PL' || !revenue) return statement.rows;
  return statement.rows.map((row) => {
    const projectFn = PL_REVENUE_PROJECTIONS[row.key];
    if (!projectFn) return row;
    const patchedValues = { ...row.values };
    for (let i = lastActualIndex + 1; i < months.length; i++) {
      patchedValues[months[i]] = projectFn(revenue, months[i]);
    }
    return { ...row, values: patchedValues };
  });
}

function StatementDoc({ statement, range }) {
  const { state: assumptionsState, hydrated: assumptionsHydrated } = useAssumptionsState();

  if (!statement) return <div className="cap">No data for this statement yet.</div>;
  // currentMonth = the last ACTUAL month (before any blank padding), so "active-col"
  // still marks the latest real reporting month, not the padded 2030 horizon.
  const currentMonth = statement.months[statement.months.length - 1];
  const months = extendMonthsThrough(statement.months, PROJECTION_HORIZON);
  const lastActualIndex = statement.months.length - 1;
  const revenue = assumptionsHydrated ? assumptionsState?.revenue : null;
  const rows = withRevenueProjections(statement, months, lastActualIndex, revenue);

  return (
    // "report-doc" (not just "table-wrap") is what the range-toggle CSS below actually
    // targets (`#reports[data-range] .report-doc:not([data-doc="custom"])`) — without it
    // the 6M/12M/24M/∞ buttons change `data-range` but nothing was ever selected by it.
    <div id="reports" data-range={range} className="table-wrap report-doc" data-doc={statement.type}>
      <table>
        <thead>
          <tr className="report-year-row">
            <th></th>
            {months.map((m, i) => {
              // One real cell per month — same column model as the row below, so a
              // range-toggle hide can never desync the two rows (a colSpan cell
              // here previously caused exactly that: see 2026-08-04 bug where a
              // hidden month left this row's year label sitting over the wrong
              // column). Only the first month of each year run shows the year
              // text; every cell in that run shares the same background, so
              // consecutive same-year cells still read as one continuous band.
              const year = m.slice(0, 4);
              const isFirstOfYear = i === 0 || months[i - 1].slice(0, 4) !== year;
              return (
                <th key={m} className={rangeClasses(i, lastActualIndex)}>
                  {isFirstOfYear ? year : ''}
                </th>
              );
            })}
          </tr>
          <tr>
            <th>Account / Line Item</th>
            {months.map((m, i) => {
              const isForecast = i > lastActualIndex;
              return (
                <th
                  key={m}
                  className={`${rangeClasses(i, lastActualIndex)}${m === currentMonth ? ' active-col' : ''}${isForecast ? ' pr-fcst' : ''}`}
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
          {groupBySection(rows).map(([section, sectionRows]) => (
            <FragmentRows
              key={section}
              section={section}
              rows={sectionRows}
              months={months}
              currentMonth={currentMonth}
              lastActualIndex={lastActualIndex}
              revenue={revenue}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FragmentRows({ section, rows, months, currentMonth, lastActualIndex, revenue }) {
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
            const calcInfo = isForecast ? revenueCalcExplanation(row.key, revenue, m) : null;
            return (
              <td
                key={m}
                className={`${rangeClasses(i, lastActualIndex)}${m === currentMonth ? ' active-col' : ''}${isForecast ? ' pr-fcst' : ''}`}
              >
                {calcInfo ? (
                  <DrillPopover
                    label={row.label}
                    value={cellText}
                    components={calcInfo.components}
                    calcNote={calcInfo.calcNote}
                  />
                ) : row.isTotal && row.values[m] != null ? (
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
