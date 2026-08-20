'use client';

import { useState, Fragment } from 'react';
import { TextInput, DateInput, MonthInput } from '../payroll/PayrollTable';
import {
  COST_CADENCES,
  generateId,
  isCostItemDue,
  buildScheduleRangePatch,
} from '../../lib/assumptions/assumptionsData';
import { formatMonthLabel } from '../../lib/calc/dashboardMetrics';

/** Plain select for Cadence — same visual convention as PayrollTable's PickerInput,
 *  but without the "+ Add new…" escape hatch (this list is fixed). */
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

/** Always-visible schedule summary (2026-08-10, Kayee: "like in revenue assumption
 *  you need to show which period is how much so that the user know") — matches
 *  ScheduledRateField's convention on the Revenue side exactly: don't make anyone open
 *  anything just to see WHETHER a future change is queued. Rendered right under the $
 *  input regardless of whether the schedule row is expanded. */
function CostItemScheduleSummary({ item, onRemoveEntry }) {
  const schedule = item.amountSchedule || {};
  const entries = Object.keys(schedule).sort();
  if (entries.length === 0) return null;
  return (
    <div className="pr-schedule-summary assump-cost-schedule-summary">
      {entries.map((iso) => (
        <span key={iso} className="pr-schedule-summary-line">
          → {schedule[iso] === null ? 'base amount' : `$${schedule[iso]}`} from {formatMonthLabel(iso)}
          <button type="button" onClick={() => onRemoveEntry(iso)} title="Remove this scheduled change">
            ×
          </button>
        </span>
      ))}
    </div>
  );
}

/** Inline "schedule a future amount change" row (2026-08-07, Kayee: "we should be able
 *  to apply to other period just like those revenue assumptions") — the From/To/Value/
 *  Apply form only appears once the clock icon is clicked (the summary itself is now
 *  always visible, see CostItemScheduleSummary above). Rendered as its own <tr>
 *  (colSpan across every column) directly under the item's row, rather than trying to
 *  cram a form into one table cell.
 *
 *  Also holds the "Start On" date (2026-08-10, Kayee: "why do i need start on if the
 *  clock icon will take care of it") — folded in here instead of its own standalone
 *  column, since both controls are about "when does this cost actually apply," just
 *  two different shapes of that question (a one-time start date vs. a $ that changes
 *  more than once). Tucking both behind the same icon frees up the name column, which
 *  was the thing actually running out of room. */
function CostItemScheduleRow({ item, onChange, onCollapse }) {
  const [fromMonth, setFromMonth] = useState('');
  const [toMonth, setToMonth] = useState('');
  const [newValue, setNewValue] = useState('');
  const schedule = item.amountSchedule || {};

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
      <td colSpan={4}>
        <div className="pr-schedule-inline-form pr-schedule-inline-form-table">
          <CostItemScheduleSummary item={item} onRemoveEntry={removeEntry} />
          <div className="pr-schedule-row">
            <label className="pr-schedule-field">
              <span>Start On (optional)</span>
              <DateInput value={item.startOn} onCommit={(v) => onChange({ startOn: v })} />
            </label>
          </div>
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
 * Non-Headcount Costs — split 2026-08-10 into one card per Category (Kayee: "can you
 * divide non headcount cost to cogs and opex? so that user no longer need to select
 * those... if i add the cost in cogs it will only be allow to get sync to any items
 * in cogs"). `category` is now fixed per card instead of a per-row picker — which cost
 * item a row card belongs to is you decided by which "+ Add Cost" button you used, not
 * a dropdown you have to remember to set correctly. That also means the Category
 * column is gone entirely, and the freed width goes to Name and $ (Kayee: "increase
 * the width of what is it blue box... now that we have more space might as well use
 * it"). The category boundary is enforced on the P&L side too now (see
 * FragmentRows/isDropTarget in ReportsPanel.jsx) — a CoGS item's drag can only land on
 * a CoGS-section P&L row, an OpEx item's only on an OpEx-section row, so there's no way
 * to accidentally cross-wire a cost into the wrong statement bucket.
 *
 * Start On and the effective-dated amount schedule both live behind the "Period"
 * button — Kayee: "why do i need start on if the clock icon will take care of it."
 * Whatever schedule IS set always shows as a quiet "→ $X from [month]" line under the
 * $ box regardless of whether the panel is open (Kayee: "like in revenue assumption
 * you need to show which period is how much so that the user know") — nothing about an
 * item's timing is ever hidden, only the form used to CHANGE it is collapsed by
 * default. The button itself is a labeled pill, not a bare icon (Kayee: "make it more
 * obvious that this button is so that they apply for the period") — an unlabeled
 * circle read as decoration, not a control. Labeled "Period" rather than "Schedule"
 * per Kayee's own naming preference (2026-08-10: "i dont like the word schedule...
 * maybe period").
 *
 * `itemOrder` (2026-08-07, optional) — a list of item ids in the order they actually
 * appear on the P&L, computed in ReportsPanel.jsx from the real matched/injected row
 * positions (Kayee: "make this align with what they actually are... rent should be
 * next to the line"). Purely a DISPLAY sort — `costItems`/`onChange` are untouched, so
 * removing/reordering doesn't corrupt anything, and this table falls back to the
 * items' own stored order when no hint is passed in.
 *
 * `costItems`/`onChange` here are always the FULL list across every category — this
 * component filters to its own `category` purely for display, so saving never drops
 * another card's items.
 */
export function CostItemsCard({ costItems, onChange, itemOrder, category, title, addLabel, defaultCollapsed = false }) {
  const [scheduleOpenId, setScheduleOpenId] = useState(null);
  // 2026-08-20 (Kayee: the sidebar's cards no longer fit in one page — "make it
  // collapsable so that it's not just fit into one page... keep it default collapse
  // for each section, that way you can keep each and stay when scroll"). Collapsed by
  // default so the Revenue Assumptions + CoGS + OpEx cards stacked in the sticky
  // sidebar (globals.css .reports-sidebar) sum to a short, natural-height list instead
  // of relying on one card force-growing to fill leftover space (the bug that was
  // clipping the OpEx card's rows).
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  const items = costItems.filter((i) => i.category === category);

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
      { id: generateId('cost'), name: '', amount: 0, cadence: 'Monthly', category, startOn: '', amountSchedule: {}, linkedRowLabel: null },
    ]);
  }

  function unlinkItem(id) {
    updateItem(id, { linkedRowLabel: null });
  }

  const displayItems = itemOrder
    ? [...items].sort((a, b) => {
        const ai = itemOrder.indexOf(a.id);
        const bi = itemOrder.indexOf(b.id);
        if (ai === -1 && bi === -1) return 0;
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      })
    : items;

  return (
    <div className="payroll-card">
      <div className="payroll-card-head">
        <button
          type="button"
          className="payroll-card-title-btn"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
        >
          <span className={`payroll-chevron${collapsed ? '' : ' open'}`}>▸</span>
          {title}
        </button>
        <span className="payroll-card-sub">{items.length} items</span>
        <span className="payroll-card-actions">
          {/* Plain .btn (white bg), not .btn.primary — this sits on the card's own
              black header bar, where solid black-on-black would be invisible (same
              contrast fix already applied to Payroll's "+ Add Role"/"+ Add Hire",
              2026-08-05/19). */}
          <button type="button" className="btn" onClick={addItem}>
            {addLabel || '+ Add Cost'}
          </button>
        </span>
      </div>

      {!collapsed && (
      <div className="payroll-table-wrap">
        <table className="payroll-table assump-cost-table">
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>What is it?</th>
              <th style={{ textAlign: 'right' }}>$</th>
              <th>Cadence</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {displayItems.map((item) => {
              const hasSchedule = item.amountSchedule && Object.keys(item.amountSchedule).length > 0;
              const isOpen = scheduleOpenId === item.id;
              return (
                <Fragment key={item.id}>
                  {/* draggable (2026-08-10, Kayee: "give me the option to drag and drop
                      to match thing so that you dont have to worry about mapping...
                      if it said rent it will allow me to add rent to P&L for
                      projections") — dropping this row onto a real P&L line (see
                      FragmentRows in ReportsPanel.jsx) sets an explicit linkedRowLabel
                      that always wins over the automatic (and, per Kayee's real "Rent"
                      example, occasionally fragile) name-matching. This card doesn't
                      know what row it landed on until it's dropped — that's read back
                      via `item.linkedRowLabel` below, set from the P&L side.
                      A second custom MIME type encodes THIS item's category directly
                      in its name (e.g. "application/x-cost-item-cogs") — dataTransfer
                      values can't be read during dragover in any browser (a security
                      restriction), but the list of available TYPES can, which is what
                      lets the P&L side show a real "not allowed" cursor over a
                      mismatched-category row instead of only rejecting it after drop. */}
                  <tr
                    className="assump-cost-draggable-row"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', item.id);
                      e.dataTransfer.setData(`application/x-cost-item-${category.toLowerCase()}`, item.id);
                    }}
                  >
                    {/* Stacked flex column, not two inline siblings (2026-08-10 fix,
                        Kayee: "it created these funny watermark like a blue thing but
                        overlap with other text") — the link badge is long text
                        ("↳ Software - Operating Expense") that has nowhere to go but
                        overflow sideways into the $ column next to it when it's just
                        an inline <span> after the name input in a narrow cell. Forcing
                        this cell into its own column layout guarantees the badge
                        always renders on its own line, clipped to this cell's width,
                        never bleeding into a neighbor. */}
                    <td className="assump-cost-name-td">
                      {/* The flex-column wrapper is a plain inner <div>, not the <td>
                          itself (2026-08-10 fix, Kayee: "why don't you use this space
                          here... just make the box for travel, team lunch and other
                          longer") — putting `display: flex` directly on a table cell
                          can make table-layout:fixed's declared column width stop
                          being honored by that cell's content in some browsers, which
                          is exactly why the name input was rendering narrower than
                          its real ~42%-wide column instead of filling it. A normal
                          block-level <div> inside an ordinary table-cell always
                          stretches to the cell's full width automatically — no such
                          quirk. */}
                      <div className="assump-cost-name-cell">
                        <TextInput value={item.name} onCommit={(v) => updateItem(item.id, { name: v })} placeholder="Cost name" />
                        {item.linkedRowLabel && (
                          <span className="assump-cost-link-badge" title={`Forecasts feed the "${item.linkedRowLabel}" P&L row directly`}>
                            ↳ {item.linkedRowLabel}
                            <button type="button" onClick={() => unlinkItem(item.id)} title="Unlink from this P&L row">
                              ×
                            </button>
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={{ textAlign: 'right' }} className="assump-cost-amount-td">
                      <div className="assump-cost-amount-cell">
                        <MonthInput value={item.amount} onCommit={(n) => updateItem(item.id, { amount: n })} />
                        <button
                          type="button"
                          className={`assump-cost-schedule-toggle${hasSchedule || item.startOn ? ' has-schedule' : ''}`}
                          title="Set a different amount for a future period, or a start date, for this cost"
                          onClick={() => setScheduleOpenId(isOpen ? null : item.id)}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="9" />
                            <path d="M12 7v5l3 3" />
                          </svg>
                          Period
                        </button>
                      </div>
                      <CostItemScheduleSummary item={item} onRemoveEntry={(iso) => {
                        const patch = { ...(item.amountSchedule || {}) };
                        delete patch[iso];
                        updateItem(item.id, { amountSchedule: patch });
                      }} />
                    </td>
                    <td className="assump-cost-cadence-td">
                      <Picker
                        value={item.cadence}
                        options={COST_CADENCES}
                        onCommit={(v) => updateItem(item.id, { cadence: v })}
                      />
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
      )}

      {!collapsed && (
      <div className="payroll-card-footer assump-cost-note">
        Quarterly items spread their total ÷ 3 across each month. Drag a row onto its P&L line to link it.
      </div>
      )}
    </div>
  );
}

export { isCostItemDue };
