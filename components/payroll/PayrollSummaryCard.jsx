'use client';

import { bonusMonthlyFlow, formatPayrollAmount, monthlyCostFor } from '../../lib/payroll/payrollData';
import { PayrollTable } from './PayrollTable';

const FROZEN_COLUMNS = [{ key: 'line', label: 'Line item', width: 220 }];

/**
 * Always-visible summary card at the top of the Payroll tab — same idea as the
 * "Salary, Bonus & Commission" rollup Kayee showed from another project (screenshot,
 * 2026-08-05): a Total row plus its component rollups, sitting above the detail cards
 * so the headline numbers don't require opening/scrolling into Roster or Bonus first.
 *
 * Base Salaries is split into Existing (current Roster) vs Planned Hires (Hiring Plan
 * ramp roles) — separate cards now that those two live apart on the tab (Kayee,
 * 2026-08-05: "leave current employees in their own sections") — so the bottom-line
 * impact of a hiring plan is visible at a glance without opening the Hiring Plan card
 * itself ("I need to know in P&L and cash perspective how would it affect my bottom
 * line").
 *
 * tintForecast={false}: every month here is a live calculation off editable Payroll
 * inputs, never a pulled "actual" figure from a GL — so the app's ACT/FCST blue tint
 * (meant to distinguish real reported months from projected ones, e.g. on Reports)
 * doesn't apply and would be misleading here (Kayee, 2026-08-05: "everything in here
 * is only projection and calculations" — asking why Sep-2026 onward was blue).
 */
export function PayrollSummaryCard({ roster, bonuses, assumptions, months, todayIso }) {
  const existing = roster.filter((r) => !r.isRamp);
  const planned = roster.filter((r) => r.isRamp);

  function existingMonthly(iso) {
    return existing.reduce((sum, employee) => sum + monthlyCostFor(employee, iso, assumptions), 0);
  }
  function plannedMonthly(iso) {
    return planned.reduce((sum, role) => sum + monthlyCostFor(role, iso, assumptions), 0);
  }
  function bonusMonthly(iso) {
    return bonuses.reduce((sum, bonus) => {
      const employee = roster.find((e) => e.id === bonus.employeeId);
      return sum + bonusMonthlyFlow(bonus, employee, iso, assumptions);
    }, 0);
  }

  const totalRow = {
    cells: { line: <b>Total</b> },
    monthCells: Object.fromEntries(
      months.map((iso) => [
        iso,
        <b key={iso}>{formatPayrollAmount(existingMonthly(iso) + plannedMonthly(iso) + bonusMonthly(iso)) || '$0'}</b>,
      ])
    ),
  };

  const rows = [
    {
      id: 'existing',
      cells: { line: 'Existing Base Salaries' },
      monthCells: Object.fromEntries(months.map((iso) => [iso, formatPayrollAmount(existingMonthly(iso)) || '$0'])),
    },
    {
      id: 'planned',
      cells: { line: 'Planned Hires' },
      monthCells: Object.fromEntries(months.map((iso) => [iso, formatPayrollAmount(plannedMonthly(iso)) || '$0'])),
    },
    {
      id: 'bonus',
      cells: { line: 'Bonus' },
      monthCells: Object.fromEntries(months.map((iso) => [iso, formatPayrollAmount(bonusMonthly(iso)) || '$0'])),
    },
  ];

  return (
    <PayrollTable
      title="Payroll Summary"
      subtitle="Total comp rollup — Existing + Planned Hires + Bonus, read-only"
      tintForecast={false}
      frozenColumns={FROZEN_COLUMNS}
      months={months}
      todayIso={todayIso}
      totalRow={totalRow}
      rowGroups={[{ key: 'summary', label: null, rows }]}
    />
  );
}
