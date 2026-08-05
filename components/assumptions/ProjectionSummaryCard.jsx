'use client';

import { usePayrollState } from '../../lib/payroll/usePayrollState';
import { isActiveInMonth, monthlyCostFor, bonusMonthlyFlow, formatMonthLabel } from '../../lib/payroll/payrollData';
import { formatPayrollAmount } from '../../lib/payroll/payrollData';
import {
  FIRST_PROJECTED_MONTH,
  netCollectedRevenueForMonth,
  costPerCampaignForMonth,
  costItemAmountForMonth,
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
 * Row labels are NOT renamed/bucketed — each Non-Headcount Cost item shows under its
 * own real name (Vetric, Software, Misc, Rent, etc., exactly as typed into the Cost
 * Items table), same as Kayee's actual sheet. Per Kayee (2026-08-05):
 *   - COGS = Cost Per Campaign (formula) + every Cost Item tagged Category=CoGS, by
 *     name (Vetric, Software, Misc, ...) + Headcount (Payroll roster, costType=CoGS).
 *   - OPEX = every Cost Item tagged Category=OpEx, by name + Headcount (Payroll
 *     roster, costType=OpEx).
 *   - Other (Non-Operating) = every Cost Item tagged Category=Other, by name.
 * Kayee flagged that actual GL months won't break COGS out with a distinct
 * Headcount-CoGS line the way this projection does — this breakdown is
 * projection-only and expected to diverge in structure from actual months.
 *
 * This card does NOT write into the Reports/Dashboard/KPI tabs yet — per Kayee
 * (2026-08-04): "just create the structure first we will decide on the math later."
 */
export function ProjectionSummaryCard({ revenue, costItems }) {
  const { state: payrollState, hydrated } = usePayrollState();
  const months = monthsForward(FIRST_PROJECTED_MONTH, 6);

  const cogsItems = costItems.filter((i) => i.category === 'CoGS');
  const opexItems = costItems.filter((i) => i.category === 'OpEx');
  const otherItems = costItems.filter((i) => i.category === 'Other');

  function cogsTotal(iso) {
    return (
      costPerCampaignForMonth(revenue, iso) +
      cogsItems.reduce((sum, i) => sum + costItemAmountForMonth(i, iso), 0) +
      headcountCostForMonth(payrollState, 'CoGS', iso)
    );
  }
  function opexTotal(iso) {
    return opexItems.reduce((sum, i) => sum + costItemAmountForMonth(i, iso), 0) + headcountCostForMonth(payrollState, 'OpEx', iso);
  }
  function otherTotal(iso) {
    return otherItems.reduce((sum, i) => sum + costItemAmountForMonth(i, iso), 0);
  }

  const rows = [
    { label: 'Net Collected Revenue', isTotal: true, fn: (iso) => netCollectedRevenueForMonth(revenue, iso) },
    { label: 'Cost Per Campaign', fn: (iso) => costPerCampaignForMonth(revenue, iso) },
    ...cogsItems.map((item) => ({ label: item.name || 'Untitled', fn: (iso) => costItemAmountForMonth(item, iso) })),
    { label: 'Headcount', fn: (iso) => headcountCostForMonth(payrollState, 'CoGS', iso) },
    { label: 'Total COGS', isTotal: true, fn: (iso) => cogsTotal(iso) },
    { label: 'Gross Margin', isTotal: true, fn: (iso) => netCollectedRevenueForMonth(revenue, iso) - cogsTotal(iso) },
    ...opexItems.map((item) => ({ label: item.name || 'Untitled', fn: (iso) => costItemAmountForMonth(item, iso) })),
    { label: 'Headcount', fn: (iso) => headcountCostForMonth(payrollState, 'OpEx', iso) },
    { label: 'Total OPEX', isTotal: true, fn: (iso) => opexTotal(iso) },
    {
      label: 'Operating Margin',
      isTotal: true,
      fn: (iso) => netCollectedRevenueForMonth(revenue, iso) - cogsTotal(iso) - opexTotal(iso),
    },
    ...otherItems.map((item) => ({ label: item.name || 'Untitled', fn: (iso) => costItemAmountForMonth(item, iso) })),
    { label: 'Total Other (Non-Operating)', isTotal: true, fn: (iso) => otherTotal(iso) },
    {
      label: 'Net Income',
      isTotal: true,
      fn: (iso) => netCollectedRevenueForMonth(revenue, iso) - cogsTotal(iso) - opexTotal(iso) - otherTotal(iso),
    },
  ];

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
              {rows.map((row, idx) => (
                <tr key={`${row.label}-${idx}`} className={row.isTotal ? 'total' : undefined}>
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
