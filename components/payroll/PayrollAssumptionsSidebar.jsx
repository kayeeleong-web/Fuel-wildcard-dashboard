'use client';

import { AssumptionField } from './AssumptionsBar';

/**
 * Payroll Assumptions sidebar (2026-08-10, Kayee: "in the payroll tab move the payroll
 * assumption to the left just like the p&l with a hamburger") — same collapsible
 * left-sidebar/hamburger-rail pattern as PLAssumptionsSidebar.jsx on the Reports tab,
 * applied to Payroll's own Tax Rate / Benefits / Bonus Attainment / Yearly Merit
 * Increase fields instead of a wide top-of-page strip. Reuses the exact <AssumptionField>
 * input and .pr-assumption-sidebar-list / .pr-assumption-group layout already built for
 * Reports, so the two sidebars look and behave identically.
 */
export function PayrollAssumptionsSidebar({ collapsed, onToggleCollapse, assumptions, onChange }) {
  if (collapsed) {
    return (
      <div className="payroll-sidebar-rail">
        <button
          type="button"
          className="payroll-sidebar-toggle-rail"
          title="Show Payroll Assumptions"
          onClick={onToggleCollapse}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
          <span>Assumptions</span>
        </button>
      </div>
    );
  }

  function setField(key, value) {
    onChange({ ...assumptions, [key]: value });
  }

  return (
    <div className="payroll-sidebar">
      <div className="payroll-card">
        <div className="payroll-card-head">
          <span className="payroll-card-title-btn" style={{ cursor: 'default' }}>
            Payroll Assumptions
          </span>
          <span className="payroll-card-actions">
            <button
              type="button"
              className="payroll-sidebar-toggle-open"
              title="Hide Assumptions"
              onClick={onToggleCollapse}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
              Hide
            </button>
          </span>
        </div>

        <div className="pr-assumption-sidebar-list">
          <div className="pr-assumption-group">
            <div className="pr-assumption-group-label">Rates</div>
            <AssumptionField label="Tax Rate" value={assumptions.taxRate} onCommit={(v) => setField('taxRate', v)} />
            <AssumptionField label="Benefits" value={assumptions.benefits} onCommit={(v) => setField('benefits', v)} />
            <AssumptionField
              label="Bonus Attainment"
              value={assumptions.bonusAttainment}
              onCommit={(v) => setField('bonusAttainment', v)}
            />
            <AssumptionField
              label="Yrly Merit Increase"
              value={assumptions.yearlyMeritIncrease}
              onCommit={(v) => setField('yearlyMeritIncrease', v)}
            />
          </div>
          <div className="pr-assumption-note">
            Does not include contractors. Loaded cost = Base ÷ 12 × (1 + Tax Rate + Benefits).
          </div>
        </div>
      </div>
    </div>
  );
}
