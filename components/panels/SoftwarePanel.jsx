'use client';

import { useMemo, useState } from 'react';
import { PayrollTable, MonthInput, TextInput, PickerInput } from '../payroll/PayrollTable';
import { CollapsibleSection } from '../payroll/CollapsibleSection';
import { formatPayrollAmount, formatMonthLabel, monthsForRange, currentIsoMonth, DEPARTMENT_OPTIONS } from '../../lib/payroll/payrollData';
import { generateId, nextMonth, netCollectedRevenueForMonth } from '../../lib/assumptions/assumptionsData';
import { buildSoftwareSpendHistory } from '../../lib/data/softwareSpendData';
import {
  SOFTWARE_DRIVER_TYPES,
  DRIVER_TYPE_LABELS,
  SOFTWARE_CADENCES,
  softwareAmountForMonth,
  recomputeSoftwareSchedules,
  makeSoftwareItem,
  makePeriod,
} from '../../lib/software/softwareData';

/**
 * Software tab — three divisions per Kayee's spec (2026-08-27), extended the same day
 * once she saw the skeleton live:
 *   1. Actual Spend to Date — real GL spend, monthly x by vendor, from inception
 *      through the last closed month (the GL export just IS whatever's closed).
 *   2. Projection Summary — CoGS vs OpEx software cost, computed live from Division 3.
 *   3. Planning — every vendor row, ALWAYS showing a month-by-month grid of exactly what
 *      lands on the P&L (Kayee: "I want it more like it has a month over month on the
 *      right so i can scroll and see how each 1000 apply to each month") — driver type
 *      decides how that $ is computed, add/inactive exactly like the Customer tab's
 *      rows, dragged onto a P&L line to link it exactly like the Assumptions sidebar's
 *      Non-Headcount Costs. Editing a vendor's price/period/rate happens in an
 *      expandable panel under its row (click Edit) — the row itself stays reserved for
 *      the thing Kayee actually asked to see by default: the numbers, month over month.
 *
 * Vendor rows live INSIDE assumptions.costItems (isSoftware: true) rather than a
 * separate store — see lib/software/softwareData.js's file header for why: it means
 * the existing P&L linking + Cash Flow timing engine needs ZERO changes to support
 * these, and CostItemsCard filters isSoftware out of its own list so nothing shows in
 * two places. `assumptionsCtl` is the SAME hook instance ProjectionPanel already lifts
 * for the P&L/CF sub-tabs (so a software-tab edit is visible on the P&L immediately,
 * and the toolbar's one Save button already covers it) — same lift-with-fallback
 * pattern as PayrollPanel/CustomerPanel.
 */

const SPEND_FROZEN_COLUMNS = [
  { key: 'name', label: 'Vendor', width: 220 },
  { key: 'category', label: 'Cat.', width: 70 },
  { key: 'total', label: 'Total', width: 104, align: 'right' },
];

// Planning's frozen columns (2026-08-27 rewrite) — deliberately more of them than the
// Spend/Summary tables above, because this is the one editable table: Vendor, Category,
// Active, Driver type, a glanceable Terms summary (so the current price/period reads
// without opening anything — "very very comfortable" means not having to click Edit
// just to check what a vendor is already set to), then Edit/Delete actions. Everything
// past that is the scrollable, always-visible month grid.
// Widened 2026-08-31 (Kayee: layout was "quite ugly and got cut off") — Category was
// clipping "CoGS" down to "C", and the Driver select was clipping its own label
// mid-word ("Variable — Usag…"). Category/Driver both grew a little and the driver
// labels themselves got shortened (see DRIVER_TYPE_LABELS in softwareData.js) so the
// closed <select> always shows its full text with room to spare, not just less-clipped.
// Category widened 2026-08-31 (Kayee: "the text cogs or opex the text got cut off,
// make the box flexible like it will be bigger for the text") — 78px was too narrow
// for "CoGS"/"OpEx" plus the select's own arrow once the browser's default select
// padding is accounted for; 108px gives it real breathing room. Terms trimmed to match
// since it no longer needs to fit as much (see driverTermsSummary).
const PLANNING_FROZEN_COLUMNS = [
  { key: 'vendor', label: 'Vendor', width: 210 },
  { key: 'category', label: 'Cat.', width: 108 },
  { key: 'active', label: 'On', width: 44, align: 'center' },
  { key: 'driver', label: 'Driver', width: 130 },
  { key: 'terms', label: 'Terms', width: 160 },
  { key: 'actions', label: '', width: 96, align: 'center' },
];

const TRASH_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0l-1 14a2 2 0 01-2 2H7a2 2 0 01-2-2L4 6" />
  </svg>
);

/** Driver-type picker with human labels — same convention as CostItemsCard's own local
 *  Picker, just mapping the stored code (e.g. 'percentRevenue') to a readable label. */
function DriverTypePicker({ value, onCommit }) {
  return (
    <select className="pr-input pr-select" value={value} onChange={(e) => onCommit(e.target.value)}>
      {SOFTWARE_DRIVER_TYPES.map((code) => (
        <option key={code} value={code}>
          {DRIVER_TYPE_LABELS[code]}
        </option>
      ))}
    </select>
  );
}

function CadencePicker({ value, onCommit }) {
  return (
    <select className="pr-input pr-select" value={value} onChange={(e) => onCommit(e.target.value)}>
      {SOFTWARE_CADENCES.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  );
}

/** Native month picker (`<input type="month">`) — a real calendar control, not to be
 *  confused with PayrollTable's own `MonthInput`, which despite the name is a $ number
 *  cell. Commits immediately on change, same convention as DateInput. */
function MonthPicker({ value, onCommit, placeholder }) {
  return (
    <input
      type="month"
      className="pr-input pr-input-date"
      value={value || ''}
      placeholder={placeholder}
      onChange={(e) => onCommit(e.target.value)}
    />
  );
}

/** One-line, always-visible plain-English readout of a Fixed period — same "→ $X from
 *  [month]" voice as CostItemScheduleSummary elsewhere in this app, so a period never
 *  requires mental math to understand once it's set. */
function periodSummaryText(period) {
  const amt = formatPayrollAmount(period.amount) || '$0';
  const cadenceLabel = period.cadence === 'Quarterly' ? '/quarter' : period.cadence === 'Annual' ? '/year' : '/month';
  const fromLabel = period.fromMonth ? formatMonthLabel(period.fromMonth) : 'the start';
  if (!period.toMonth) return `→ ${amt}${cadenceLabel}, from ${fromLabel}, ongoing`;
  return `→ ${amt}${cadenceLabel}, from ${fromLabel} through ${formatMonthLabel(period.toMonth)}`;
}

/** Compact "what is this vendor set to right now" readout for the Terms column —
 *  Kayee's "very very comfortable" bar means the current price/period/rate should be
 *  readable WITHOUT opening the row first. */
function driverTermsSummary(item) {
  switch (item.driverType) {
    case 'fixed': {
      const periods = item.periods || [];
      if (!periods.length) return '—';
      if (periods.length === 1) {
        const p = periods[0];
        const cadenceLabel = p.cadence === 'Quarterly' ? '/qtr' : p.cadence === 'Annual' ? '/yr' : '/mo';
        return `${formatPayrollAmount(p.amount) || '$0'}${cadenceLabel}`;
      }
      return `${periods.length} periods`;
    }
    case 'usage':
      return item.unitRate ? `$${item.unitRate}/${item.unitLabel || 'unit'}` : 'Not set';
    case 'percentRevenue':
      return item.revenuePercent ? `${item.revenuePercent}% of revenue` : 'Not set';
    case 'perSeat':
      return item.seatRate ? `$${item.seatRate}/seat${item.seatDepartment ? ` · ${item.seatDepartment}` : ''}` : 'Not set';
    default:
      return '—';
  }
}

/** One editable period row inside the Fixed-driver expand panel. */
function PeriodRow({ period, isOnly, onUpdate, onRemove }) {
  return (
    <div className="software-period-row">
      <div className="software-period-fields">
        <label className="software-period-field">
          <span>From</span>
          <MonthPicker value={period.fromMonth} onCommit={(v) => onUpdate({ fromMonth: v })} />
        </label>
        <label className="software-period-field">
          <span>To</span>
          <MonthPicker value={period.toMonth} onCommit={(v) => onUpdate({ toMonth: v })} placeholder="Ongoing" />
        </label>
        <label className="software-period-field">
          <span>Amount</span>
          <MonthInput value={period.amount} onCommit={(n) => onUpdate({ amount: n })} />
        </label>
        <label className="software-period-field">
          <span>Cadence</span>
          <CadencePicker value={period.cadence} onCommit={(v) => onUpdate({ cadence: v })} />
        </label>
        <button
          type="button"
          className="icon-btn"
          title={isOnly ? 'A vendor needs at least one period' : 'Remove this period'}
          onClick={onRemove}
          disabled={isOnly}
        >
          {TRASH_ICON}
        </button>
      </div>
      <div className="software-period-summary">{periodSummaryText(period)}</div>
    </div>
  );
}

/** Fixed driver's expand panel — the multi-period editor itself (2026-08-27, Kayee:
 *  "it needs to have period like ok monthly but 1000 from which month to ongoing or an
 *  end date and if i need to add a second row for another amount"). Adding a period
 *  defaults its From month to right after the previous period's To month, so a price
 *  change reads as "pick up where the last one left off" rather than a blank slate the
 *  user has to date correctly by hand every time. */
function PeriodsEditor({ item, onChange }) {
  const periods = item.periods || [];

  function updatePeriod(id, patch) {
    onChange(periods.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }
  function removePeriod(id) {
    onChange(periods.filter((p) => p.id !== id));
  }
  function addPeriod() {
    const last = periods[periods.length - 1];
    const fromMonth = last?.toMonth ? nextMonth(last.toMonth, 1) : '';
    onChange([...periods, makePeriod({ fromMonth, amount: last?.amount || 0, cadence: last?.cadence || 'Monthly' })]);
  }

  return (
    <div className="software-period-list">
      {periods.map((period) => (
        <PeriodRow
          key={period.id}
          period={period}
          isOnly={periods.length === 1}
          onUpdate={(patch) => updatePeriod(period.id, patch)}
          onRemove={() => removePeriod(period.id)}
        />
      ))}
      <button type="button" className="btn btn-xs" onClick={addPeriod}>
        + Add Period
      </button>
      <p className="software-editor-hint">
        Add a period whenever the price changes or the vendor is only contracted for part of the
        year — e.g. $800/mo through Dec 2026, then $1,200/mo starting Jan 2027. Leave "To" blank
        for a period that's still ongoing. The month grid above updates as you type.
      </p>
    </div>
  );
}

function UsageEditor({ item, onChange }) {
  const monthlyPreview = (Number(item.unitRate) || 0) * (Number(item.unitsPerMonth) || 0);
  return (
    <div className="software-rate-editor">
      <label className="software-rate-field">
        <span>Unit label</span>
        <TextInput value={item.unitLabel} placeholder="e.g. token" onCommit={(v) => onChange({ unitLabel: v })} />
      </label>
      <label className="software-rate-field">
        <span>$ per unit</span>
        <MonthInput value={item.unitRate} onCommit={(n) => onChange({ unitRate: n })} />
      </label>
      <label className="software-rate-field">
        <span>Units per month</span>
        <MonthInput value={item.unitsPerMonth} onCommit={(n) => onChange({ unitsPerMonth: n })} />
      </label>
      <p className="software-editor-hint">
        {formatPayrollAmount(monthlyPreview) || '$0'} per month at this rate. The same flat unit
        count applies to every month for now — a per-month-editable usage grid, or deriving units
        from revenue, is a real follow-up, not built here.
      </p>
    </div>
  );
}

function PercentRevenueEditor({ item, onChange }) {
  return (
    <div className="software-rate-editor">
      <label className="software-rate-field">
        <span>% of Total Revenue</span>
        <MonthInput value={item.revenuePercent} onCommit={(n) => onChange({ revenuePercent: n })} />
      </label>
      <p className="software-editor-hint">
        Moves with the P&L's own Total Revenue projection automatically, up or down — no separate
        step to bring in a revenue projection. Close this panel and look at the grey "↳ Total
        Revenue (reference)" row right under this vendor in the month grid to see the $ basis for
        the % above, month by month.
      </p>
    </div>
  );
}

function PerSeatEditor({ item, onChange }) {
  return (
    <div className="software-rate-editor">
      <label className="software-rate-field">
        <span>$ per seat</span>
        <MonthInput value={item.seatRate} onCommit={(n) => onChange({ seatRate: n })} />
      </label>
      <label className="software-rate-field">
        <span>Department</span>
        <PickerInput value={item.seatDepartment} options={DEPARTMENT_OPTIONS} placeholder="Department" onCommit={(v) => onChange({ seatDepartment: v })} />
      </label>
      <p className="software-editor-hint">
        Counts active Payroll roster rows in this department each month — ramp hires count
        fractionally as they ramp up, same as everywhere else headcount is used.
      </p>
    </div>
  );
}

/** Division 1 table — vendor rows x month columns, TOTAL row, same shell as the
 *  Customer tab's WaterfallTable. */
function SpendWaterfallTable({ history, months, todayIso }) {
  const rows = history.vendors.map((v) => ({
    id: `${v.category}:${v.name}`,
    monthCells: Object.fromEntries(months.map((iso) => [iso, formatPayrollAmount(v.byMonth[iso])])),
    cells: {
      name: (
        <span className="pr-nowrap-cell" title={v.name}>
          {v.name}
        </span>
      ),
      category: v.category,
      total: <b>{formatPayrollAmount(v.total) || '$0'}</b>,
    },
  }));

  const totalRow = {
    cells: {
      name: <b>TOTAL</b>,
      category: '',
      total: <b>{formatPayrollAmount(history.vendors.reduce((a, v) => a + v.total, 0)) || '$0'}</b>,
    },
    monthCells: Object.fromEntries(
      months.map((iso) => [iso, <b key={iso}>{formatPayrollAmount(history.monthlyTotal[iso]) || '$0'}</b>])
    ),
  };

  return (
    <PayrollTable
      title="Software Spend — by Vendor"
      subtitle={`${history.vendors.length} vendor${history.vendors.length === 1 ? '' : 's'} · monthly $, ordered by total spend`}
      tintForecast={false}
      frozenColumns={SPEND_FROZEN_COLUMNS}
      months={months}
      todayIso={todayIso}
      totalRow={totalRow}
      rowGroups={[{ key: 'vendors', label: null, rows }]}
    />
  );
}

/** The Dashboard tab's established misconfigured-data pattern — a GL tab that's
 *  missing or has renamed columns must be VISIBLY broken, never quietly empty. */
function MisconfiguredNotice({ tab, message }) {
  return (
    <div style={{ margin: '8px 0 16px' }}>
      <h3>{tab} — data source misconfigured</h3>
      <div className="cap">
        {message} See the GL tab contract in <code>lib/data/sources/googleSheets.ts</code>.
      </div>
    </div>
  );
}

export function SoftwarePanel({ glCash, glAccrued, assumptionsCtl, payrollCtl }) {
  const todayIso = currentIsoMonth();
  const { state: assumptions, setState: setAssumptions, hydrated } = assumptionsCtl;
  const roster = payrollCtl?.state?.roster || [];

  const [spendView, setSpendView] = useState('accrued'); // 'cash' | 'accrued'
  const [spendCategory, setSpendCategory] = useState('all'); // 'all' | 'CoGS' | 'OpEx'
  const [collapsedSections, setCollapsedSections] = useState({ spend: true, summary: false, planning: false });
  const toggleSection = (key) => setCollapsedSections((p) => ({ ...p, [key]: !p[key] }));

  // Which vendor rows have their edit panel open (2026-08-27) — local UI state, not
  // persisted; every row starts collapsed except one just added (see addVendor below),
  // so the user isn't left hunting for where to type the price on a brand-new row.
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  function toggleExpanded(id) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const spendSource = spendView === 'cash' ? glCash : glAccrued;
  const spendHistory = useMemo(
    () => buildSoftwareSpendHistory(spendSource?.transactions, spendCategory),
    [spendSource, spendCategory]
  );

  const planMonths = monthsForRange('default');

  /* ------------------------------- Vendor rows ------------------------------- */

  const softwareItems = (assumptions?.costItems || []).filter((i) => i.isSoftware);
  const calcCtx = { revenue: assumptions?.revenue, roster };

  function commitCostItems(nextCostItems) {
    if (!assumptions) return;
    setAssumptions({ ...assumptions, costItems: recomputeSoftwareSchedules(nextCostItems, calcCtx) });
  }

  function updateVendor(id, patch) {
    commitCostItems((assumptions.costItems || []).map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }

  function addVendor(category) {
    const id = generateId('software');
    commitCostItems([...(assumptions.costItems || []), makeSoftwareItem({ id, category })]);
    setExpandedIds((prev) => new Set(prev).add(id));
  }

  function removeVendor(id) {
    // No confirm() dialog (house style — "i dont want no pop up when i delete stuff").
    commitCostItems((assumptions.costItems || []).filter((i) => i.id !== id));
  }

  /* --------------------------- Projection summary --------------------------- */

  function categoryTotalForMonth(category, iso) {
    return softwareItems
      .filter((i) => i.category === category)
      .reduce((sum, i) => sum + softwareAmountForMonth(i, iso, calcCtx), 0);
  }

  const summaryRows = [
    {
      id: 'cogs',
      cells: { name: 'CoGS Software' },
      monthCells: Object.fromEntries(
        planMonths.map((iso) => [iso, formatPayrollAmount(categoryTotalForMonth('CoGS', iso))])
      ),
    },
    {
      id: 'opex',
      cells: { name: 'OpEx Software' },
      monthCells: Object.fromEntries(
        planMonths.map((iso) => [iso, formatPayrollAmount(categoryTotalForMonth('OpEx', iso))])
      ),
    },
  ];
  const summaryTotalRow = {
    cells: { name: <b>Total Software Cost</b> },
    monthCells: Object.fromEntries(
      planMonths.map((iso) => [
        iso,
        <b key={iso}>
          {formatPayrollAmount(categoryTotalForMonth('CoGS', iso) + categoryTotalForMonth('OpEx', iso)) || '$0'}
        </b>,
      ])
    ),
  };

  /* ------------------------------ Planning rows ------------------------------ */

  // 2026-08-31 (Kayee: "for variable % of revenue you need to bring in projected
  // revenue so that we can visualize but its in grey font so that people know it's a
  // reference thing") — every % of Revenue vendor gets a second, non-draggable, grey
  // "↳ Total Revenue (reference)" row directly under its own row in the SAME
  // month-by-month grid, so the $ basis the % is applied to is visible right there
  // while scrolling, without opening the edit panel. Purely a readout — it's not a
  // cost item and contributes nothing to any total.
  function revenueReferenceRow(item) {
    return {
      id: `${item.id}-revenue-ref`,
      className: 'software-reference-row',
      cells: {
        vendor: <span className="software-ref-label">↳ Total Revenue (reference)</span>,
        category: '',
        active: '',
        driver: '',
        terms: <span className="software-ref-label">Basis for the % above</span>,
        actions: '',
      },
      monthCells: Object.fromEntries(
        planMonths.map((iso) => [
          iso,
          <span key={iso} className="software-ref-figure">
            {formatPayrollAmount(netCollectedRevenueForMonth(assumptions?.revenue, iso)) || '$0'}
          </span>,
        ])
      ),
    };
  }

  const planningRows = softwareItems.flatMap((item) => {
    const isExpanded = expandedIds.has(item.id);
    let expandedContent = null;
    if (item.driverType === 'usage') {
      expandedContent = <UsageEditor item={item} onChange={(patch) => updateVendor(item.id, patch)} />;
    } else if (item.driverType === 'percentRevenue') {
      expandedContent = <PercentRevenueEditor item={item} onChange={(patch) => updateVendor(item.id, patch)} />;
    } else if (item.driverType === 'perSeat') {
      expandedContent = <PerSeatEditor item={item} onChange={(patch) => updateVendor(item.id, patch)} />;
    } else {
      expandedContent = <PeriodsEditor item={item} onChange={(periods) => updateVendor(item.id, { periods })} />;
    }

    const mainRow = {
      id: item.id,
      className: item.active === false ? 'software-inactive-row' : undefined,
      isExpanded,
      expandedContent,
      cells: {
        vendor: (
          <div className="assump-cost-name-cell">
            <TextInput
              value={item.name}
              placeholder="Vendor name"
              onCommit={(v) => updateVendor(item.id, { name: v })}
            />
            <span
              className="assump-cost-link-badge"
              title={`Forecasts feed the "${item.linkedRowLabel}" P&L row directly — set automatically by Category`}
            >
              ↳ {item.linkedRowLabel}
            </span>
          </div>
        ),
        category: (
          <select
            className="pr-input pr-select"
            value={item.category}
            onChange={(e) => updateVendor(item.id, { category: e.target.value })}
          >
            <option value="CoGS">CoGS</option>
            <option value="OpEx">OpEx</option>
          </select>
        ),
        active: (
          <input
            type="checkbox"
            checked={item.active !== false}
            onChange={(e) => updateVendor(item.id, { active: e.target.checked })}
            title="Active — inactive vendors contribute $0 everywhere (P&L and Cash Flow both)"
          />
        ),
        driver: <DriverTypePicker value={item.driverType} onCommit={(v) => updateVendor(item.id, { driverType: v })} />,
        terms: <span className="software-terms-cell">{driverTermsSummary(item)}</span>,
        actions: (
          <div className="software-row-actions">
            <button
              type="button"
              className={`btn btn-xs${isExpanded ? ' active' : ''}`}
              onClick={() => toggleExpanded(item.id)}
            >
              {isExpanded ? 'Close' : 'Edit'}
            </button>
            <button type="button" className="icon-btn" title="Remove" onClick={() => removeVendor(item.id)}>
              {TRASH_ICON}
            </button>
          </div>
        ),
      },
      monthCells: Object.fromEntries(
        planMonths.map((iso) => [iso, formatPayrollAmount(softwareAmountForMonth(item, iso, calcCtx))])
      ),
    };

    return item.driverType === 'percentRevenue' ? [mainRow, revenueReferenceRow(item)] : [mainRow];
  });

  const planningTotalRow = {
    cells: { vendor: <b>TOTAL</b>, category: '', active: '', driver: '', terms: '', actions: '' },
    monthCells: Object.fromEntries(
      planMonths.map((iso) => [
        iso,
        <b key={iso}>
          {formatPayrollAmount(softwareItems.reduce((sum, i) => sum + softwareAmountForMonth(i, iso, calcCtx), 0)) ||
            '$0'}
        </b>,
      ])
    ),
  };

  /* --------------------------------- Render --------------------------------- */

  return (
    <div className="page-wide">
      {/* ------------------------ 1. Actual Spend to Date ------------------------ */}
      <CollapsibleSection
        title="Actual Spend to Date"
        subtitle="From inception through the last closed month — GL Software accounts (52000 CoGS / 66200 OpEx)"
        colorVar="--blue"
        collapsed={collapsedSections.spend}
        onToggle={() => toggleSection('spend')}
        headActions={
          <div style={{ display: 'flex', gap: 8 }} onClick={(e) => e.stopPropagation()}>
            <div className="seg">
              <button className={spendView === 'cash' ? 'active' : undefined} onClick={() => setSpendView('cash')}>
                Cash
              </button>
              <button className={spendView === 'accrued' ? 'active' : undefined} onClick={() => setSpendView('accrued')}>
                Accrued
              </button>
            </div>
            <div className="seg">
              <button className={spendCategory === 'all' ? 'active' : undefined} onClick={() => setSpendCategory('all')}>
                All
              </button>
              <button className={spendCategory === 'CoGS' ? 'active' : undefined} onClick={() => setSpendCategory('CoGS')}>
                CoGS
              </button>
              <button className={spendCategory === 'OpEx' ? 'active' : undefined} onClick={() => setSpendCategory('OpEx')}>
                OpEx
              </button>
            </div>
          </div>
        }
      >
        {spendSource?.error ? (
          <MisconfiguredNotice tab={spendView === 'cash' ? 'GL Cash' : 'GL Accrued'} message={spendSource.error} />
        ) : (
          <SpendWaterfallTable history={spendHistory} months={spendHistory.months} todayIso={todayIso} />
        )}
      </CollapsibleSection>

      <div style={{ height: 20 }} />

      {/* -------------------------- 2. Projection Summary -------------------------- */}
      <CollapsibleSection
        title="Projection Summary"
        subtitle="CoGS vs OpEx software cost — computed live from the vendor rows in Planning below"
        colorVar="--purple"
        collapsed={collapsedSections.summary}
        onToggle={() => toggleSection('summary')}
      >
        <PayrollTable
          title="Software Cost — CoGS vs OpEx"
          tintForecast={false}
          frozenColumns={[{ key: 'name', label: '', width: 200 }]}
          months={planMonths}
          todayIso={todayIso}
          totalRow={summaryTotalRow}
          rowGroups={[{ key: 'summary', label: null, rows: summaryRows }]}
        />
      </CollapsibleSection>

      <div style={{ height: 20 }} />

      {/* ------------------------------ 3. Planning ------------------------------ */}
      <CollapsibleSection
        title="Planning"
        subtitle="Every software vendor, month over month — click Edit to set price, period, or driver details. CoGS vendors feed the Cost of Revenue line, OpEx vendors feed Operating Expense, automatically."
        colorVar="--green"
        collapsed={collapsedSections.planning}
        onToggle={() => toggleSection('planning')}
        headActions={
          <div style={{ display: 'flex', gap: 8 }} onClick={(e) => e.stopPropagation()}>
            <button type="button" className="btn" onClick={() => addVendor('CoGS')}>
              + Add CoGS Vendor
            </button>
            <button type="button" className="btn" onClick={() => addVendor('OpEx')}>
              + Add OpEx Vendor
            </button>
          </div>
        }
      >
        {!hydrated || !assumptions ? (
          <div className="cap">Loading saved software vendors…</div>
        ) : softwareItems.length === 0 ? (
          <div className="cap" style={{ padding: '10px 4px 4px' }}>
            No software vendors yet — add one above to start planning.
          </div>
        ) : (
          <PayrollTable
            title="Software Vendors"
            subtitle={`${softwareItems.length} vendor${softwareItems.length === 1 ? '' : 's'} · scroll right for the full month-over-month projection`}
            tintForecast
            frozenColumns={PLANNING_FROZEN_COLUMNS}
            months={planMonths}
            todayIso={todayIso}
            totalRow={planningTotalRow}
            rowGroups={[{ key: 'vendors', label: null, rows: planningRows }]}
            footer="Every vendor's Category decides where it lands on the P&L — CoGS → Software - Cost of Revenue, OpEx → Software - Operating Expense — no dragging needed. Fixed items spread each period's amount across its months by cadence (Quarterly ÷3 / Annual ÷12) and pay in one lump in Cash Flow via that account's own timing override; Usage / % Revenue / Per Seat recompute every month from their own drivers."
          />
        )}
      </CollapsibleSection>
    </div>
  );
}
