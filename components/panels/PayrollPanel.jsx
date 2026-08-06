'use client';

import { useState } from 'react';
import { PageHead } from '../ui/PageHead';
import { AssumptionsBar } from '../payroll/AssumptionsBar';
import { PayrollSummaryCard } from '../payroll/PayrollSummaryCard';
import { RosterCard } from '../payroll/RosterCard';
import { HiringPlanCard } from '../payroll/HiringPlanCard';
import { BonusCard } from '../payroll/BonusCard';
import { TotalCompCard } from '../payroll/TotalCompCard';
import { CollapsibleSection } from '../payroll/CollapsibleSection';
import { usePayrollState } from '../../lib/payroll/usePayrollState';
import { MONTHS, currentIsoMonth } from '../../lib/payroll/payrollData';

// Section anchor ids — Payroll Summary's clickable rows scroll to these.
const SECTION_IDS = { totalComp: 'section-total-comp', existing: 'section-existing', planned: 'section-planned' };

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

  // Existing/Planned open by default (that's the day-to-day working area); Total Comp
  // by Employee starts collapsed (Kayee, 2026-08-06: "it can stay collapsed only when
  // people want to see it they can expand").
  const [collapsedSections, setCollapsedSections] = useState({
    totalComp: true,
    existing: false,
    planned: false,
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
        <PageHead title="Payroll" subtitle="Employee roster, bonus, and total comp forecast" />
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
      <PageHead title="Payroll" subtitle="Employee roster, bonus, and total comp forecast — saved to this browser">
        <button type="button" className="btn" onClick={() => window.print()}>
          Export PDF
        </button>
      </PageHead>

      <AssumptionsBar assumptions={state.assumptions} onChange={setAssumptions} />

      {/* Wide wrapper (2026-08-05, Kayee: "I can only see one month" scrolling right) —
          these tables' frozen columns eat nearly all of the normal 1320px page width, so
          this section alone breaks out wider (capped, with a gutter on both sides — see
          .page-wide in globals.css). PageHead and AssumptionsBar above stay at the
          normal page width. */}
      <div className="page-wide">
        <PayrollSummaryCard
          roster={state.roster}
          bonuses={state.bonuses}
          assumptions={state.assumptions}
          months={MONTHS}
          todayIso={todayIso}
          onJumpToSection={jumpToSection}
        />

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
            months={MONTHS}
            todayIso={todayIso}
          />
        </CollapsibleSection>

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
            months={MONTHS}
            todayIso={todayIso}
            onChange={setRoster}
          />
          <BonusCard
            bonuses={state.bonuses}
            roster={state.roster}
            assumptions={state.assumptions}
            months={MONTHS}
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
            months={MONTHS}
            todayIso={todayIso}
            onChange={setRoster}
          />
          <BonusCard
            bonuses={state.bonuses}
            roster={state.roster}
            assumptions={state.assumptions}
            months={MONTHS}
            todayIso={todayIso}
            onChange={setBonuses}
            scope="planned"
          />
        </CollapsibleSection>
      </div>
    </>
  );
}
