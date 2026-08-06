'use client';

import { bonusMonthlyFlow, formatPayrollAmount, generateId, oteFor } from '../../lib/payroll/payrollData';
import { FillRangeButton, MonthInput, PayrollTable } from './PayrollTable';

const FROZEN_COLUMNS = [
  { key: 'actions', label: '', width: 64 },
  { key: 'name', label: 'Name', width: 210 },
  { key: 'base', label: 'Base', width: 110, align: 'right' },
  { key: 'bonus', label: 'Bonus', width: 110, align: 'right' },
  { key: 'ote', label: 'OTE', width: 110, align: 'right' },
];

/**
 * Bonus — deliberately simpler than the roster: no tiers, no accelerator split, just a
 * per-person Bonus $ amount and the single global Bonus Attainment % from the
 * assumptions bar (Kayee's call — "no need to do the % split like the other client").
 * Monthly flow = Bonus $ x Bonus Attainment% / 12, and only pays out during months the
 * linked roster member is actually active (see payrollData.js bonusMonthlyFlow) — no
 * separate start/end dates to maintain here, unlike the source sheet. For a headcount-
 * "ramp" role (Roster's not-yet-hired rows — Junior Creative Hire, Head of Ops, etc.),
 * that same per-person bonus figure is automatically multiplied by however many people
 * are planned for that role that month — no separate UI here, bonusMonthlyFlow already
 * does the multiply (Kayee, 2026-08-05: "bonus should be a calculation based on
 * [headcount ramp]").
 */
export function BonusCard({ bonuses, roster, assumptions, months, todayIso, onChange }) {
  const rosterById = Object.fromEntries(roster.map((e) => [e.id, e]));
  const availableToAdd = roster.filter((e) => !bonuses.some((b) => b.employeeId === e.id));

  function updateBonus(id, patch) {
    onChange(bonuses.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }

  function updateMonthly(id, iso, value) {
    onChange(
      bonuses.map((b) => (b.id === id ? { ...b, monthlyOverrides: { ...b.monthlyOverrides, [iso]: value } } : b))
    );
  }

  function fillRange(id, targetMonths, value) {
    onChange(
      bonuses.map((b) => {
        if (b.id !== id) return b;
        const patch = {};
        for (const m of targetMonths) patch[m] = value;
        return { ...b, monthlyOverrides: { ...b.monthlyOverrides, ...patch } };
      })
    );
  }

  function removeBonus(id, name) {
    if (typeof window !== 'undefined' && !window.confirm(`Remove ${name || 'this person'} from the bonus table?`)) return;
    onChange(bonuses.filter((b) => b.id !== id));
  }

  function addBonus(employeeId) {
    if (!employeeId) return;
    onChange([...bonuses, { id: generateId('bonus'), employeeId, bonusAmount: 0, monthlyOverrides: {} }]);
  }

  const rows = bonuses.map((bonus) => {
    const employee = rosterById[bonus.employeeId];
    const monthCells = {};
    for (const iso of months) {
      const val = bonusMonthlyFlow(bonus, employee, iso, assumptions);
      monthCells[iso] = <MonthInput value={val} onCommit={(n) => updateMonthly(bonus.id, iso, n)} />;
    }
    return {
      id: bonus.id,
      monthCells,
      cells: {
        actions: (
          <div className="pr-row-actions">
            <FillRangeButton months={months} onApply={(targetMonths, value) => fillRange(bonus.id, targetMonths, value)} />
            <button type="button" className="icon-btn" title="Remove" onClick={() => removeBonus(bonus.id, employee?.name)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0l-1 14a2 2 0 01-2 2H7a2 2 0 01-2-2L4 6" />
              </svg>
            </button>
          </div>
        ),
        name: employee ? (
          <span className="pr-name-cell">
            {employee.name}
            {employee.isRamp && <span className="pr-ramp-badge">Ramp</span>}
          </span>
        ) : (
          <span className="pr-missing">Removed from roster</span>
        ),
        base: formatPayrollAmount(employee?.baseSalary) || '$0',
        bonus: <MonthInput value={bonus.bonusAmount} onCommit={(n) => updateBonus(bonus.id, { bonusAmount: n })} />,
        ote: <b>{formatPayrollAmount(oteFor(bonus, employee)) || '$0'}</b>,
      },
    };
  });

  const totalRow = {
    cells: { name: <b>TOTAL</b> },
    monthCells: Object.fromEntries(
      months.map((iso) => {
        const sum = bonuses.reduce((acc, b) => acc + bonusMonthlyFlow(b, rosterById[b.employeeId], iso, assumptions), 0);
        return [iso, <b key={iso}>{formatPayrollAmount(sum) || '$0'}</b>];
      })
    ),
  };

  return (
    <PayrollTable
      title="Bonus"
      subtitle={`${bonuses.length} people · Bonus Attainment ${assumptions.bonusAttainment}%`}
      tintForecast={false}
      frozenColumns={FROZEN_COLUMNS}
      months={months}
      todayIso={todayIso}
      totalRow={totalRow}
      rowGroups={[{ key: 'all', label: null, rows }]}
      headActions={
        availableToAdd.length > 0 && (
          <select
            className="pr-input pr-select pr-add-bonus"
            value=""
            onChange={(e) => addBonus(e.target.value)}
          >
            <option value="">+ Add bonus for…</option>
            {availableToAdd.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name || '(unnamed)'}
              </option>
            ))}
          </select>
        )
      }
    />
  );
}
