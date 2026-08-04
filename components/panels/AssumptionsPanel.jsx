'use client';

import { PageHead } from '../ui/PageHead';
import { RevenueAssumptionsCard } from '../assumptions/RevenueAssumptionsCard';
import { CostItemsCard } from '../assumptions/CostItemsCard';
import { ProjectionSummaryCard } from '../assumptions/ProjectionSummaryCard';
import { useAssumptionsState } from '../../lib/assumptions/useAssumptionsState';

/**
 * Assumptions tab — 6th sibling panel alongside KPI Report / Dashboard / Reports /
 * Custom / Payroll. Like Payroll, this is a forecast/what-if calculator: state lives
 * in the browser (localStorage via useAssumptionsState), not in Wildcard's Google
 * Sheet. It only ever describes PROJECTED months (July 2026 onward, per Kayee) —
 * actual months always come from the Google Sheet untouched.
 *
 * Structure-first build (2026-08-04): Revenue formulas are locked in and verified;
 * the Non-Headcount Costs table is fully editable; the Projection Preview is
 * read-only and does not yet feed Reports/Dashboard/KPI — that wiring comes once the
 * COGS "Misc"/"Vetric" reconciliation Kayee flagged is settled.
 */
export function AssumptionsPanel() {
  const { state, setState, hydrated } = useAssumptionsState();

  if (!hydrated || !state) {
    return (
      <>
        <PageHead title="Assumptions" subtitle="Revenue &amp; cost drivers for projected months" />
        <div className="cap">Loading saved assumptions…</div>
      </>
    );
  }

  function setRevenue(revenue) {
    setState({ ...state, revenue });
  }

  function setCostItems(costItems) {
    setState({ ...state, costItems });
  }

  return (
    <>
      <PageHead title="Assumptions" subtitle="Revenue & cost drivers for projected months — saved to this browser" />

      <RevenueAssumptionsCard revenue={state.revenue} onChange={setRevenue} />

      <div style={{ height: 20 }} />

      <CostItemsCard costItems={state.costItems} onChange={setCostItems} />

      <div style={{ height: 20 }} />

      <ProjectionSummaryCard revenue={state.revenue} costItems={state.costItems} />
    </>
  );
}
