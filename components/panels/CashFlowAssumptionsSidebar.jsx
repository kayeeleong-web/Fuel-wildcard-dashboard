'use client';

import { useState } from 'react';
import { formatMonthLabel } from '../../lib/calc/dashboardMetrics';

/**
 * Cash Flow Assumptions sidebar (2026-08-18 UX redesign — v2 "list every account"
 * was rejected as too noisy: a full card + "Follow P&L" tag + Configure button per
 * P&L account buried the handful of accounts that actually have custom timing).
 *
 * The model now matches how the projection math already works (see
 * lib/cashflow/cashProjection.js cashOutflowForMonth): Follow P&L is the SILENT
 * DEFAULT for every account — an account absent from timingByAccount mirrors its
 * P&L accrual month-by-month, and needs no UI at all. The sidebar only shows the
 * accounts the user has EXPLICITLY overridden:
 *
 *  - Each section (COGS Outflow / OpEx Outflow) opens with one quiet explainer
 *    line, then a card per overridden account, then a "+ Set custom timing…" link
 *    (same visual language as PLAssumptionsSidebar's "+ Schedule a future change").
 *  - Clicking the link swaps it for a compact select listing only the accounts NOT
 *    yet configured in that section; picking one immediately creates its config
 *    card (pre-expanded, default = monthly interval) and drops it from the picker.
 *  - Each card: account name + "× Remove" in the header, then the same controls as
 *    before — Custom interval (frequency + payment-month) or Manual input (per-month
 *    $ with the P&L accrual as reference). "Remove" deletes the account's entry from
 *    timingByAccount entirely (onSetTiming(id, null)), reverting it to Follow P&L.
 *
 * Visual system still copied 1:1 from PLAssumptionsSidebar: the collapsed
 * full-height hamburger rail, the .payroll-card black header bar, and the existing
 * .sidebar-* / .pr-schedule-add-link classes from globals.css — nothing hardcoded.
 *
 * The old "Revenue Inflow" section stays gone: customer cash-in inputs live on the
 * Customer Cash Flow tab (CustomerPanel.jsx), handed off via
 * CUSTOMER_INFLOW_STORAGE_KEY in lib/cashflow/cashProjection.js.
 *
 * None of this is cosmetic — ReportsPanel's CF pipeline applies these configs to
 * the projection's CASH PROJECTION rows (withCashFlowProjectionRows).
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

/**
 * One section = explainer line + a card per EXPLICITLY overridden account + the
 * "+ Set custom timing…" affordance. Accounts with no entry in timingByAccount are
 * simply not rendered — Follow P&L is the implicit default, not a per-account tag.
 * Any stored entry renders as a card regardless of its mode (even a legacy
 * mode:'followPL' entry from the old UI — never silently drop user data).
 */
function TimingSection({ label, accounts, timingByAccount, onSetTiming, manualMonths, accrualFor }) {
  const [picking, setPicking] = useState(false);
  // The account just added via the picker starts expanded so the user lands
  // straight in its controls instead of on a collapsed card.
  const [justAddedId, setJustAddedId] = useState(null);

  const configured = accounts.filter((a) => timingByAccount?.[a.id] != null);
  const unconfigured = accounts.filter((a) => timingByAccount?.[a.id] == null);

  function addAccount(accountId) {
    if (!accountId) return;
    // Sensible starting config: monthly interval (cash = accrual each month, same
    // math as Follow P&L) — the card opens expanded so the user immediately picks
    // the frequency/mode they actually came here to set.
    onSetTiming(accountId, { mode: 'interval', frequency: 'monthly', payMonth: 1 });
    setJustAddedId(accountId);
    setPicking(false);
  }

  return (
    <div className="sidebar-section">
      <h4 className="sidebar-section-label">{label}</h4>

      {accounts.length === 0 ? (
        <div className="sidebar-section-note">No accounts found on the P&amp;L for this section.</div>
      ) : (
        <>
          <div className="sidebar-section-note">
            All accounts follow P&amp;L timing unless overridden below.
          </div>

          {configured.map((account) => (
            <AccountTimingCard
              key={account.id}
              account={account}
              timing={timingByAccount[account.id]}
              onSetTiming={onSetTiming}
              manualMonths={manualMonths}
              accrualFor={accrualFor}
              defaultExpanded={account.id === justAddedId}
            />
          ))}

          {unconfigured.length > 0 &&
            (!picking ? (
              <button type="button" className="pr-schedule-add-link" onClick={() => setPicking(true)}>
                + Set custom timing…
              </button>
            ) : (
              <div className="sidebar-add-picker">
                <select
                  className="sidebar-select"
                  defaultValue=""
                  autoFocus
                  onChange={(e) => addAccount(e.target.value)}
                >
                  <option value="" disabled>
                    Select account…
                  </option>
                  {unconfigured.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.label}
                    </option>
                  ))}
                </select>
                <button type="button" className="pr-schedule-add-link" onClick={() => setPicking(false)}>
                  Cancel
                </button>
              </div>
            ))}
        </>
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
  // Only reachable by a legacy stored entry — the new UI never writes followPL.
  if (mode === 'followPL') return 'Follow P&L';
  if (mode === 'manual') return 'Manual input';
  const frequency = timing?.frequency || 'monthly';
  if (frequency === 'monthly') return 'Monthly';
  if (frequency === 'quarterly') return `Quarterly · M${Math.min(3, Math.max(1, Number(timing?.payMonth) || 3))}`;
  return `Annually · ${CALENDAR_MONTHS[Math.min(12, Math.max(1, Number(timing?.payMonth) || 1)) - 1].slice(0, 3)}`;
}

/** One OVERRIDDEN account's cash-timing card — header row (name + current-mode tag +
 *  "×" remove), expanding to the Custom interval / Manual input controls. Removing
 *  deletes the account's timing entry entirely, reverting it to the implicit Follow
 *  P&L default. All classes are the existing .sidebar-* set from globals.css. */
function AccountTimingCard({ account, timing, onSetTiming, manualMonths, accrualFor, defaultExpanded }) {
  const [expanded, setExpanded] = useState(!!defaultExpanded);
  const mode = timing?.mode || 'followPL';

  function setMode(nextMode) {
    if (nextMode === 'interval') {
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
        <button
          type="button"
          className="sidebar-card-remove"
          title="Remove — revert to Follow P&L"
          onClick={(e) => {
            e.stopPropagation();
            onSetTiming(account.id, null);
          }}
        >
          ×
        </button>
      </div>

      {expanded && (
        <div className="sidebar-card-body">
          <div className="sidebar-control-group">
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
                <div className="sidebar-section-note">No forecast months available to edit.</div>
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
