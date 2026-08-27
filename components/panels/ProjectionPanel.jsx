'use client';

import { useState } from 'react';
import { ReportsPanel } from './ReportsPanel';
import { PayrollPanel } from './PayrollPanel';
import { CustomerPanel, usePlannedCustomers, useCustomerDrivers } from './CustomerPanel';
import { SoftwarePanel } from './SoftwarePanel';
import { useAssumptionsState } from '../../lib/assumptions/useAssumptionsState';
import { usePayrollState } from '../../lib/payroll/usePayrollState';
import { useCashTimingState } from '../../lib/cashflow/useCashTimingState';

const SUB_TABS = [
  { id: 'pl', label: 'P&L' },
  { id: 'cf', label: 'Cash Flow' },
  { id: 'payroll', label: 'Payroll' },
  { id: 'customer', label: 'Customer' },
  { id: 'software', label: 'Software' },
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

  // Assumptions state now lives HERE (2026-08-24, Kayee: "sabe button is really
  // ugly... it should be right align all the way to the right") — moved up from
  // ReportsPanel so the Save button can render in THIS toolbar, which is the one row
  // that actually spans the full page width (ReportsPanel's own column sits beside the
  // Assumptions sidebar, so its "far right" was only the far right of that narrower
  // column). Passed down to ReportsPanel as the `assumptions` prop; ReportsPanel falls
  // back to its own internal hook when the prop is absent, so the plain actual-mode
  // Reports view elsewhere in the app is unaffected.
  const assumptions = useAssumptionsState();

  // Same lift-with-fallback pattern, extended to every OTHER sub-tab with its own
  // persisted entries (2026-08-24, Kayee: "it should also show up in each tab that
  // needs to have entries so that everything can be saved") — Cash Flow's per-account
  // timing config, Payroll's roster/bonus/hiring-plan state, and Customer's two stores
  // (planned-customer rows + campaign/meeting driver grids). Each sub-tab's own
  // component (ReportsPanel/PayrollPanel/CustomerPanel) still owns all the actual
  // editing UI — this level only needs read access to lastSavedAt/saveNow so the one
  // Save button in the toolbar below can act on whichever tab is currently open.
  const cashTiming = useCashTimingState();
  const payroll = usePayrollState();
  const plannedCustomers = usePlannedCustomers();
  const customerDrivers = useCustomerDrivers();

  // Which (lastSavedAt, saveNow) pair the toolbar's Save button uses, per sub-tab.
  // Customer has TWO independent stores, so its Save flushes both with one click and
  // shows whichever save happened most recently.
  const saveHandleForSubTab = {
    pl: { lastSavedAt: assumptions.lastSavedAt, saveNow: assumptions.saveNow },
    cf: { lastSavedAt: cashTiming.lastSavedAt, saveNow: cashTiming.saveNow },
    payroll: { lastSavedAt: payroll.lastSavedAt, saveNow: payroll.saveNow },
    customer: {
      lastSavedAt: Math.max(plannedCustomers.lastSavedAt || 0, customerDrivers.lastSavedAt || 0) || null,
      saveNow: () => {
        plannedCustomers.saveNow();
        customerDrivers.saveNow();
      },
    },
    // Software vendors live inside assumptions.costItems (see lib/software/softwareData.js),
    // so Software shares the exact same save handle as P&L.
    software: { lastSavedAt: assumptions.lastSavedAt, saveNow: assumptions.saveNow },
  }[projectionSubTab];

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
        {/* Single right-hand group (2026-08-24) — one marginLeft:auto on the OUTER
            wrapper pushes the whole group to the true right edge of the page (this
            toolbar spans full width, unlike ReportsPanel's own narrower column); every
            control inside just flows left-to-right with a normal gap, so there's never
            a fight over which element claims the auto-margin. */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Cash Flow's Monthly/Weekly toggle (2026-08-24) — Weekly shares the exact
              same Cash Timing Assumptions sidebar/state as Monthly (Kayee: "I still
              want it to sync... if I add a new assumption in cash flow monthly it
              should show up in weekly and vice versa") — flipping this toggle only
              changes which `fixedType` ReportsPanel is fed, not which timingByAccount
              it reads. Weekly's own addition on top of that shared config is a
              per-account week-placement override, plus a per-week manual override
              (manualByWeek) so a Manual-mode account can be steered to land in one
              SPECIFIC week. See lib/cashflow/weeklyCashProjection.js. */}
          {projectionSubTab === 'cf' && (
            <div className="seg">
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
            <button type="button" className="btn" onClick={() => window.print()}>
              Export PDF
            </button>
          )}
          {/* Save button (2026-08-24, Kayee: first "right align all the way to the
              right", then "it should also show up in each tab that needs to have
              entries so that everything can be saved") — same neutral .btn theme as
              every other button here, present on every sub-tab now, each acting on
              THAT tab's own persisted state via saveHandleForSubTab above. Customer's
              handle flushes both of its stores (planned customers + driver grids) in
              one click. */}
          <div className="report-save-block">
            {saveHandleForSubTab.lastSavedAt != null && (
              <span className="report-saved-note">Saved {new Date(saveHandleForSubTab.lastSavedAt).toLocaleTimeString()}</span>
            )}
            <button type="button" className="btn" onClick={saveHandleForSubTab.saveNow} title="Force-save this tab's entries to this browser now">
              Save
            </button>
          </div>
        </div>
      </div>

      {/* P&L and Cash Flow projections both use ReportsPanel with mode='projection',
          which runs all the Assumptions-driven forecast pipelines, shows the
          Assumptions sidebar (P&L only), and extends months through PROJECTION_HORIZON.
          Payroll and Assumptions are their own panels (different UI entirely). */}

      {projectionSubTab === 'pl' && (
        <ReportsPanel
          statements={statements}
          customReports={customReports}
          mode="projection"
          fixedType="PL"
          assumptions={assumptions}
        />
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
          assumptions={assumptions}
          cashTiming={cashTiming}
          payroll={payroll}
        />
      )}

      {projectionSubTab === 'payroll' && (
        <PayrollPanel payrollCtl={payroll} />
      )}

      {projectionSubTab === 'customer' && (
        <CustomerPanel
          glCash={glCash}
          glAccrued={glAccrued}
          plannedCtl={plannedCustomers}
          driversCtl={customerDrivers}
        />
      )}

      {projectionSubTab === 'software' && (
        <SoftwarePanel
          glCash={glCash}
          glAccrued={glAccrued}
          assumptionsCtl={assumptions}
          payrollCtl={payroll}
        />
      )}
    </>
  );
}
