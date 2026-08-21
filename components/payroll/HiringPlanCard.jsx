'use client';

import { useState } from 'react';
import {
  DEPARTMENT_OPTIONS,
  formatPayrollAmount,
  generateId,
  monthlyCostFor,
  newHiresFor,
} from '../../lib/payroll/payrollData';
import { FillRangeButton, HeadcountMonthInput, MonthInput, PayrollTable, PickerInput, TextInput } from './PayrollTable';

const FROZEN_COLUMNS = [
  // Widened to match RosterCard's fix (2026-08-20) — 64px was clipping icon buttons
  // against this sticky column's edge.
  { key: 'actions', label: '', width: 80 },
  { key: 'name', label: 'Role', width: 210 },
  { key: 'department', label: 'Department', width: 130 },
  { key: 'costType', label: 'CoGS or OpEx?', width: 110 },
  { key: 'baseSalary', label: 'Base Salary (per person)', width: 150, align: 'right' },
];

/**
 * Hiring Plan — roles we don't have anyone in yet, planned to fill with several people
 * over time (e.g. "3 more Campaign Coordinators by Q4"), split out from the regular
 * Employee Roster onto its own card (Kayee, 2026-08-05: "create a separate section for
 * hiring plan, leave current employees in their own sections") so a hiring decision and
 * its cost/bottom-line impact are visible on their own, distinct from who's already on
 * payroll today.
 *
 * The editable figure per month is INCREMENTAL new hires (usually 0, occasionally 1+ —
 * "2 people start this role in June"), not a running headcount total — the app
 * accumulates that automatically every month afterward (Kayee, 2026-08-05, after
 * reviewing a reference sheet: "I want to be able to plug in the number month over
 * month and it will count"). The small caption under each month's input shows the
 * resulting running cost (headcount-to-date x per-person loaded cost) so the effect of
 * a hiring decision on cost is visible immediately, without needing to add up months by
 * hand. This card still receives (and writes back) the FULL payroll roster array —
 * every non-ramp employee just passes straight through untouched.
 */
export function HiringPlanCard({ roster, assumptions, months, todayIso, onChange }) {
  const [justAddedId, setJustAddedId] = useState(null);
  const roles = roster.filter((r) => r.isRamp);

  function updateRole(id, patch) {
    onChange(roster.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function updateNewHires(id, iso, value) {
    onChange(
      roster.map((r) => (r.id === id ? { ...r, newHiresByMonth: { ...r.newHiresByMonth, [iso]: value } } : r))
    );
  }

  function fillNewHires(id, targetMonths, value) {
    onChange(
      roster.map((r) => {
        if (r.id !== id) return r;
        const patch = {};
        for (const m of targetMonths) patch[m] = value;
        return { ...r, newHiresByMonth: { ...r.newHiresByMonth, ...patch } };
      })
    );
  }

  function removeRole(id, name) {
    if (typeof window !== 'undefined' && !window.confirm(`Remove ${name || 'this planned role'} from the hiring plan?`)) return;
    onChange(roster.filter((r) => r.id !== id));
  }

  function addRole() {
    const id = generateId('hire');
    const newRole = {
      id,
      name: '',
      department: '',
      costType: 'OpEx',
      title: '',
      startDate: '',
      endDate: '',
      employment: 'TBD',
      baseSalary: 0,
      isRamp: true,
      newHiresByMonth: {},
      monthlyOverrides: {},
    };
    onChange([...roster, newRole]);
    setJustAddedId(id);
  }

  const departmentOptions = Array.from(
    new Set([...DEPARTMENT_OPTIONS, ...roles.map((r) => r.department).filter(Boolean)])
  );

  const rows = roles.map((role) => {
    const monthCells = {};
    for (const iso of months) {
      monthCells[iso] = (
        <HeadcountMonthInput
          count={newHiresFor(role, iso)}
          costPreview={formatPayrollAmount(monthlyCostFor(role, iso, assumptions))}
          onCommit={(n) => updateNewHires(role.id, iso, n)}
        />
      );
    }
    return {
      id: role.id,
      monthCells,
      cells: {
        actions: (
          <div className="pr-row-actions">
            <FillRangeButton
              months={months}
              valueLabel="New hires"
              valuePlaceholder="e.g. 1"
              onApply={(targetMonths, value) => fillNewHires(role.id, targetMonths, value)}
            />
            <button
              type="button"
              className="icon-btn"
              title="Remove from hiring plan"
              onClick={() => removeRole(role.id, role.name)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0l-1 14a2 2 0 01-2 2H7a2 2 0 01-2-2L4 6" />
              </svg>
            </button>
          </div>
        ),
        name: (
          <TextInput
            value={role.name}
            placeholder="Role name"
            focusOnMount={role.id === justAddedId}
            onCommit={(v) => {
              updateRole(role.id, { name: v });
              if (role.id === justAddedId) setJustAddedId(null);
            }}
          />
        ),
        department: (
          <PickerInput
            value={role.department}
            options={departmentOptions}
            placeholder="Department"
            onCommit={(v) => updateRole(role.id, { department: v })}
          />
        ),
        costType: (
          <select
            className="pr-input pr-select"
            value={role.costType || ''}
            onChange={(e) => updateRole(role.id, { costType: e.target.value })}
          >
            <option value="">—</option>
            <option value="CoGS">CoGS</option>
            <option value="OpEx">OpEx</option>
          </select>
        ),
        baseSalary: <MonthInput value={role.baseSalary} onCommit={(n) => updateRole(role.id, { baseSalary: n })} />,
      },
    };
  });

  const totalRow = {
    cells: { name: <b>TOTAL</b> },
    monthCells: Object.fromEntries(
      months.map((iso) => {
        const sum = roles.reduce((acc, r) => acc + monthlyCostFor(r, iso, assumptions), 0);
        return [iso, <b key={iso}>{formatPayrollAmount(sum) || '$0'}</b>];
      })
    ),
  };

  return (
    <PayrollTable
      title="Hiring Plan"
      subtitle={`${roles.length} planned role${roles.length === 1 ? '' : 's'} · type new hires per month, cost accumulates automatically`}
      tintForecast={false}
      frozenColumns={FROZEN_COLUMNS}
      months={months}
      todayIso={todayIso}
      totalRow={totalRow}
      rowGroups={[{ key: 'roles', label: null, rows }]}
      headActions={
        // Plain .btn (white bg), not .btn.primary — .btn.primary is solid black and
        // would disappear against this card's own black header bar (the exact
        // "+Add bonus" contrast bug fixed earlier, 2026-08-05 — same fix applies here).
        <button type="button" className="btn" onClick={addRole}>
          + Add Role
        </button>
      }
    />
  );
}
