'use client';

import { useState } from 'react';
import { DEPARTMENT_OPTIONS, EMPLOYMENT_STATUSES, formatPayrollAmount, monthlyCostFor } from '../../lib/payroll/payrollData';
import { DateInput, FillRangeButton, MonthInput, PayrollTable, PickerInput, TextInput } from './PayrollTable';

const FROZEN_COLUMNS = [
  { key: 'actions', label: '', width: 64 },
  { key: 'name', label: 'Name', width: 210 },
  { key: 'department', label: 'Department', width: 130 },
  { key: 'costType', label: 'CoGS or OpEx?', width: 100 },
  { key: 'title', label: 'Title', width: 170 },
  { key: 'startDate', label: 'Start Date', width: 130 },
  { key: 'endDate', label: 'End Date', width: 130 },
  { key: 'employment', label: 'Employment', width: 100 },
  { key: 'baseSalary', label: 'Base Salaries', width: 120, align: 'right' },
];

const SECTION_ORDER = [
  { key: 'Active', label: 'Active', rowModifier: '' },
  { key: 'TBD', label: 'Planned (TBD)', rowModifier: 'pr-tbd' },
  { key: 'Dismissed', label: 'Dismissed', rowModifier: 'pr-dismissed' },
];

/**
 * Employee Roster — the editable heart of the Payroll tab, but ONLY current real people
 * (Active / Planned (TBD) / Dismissed, per each person's actual "Employment" field).
 * Not-yet-hired roles with a ramping headcount live on their own Hiring Plan card
 * instead (Kayee, 2026-08-05: "create a separate section for hiring plan, leave current
 * employees in their own sections") — this card still receives the FULL roster array
 * (and writes the full array back via onChange) so Hiring Plan rows pass through
 * untouched, it just never renders or edits them. Frozen leading columns (Name → Base
 * Salary) stay put while the monthly $ grid scrolls. A TOTAL row is pinned at the top
 * so the running headcount cost (of real people only) is visible without scrolling.
 */
export function RosterCard({ roster, assumptions, months, todayIso, onChange, justAddedId, onFocusHandled }) {
  const employees = roster.filter((r) => !r.isRamp);

  // Drag-to-reorder (Kayee, 2026-08-05: "turn it into draggable so people can rearrange
  // people") — scoped to within one section only (Active/Planned/Dismissed don't mix),
  // per Kayee's call, so dragging never silently changes someone's Employment status.
  const [draggedId, setDraggedId] = useState(null);

  function reorderWithinSection(sectionKey, fromId, toId) {
    if (fromId === toId) return;
    const sectionIds = employees.filter((r) => (r.employment || 'Active') === sectionKey).map((r) => r.id);
    const fromIndex = sectionIds.indexOf(fromId);
    const toIndex = sectionIds.indexOf(toId);
    if (fromIndex === -1 || toIndex === -1) return;
    const reorderedIds = [...sectionIds];
    const [moved] = reorderedIds.splice(fromIndex, 1);
    reorderedIds.splice(toIndex, 0, moved);

    // Walk the roster in its existing order, and wherever a row belongs to this
    // section, substitute the next id off the freshly-reordered list — every other
    // row (and every other section's rows) stays exactly where it was. Filtering by
    // section for display only cares about relative order among matching rows, so
    // this alone is enough to make the drag visible without touching anything else.
    let cursor = 0;
    const rosterById = Object.fromEntries(roster.map((r) => [r.id, r]));
    const newRoster = roster.map((r) => {
      // Ramp rows can share the same 'TBD' employment value but live on the Hiring
      // Plan card, not here — excluded so they never get pulled into this reorder.
      if (r.isRamp || (r.employment || 'Active') !== sectionKey) return r;
      const next = rosterById[reorderedIds[cursor]];
      cursor += 1;
      return next;
    });
    onChange(newRoster);
  }

  function updateEmployee(id, patch) {
    onChange(roster.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function updateMonthly(id, iso, value) {
    onChange(
      roster.map((r) =>
        r.id === id ? { ...r, monthlyOverrides: { ...r.monthlyOverrides, [iso]: value } } : r
      )
    );
  }

  function fillRange(id, targetMonths, value) {
    onChange(
      roster.map((r) => {
        if (r.id !== id) return r;
        const patch = {};
        for (const m of targetMonths) patch[m] = value;
        return { ...r, monthlyOverrides: { ...r.monthlyOverrides, ...patch } };
      })
    );
  }

  function removeEmployee(id, name) {
    if (typeof window !== 'undefined' && !window.confirm(`Remove ${name || 'this person'} from the roster?`)) return;
    onChange(roster.filter((r) => r.id !== id));
  }

  const departmentOptions = Array.from(
    new Set([...DEPARTMENT_OPTIONS, ...employees.map((r) => r.department).filter(Boolean)])
  );

  const rowGroups = SECTION_ORDER.map((section) => ({
    key: section.key,
    label: section.label,
    rowModifier: section.rowModifier,
    rows: employees
      .filter((r) => (r.employment || 'Active') === section.key)
      .map((employee) => buildRow(employee, section.key)),
  }));

  function buildRow(employee, sectionKey) {
    const monthCells = {};
    for (const iso of months) {
      const val = monthlyCostFor(employee, iso, assumptions);
      monthCells[iso] = <MonthInput value={val} onCommit={(n) => updateMonthly(employee.id, iso, n)} />;
    }

    return {
      id: employee.id,
      monthCells,
      className: draggedId === employee.id ? 'pr-dragging' : undefined,
      draggable: true,
      // Row itself is draggable (HTML5 DnD requires that), but the drag only actually
      // starts if the gesture began on the handle icon specifically — otherwise
      // clicking/dragging to select text inside a Name field would trigger a row drag.
      onDragStart: (e) => {
        if (!e.target.closest('[data-drag-handle]')) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.effectAllowed = 'move';
        setDraggedId(employee.id);
      },
      onDragOver: (e) => e.preventDefault(),
      onDrop: (e) => {
        e.preventDefault();
        if (draggedId) reorderWithinSection(sectionKey, draggedId, employee.id);
        setDraggedId(null);
      },
      onDragEnd: () => setDraggedId(null),
      cells: {
        actions: (
          <div className="pr-row-actions">
            <span
              className="icon-btn pr-drag-handle"
              data-drag-handle
              title="Drag to reorder within this section"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </span>
            <FillRangeButton months={months} onApply={(targetMonths, value) => fillRange(employee.id, targetMonths, value)} />
            <button
              type="button"
              className="icon-btn"
              title="Remove from roster"
              onClick={() => removeEmployee(employee.id, employee.name)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0l-1 14a2 2 0 01-2 2H7a2 2 0 01-2-2L4 6" />
              </svg>
            </button>
          </div>
        ),
        name: (
          <TextInput
            value={employee.name}
            placeholder="Name"
            focusOnMount={employee.id === justAddedId}
            onCommit={(v) => {
              updateEmployee(employee.id, { name: v });
              if (employee.id === justAddedId) onFocusHandled?.();
            }}
          />
        ),
        department: (
          <PickerInput
            value={employee.department}
            options={departmentOptions}
            placeholder="Department"
            onCommit={(v) => updateEmployee(employee.id, { department: v })}
          />
        ),
        costType: (
          <select
            className="pr-input pr-select"
            value={employee.costType || ''}
            onChange={(e) => updateEmployee(employee.id, { costType: e.target.value })}
          >
            <option value="">—</option>
            <option value="CoGS">CoGS</option>
            <option value="OpEx">OpEx</option>
          </select>
        ),
        title: (
          <TextInput
            value={employee.title}
            placeholder="Title"
            onCommit={(v) => updateEmployee(employee.id, { title: v })}
          />
        ),
        startDate: <DateInput value={employee.startDate} onCommit={(v) => updateEmployee(employee.id, { startDate: v })} />,
        endDate: <DateInput value={employee.endDate} onCommit={(v) => updateEmployee(employee.id, { endDate: v })} />,
        employment: (
          <select
            className="pr-input pr-select"
            value={employee.employment || 'Active'}
            onChange={(e) => updateEmployee(employee.id, { employment: e.target.value })}
          >
            {EMPLOYMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        ),
        baseSalary: (
          <MonthInput
            value={employee.baseSalary}
            onCommit={(n) => updateEmployee(employee.id, { baseSalary: n })}
          />
        ),
      },
    };
  }

  const totalRow = {
    cells: { name: <b>TOTAL</b> },
    monthCells: Object.fromEntries(
      months.map((iso) => {
        const sum = employees.reduce((acc, e) => acc + monthlyCostFor(e, iso, assumptions), 0);
        return [iso, <b key={iso}>{formatPayrollAmount(sum) || '$0'}</b>];
      })
    ),
  };

  return (
    <PayrollTable
      title="Employee Roster"
      subtitle={`${employees.length} people`}
      tintForecast={false}
      frozenColumns={FROZEN_COLUMNS}
      months={months}
      todayIso={todayIso}
      totalRow={totalRow}
      rowGroups={rowGroups}
    />
  );
}
