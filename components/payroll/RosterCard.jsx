'use client';

import {
  DEPARTMENT_OPTIONS,
  EMPLOYMENT_STATUSES,
  formatPayrollAmount,
  headcountFor,
  monthlyCostFor,
} from '../../lib/payroll/payrollData';
import {
  DateInput,
  FillRangeButton,
  HeadcountMonthInput,
  MonthInput,
  PayrollTable,
  PickerInput,
  TextInput,
} from './PayrollTable';

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
 * Employee Roster — the editable heart of the Payroll tab. Frozen leading columns
 * (Name → Base Salary) stay put while the monthly $ grid scrolls; every roster member
 * is split into Active / Planned (TBD) / Dismissed sections (Kayee's actual "Employment"
 * field, carried straight from her sheet — see payrollData.js). A TOTAL row is pinned at
 * the top so the running headcount cost is visible without scrolling to the bottom.
 */
export function RosterCard({ roster, assumptions, months, todayIso, onChange, justAddedId, onFocusHandled }) {
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

  // Ramp rows (see payrollData.js headcountFor) track a headcount COUNT per month
  // instead of a dollar override — a separate updater/fill so the two never collide.
  function updateHeadcount(id, iso, value) {
    onChange(
      roster.map((r) => (r.id === id ? { ...r, headcountByMonth: { ...r.headcountByMonth, [iso]: value } } : r))
    );
  }

  function fillHeadcount(id, targetMonths, value) {
    onChange(
      roster.map((r) => {
        if (r.id !== id) return r;
        const patch = {};
        for (const m of targetMonths) patch[m] = value;
        return { ...r, headcountByMonth: { ...r.headcountByMonth, ...patch } };
      })
    );
  }

  function removeEmployee(id, name) {
    if (typeof window !== 'undefined' && !window.confirm(`Remove ${name || 'this person'} from the roster?`)) return;
    onChange(roster.filter((r) => r.id !== id));
  }

  const departmentOptions = Array.from(
    new Set([...DEPARTMENT_OPTIONS, ...roster.map((r) => r.department).filter(Boolean)])
  );

  const rowGroups = SECTION_ORDER.map((section) => ({
    key: section.key,
    label: section.label,
    rowModifier: section.rowModifier,
    rows: roster
      .filter((r) => (r.employment || 'Active') === section.key)
      .map((employee) => buildRow(employee)),
  }));

  function buildRow(employee) {
    const monthCells = {};
    for (const iso of months) {
      if (employee.isRamp) {
        // Ramp row: the editable figure is a headcount count, not a dollar amount — cost
        // (shown as a small caption under the count) is always count x per-person loaded
        // cost, computed in payrollData.js, never typed directly here.
        monthCells[iso] = (
          <HeadcountMonthInput
            count={headcountFor(employee, iso)}
            costPreview={formatPayrollAmount(monthlyCostFor(employee, iso, assumptions))}
            onCommit={(n) => updateHeadcount(employee.id, iso, n)}
          />
        );
      } else {
        const val = monthlyCostFor(employee, iso, assumptions);
        monthCells[iso] = <MonthInput value={val} onCommit={(n) => updateMonthly(employee.id, iso, n)} />;
      }
    }

    return {
      id: employee.id,
      monthCells,
      cells: {
        actions: (
          <div className="pr-row-actions">
            <FillRangeButton
              months={months}
              valueLabel={employee.isRamp ? 'Headcount' : 'Value'}
              valuePlaceholder={employee.isRamp ? 'e.g. 2' : '$'}
              onApply={(targetMonths, value) =>
                employee.isRamp
                  ? fillHeadcount(employee.id, targetMonths, value)
                  : fillRange(employee.id, targetMonths, value)
              }
            />
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
          <div className="pr-name-cell">
            <TextInput
              value={employee.name}
              placeholder="Name"
              focusOnMount={employee.id === justAddedId}
              onCommit={(v) => {
                updateEmployee(employee.id, { name: v });
                if (employee.id === justAddedId) onFocusHandled?.();
              }}
            />
            {employee.isRamp && <span className="pr-ramp-badge">Ramp</span>}
          </div>
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
        // Ramp rows have no single start/end date — headcount per month (below) drives
        // when this role's cost/bonus kicks in instead.
        startDate: employee.isRamp ? (
          <span className="pr-missing">Ramps by headcount →</span>
        ) : (
          <DateInput value={employee.startDate} onCommit={(v) => updateEmployee(employee.id, { startDate: v })} />
        ),
        endDate: employee.isRamp ? null : (
          <DateInput value={employee.endDate} onCommit={(v) => updateEmployee(employee.id, { endDate: v })} />
        ),
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
        const sum = roster.reduce((acc, e) => acc + monthlyCostFor(e, iso, assumptions), 0);
        return [iso, <b key={iso}>{formatPayrollAmount(sum) || '$0'}</b>];
      })
    ),
  };

  return (
    <PayrollTable
      title="Employee Roster"
      subtitle={`${roster.length} people`}
      tintForecast={false}
      frozenColumns={FROZEN_COLUMNS}
      months={months}
      todayIso={todayIso}
      totalRow={totalRow}
      rowGroups={rowGroups}
    />
  );
}
