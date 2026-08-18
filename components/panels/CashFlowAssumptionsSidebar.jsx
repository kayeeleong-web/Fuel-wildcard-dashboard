'use client';

import { useState } from 'react';
import { formatMonthLabel } from '../../lib/calc/dashboardMetrics';

/**
 * Cash Flow Assumptions sidebar (2026-08-18 rebuild — the first version was rejected
 * as raw/cosmetic). Visual system copied 1:1 from PLAssumptionsSidebar.jsx: the same
 * collapsed full-height hamburger rail, the same .payroll-card black header bar with
 * an icon+"Hide" toggle, and the existing .sidebar-* card/control classes from
 * globals.css — no new styles invented here.
 *
 * Exactly TWO sections — COGS Outflow and OpEx Outflow. The old "Revenue Inflow"
 * section is gone: customer cash-in inputs live on the Customer Cash Flow tab now
 * (CustomerPanel.jsx), which writes its monthly totals to localStorage for the CF
 * projection to read (see lib/cashflow/cashProjection.js CUSTOMER_INFLOW_STORAGE_KEY).
 *
 * Each account listed is a real chart-of-account row from the live P&L statement
 * (plus Payroll's injected COGS headcount line and any user-added manual P&L
 * accounts) — see plExpenseAccounts in lib/cashflow/cashProjection.js. Per account:
 *  - default (unconfigured): compact row tagged "Follow P&L" — cash out mirrors the
 *    projected P&L accrual month-by-month
 *  - "Custom interval": pick Monthly/Quarterly/Annually and WHICH month payment lands
 *    (month 1–3 of the quarter, or a calendar month for annual) — the projection
 *    aggregates the cycle's accruals into that payment month
 *  - "Manual input": type the cash $ per forecast month directly; each input shows
 *    the P&L accrual for that month as a small reference so you can see what you're
 *    overriding
 * None of this is cosmetic — ReportsPanel's CF pipeline applies these configs to the
 * projection's CASH PROJECTION rows (withCashFlowProjectionRows).
 */
export function CashFlowAssumptionsSidebar({
  collapsed,
  onToggleCollapse,
  cogsAccounts,
  opexAccounts,
  timingByAccount,
  onSetTiming,
  manualMonths,
  accrualFor,
}) {
  if (collapsed) {
    // Same full-height black/white rail as the P&L sidebar (2026-08-07, Kayee: "make
    // hamburger more obvious") — vertical label so it can't be missed.
    return (
      <div className="reports-sidebar-rail">
        <button
          type="button"
          className="reports-sidebar-toggle-rail"
          title="Show Cash Flow Assumptions"
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

  if (!cogsAccounts || !opexAccounts) {
    return (
      <div className="reports-sidebar">
        <div className="payroll-card">
          <div className="cap" style={{ padding: 18 }}>
            Loading saved cash-timing assumptions…
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="reports-sidebar">
      <div className="payroll-card">
        <div className="payroll-card-head">
          <span className="payroll-card-title-btn" style={{ cursor: 'default' }}>
            Cash Flow Assumptions
          </span>
          <span className="payroll-card-actions">
            <button
              type="button"
              className="reports-sidebar-toggle-open"
              title="Hide Cash Flow Assumptions"
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
          <TimingSection
            label="COGS Outflow"
            accounts={cogsAccounts}
            timingByAccount={timingByAccount}
            onSetTiming={onSetTiming}
            manualMonths={manualMonths}
            accrualFor={accrualFor}
          />
          <TimingSection
            label="OpEx Outflow"
            accounts={opexAccounts}
            timingByAccount={timingByAccount}
            onSetTiming={onSetTiming}
            manualMonths={manualMonths}
            accrualFor={accrualFor}
          />
        </div>
      </div>
    </div>
  );
}

function TimingSection({ label, accounts, timingByAccount, onSetTiming, manualMonths, accrualFor }) {
  return (
    <div className="sidebar-section">
      <h4 className="sidebar-section-label">{label}</h4>
      {accounts.length === 0 ? (
        <div className="cap">No accounts found on the P&amp;L for this section.</div>
      ) : (
        accounts.map((account) => (
          <AccountTimingCard
            key={account.id}
            account={account}
            timing={timingByAccount?.[account.id]}
            onSetTiming={onSetTiming}
            manualMonths={manualMonths}
            accrualFor={accrualFor}
          />
        ))
      )}
    </div>
  );
}

const QUARTER_MONTH_OPTIONS = [
  { value: 1, label: 'Month 1 of quarter (Jan / Apr / Jul / Oct)' },
  { value: 2, label: 'Month 2 of quarter (Feb / May / Aug / Nov)' },
  { value: 3, label: 'Month 3 of quarter (Mar / Jun / Sep / Dec)' },
];

const CALENDAR_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function timingTag(timing) {
  const mode = timing?.mode || 'followPL';
  if (mode === 'followPL') return 'Follow P&L';
  if (mode === 'manual') return 'Manual input';
  const frequency = timing?.frequency || 'monthly';
  if (frequency === 'monthly') return 'Monthly';
  if (frequency === 'quarterly') return `Quarterly · M${Math.min(3, Math.max(1, Number(timing?.payMonth) || 3))}`;
  return `Annually · ${CALENDAR_MONTHS[Math.min(12, Math.max(1, Number(timing?.payMonth) || 1)) - 1].slice(0, 3)}`;
}

/** One P&L account's cash-timing card — compact header row (label + current-mode tag)
 *  with a Configure toggle, expanding to the mode radios and mode-specific controls.
 *  All classes are the existing .sidebar-* set from globals.css. */
function AccountTimingCard({ account, timing, onSetTiming, manualMonths, accrualFor }) {
  const [expanded, setExpanded] = useState(false);
  const mode = timing?.mode || 'followPL';

  function setMode(nextMode) {
    if (nextMode === 'followPL') {
      // Follow P&L is the default — remove the config entirely rather than storing a
      // redundant entry (onSetTiming(id, null) deletes the key).
      onSetTiming(account.id, null);
    } else if (nextMode === 'interval') {
      onSetTiming(account.id, {
        mode: 'interval',
        frequency: timing?.frequency || 'monthly',
        payMonth: timing?.payMonth || 1,
      });
    } else {
      onSetTiming(account.id, {
        mode: 'manual',
        manualByMonth: timing?.manualByMonth || {},
      });
    }
  }

  function setFrequency(frequency) {
    // Reset payMonth to a sensible default when the frequency's valid range changes.
    const payMonth = frequency === 'quarterly' ? 3 : 1;
    onSetTiming(account.id, { ...timing, mode: 'interval', frequency, payMonth });
  }

  function setPayMonth(payMonth) {
    onSetTiming(account.id, { ...timing, mode: 'interval', payMonth });
  }

  function setManualAmount(iso, amount) {
    onSetTiming(account.id, {
      ...timing,
      mode: 'manual',
      manualByMonth: { ...(timing?.manualByMonth || {}), [iso]: amount },
    });
  }

  const frequency = timing?.frequency || 'monthly';

  return (
    <div className="sidebar-card">
      <div className="sidebar-card-header" onClick={() => setExpanded((e) => !e)}>
        <span className="sidebar-card-label">{account.label}</span>
        <span className="sidebar-card-value">{timingTag(timing)}</span>
      </div>

      {expanded && (
        <div className="sidebar-card-body">
          <div className="sidebar-control-group">
            <label className="sidebar-radio-label">
              <input type="radio" checked={mode === 'followPL'} onChange={() => setMode('followPL')} />
              Follow P&amp;L — cash mirrors the accrual month-by-month
            </label>
            <label className="sidebar-radio-label">
              <input type="radio" checked={mode === 'interval'} onChange={() => setMode('interval')} />
              Custom interval — pick frequency &amp; payment month
            </label>
            <label className="sidebar-radio-label">
              <input type="radio" checked={mode === 'manual'} onChange={() => setMode('manual')} />
              Manual input — type cash $ per month
            </label>
          </div>

          {mode === 'interval' && (
            <div className="sidebar-control-group">
              <label className="sidebar-input-label">Payment frequency</label>
              <select
                className="sidebar-select"
                value={frequency}
                onChange={(e) => setFrequency(e.target.value)}
              >
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annually">Annually</option>
              </select>

              {frequency === 'quarterly' && (
                <>
                  <label className="sidebar-input-label">Payment lands in</label>
                  <select
                    className="sidebar-select"
                    value={Math.min(3, Math.max(1, Number(timing?.payMonth) || 3))}
                    onChange={(e) => setPayMonth(Number(e.target.value))}
                  >
                    {QUARTER_MONTH_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </>
              )}

              {frequency === 'annually' && (
                <>
                  <label className="sidebar-input-label">Payment lands in</label>
                  <select
                    className="sidebar-select"
                    value={Math.min(12, Math.max(1, Number(timing?.payMonth) || 1))}
                    onChange={(e) => setPayMonth(Number(e.target.value))}
                  >
                    {CALENDAR_MONTHS.map((name, i) => (
                      <option key={name} value={i + 1}>
                        {name}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </div>
          )}

          {mode === 'manual' && (
            <div className="sidebar-control-group">
              <label className="sidebar-input-label">Cash out per forecast month</label>
              {manualMonths.length === 0 && (
                <div className="cap">No forecast months available to edit.</div>
              )}
              {manualMonths.map((iso) => (
                <ManualMonthInput
                  key={iso}
                  iso={iso}
                  value={timing?.manualByMonth?.[iso]}
                  accrual={accrualFor(account, iso)}
                  onCommit={(n) => setManualAmount(iso, n)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <button type="button" className="sidebar-card-toggle" onClick={() => setExpanded((e) => !e)}>
        {expanded ? '▼ Done' : '▶ Configure'}
      </button>
    </div>
  );
}

/** One manual-mode month row: label, commit-on-blur $ input (same convention as every
 *  other editable cell in the app), and the P&L accrual for that account+month shown
 *  as a small reference right under the input — what the typed cash $ is overriding. */
function ManualMonthInput({ iso, value, accrual, onCommit }) {
  const [draft, setDraft] = useState(value != null && value !== 0 ? String(Math.round(value)) : '');
  const [focused, setFocused] = useState(false);

  const display = focused ? draft : value != null && value !== 0 ? String(Math.round(value)) : '';

  return (
    <div style={{ marginBottom: 6 }}>
      <label className="sidebar-input-label">{formatMonthLabel(iso)}</label>
      <input
        type="text"
        inputMode="decimal"
        className="sidebar-input"
        placeholder="0"
        value={display}
        onFocus={(e) => {
          const current = value != null && value !== 0 ? String(Math.round(value)) : '';
          setDraft(current);
          setFocused(true);
          e.target.select();
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const n = Number(String(draft).replace(/[^0-9.-]/g, '')) || 0;
          setFocused(false);
          onCommit(n);
        }}
      />
      <span className="sidebar-card-value">
        P&amp;L accrual: ${Math.round(accrual || 0).toLocaleString('en-US')}
      </span>
    </div>
  );
}
