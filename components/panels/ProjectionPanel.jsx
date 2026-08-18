'use client';

import { useState } from 'react';
import { PageHead } from '../ui/PageHead';
import { ReportsPanel } from './ReportsPanel';
import { PayrollPanel } from './PayrollPanel';
import { AssumptionsPanel } from './AssumptionsPanel';

/**
 * Projection tab — sixth sibling panel (2026-08-17, Kayee: "let's separate projection
 * with reports... in report it will only show actual"). This is a forecast view with
 * four sub-tabs: Payroll, P&L Projection, Cash Flow Projection, Assumptions. Unlike
 * Reports (which shows only actual data, no sidebar, no forecast columns), Projection
 * runs the full Assumptions-driven forecast pipeline.
 *
 * Sub-tab navigation is LOCAL to this panel (not in the main TabNav) — clicking
 * "Reports" in the main bar hides this entire panel and shows the actual-only Reports
 * view instead.
 */
export function ProjectionPanel({ statements, customReports }) {
  const [projectionSubTab, setProjectionSubTab] = useState('pl');

  const SUB_TABS = [
    { id: 'pl', label: 'P&L Projection' },
    { id: 'cf', label: 'Cash Flow Projection' },
    { id: 'payroll', label: 'Payroll' },
    { id: 'assumptions', label: 'Assumptions' },
  ];

  return (
    <>
      <PageHead title="Projection" subtitle="Full-month forecast with Assumptions sidebar — edit and project forward" />

      {/* Sub-tab navigation — local to this panel only, separate from the main
          TabNav in the shell. Clicking "Reports" in the main bar entirely hides
          this panel and switches to actual-data-only view. */}
      <div className="toolbar">
        <div className="seg">
          {SUB_TABS.map((tab) => (
            <button
              key={tab.id}
              className={projectionSubTab === tab.id ? 'active' : undefined}
              onClick={() => setProjectionSubTab(tab.id)}
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

      {projectionSubTab === 'assumptions' && (
        <AssumptionsPanel />
      )}
    </>
  );
}
