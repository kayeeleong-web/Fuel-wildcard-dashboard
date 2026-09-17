'use client';

import {
  employeeBonusMonthly,
  formatPayrollAmount,
  headcountBenefitsByCostType,
  headcountBonusByCostType,
  headcountCostByCostType,
  headcountPayrollTaxesByCostType,
  headcountSalariesByCostType,
  monthlyCostFor,
} from '../../lib/payroll/payrollData';
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
  // Bonus plans are per role group with memberIds (2026-09-15) — sum each plan across
  // its members, bucketed by whether the member is a real person or a Hiring Plan ramp.
  function existingBonusMonthly(iso) {
    return existing.reduce((sum, employee) => sum + employeeBonusMonthly(bonuses, employee, iso, assumptions, undefined, roster), 0);
  }
  function plannedBonusMonthly(iso) {
    return planned.reduce((sum, role) => sum + employeeBonusMonthly(bonuses, role, iso, assumptions, undefined, roster), 0);
  }

  const totalRow = {
    cells: { line: <b>Total</b> },
    monthCells: Object.fromEntries(
      months.map((iso) => [
        iso,
        <b key={iso}>
          {formatPayrollAmount(
            existingBaseMonthly(iso) + plannedBaseMonthly(iso) + existingBonusMonthly(iso) + plannedBonusMonthly(iso)
          )}
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

  // Three SEPARATE breakdowns of the same Total, each under its own band so none reads
  // as adding up with the others (2026-09-16, Kayee: "it looks like you're totaling
  // everything... the green dot is one total, the blue and purple is another total —
  // misleading"). Each group sums to the Total row on its own:
  //   By P&L line   — Salaries / Payroll Taxes / Benefits / Bonuses (what the P&L books)
  //   By cost type  — CoGS / OpEx (the two Payroll headcount lines on the P&L)
  //   By section    — Existing base+bonus / Planned base+bonus (the boxes below)
  const both = (fn, iso) => fn(roster, bonuses, assumptions, 'CoGS', iso) + fn(roster, bonuses, assumptions, 'OpEx', iso);
  const cells = (valueFor) => Object.fromEntries(months.map((iso) => [iso, formatPayrollAmount(valueFor(iso))]));
  const band = (text) => <span className="pr-group-band"><span className="pr-group-band-name">{text}</span></span>;

  const rowGroups = [
    {
      key: 'pl',
      // By P&L line and By cost type start collapsed; only By section is open by default
      // (2026-09-17, Kayee: "so it's not eating up a lot of space"). Click the band to open.
      label: band('By P&L line'),
      collapsible: true,
      defaultCollapsed: true,
      rows: [
        { id: 'salaries', cells: { line: lineLabel('Salaries', '--muted-2', 'existing') }, monthCells: cells((iso) => both(headcountSalariesByCostType, iso)) },
        { id: 'taxes', cells: { line: lineLabel('Payroll Taxes', '--muted-2', 'existing') }, monthCells: cells((iso) => both(headcountPayrollTaxesByCostType, iso)) },
        { id: 'benefits', cells: { line: lineLabel('Benefits', '--muted-2', 'existing') }, monthCells: cells((iso) => both(headcountBenefitsByCostType, iso)) },
        { id: 'bonuses', cells: { line: lineLabel('Bonuses', '--muted-2', 'existing') }, monthCells: cells((iso) => both(headcountBonusByCostType, iso)) },
      ],
    },
    {
      key: 'type',
      label: band('By cost type'),
      collapsible: true,
      defaultCollapsed: true,
      rows: [
        { id: 'cogs', cells: { line: lineLabel('CoGS — Total Comp', '--green', 'totalComp') }, monthCells: cells((iso) => headcountCostByCostType(roster, bonuses, assumptions, 'CoGS', iso)) },
        { id: 'opex', cells: { line: lineLabel('OpEx — Total Comp', '--green', 'totalComp') }, monthCells: cells((iso) => headcountCostByCostType(roster, bonuses, assumptions, 'OpEx', iso)) },
      ],
    },
    {
      key: 'section',
      label: band('By section'),
      collapsible: true,
      rows: [
        { id: 'existing-base', cells: { line: lineLabel('Existing — Base Salaries', '--blue', 'existing') }, monthCells: cells(existingBaseMonthly) },
        { id: 'existing-bonus', cells: { line: lineLabel('Existing — Bonus', '--blue', 'existing') }, monthCells: cells(existingBonusMonthly) },
        { id: 'planned-base', cells: { line: lineLabel('Planned — Base (Hiring Plan)', '--purple', 'planned') }, monthCells: cells(plannedBaseMonthly) },
        { id: 'planned-bonus', cells: { line: lineLabel('Planned — Bonus', '--purple', 'planned') }, monthCells: cells(plannedBonusMonthly) },
      ],
    },
  ];

  return (
    <PayrollTable
      title="Payroll Summary"
      subtitle="Total comp — three ways to slice the same Total · click a line to jump to that section"
      tintForecast={false}
      frozenColumns={FROZEN_COLUMNS}
      months={months}
      todayIso={todayIso}
      totalRow={totalRow}
      rowGroups={rowGroups}
    />
  );
}
