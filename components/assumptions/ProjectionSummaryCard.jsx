'use client';

import { usePayrollState } from '../../lib/payroll/usePayrollState';
import { isActiveInMonth, monthlyCostFor, bonusMonthlyFlow, formatMonthLabel } from '../../lib/payroll/payrollData';
import { formatPayrollAmount } from '../../lib/payroll/payrollData';
import {
  FIRST_PROJECTED_MONTH,
  netCollectedRevenueForMonth,
  costPerCampaignForMonth,
  costItemsTotalForMonth,
} from '../../lib/assumptions/assumptionsData';

function monthsForward(startIso, count) {
  const [y, m] = startIso.split('-').map(Number);
  const out = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(y, m - 1 + i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

/** Headcount cost (base + bonus, loaded) for one costType ('CoGS' | 'OpEx'), one
 *  month — read from the Payroll tab's own saved roster/bonuses so this never
 *  duplicates headcount data entry. */
function headcountCostForMonth(payrollState, costType, iso) {
  if (!payrollState) return 0;
  const { roster, bonuses, assumptions } = payrollState;
  let total = 0;
  for (const emp of roster) {
    if (emp.costType !== costType) continue;
    total += monthlyCostFor(emp, iso, assumptions);
  }
  for (const bonus of bonuses) {
    const emp = roster.find((r) => r.id === bonus.employeeId);
    if (!emp || emp.costType !== costType) continue;
    total += bonusMonthlyFlow(bonus, emp, iso, assumptions);
  }
  return total;
}

/**
 * Read-only 6-month projection preview — the payoff of the Revenue Assumptions +
 * Non-Headcount Costs cards actually adding up to something. Pulls headcount cost
 * straight from Payroll's saved roster (split by each employee's own CoGS/OpEx
 * costType) rather than asking for it twice.
 *
 * This card does NOT write into the Reports/Dashboard/KPI tabs yet — per Kayee
 * (2026-08-04): "just create the structure first we will decide on the math later."
 * Wiring these projected months into the GL-backed statements is the next step once
 * the COGS "Misc"/"Vetric" reconciliation is settled (see assumptionsData.js header).
 */
export function ProjectionSummaryCard({ revenue, costItems }) {
  const { state: payrollState, hydrated } = usePayrollState();
  const months = monthsForward(FIRST_PROJECTED_MONTH, 6);

  return (
    <div className="payroll-card">
      <div className="payroll-card-head">
        <span className="payroll-card-title-btn" style={{ cursor: 'default' }}>
          Projection Preview
        </span>
        <span className="payroll-card-sub">
          Read-only — {FIRST_PROJECTED_MONTH} onward, not yet feeding Reports/Dashboard/KPI
        </span>
      </div>

      {!hydrated ? (
        <div className="cap">Loading Payroll headcount data…</div>
      ) : (
        <div className="payroll-table-wrap">
          <table className="payroll-table assump-projection-table">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Line</th>
                {months.map((m) => (
                  <th key={m}>{formatMonthLabel(m)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                {
                  label: 'Net Collected Revenue',
                  isTotal: true,
                  fn: (iso) => netCollectedRevenueForMonth(revenue, iso),
                },
                {
                  label: 'COGS — Cost Per Campaign',
                  fn: (iso) => costPerCampaignForMonth(revenue, iso),
                },
                {
                  label: 'COGS — Headcount',
                  fn: (iso) => headcountCostForMonth(payrollState, 'CoGS', iso),
                },
                {
                  label: 'COGS — Non-Headcount',
                  fn: (iso) => costItemsTotalForMonth(costItems, 'CoGS', iso),
                },
                {
                  label: 'Gross Margin',
                  isTotal: true,
                  fn: (iso) =>
                    netCollectedRevenueForMonth(revenue, iso) -
                    costPerCampaignForMonth(revenue, iso) -
                    headcountCostForMonth(payrollState, 'CoGS', iso) -
                    costItemsTotalForMonth(costItems, 'CoGS', iso),
                },
                {
                  label: 'OPEX — Headcount',
                  fn: (iso) => headcountCostForMonth(payrollState, 'OpEx', iso),
                },
                {
                  label: 'OPEX — Non-Headcount',
                  fn: (iso) => costItemsTotalForMonth(costItems, 'OpEx', iso),
                },
                {
                  label: 'Operating Margin',
                  isTotal: true,
                  fn: (iso) =>
                    netCollectedRevenueForMonth(revenue, iso) -
                    costPerCampaignForMonth(revenue, iso) -
                    headcountCostForMonth(payrollState, 'CoGS', iso) -
                    costItemsTotalForMonth(costItems, 'CoGS', iso) -
                    headcountCostForMonth(payrollState, 'OpEx', iso) -
                    costItemsTotalForMonth(costItems, 'OpEx', iso),
                },
                {
                  label: 'Other (Non-Operating)',
                  fn: (iso) => costItemsTotalForMonth(costItems, 'Other', iso),
                },
                {
                  label: 'Net Income',
                  isTotal: true,
                  fn: (iso) =>
                    netCollectedRevenueForMonth(revenue, iso) -
                    costPerCampaignForMonth(revenue, iso) -
                    headcountCostForMonth(payrollState, 'CoGS', iso) -
                    costItemsTotalForMonth(costItems, 'CoGS', iso) -
                    headcountCostForMonth(payrollState, 'OpEx', iso) -
                    costItemsTotalForMonth(costItems, 'OpEx', iso) -
                    costItemsTotalForMonth(costItems, 'Other', iso),
                },
              ].map((row) => (
                <tr key={row.label} className={row.isTotal ? 'total' : undefined}>
                  <td style={{ textAlign: 'left' }}>{row.label}</td>
                  {months.map((iso) => (
                    <td key={iso}>{formatPayrollAmount(row.fn(iso)) || '$0'}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
