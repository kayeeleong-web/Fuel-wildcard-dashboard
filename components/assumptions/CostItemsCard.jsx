'use client';

import { useState, Fragment } from 'react';
import { TextInput, DateInput, MonthInput } from '../payroll/PayrollTable';
import {
  COST_CATEGORIES,
  COST_CADENCES,
  FIRST_PROJECTED_MONTH,
  generateId,
  isCostItemDue,
  buildScheduleRangePatch,
} from '../../lib/assumptions/assumptionsData';
import { formatMonthLabel } from '../../lib/calc/dashboardMetrics';

/** Plain select for Category/Cadence — same visual convention as PayrollTable's
 *  PickerInput, but without the "+ Add new…" escape hatch (this list is fixed). */
function Picker({ value, options, onCommit }) {
  return (
    <select className="pr-input pr-select" value={value} onChange={(e) => onCommit(e.target.value)}>
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  );
}

/** Inline "schedule a future amount change" row (2026-08-07, Kayee: "we should be able
 *  to apply to other period just like those revenue assumptions") — same collapsed-by-
 *  default pattern as ScheduledRateField (components/reports/RateScheduleControl.jsx):
 *  a quiet summary line for anything already scheduled, and the actual From/To/Value/
 *  Apply form only appears once "+ Schedule a future change" is clicked. Rendered as
 *  its own <tr> (colSpan across every column) directly under the item's row, rather
 *  than trying to cram a form into one table cell. */
function CostItemScheduleRow({ item, onChange, onCollapse }) {
  const [fromMonth, setFromMonth] = useState('');
  const [toMonth, setToMonth] = useState('');
  const [newValue, setNewValue] = useState('');
  const schedule = item.amountSchedule || {};
  const entries = Object.keys(schedule).sort();

  function apply() {
    if (!fromMonth || newValue === '') return;
    const patch = buildScheduleRangePatch(schedule, fromMonth, toMonth || null, newValue);
    onChange({ amountSchedule: patch });
    setFromMonth('');
    setToMonth('');
    setNewValue('');
  }

  function removeEntry(iso) {
    const patch = { ...schedule };
    delete patch[iso];
    onChange({ amountSchedule: patch });
  }

  return (
    <tr className="assump-cost-schedule-row">
      <td colSpan={6}>
        <div className="pr-schedule-inline-form pr-schedule-inline-form-table">
          {entries.length > 0 && (
            <div className="pr-schedule-summary">
              {entries.map((iso) => (
                <span key={iso} className="pr-schedule-summary-line">
                  → {schedule[iso] === null ? 'base amount' : `$${schedule[iso]}`} from {formatMonthLabel(iso)}
                  <button type="button" onClick={() => removeEntry(iso)} title="Remove this scheduled change">
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="pr-schedule-row">
            <label className="pr-schedule-field">
              <span>From</span>
              <input type="month" className="pr-input" value={fromMonth} onChange={(e) => setFromMonth(e.target.value)} />
            </label>
            <label className="pr-schedule-field">
              <span>To (optional)</span>
              <input type="month" className="pr-input" value={toMonth} onChange={(e) => setToMonth(e.target.value)} />
            </label>
            <label className="pr-schedule-field">
              <span>New Value ($)</span>
              <input type="number" className="pr-input" value={newValue} onChange={(e) => setNewValue(e.target.value)} />
            </label>
            <button type="button" className="btn primary pr-schedule-apply" onClick={apply} disabled={!fromMonth || newValue === ''}>
              Apply
            </button>
            <button type="button" className="btn pr-schedule-cancel" onClick={onCollapse}>
              Close
            </button>
          </div>
        </div>
      </td>
    </tr>
  );
}

/**
 * Non-Headcount Costs table — one flat list matching Kayee's real sheet exactly (What
 * is it? / $ / Cadence / Category / Start On), rather than splitting into separate
 * COGS/OPEX tables. The Category column is what determines whether a row counts
 * toward projected COGS, OPEX, or Other (Non-Operating) each month — see
 * ProjectionSummaryCard. Monthly items show their full $ every active month;
 * Quarterly items show their total / 3 every active month (spread evenly — e.g.
 * Vetric's $5,250/quarter shows as $1,750 every month, per Kayee 2026-08-05). Start
 * On is optional on both — leave it blank for "always active."
 *
 * `itemOrder` (2026-08-07, optional) — a list of item ids in the order they actually
 * appear on the P&L, computed in ReportsPanel.jsx from the real matched/injected row
 * positions (Kayee: "make this align with what they actually are... rent should be
 * next to the line"). Purely a DISPLAY sort — `costItems`/`onChange` are untouched, so
 * removing/reordering doesn't corrupt anything, and this table falls back to the
 * items' own stored order when no hint is passed in (the standalone Assumptions tab
 * has no P&L row context to build one from).
 */
export function CostItemsCard({ costItems, onChange, itemOrder }) {
  const [scheduleOpenId, setScheduleOpenId] = useState(null);

  function updateItem(id, patch) {
    onChange(costItems.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }

  function removeItem(id, name) {
    if (typeof window !== 'undefined' && !window.confirm(`Remove ${name || 'this cost item'}?`)) return;
    onChange(costItems.filter((i) => i.id !== id));
  }

  function addItem() {
    onChange([
      ...costItems,
      { id: generateId('cost'), name: '', amount: 0, cadence: 'Monthly', category: 'OpEx', startOn: '', amountSchedule: {} },
    ]);
  }

  const displayItems = itemOrder
    ? [...costItems].sort((a, b) => {
        const ai = itemOrder.indexOf(a.id);
        const bi = itemOrder.indexOf(b.id);
        if (ai === -1 && bi === -1) return 0;
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      })
    : costItems;

  return (
    <div className="payroll-card">
      <div className="payroll-card-head">
        <span className="payroll-card-title-btn" style={{ cursor: 'default' }}>
          Non-Headcount Costs
        </span>
        <span className="payroll-card-sub">{costItems.length} items</span>
        <span className="payroll-card-actions">
          <button type="button" className="btn primary" onClick={addItem}>
            + Add Cost
          </button>
        </span>
      </div>

      <div className="payroll-table-wrap">
        <table className="payroll-table assump-cost-table">
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>What is it?</th>
              <th style={{ textAlign: 'right' }}>$</th>
              <th>Cadence</th>
              <th>Category</th>
              <th>Start On</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {displayItems.map((item) => {
              const hasSchedule = item.amountSchedule && Object.keys(item.amountSchedule).length > 0;
              const isOpen = scheduleOpenId === item.id;
              return (
                <Fragment key={item.id}>
                  <tr>
                    <td>
                      <TextInput value={item.name} onCommit={(v) => updateItem(item.id, { name: v })} placeholder="Cost name" />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="assump-cost-amount-cell">
                        <MonthInput value={item.amount} onCommit={(n) => updateItem(item.id, { amount: n })} />
                        {/* Schedule toggle (2026-08-07) — a filled dot marks an item that
                            already has a future change queued, so that's visible even
                            while collapsed, same "don't hide what's already there"
                            principle as the Revenue rate fields. */}
                        <button
                          type="button"
                          className={`icon-btn assump-cost-schedule-toggle${hasSchedule ? ' has-schedule' : ''}`}
                          title="Schedule a future amount change"
                          onClick={() => setScheduleOpenId(isOpen ? null : item.id)}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="9" />
                            <path d="M12 7v5l3 3" />
                          </svg>
                        </button>
                      </div>
                    </td>
                    <td>
                      <Picker
                        value={item.cadence}
                        options={COST_CADENCES}
                        onCommit={(v) => updateItem(item.id, { cadence: v })}
                      />
                    </td>
                    <td>
                      <Picker
                        value={item.category}
                        options={COST_CATEGORIES}
                        onCommit={(v) => updateItem(item.id, { category: v })}
                      />
                    </td>
                    <td>
                      <DateInput value={item.startOn} onCommit={(v) => updateItem(item.id, { startOn: v })} />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="icon-btn"
                        title="Remove"
                        onClick={() => removeItem(item.id, item.name)}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0l-1 14a2 2 0 01-2 2H7a2 2 0 01-2-2L4 6" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                  {isOpen && (
                    <CostItemScheduleRow
                      key={`${item.id}-schedule`}
                      item={item}
                      onChange={(patch) => updateItem(item.id, patch)}
                      onCollapse={() => setScheduleOpenId(null)}
                    />
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="payroll-card-footer assump-cost-note">
        Whether a row counts toward projected COGS, OPEX, or Other from {FIRST_PROJECTED_MONTH} onward depends only
        on its Category — Monthly items show their full $ every month; Quarterly items show their total ÷ 3 every
        month (spread evenly, not billed as a lump sum once a quarter).
      </div>
    </div>
  );
}

export { isCostItemDue };
