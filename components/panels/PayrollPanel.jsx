'use client';

import { useState } from 'react';
import { PageHead } from '../ui/PageHead';
import { PayrollAssumptionsSidebar } from '../payroll/PayrollAssumptionsSidebar';
import { PayrollSummaryCard } from '../payroll/PayrollSummaryCard';
import { RosterCard } from '../payroll/RosterCard';
import { HiringPlanCard } from '../payroll/HiringPlanCard';
import { BonusCard } from '../payroll/BonusCard';
import { TotalCompCard } from '../payroll/TotalCompCard';
import { TotalCompByCategoryCard } from '../payroll/TotalCompByCategoryCard';
import { CollapsibleSection } from '../payroll/CollapsibleSection';
import { usePayrollState } from '../../lib/payroll/usePayrollState';
import { currentIsoMonth, monthsForRange } from '../../lib/payroll/payrollData';

// Section anchor ids — Payroll Summary's clickable rows scroll to these.
const SECTION_IDS = {
  totalComp: 'section-total-comp',
  byCategory: 'section-by-category',
  existing: 'section-existing',
  planned: 'section-planned',
};

/**
 * Payroll tab — 5th sibling panel alongside KPI Report / Dashboard / Reports / Custom
 * (design-rules.md §2: "add tabs to this same control if a client needs a genuinely new
 * page type"). Unlike every other tab, this one is a forecast/what-if calculator: state
 * lives in the browser (localStorage via usePayrollState), not in Wildcard's Google
 * Sheet — Kayee's explicit call, so no service-account/write-access changes were made to
 * the shared data layer for this.
 */
export function PayrollPanel() {
  const { state, setState, hydrated } = usePayrollState();
  const todayIso = currentIsoMonth();

  // Sidebar mirrors the Reports/P&L merged-Assumptions pattern (2026-08-10, Kayee: "in
  // the payroll tab move the payroll assumption to the left just like the p&l with a
  // hamburger") — defaults open, collapses to a slim rail via the same
  // .payroll-sidebar-rail chrome as .reports-sidebar-rail.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // 2026-08-10, Kayee: "give me a hide button also for [older years] so that now I
  // only see 2026 to 2028... that button work in sync for all sections in payroll as
  // well as the summary tab" — same default-forward-window/Historical pair as Reports.
  // One piece of state feeding every card below via the SAME `visibleMonths` array is
  // what keeps them "in sync" — there's only one source of truth for what's shown.
  const [range, setRange] = useState('default');
  const visibleMonths = monthsForRange(range);

  // All three sections start collapsed (Kayee, 2026-08-06: "keep the three sections
  // collapsed when open up this page") — Payroll Summary at the top already shows the
  // headline numbers, and each summary row jumps to + expands its matching section on
  // click, so nothing below needs to be open by default just to land on the page.
  const [collapsedSections, setCollapsedSections] = useState({
    totalComp: true,
    byCategory: true,
    existing: true,
    planned: true,
  });

  function toggleSection(key) {
    setCollapsedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  // Payroll Summary rows call this — expands the matching section (if collapsed) and
  // scrolls it into view, so the colored dot up top always leads somewhere real
  // (Kayee: "clicking it will bring them to that section").
  function jumpToSection(key) {
    setCollapsedSections((prev) => ({ ...prev, [key]: false }));
    requestAnimationFrame(() => {
      document.getElementById(SECTION_IDS[key])?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  if (!hydrated || !state) {
    return (
      <>
        <PageHead title="Payroll" />
        <div className="cap">Loading saved roster…</div>
      </>
    );
  }

  function setRoster(roster) {
    setState({ ...state, roster });
  }

  function setBonuses(bonuses) {
    setState({ ...state, bonuses });
  }

  function setAssumptions(assumptions) {
    setState({ ...state, assumptions });
  }

  return (
    <>
      <PageHead title="Payroll">
        <button type="button" className="btn" onClick={() => window.print()}>
          Export PDF
        </button>
      </PageHead>

      {/* Same 2026-2028/Historical pair as Reports (2026-08-10) — one piece of state
          (`range`) feeding the SAME `visibleMonths` array to every card below is what
          keeps the toggle "in sync" across Summary + all three sections at once. */}
      <div className="toolbar">
        <div className="seg right">
          <button className={range === 'default' ? 'active' : undefined} onClick={() => setRange('default')}>
            2026 – 2028
          </button>
          <button className={range === 'all' ? 'active' : undefined} onClick={() => setRange('all')}>
            Historical
          </button>
        </div>
      </div>

      {/* Wide wrapper (2026-08-05, Kayee: "I can only see one month" scrolling right) —
          these tables' frozen columns eat nearly all of the normal 1320px page width, so
          this section alone breaks out wider (capped, with a gutter on both sides — see
          .page-wide in globals.css). PageHead above stays at the normal page width.
          Picks up .page-wide-reports-open while the Assumptions sidebar is expanded
          (2026-08-10, same reasoning as Reports) so this view can borrow the gutter
          room the normal .page-wide cap reserves elsewhere. */}
      <div className={`page-wide${!sidebarCollapsed ? ' page-wide-reports-open' : ''}`}>
        <div className={`payroll-with-sidebar${sidebarCollapsed ? ' is-collapsed' : ''}`}>
          <PayrollAssumptionsSidebar
            collapsed={sidebarCollapsed}
            onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
            assumptions={state.assumptions}
            onChange={setAssumptions}
          />

          <div className="payroll-main">
            <PayrollSummaryCard
              roster={state.roster}
              bonuses={state.bonuses}
              assumptions={state.assumptions}
              months={visibleMonths}
              todayIso={todayIso}
              onJumpToSection={jumpToSection}
            />

            <div style={{ height: 20 }} />

            <CollapsibleSection
              id={SECTION_IDS.existing}
              title="Existing"
              subtitle="People already on payroll — base salaries + their bonus"
              colorVar="--blue"
              collapsed={collapsedSections.existing}
              onToggle={() => toggleSection('existing')}
            >
              <RosterCard
                roster={state.roster}
                assumptions={state.assumptions}
                months={visibleMonths}
                todayIso={todayIso}
                onChange={setRoster}
              />
              <BonusCard
                bonuses={state.bonuses}
                roster={state.roster}
                assumptions={state.assumptions}
                months={visibleMonths}
                todayIso={todayIso}
                onChange={setBonuses}
                scope="existing"
              />
            </CollapsibleSection>

            <div style={{ height: 20 }} />

            <CollapsibleSection
              id={SECTION_IDS.planned}
              title="Planned"
              subtitle="Not-yet-hired roles — hiring plan + their bonus"
              colorVar="--purple"
              collapsed={collapsedSections.planned}
              onToggle={() => toggleSection('planned')}
              note="Planned numbers ramp up automatically as you fill in the Hiring Plan below — type in the month someone starts, and their base and bonus both flow through from that month on."
            >
              <HiringPlanCard
                roster={state.roster}
                assumptions={state.assumptions}
                months={visibleMonths}
                todayIso={todayIso}
                onChange={setRoster}
              />
              <BonusCard
                bonuses={state.bonuses}
                roster={state.roster}
                assumptions={state.assumptions}
                months={visibleMonths}
                todayIso={todayIso}
                onChange={setBonuses}
                scope="planned"
              />
            </CollapsibleSection>

            <div style={{ height: 20 }} />

            <CollapsibleSection
              id={SECTION_IDS.totalComp}
              title="Total Comp by Employee"
              subtitle="Base + bonus, combined per person · read-only"
              colorVar="--green"
              collapsed={collapsedSections.totalComp}
              onToggle={() => toggleSection('totalComp')}
            >
              <TotalCompCard
                roster={state.roster}
                bonuses={state.bonuses}
                assumptions={state.assumptions}
                months={visibleMonths}
                todayIso={todayIso}
              />
            </CollapsibleSection>

            <div style={{ height: 20 }} />

            <CollapsibleSection
              id={SECTION_IDS.byCategory}
              title="Total Comp by CoGS/OpEx"
              subtitle="Two totals to match against the new Payroll lines on the P&L · read-only"
              colorVar="--green"
              collapsed={collapsedSections.byCategory}
              onToggle={() => toggleSection('byCategory')}
            >
              <TotalCompByCategoryCard
                roster={state.roster}
                bonuses={state.bonuses}
                assumptions={state.assumptions}
                months={visibleMonths}
                todayIso={todayIso}
              />
            </CollapsibleSection>
          </div>
        </div>
      </div>
    </>
  );
}
