'use client';

import { TextInput, DateInput, MonthInput } from '../payroll/PayrollTable';
import {
  COST_CATEGORIES,
  COST_CADENCES,
  FIRST_PROJECTED_MONTH,
  generateId,
  isCostItemDue,
} from '../../lib/assumptions/assumptionsData';

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

/**
 * Non-Headcount Costs table — one flat list matching Kayee's real sheet exactly (What
 * is it? / $ / Cadence / Category / Start On), rather than splitting into separate
 * COGS/OPEX tables. The Category column is what determines whether a row counts
 * toward projected COGS, OPEX, or Other (Non-Operating) each month — see
 * ProjectionSummaryCard. Monthly items show their full $ every active month;
 * Quarterly items show their total / 3 every active month (spread evenly — e.g.
 * Vetric's $5,250/quarter shows as $1,750 every month, per Kayee 2026-08-05). Start
 * On is optional on both — leave it blank for "always active."
 */
export function CostItemsCard({ costItems, onChange }) {
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
      { id: generateId('cost'), name: '', amount: 0, cadence: 'Monthly', category: 'OpEx', startOn: '' },
    ]);
  }

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
            {costItems.map((item) => {
              return (
                <tr key={item.id}>
                  <td>
                    <TextInput value={item.name} onCommit={(v) => updateItem(item.id, { name: v })} placeholder="Cost name" />
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <MonthInput value={item.amount} onCommit={(n) => updateItem(item.id, { amount: n })} />
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
