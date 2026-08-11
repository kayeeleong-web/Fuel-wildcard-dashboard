'use client';

import { PayrollTable } from './PayrollTable';
import { headcountCostByCostType, formatPayrollAmount } from '../../lib/payroll/payrollData';

const FROZEN_COLUMNS = [{ key: 'metric', label: '', width: 220 }];

/**
 * Total Comp by CoGS/OpEx (2026-08-10, Kayee: "add a new section for total comp by
 * cogs/opex so that I can match them") — two read-only summary rows, using the exact
 * same headcountCostByCostType formula that now also feeds the new Payroll lines on
 * the P&L (see withPayrollHeadcountRows in ReportsPanel.jsx: the CoGS row here should
 * always equal the P&L's "Headcount (Payroll)" line under COGS, and the OpEx row here
 * should always equal the sum of the P&L's Salaries + Payroll Taxes + Benefits lines
 * under OpEx). Purely derived from Roster/Bonus, same as Total Comp by Employee above
 * it — no new data entry here, just a different rollup of the same numbers.
 */
export function TotalCompByCategoryCard({ roster, bonuses, assumptions, months, todayIso }) {
  const rows = ['CoGS', 'OpEx'].map((costType) => ({
    id: costType,
    cells: { metric: <b>{costType}</b> },
    monthCells: Object.fromEntries(
      months.map((iso) => [
        iso,
        <b key={iso}>{formatPayrollAmount(headcountCostByCostType(roster, bonuses, assumptions, costType, iso)) || ''}</b>,
      ])
    ),
  }));

  return (
    <PayrollTable
      title="Total Comp by CoGS/OpEx"
      subtitle="Same totals feeding the new Payroll lines on the P&L — read-only"
      tintForecast={false}
      frozenColumns={FROZEN_COLUMNS}
      months={months}
      todayIso={todayIso}
      rowGroups={[{ key: 'category', label: null, rows }]}
    />
  );
}
