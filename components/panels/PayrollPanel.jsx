'use client';

import { useState } from 'react';
import { PageHead } from '../ui/PageHead';
import { AssumptionsBar } from '../payroll/AssumptionsBar';
import { PayrollSummaryCard } from '../payroll/PayrollSummaryCard';
import { RosterCard } from '../payroll/RosterCard';
import { BonusCard } from '../payroll/BonusCard';
import { TotalCompCard } from '../payroll/TotalCompCard';
import { usePayrollState } from '../../lib/payroll/usePayrollState';
import { MONTHS, currentIsoMonth, generateId } from '../../lib/payroll/payrollData';

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
  const [justAddedId, setJustAddedId] = useState(null);
  const todayIso = currentIsoMonth();

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

  function addEmployee() {
    const id = generateId('emp');
    const newEmployee = {
      id,
      name: '',
      department: '',
      costType: 'OpEx',
      title: '',
      startDate: '',
      endDate: '',
      employment: 'TBD',
      baseSalary: 0,
      monthlyOverrides: {},
    };
    setState({ ...state, roster: [...state.roster, newEmployee] });
    setJustAddedId(id);
  }

  return (
    <>
      <PageHead title="Payroll" subtitle="Employee roster, bonus, and total comp forecast — saved to this browser">
        <button type="button" className="btn" onClick={() => window.print()}>
          Export PDF
        </button>
        <button type="button" className="btn primary" onClick={addEmployee}>
          + Add Employee
        </button>
      </PageHead>

      <AssumptionsBar assumptions={state.assumptions} onChange={setAssumptions} />

      {/* Full-bleed wrapper (2026-08-05, Kayee: "I can only see one month" scrolling
          right) — these tables' frozen columns eat nearly all of the normal 1320px page
          width, so this section alone breaks out to the full viewport width. PageHead
          and AssumptionsBar above stay at the normal page width. */}
      <div className="payroll-wide">
        <PayrollSummaryCard
          roster={state.roster}
          bonuses={state.bonuses}
          assumptions={state.assumptions}
          months={MONTHS}
          todayIso={todayIso}
        />

        <div style={{ height: 20 }} />

        <RosterCard
          roster={state.roster}
          assumptions={state.assumptions}
          months={MONTHS}
          todayIso={todayIso}
          onChange={setRoster}
          justAddedId={justAddedId}
          onFocusHandled={() => setJustAddedId(null)}
        />

        <div style={{ height: 20 }} />

        <BonusCard
          bonuses={state.bonuses}
          roster={state.roster}
          assumptions={state.assumptions}
          months={MONTHS}
          todayIso={todayIso}
          onChange={setBonuses}
        />

        <div style={{ height: 20 }} />

        <TotalCompCard
          roster={state.roster}
          bonuses={state.bonuses}
          assumptions={state.assumptions}
          months={MONTHS}
          todayIso={todayIso}
        />
      </div>
    </>
  );
}
