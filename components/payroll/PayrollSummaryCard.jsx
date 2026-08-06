'use client';

import { bonusMonthlyFlow, formatPayrollAmount, monthlyCostFor } from '../../lib/payroll/payrollData';
import { PayrollTable } from './PayrollTable';

const FROZEN_COLUMNS = [{ key: 'line', label: 'Line item', width: 220 }];

/**
 * Always-visible summary card at the top of the Payroll tab — same idea as the
 * "Salary, Bonus & Commission" rollup Kayee showed from another project (screenshot,
 * 2026-08-05): a Total row plus its component rollups, sitting above the detail cards
 * so the headline numbers don't require opening/scrolling into a section first.
 *
 * Four line items (Kayee, 2026-08-06): Existing Base / Existing Bonus / Planned Base /
 * Planned Bonus — Bonus is now broken out per side instead of one combined line, so
 * "what does a hiring plan cost including bonus" and "what do current people cost
 * including bonus" are each readable at a glance. Each row (except Total) carries a
 * small colored dot and is clickable — the color and the click both point at the exact
 * outer box below that contains that number (Existing/blue, Planned/purple), so this
 * card doubles as a table of contents for the sections underneath.
 *
 * tintForecast={false}: every month here is a live calculation off editable Payroll
 * inputs, never a pulled "actual" figure from a GL — so the app's ACT/FCST blue tint
 * doesn't apply here (Kayee, 2026-08-05: "everything in here is only projection and
 * calculations").
 */
export function PayrollSummaryCard({ roster, bonuses, assumptions, months, todayIso, onJumpToSection }) {
  const existing = roster.filter((r) => !r.isRamp);
  const planned = roster.filter((r) => r.isRamp);

  function existingBaseMonthly(iso) {
    return existing.reduce((sum, employee) => sum + monthlyCostFor(employee, iso, assumptions), 0);
  }
  function plannedBaseMonthly(iso) {
    return planned.reduce((sum, role) => sum + monthlyCostFor(role, iso, assumptions), 0);
  }
  function existingBonusMonthly(iso) {
    return bonuses.reduce((sum, bonus) => {
      const employee = roster.find((e) => e.id === bonus.employeeId);
      if (employee && employee.isRamp) return sum;
      return sum + bonusMonthlyFlow(bonus, employee, iso, assumptions);
    }, 0);
  }
  function plannedBonusMonthly(iso) {
    return bonuses.reduce((sum, bonus) => {
      const employee = roster.find((e) => e.id === bonus.employeeId);
      if (!employee || !employee.isRamp) return sum;
      return sum + bonusMonthlyFlow(bonus, employee, iso, assumptions);
    }, 0);
  }

  const totalRow = {
    cells: { line: <b>Total</b> },
    monthCells: Object.fromEntries(
      months.map((iso) => [
        iso,
        <b key={iso}>
          {formatPayrollAmount(
            existingBaseMonthly(iso) + plannedBaseMonthly(iso) + existingBonusMonthly(iso) + plannedBonusMonthly(iso)
          ) || '$0'}
        </b>,
      ])
    ),
  };

  function lineLabel(text, colorVar, sectionKey) {
    if (!onJumpToSection) {
      return (
        <span className="pr-summary-row-btn" style={{ cursor: 'default' }}>
          <span className="pr-summary-dot" style={{ background: `var(${colorVar})` }} />
          {text}
        </span>
      );
    }
    return (
      <button type="button" className="pr-summary-row-btn" onClick={() => onJumpToSection(sectionKey)}>
        <span className="pr-summary-dot" style={{ background: `var(${colorVar})` }} />
        {text}
      </button>
    );
  }

  const rows = [
    {
      id: 'existing-base',
      cells: { line: lineLabel('Existing — Base Salaries', '--blue', 'existing') },
      monthCells: Object.fromEntries(months.map((iso) => [iso, formatPayrollAmount(existingBaseMonthly(iso)) || '$0'])),
    },
    {
      id: 'existing-bonus',
      cells: { line: lineLabel('Existing — Bonus', '--blue', 'existing') },
      monthCells: Object.fromEntries(months.map((iso) => [iso, formatPayrollAmount(existingBonusMonthly(iso)) || '$0'])),
    },
    {
      id: 'planned-base',
      cells: { line: lineLabel('Planned — Base (Hiring Plan)', '--purple', 'planned') },
      monthCells: Object.fromEntries(months.map((iso) => [iso, formatPayrollAmount(plannedBaseMonthly(iso)) || '$0'])),
    },
    {
      id: 'planned-bonus',
      cells: { line: lineLabel('Planned — Bonus', '--purple', 'planned') },
      monthCells: Object.fromEntries(months.map((iso) => [iso, formatPayrollAmount(plannedBonusMonthly(iso)) || '$0'])),
    },
  ];

  return (
    <PayrollTable
      title="Payroll Summary"
      subtitle="Total comp rollup — click a line to jump to that section"
      tintForecast={false}
      frozenColumns={FROZEN_COLUMNS}
      months={months}
      todayIso={todayIso}
      totalRow={totalRow}
      rowGroups={[{ key: 'summary', label: null, rows }]}
    />
  );
}
