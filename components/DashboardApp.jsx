'use client';

import { useState } from 'react';
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
 * activeTab is remembered via a cookie now (2026-08-20 rewrite, Kayee: "when I do a
 * hard refresh in a specific tab it will always go back to KPI and then go back again
 * to my current tab" — still a visible flash even with the useLayoutEffect fix below).
 * That earlier fix used localStorage, which only the BROWSER can read — so the
 * server-rendered HTML on every hard refresh always had to start on 'kpi' (the only
 * state the server could possibly know), and only after hydration could client JS
 * correct it. However early that correction ran, the wrong tab had already been
 * painted once — that gap IS the flash. Reading the last-active tab from a cookie in
 * app/page.js (a Server Component) instead means the server already renders the
 * CORRECT tab on the very first response — `initialActiveTab` below comes from that
 * cookie, so there's no wrong tab left to flash away from. localStorage is gone
 * entirely; changeTab now just sets the cookie the server reads next time.
 */
export function DashboardApp({ clientName, initialActiveTab, kpiData, dashboardSummary, statements, customReportsList, glCash, glAccrued }) {
  const [activeTab, setActiveTab] = useState(TABS.includes(initialActiveTab) ? initialActiveTab : 'kpi');

  function changeTab(tab) {
    setActiveTab(tab);
    // 1-year expiry, path=/ so app/page.js can read it on any hard refresh.
    document.cookie = `${ACTIVE_TAB_STORAGE_KEY}=${tab}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <div className="app-shell">
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
    </div>
  );
}
