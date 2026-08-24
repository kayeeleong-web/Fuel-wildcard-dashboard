'use client';

import { useState } from 'react';
import { ReportsPanel } from './ReportsPanel';
import { PayrollPanel } from './PayrollPanel';
import { CustomerPanel } from './CustomerPanel';

const SUB_TABS = [
  { id: 'pl', label: 'P&L Projection' },
  { id: 'cf', label: 'Cash Flow Projection' },
  { id: 'weeklycf', label: 'Weekly CF' },
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

      {projectionSubTab === 'cf' && (
        <ReportsPanel statements={statements} customReports={customReports} mode="projection" fixedType="CF" />
      )}

      {/* Weekly CF (2026-08-24) — the client's own "Weekly CF" sheet tab, same rows/
          sections as monthly CF but one column per week. This is actual-only: no
          Assumptions sidebar, no forecast pipeline (mode="actual", not "projection") —
          those all assume monthly cadence and would misbehave against week columns.
          statements.WeeklyCF is fetched with type:"CF" (see googleSheets.ts) purely so
          it inherits CF's hero-total / Beginning-Net Change-Ending Cash box styling. */}
      {projectionSubTab === 'weeklycf' && (
        <ReportsPanel statements={statements} customReports={customReports} mode="actual" fixedType="WeeklyCF" />
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
