'use client';

import { bonusMonthlyFlow, formatPayrollAmount, monthlyCostFor } from '../../lib/payroll/payrollData';
import { PayrollTable } from './PayrollTable';

const FROZEN_COLUMNS = [{ key: 'line', label: 'Line item', width: 220 }];

/**
 * Always-visible summary card at the top of the Payroll tab — same idea as the
 * "Salary, Bonus & Commission" rollup Kayee showed from another project (screenshot,
 * 2026-08-05): a Total row plus its component rollups, sitting above the detail cards
 * so the headline numbers don't require opening/scrolling into Roster or Bonus first.
 * Wildcard only has two rollups feeding Total Comp — Base Salaries and Bonus —
 * so this card shows exactly those two, not the six from the reference screenshot
 * (that project tracks Full-Time/Part-Time/Sales Commission separately; Wildcard's
 * roster doesn't split that way).
 *
 * tintForecast={false}: every month here is a live calculation off editable Payroll
 * inputs, never a pulled "actual" figure from a GL — so the app's ACT/FCST blue tint
 * (meant to distinguish real reported months from projected ones, e.g. on Reports)
 * doesn't apply and would be misleading here (Kayee, 2026-08-05: "everything in here
 * is only projection and calculations" — asking why Sep-2026 onward was blue).
 */
export function PayrollSummaryCard({ roster, bonuses, assumptions, months, todayIso }) {
  function rosterMonthly(iso) {
    return roster.reduce((sum, employee) => sum + monthlyCostFor(employee, iso, assumptions), 0);
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
      months.map((iso) => [iso, <b key={iso}>{formatPayrollAmount(rosterMonthly(iso) + bonusMonthly(iso)) || '$0'}</b>])
    ),
  };

  const rows = [
    {
      id: 'roster',
      cells: { line: 'Base Salaries' },
      monthCells: Object.fromEntries(months.map((iso) => [iso, formatPayrollAmount(rosterMonthly(iso)) || '$0'])),
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
      subtitle="Total comp rollup — Base Salaries + Bonus, read-only"
      tintForecast={false}
      frozenColumns={FROZEN_COLUMNS}
      months={months}
      todayIso={todayIso}
      totalRow={totalRow}
      rowGroups={[{ key: 'summary', label: null, rows }]}
    />
  );
}
