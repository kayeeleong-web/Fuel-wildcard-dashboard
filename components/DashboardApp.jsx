'use client';

import { useEffect, useState } from 'react';
import { Topbar } from './shell/Topbar';
import { TabNav } from './shell/TabNav';
import { Footer } from './shell/Footer';
import { KPIReportPanel } from './panels/KPIReportPanel';
import { DashboardPanel } from './panels/DashboardPanel';
import { ReportsPanel } from './panels/ReportsPanel';
import { ProjectionPanel } from './panels/ProjectionPanel';
import { PanelErrorBoundary } from './shell/PanelErrorBoundary';

// 2026-08-17: Removed 'custom', 'payroll', 'assumptions' from main bar (Kayee:
// "remove the custom tab", and now: "you can now remove these two since you've already
// move to the projection tab"). Payroll and Assumptions moved as sub-tabs under Projection.
const TABS = ['kpi', 'dashboard', 'reports', 'projection'];
const ACTIVE_TAB_STORAGE_KEY = 'fuel_wildcard_active_tab';

/**
 * The whole client-facing product, post-Clerk-auth. This IS the "Portal" — there is
 * no separate portal app/repo (see architecture note in CLAUDE.md): the default
 * landing tab is KPI Report, and Dashboard/Reports/Projection/Payroll/Assumptions are
 * sibling tabs in the same shell, not separate pages or deployments.
 *
 * All data for the GL-backed tabs (KPI/Dashboard/Reports) is fetched ONCE, server-side,
 * in app/page.js and passed in here as props — switching tabs only toggles which panel
 * is visible (functionality-spec.md §2: "no page reload, no data refetch"). Every panel
 * stays mounted; the CSS `.panel-view` / `.panel-view.active` classes control visibility,
 * matching the reference build's behavior exactly.
 *
 * Reports (2026-08-17, Kayee: "in report it will only show actual"): shows actual GL
 * data only, no forecast columns, no Assumptions sidebar — just the real months from
 * the Google Sheet. Projection: full Assumptions-driven forecast for P&L/CF/Payroll
 * (sub-tabs) with all controls. Custom reports removed from the main bar (Kayee).
 *
 * Payroll is the one exception to the GL-data rule: it's a browser-saved forecast tool,
 * not GL data, so it loads its own state client-side (lib/payroll/usePayrollState.js)
 * rather than receiving props here. Appears as both a standalone tab and in Projection.
 *
 * activeTab is remembered in localStorage (ACTIVE_TAB_STORAGE_KEY) so a hard refresh
 * reopens on whichever tab the user was last viewing instead of resetting to KPI
 * Report. The initial render still has to start on 'kpi' (server and first client
 * render must match, or React throws a hydration mismatch) — the saved tab is applied
 * in a useEffect right after mount, which is the standard way to read a browser-only
 * API without breaking SSR.
 */
export function DashboardApp({ clientName, kpiData, dashboardSummary, statements, customReportsList, glCash, glAccrued }) {
  const [activeTab, setActiveTab] = useState('kpi');

  useEffect(() => {
    const saved = window.localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
    if (saved && TABS.includes(saved)) setActiveTab(saved);
  }, []);

  function changeTab(tab) {
    setActiveTab(tab);
    window.localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, tab);
  }

  return (
    <>
      <Topbar clientName={clientName} onLogoClick={() => changeTab('kpi')} />
      <TabNav activeTab={activeTab} onChange={changeTab} reportsCount={customReportsList.length + 3} />

      <div className="page">
        {/* Every panel below stays mounted regardless of activeTab (see file header) —
            each one is wrapped in its own PanelErrorBoundary so a crash rendering ONE
            tab (e.g. from stale/incompatible saved localStorage data on Payroll or
            Assumptions) can never take down every other tab too (2026-08-06). */}
        <section className={`panel-view${activeTab === 'kpi' ? ' active' : ''}`}>
          <PanelErrorBoundary name="KPI Report">
            <KPIReportPanel kpiData={kpiData} />
          </PanelErrorBoundary>
        </section>

        <section className={`panel-view${activeTab === 'dashboard' ? ' active' : ''}`}>
          <PanelErrorBoundary name="Dashboard">
            <DashboardPanel summary={dashboardSummary} plStatement={statements.PL} kpiData={kpiData} />
          </PanelErrorBoundary>
        </section>

        <section className={`panel-view${activeTab === 'reports' ? ' active' : ''}`}>
          <PanelErrorBoundary name="Reports">
            <ReportsPanel statements={statements} customReports={customReportsList} mode="actual" />
          </PanelErrorBoundary>
        </section>

        <section className={`panel-view${activeTab === 'projection' ? ' active' : ''}`}>
          <PanelErrorBoundary name="Projection">
            <ProjectionPanel statements={statements} customReports={customReportsList} glCash={glCash} glAccrued={glAccrued} />
          </PanelErrorBoundary>
        </section>
      </div>

      <Footer />
    </>
  );
}
