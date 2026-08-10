'use client';

import { useState } from 'react';
import { buildScheduleRangePatch } from '../../lib/assumptions/assumptionsData';
import { formatMonthLabel } from '../../lib/calc/dashboardMetrics';

/**
 * "Apply a rate change for a date range" panel (2026-08-07, Kayee: "if they want to
 * switch from 3500 to 4500 in 2027 there will be an apply button that let them do
 * this... start date for jan 2026 to dec 2026 is 3500 then I apply it and it will
 * show up on a monthly basis"). Sits as its own section next to a group's rate
 * field(s) in PLAssumptionsSidebar — the group's existing <AssumptionField> is still
 * the BASE rate (applies everywhere with no override); this panel layers effective-
 * dated overrides on top of it via the `*Schedule` maps in lib/assumptions/
 * assumptionsData.js, which every revenue formula (upfrontRevenueForMonth,
 * meetingRevenueForMonth, meetingsForMonth, costPerCampaignForMonth) already reads.
 *
 * `fields` is the list of this group's schedulable rates — one dropdown when there's
 * more than one (e.g. Transaction Revenue's Per Meeting Rate AND Meeting Conversion),
 * no dropdown needed when there's only one (Subscription Revenue's Upfront Rate,
 * COGS's Cost Per Campaign Rate).
 */
export function RateScheduleControl({ fields, revenue, onChange }) {
  const [selectedKey, setSelectedKey] = useState(fields[0].key);
  const [fromMonth, setFromMonth] = useState('');
  const [toMonth, setToMonth] = useState('');
  const [value, setValue] = useState('');

  const field = fields.find((f) => f.key === selectedKey) || fields[0];
  const schedule = revenue[field.scheduleKey] || {};
  const entries = Object.keys(schedule).sort();

  function apply() {
    if (!fromMonth || value === '') return;
    const patch = buildScheduleRangePatch(schedule, fromMonth, toMonth || null, value);
    onChange({ ...revenue, [field.scheduleKey]: patch });
    setFromMonth('');
    setToMonth('');
    setValue('');
  }

  function removeEntry(iso) {
    const patch = { ...schedule };
    delete patch[iso];
    onChange({ ...revenue, [field.scheduleKey]: patch });
  }

  return (
    <div className="pr-schedule-panel">
      <div className="pr-schedule-panel-label">Apply a rate change</div>

      {fields.length > 1 && (
        <select
          className="pr-input pr-select pr-schedule-field-select"
          value={selectedKey}
          onChange={(e) => setSelectedKey(e.target.value)}
        >
          {fields.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </select>
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
      </div>
      <div className="pr-schedule-row">
        <label className="pr-schedule-field">
          <span>New Value{field.suffix ? ` (${field.suffix})` : ''}</span>
          <input
            type="number"
            className="pr-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={field.suffix === '$' ? '4500' : '12'}
          />
        </label>
        <button type="button" className="btn primary pr-schedule-apply" onClick={apply} disabled={!fromMonth || value === ''}>
          Apply
        </button>
      </div>

      {entries.length > 0 && (
        <div className="pr-schedule-chips">
          {entries.map((iso) => (
            <span key={iso} className="pr-schedule-chip">
              {formatMonthLabel(iso)}: {schedule[iso] === null ? 'base rate' : `${field.suffix === '$' ? '$' : ''}${schedule[iso]}${field.suffix === '%' ? '%' : ''}`}
              <button type="button" onClick={() => removeEntry(iso)} title="Remove this override">
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
