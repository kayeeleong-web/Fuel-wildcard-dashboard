'use client';

import { useState } from 'react';
import { AssumptionField } from '../payroll/AssumptionsBar';
import { buildScheduleRangePatch } from '../../lib/assumptions/assumptionsData';
import { formatMonthLabel } from '../../lib/calc/dashboardMetrics';

/**
 * A single rate field (Per Meeting Rate, Upfront Rate, etc.) plus its optional future
 * rate schedule, redesigned 2026-08-07 after Kayee's UX/FP&A framing question: "this
 * is covering what's behind... what should we still show at the meantime? like 3000
 * for now but I know if I already have 4000 for the next year... maybe the apply a
 * rate change can be hidden, only show up when I want it."
 *
 * v1 (same day, superseded) put a whole From/To/Value/Apply form permanently open as
 * a third section next to every group's fields — correct data model, wrong amount of
 * screen real estate for something you set once and rarely touch. This version:
 *   - Always shows the field's CURRENT value (the number in effect right now) exactly
 *     like before — that's the thing that should stay visually dominant.
 *   - If a future change is already scheduled, shows it as a single quiet line
 *     ("→ $4,500 from Jan 2027") right under the field — always visible, no clicking
 *     required, so "do I already have next year's number queued?" never requires
 *     opening anything to answer.
 *   - The actual add-a-change FORM is collapsed behind a plain text link ("+ Schedule
 *     a future change") and only appears inline when clicked, collapsing again once
 *     applied — so the heavy editing UI is only on screen when it's actually wanted.
 */
export function ScheduledRateField({ label, value, onCommit, suffix, revenue, scheduleKey, onChange }) {
  const [expanded, setExpanded] = useState(false);
  const [fromMonth, setFromMonth] = useState('');
  const [toMonth, setToMonth] = useState('');
  const [newValue, setNewValue] = useState('');

  const schedule = revenue[scheduleKey] || {};
  const entries = Object.keys(schedule).sort();

  function apply() {
    if (!fromMonth || newValue === '') return;
    const patch = buildScheduleRangePatch(schedule, fromMonth, toMonth || null, newValue);
    onChange({ ...revenue, [scheduleKey]: patch });
    setFromMonth('');
    setToMonth('');
    setNewValue('');
    setExpanded(false);
  }

  function removeEntry(iso) {
    const patch = { ...schedule };
    delete patch[iso];
    onChange({ ...revenue, [scheduleKey]: patch });
  }

  return (
    <div className="pr-scheduled-field">
      <AssumptionField label={label} value={value} onCommit={onCommit} suffix={suffix} />

      {entries.length > 0 && (
        <div className="pr-schedule-summary">
          {entries.map((iso) => (
            <span key={iso} className="pr-schedule-summary-line">
              → {schedule[iso] === null ? 'base rate' : `${suffix === '$' ? '$' : ''}${schedule[iso]}${suffix === '%' ? '%' : ''}`} from{' '}
              {formatMonthLabel(iso)}
              <button type="button" onClick={() => removeEntry(iso)} title="Remove this scheduled change">
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {!expanded ? (
        <button type="button" className="pr-schedule-add-link" onClick={() => setExpanded(true)}>
          + Schedule a future change
        </button>
      ) : (
        <div className="pr-schedule-inline-form">
          <div className="pr-schedule-row">
            <label className="pr-schedule-field">
              <span>From</span>
              <input type="month" className="pr-input" value={fromMonth} onChange={(e) => setFromMonth(e.target.value)} />
            </label>
            <label className="pr-schedule-field">
              <span>To (optional)</span>
              <input type="month" className="pr-input" value={toMonth} onChange={(e) => setToMonth(e.target.value)} />
            </label>
          </div>
          <div className="pr-schedule-row">
            <label className="pr-schedule-field">
              <span>New Value{suffix ? ` (${suffix})` : ''}</span>
              <input
                type="number"
                className="pr-input"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder={suffix === '$' ? '4500' : '12'}
              />
            </label>
            <button type="button" className="btn primary pr-schedule-apply" onClick={apply} disabled={!fromMonth || newValue === ''}>
              Apply
            </button>
            <button type="button" className="btn pr-schedule-cancel" onClick={() => setExpanded(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
