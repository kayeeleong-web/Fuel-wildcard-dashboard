'use client';

import { bonusMonthlyFlow, formatPayrollAmount, monthlyCostFor } from '../../lib/payroll/payrollData';
import { PayrollTable } from './PayrollTable';

const FROZEN_COLUMNS = [
  { key: 'name', label: 'Name', width: 220 },
  { key: 'department', label: 'Department', width: 140 },
  { key: 'costType', label: 'CoGS or OpEx?', width: 110 },
];

/**
 * Total Comp — read-only rollup: each person's loaded roster cost plus any bonus flow
 * they're linked to, combined per month. Purely derived from the Roster and Bonus cards
 * above (no new data entry here), same sticky-column table shell, defaulted collapsed
 * since it repeats the same person list as the roster above it.
 */
export function TotalCompCard({ roster, bonuses, assumptions, months, todayIso }) {
  const bonusesByEmployee = {};
  for (const b of bonuses) {
    if (!bonusesByEmployee[b.employeeId]) bonusesByEmployee[b.employeeId] = [];
    bonusesByEmployee[b.employeeId].push(b);
  }

  const rows = roster.map((employee) => {
    const linkedBonuses = bonusesByEmployee[employee.id] || [];
    const monthCells = {};
    for (const iso of months) {
      const base = monthlyCostFor(employee, iso, assumptions);
      const bonus = linkedBonuses.reduce((acc, b) => acc + bonusMonthlyFlow(b, employee, iso, assumptions), 0);
      monthCells[iso] = formatPayrollAmount(base + bonus);
    }
    return {
      id: employee.id,
      monthCells,
      cells: {
        name: employee.name || <span className="pr-missing">(unnamed)</span>,
        department: employee.department,
        costType: employee.costType,
      },
    };
  });

  const totalRow = {
    cells: { name: <b>TOTAL COMP</b> },
    monthCells: Object.fromEntries(
      months.map((iso) => {
        const sum = roster.reduce((acc, employee) => {
          const linkedBonuses = bonusesByEmployee[employee.id] || [];
          const base = monthlyCostFor(employee, iso, assumptions);
          const bonus = linkedBonuses.reduce((bAcc, b) => bAcc + bonusMonthlyFlow(b, employee, iso, assumptions), 0);
          return acc + base + bonus;
        }, 0);
        return [iso, <b key={iso}>{formatPayrollAmount(sum) || '$0'}</b>];
      })
    ),
  };

  return (
    <PayrollTable
      title="Total Comp"
      subtitle="Base cost + bonus, combined — read-only"
      defaultCollapsed
      frozenColumns={FROZEN_COLUMNS}
      months={months}
      todayIso={todayIso}
      totalRow={totalRow}
      rowGroups={[{ key: 'all', label: null, rows }]}
    />
  );
}
