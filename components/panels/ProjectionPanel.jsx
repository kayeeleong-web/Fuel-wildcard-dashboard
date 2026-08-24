'use client';

import { useState } from 'react';
import { ReportsPanel } from './ReportsPanel';
import { PayrollPanel } from './PayrollPanel';
import { CustomerPanel } from './CustomerPanel';

const SUB_TABS = [
  { id: 'pl', label: 'P&L' },
  { id: 'cf', label: 'Cash Flow' },
  { id: 'payroll', label: 'Payroll' },
  { id: 'customer', label: 'Customer' },
];
const SUB_TAB_IDS = SUB_TABS.map((t) => t.id);

/**
 * Projection tab — sixth sibling panel (2026-08-17, Kayee: "let's separate projection
 * with reports... in report it will only show actual"). This is a forecast view with
 * four sub-tabs: Payroll, P&L Projection, Cash Flow Projection, Customer. Unlike
 * Reports (which shows only actual data, no sidebar, no forecast columns), Projection
 * runs the full Assumptions-driven forecast pipeline.
 *
 * Sub-tab navigation is LOCAL to this panel (not in the main TabNav) — clicking
 * "Reports" in the main bar hides this entire panel and shows the actual-only Reports
 * view instead.
 *
 * The active sub-tab is NOT remembered across visits (2026-08-20, Kayee: "when I open
 * up projection it always default to customer. please default to P&L projection" —
 * reversing the 2026-08-18 "remember where I left off" behavior for this one sub-nav,
 * which meant reopening Projection kept landing on whatever was last clicked instead
 * of the P&L view). Always opens on 'pl'; switching sub-tabs during a session still
 * works exactly the same, it just isn't persisted anymore.
 */
export function ProjectionPanel({ statements, customReports, glCash, glAccrued }) {
  const [projectionSubTab, setProjectionSubTab] = useState('pl');

  // Cash Flow granularity toggle (2026-08-24, Kayee: "keep one tab for cash flow...
  // give me a toggle to change it between monthly and weekly" — replacing the earlier
  // separate "Weekly Cash Flow" sub-tab). Monthly and Weekly are the SAME ReportsPanel
  // instance staying mounted, just fed a different `fixedType` — its own
  // `useEffect(() => { if (fixedType) setReportType(fixedType) }, [fixedType])` reacts
  // to that prop change, so this is a live re-render, not a remount. That's actually a
  // stronger sync than two separate sub-tabs would give: the Cash Timing Assumptions
  // sidebar (cashTimingState) and its collapsed/open state carry over instantly when
  // you flip the toggle, not just "eventually consistent" the next time you visit.
  const [cfGranularity, setCfGranularity] = useState('monthly');

  function changeSubTab(tab) {
    setProjectionSubTab(tab);
  }

  return (
    <>
      {/* Sub-tab navigation — local to this panel only, separate from the main
          TabNav in the shell. Clicking "Reports" in the main bar entirely hides
          this panel and switches to actual-data-only view. */}
      <div className="toolbar">
        <div className="seg">
          {SUB_TABS.map((tab) => (
            <button
              key={tab.id}
              className={projectionSubTab === tab.id ? 'active' : undefined}
              onClick={() => changeSubTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {/* Cash Flow's Monthly/Weekly toggle (2026-08-24) — same slot/pattern as
            Payroll's Export PDF button below, just for the 'cf' sub-tab instead.
            Weekly shares the exact same Cash Timing Assumptions sidebar/state as
            Monthly (Kayee: "I still want it to sync... if I add a new assumption in
            cash flow monthly it should show up in weekly and vice versa") — flipping
            this toggle only changes which `fixedType` ReportsPanel is fed, not which
            timingByAccount it reads. Weekly's own addition on top of that shared
            config is a per-week manual override (manualByWeek) so a Manual-mode
            account can also be steered to land in one SPECIFIC week, not just spread
            evenly across a month's weeks (the default). See
            lib/cashflow/weeklyCashProjection.js for the full mechanism. */}
        {projectionSubTab === 'cf' && (
          <div className="seg" style={{ marginLeft: 'auto' }}>
            <button
              className={cfGranularity === 'monthly' ? 'active' : undefined}
              onClick={() => setCfGranularity('monthly')}
            >
              Monthly
            </button>
            <button
              className={cfGranularity === 'weekly' ? 'active' : undefined}
              onClick={() => setCfGranularity('weekly')}
            >
              Weekly
            </button>
          </div>
        )}
        {/* Payroll's Export PDF lives up here on the sub-tab row now (2026-08-20,
            Kayee: "waste of space, remove payroll text and move export pdf to the
            very top right... at the same line as the toggle") — the PayrollPanel's
            own PageHead row (title + button) is gone entirely; this was its only
            surviving control. Payroll-sub-tab only: it prints the Payroll view. */}
        {projectionSubTab === 'payroll' && (
          <button type="button" className="btn" style={{ marginLeft: 'auto' }} onClick={() => window.print()}>
            Export PDF
          </button>
        )}
      </div>

      {/* P&L and Cash Flow projections both use ReportsPanel with mode='projection',
          which runs all the Assumptions-driven forecast pipelines, shows the
          Assumptions sidebar (P&L only), and extends months through PROJECTION_HORIZON.
          Payroll and Assumptions are their own panels (different UI entirely). */}

      {projectionSubTab === 'pl' && (
        <ReportsPanel statements={statements} customReports={customReports} mode="projection" fixedType="PL" />
      )}

      {/* Cash Flow — fixedType switches between 'CF' (monthly) and 'WeeklyCF' off the
          toggle above. This ReportsPanel instance stays mounted across that switch
          (same conditional branch, just a different prop), so its own
          `useEffect(() => { if (fixedType) setReportType(fixedType) }, [fixedType])`
          picks up the change live — the Cash Timing Assumptions sidebar and its
          collapsed/open state carry over instantly, not just on next visit. */}
      {projectionSubTab === 'cf' && (
        <ReportsPanel
          statements={statements}
          customReports={customReports}
          mode="projection"
          fixedType={cfGranularity === 'weekly' ? 'WeeklyCF' : 'CF'}
        />
      )}

      {projectionSubTab === 'payroll' && (
        <PayrollPanel />
      )}

      {projectionSubTab === 'customer' && (
        <CustomerPanel glCash={glCash} glAccrued={glAccrued} />
      )}
    </>
  );
}
