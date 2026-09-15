'use client';

import { employeeBonusMonthly, formatPayrollAmount, monthlyCostFor } from '../../lib/payroll/payrollData';
import { PayrollTable } from './PayrollTable';

const FROZEN_COLUMNS = [
  { key: 'name', label: 'Name', width: 220 },
  { key: 'department', label: 'Department', width: 140 },
  { key: 'costType', label: 'CoGS or OpEx?', width: 110 },
];

/**
 * Total Comp — read-only rollup: each person's loaded roster cost plus any bonus flow
 * they're linked to, combined per month. Purely derived from the Roster and Bonus cards
 * above (no new data entry here), same sticky-column table shell. Expanded by default
 * (Kayee, 2026-08-05: "Total Comp is automatically collapsed. keep it expanded") —
 * it's one of only two rollup cards on the tab and shouldn't need an extra click to see.
 */
export function TotalCompCard({ roster, bonuses, assumptions, months, todayIso }) {
  // Bonus plans are per role group (2026-09-15) — employeeBonusMonthly sums every plan
  // this person is a member of.
  const rows = roster.map((employee) => {
    const monthCells = {};
    for (const iso of months) {
      const base = monthlyCostFor(employee, iso, assumptions);
      const bonus = employeeBonusMonthly(bonuses, employee, iso, assumptions, undefined, roster);
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
          const base = monthlyCostFor(employee, iso, assumptions);
          const bonus = employeeBonusMonthly(bonuses, employee, iso, assumptions, undefined, roster);
          return acc + base + bonus;
        }, 0);
        return [iso, <b key={iso}>{formatPayrollAmount(sum)}</b>];
      })
    ),
  };

  return (
    <PayrollTable
      title="Total Comp"
      subtitle="Base cost + bonus, combined — read-only"
      tintForecast={false}
      frozenColumns={FROZEN_COLUMNS}
      months={months}
      todayIso={todayIso}
      totalRow={totalRow}
      rowGroups={[{ key: 'all', label: null, rows }]}
    />
  );
}
