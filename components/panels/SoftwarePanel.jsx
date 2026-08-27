'use client';

import { useMemo, useState } from 'react';
import { PayrollTable, MonthInput, TextInput, PickerInput } from '../payroll/PayrollTable';
import { CollapsibleSection } from '../payroll/CollapsibleSection';
import { formatPayrollAmount, monthsForRange, currentIsoMonth, DEPARTMENT_OPTIONS } from '../../lib/payroll/payrollData';
import { generateId } from '../../lib/assumptions/assumptionsData';
import { buildSoftwareSpendHistory } from '../../lib/data/softwareSpendData';
import {
  SOFTWARE_DRIVER_TYPES,
  DRIVER_TYPE_LABELS,
  SOFTWARE_CADENCES,
  softwareAmountForMonth,
  recomputeSoftwareSchedules,
  makeSoftwareItem,
} from '../../lib/software/softwareData';

/**
 * Software tab — SKELETON (2026-08-27, Kayee: "you can build out a skeleton and then
 * we will make changes"). Same page shell as Payroll/Customer (page-wide,
 * CollapsibleSection "outer folder" boxes, payroll-card black-headed tables), three
 * divisions per Kayee's spec:
 *   1. Actual Spend to Date — real GL spend, monthly x by vendor, from inception
 *      through the last closed month (the GL export just IS whatever's closed).
 *   2. Projection Summary — CoGS vs OpEx software cost, computed live from Division 3.
 *   3. Planning — every vendor row, with a driver type deciding how its monthly $ is
 *      computed (Fixed / Variable-Usage / Variable-%-Revenue / Per Seat), add/inactive
 *      exactly like the Customer tab's rows, dragged onto a P&L line to link it exactly
 *      like the Assumptions sidebar's Non-Headcount Costs.
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
  const [collapsedSections, setCollapsedSections] = useState({ spend: false, summary: false, planning: false });
  const toggleSection = (key) => setCollapsedSections((p) => ({ ...p, [key]: !p[key] }));

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
    commitCostItems([...(assumptions.costItems || []), makeSoftwareItem({ id: generateId('software'), category })]);
  }

  function removeVendor(id) {
    // No confirm() dialog (house style — "i dont want no pop up when i delete stuff").
    commitCostItems((assumptions.costItems || []).filter((i) => i.id !== id));
  }

  function unlinkVendor(id) {
    updateVendor(id, { linkedRowLabel: null });
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
        subtitle="Every software vendor — driver type decides how its monthly $ is computed · drag a row onto a P&L line to link it"
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
        ) : (
          <div className="payroll-card">
            <div className="payroll-table-wrap">
              <table className="payroll-table assump-cost-table software-vendor-table">
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Vendor</th>
                    <th>Category</th>
                    <th>Active</th>
                    <th style={{ textAlign: 'left' }}>Driver</th>
                    <th style={{ textAlign: 'left' }}>Details</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {softwareItems.map((item) => (
                    <tr
                      key={item.id}
                      className={`assump-cost-draggable-row${item.active === false ? ' software-inactive-row' : ''}`}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', item.id);
                        e.dataTransfer.setData(`application/x-cost-item-${item.category.toLowerCase()}`, item.id);
                      }}
                    >
                      <td className="assump-cost-name-td">
                        <div className="assump-cost-name-cell">
                          <TextInput
                            value={item.name}
                            placeholder="Vendor name"
                            onCommit={(v) => updateVendor(item.id, { name: v })}
                          />
                          <span
                            className="assump-cost-link-badge"
                            style={item.linkedRowLabel ? undefined : { visibility: 'hidden' }}
                            title={
                              item.linkedRowLabel
                                ? `Forecasts feed the "${item.linkedRowLabel}" P&L row directly`
                                : undefined
                            }
                          >
                            ↳ {item.linkedRowLabel || ' '}
                            <button type="button" onClick={() => unlinkVendor(item.id)} title="Unlink from this P&L row">
                              ×
                            </button>
                          </span>
                        </div>
                      </td>
                      <td>
                        <select
                          className="pr-input pr-select"
                          value={item.category}
                          onChange={(e) => updateVendor(item.id, { category: e.target.value })}
                        >
                          <option value="CoGS">CoGS</option>
                          <option value="OpEx">OpEx</option>
                        </select>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={item.active !== false}
                          onChange={(e) => updateVendor(item.id, { active: e.target.checked })}
                          title="Active — inactive vendors contribute $0 everywhere (P&L and Cash Flow both)"
                        />
                      </td>
                      <td>
                        <DriverTypePicker value={item.driverType} onCommit={(v) => updateVendor(item.id, { driverType: v })} />
                      </td>
                      <td className="software-details-td">
                        {item.driverType === 'fixed' && (
                          <div className="software-details-row">
                            <MonthInput value={item.softwareAmount} onCommit={(n) => updateVendor(item.id, { softwareAmount: n })} />
                            <CadencePicker
                              value={item.softwareCadence}
                              onCommit={(v) => updateVendor(item.id, { softwareCadence: v })}
                            />
                          </div>
                        )}
                        {item.driverType === 'usage' && (
                          <div className="software-details-row">
                            <TextInput
                              value={item.unitLabel}
                              placeholder="unit (e.g. token)"
                              onCommit={(v) => updateVendor(item.id, { unitLabel: v })}
                            />
                            <span className="software-details-label">$</span>
                            <MonthInput value={item.unitRate} onCommit={(n) => updateVendor(item.id, { unitRate: n })} />
                            <span className="software-details-label">/ unit ×</span>
                            <MonthInput
                              value={item.unitsPerMonth}
                              onCommit={(n) => updateVendor(item.id, { unitsPerMonth: n })}
                            />
                            <span className="software-details-label">units/mo</span>
                          </div>
                        )}
                        {item.driverType === 'percentRevenue' && (
                          <div className="software-details-row">
                            <MonthInput
                              value={item.revenuePercent}
                              onCommit={(n) => updateVendor(item.id, { revenuePercent: n })}
                            />
                            <span className="software-details-label">% of Total Revenue</span>
                          </div>
                        )}
                        {item.driverType === 'perSeat' && (
                          <div className="software-details-row">
                            <span className="software-details-label">$</span>
                            <MonthInput value={item.seatRate} onCommit={(n) => updateVendor(item.id, { seatRate: n })} />
                            <span className="software-details-label">/ seat ×</span>
                            <PickerInput
                              value={item.seatDepartment}
                              options={DEPARTMENT_OPTIONS}
                              placeholder="Department"
                              onCommit={(v) => updateVendor(item.id, { seatDepartment: v })}
                            />
                          </div>
                        )}
                      </td>
                      <td>
                        <button type="button" className="icon-btn" title="Remove" onClick={() => removeVendor(item.id)}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0l-1 14a2 2 0 01-2 2H7a2 2 0 01-2-2L4 6" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="payroll-card-footer assump-cost-note">
              Drag a vendor row onto its P&L line to link it — same mechanic as Non-Headcount Costs. Fixed items
              spread Quarterly ÷3 / Annual ÷12 across the P&L (paid in one lump in Cash Flow via that account's own
              timing override); Usage / % Revenue / Per Seat recompute every month from their own drivers.
            </div>
          </div>
        )}
      </CollapsibleSection>
    </div>
  );
}
