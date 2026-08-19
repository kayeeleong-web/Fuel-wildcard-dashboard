'use client';

import { useLayoutEffect, useState } from 'react';
import { ReportsPanel } from './ReportsPanel';
import { PayrollPanel } from './PayrollPanel';
import { CustomerPanel } from './CustomerPanel';

const SUB_TABS = [
  { id: 'pl', label: 'P&L Projection' },
  { id: 'cf', label: 'Cash Flow Projection' },
  { id: 'payroll', label: 'Payroll' },
  { id: 'customer', label: 'Customer' },
];
const SUB_TAB_IDS = SUB_TABS.map((t) => t.id);
const ACTIVE_SUBTAB_STORAGE_KEY = 'fuel_wildcard_projection_subtab';

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
 * The active sub-tab is remembered in localStorage (2026-08-18, Kayee: "it should
 * refresh there show me back to customer. not jumping around") — same pattern as
 * DashboardApp's ACTIVE_TAB_STORAGE_KEY: render starts on 'pl' (so server/first-client
 * render match and React doesn't throw a hydration mismatch), then the saved sub-tab
 * is restored right after mount, once the main tab has already restored to 'projection'
 * on the outer level.
 *
 * Uses useLayoutEffect, not useEffect (2026-08-18, Kayee, again: "I refresh... it will
 * jump to KPI report first and then jump back... it's just annoying" — same flash, one
 * level down: a plain useEffect here fired after the browser already painted 'P&L
 * Projection', so refreshing on Customer visibly flashed P&L Projection first even
 * once the outer DashboardApp tab was fixed. useLayoutEffect corrects it before paint,
 * so nothing wrong is ever shown on screen.
 */
export function ProjectionPanel({ statements, customReports, glCash, glAccrued }) {
  const [projectionSubTab, setProjectionSubTab] = useState('pl');

  useLayoutEffect(() => {
    const saved = window.localStorage.getItem(ACTIVE_SUBTAB_STORAGE_KEY);
    if (saved && SUB_TAB_IDS.includes(saved)) setProjectionSubTab(saved);
  }, []);

  function changeSubTab(tab) {
    setProjectionSubTab(tab);
    window.localStorage.setItem(ACTIVE_SUBTAB_STORAGE_KEY, tab);
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

      {projectionSubTab === 'payroll' && (
        <PayrollPanel />
      )}

      {projectionSubTab === 'customer' && (
        <CustomerPanel glCash={glCash} glAccrued={glAccrued} />
      )}
    </>
  );
}
