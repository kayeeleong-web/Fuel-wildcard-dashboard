'use client';

import { useEffect, useState } from 'react';

// Manual input mode hidden from the UI for now (2026-08-24, Kayee: "you can remove
// manual input option for now. but we might bring it back so you can just hide this
// option for user") — flip back to true to restore the radio option. The underlying
// mode:'manual' handling (manualByMonth/manualByWeek cells, live-editable Cash Flow
// grid inputs) is untouched, so any account already saved in manual mode keeps
// working exactly as before; it just can't be freshly picked from this sidebar.
const SHOW_MANUAL_INPUT_OPTION = false;

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
    // 'cf-assumptions-sidebar' (2026-08-19, Kayee: "make the cash flow assumption
    // narrowing it's a little too wide") narrows JUST this sidebar, scoped separately
    // from .reports-sidebar's shared width so the P&L Assumptions sidebar (which still
    // needs its own room for the Revenue/Cost cards) is untouched.
    <div className="reports-sidebar cf-assumptions-sidebar">
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
    // Starting config: Follow P&L cadence (2026-08-24 — changed from a forced
    // quarterly-interval default, since the most common reason to add an account now
    // is just to set WHICH WEEK it lands in — e.g. payroll clearing on the 1st — not
    // to change its monthly cadence at all. Frequency/interval is still one click away
    // via the radio group below.) The card opens expanded so the user lands straight
    // in its controls.
    onSetTiming(accountId, { mode: 'followPL' });
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

/** Human label for the week-placement override, e.g. "day 1", "2 payments/mo" —
 *  shown as a suffix on the tag so a card's header alone tells you both the cadence
 *  AND which week(s) it lands in without expanding it. */
function weekPlacementSuffix(timing) {
  if (Array.isArray(timing?.weekPlacements) && timing.weekPlacements.length > 1) {
    return ` · ${timing.weekPlacements.length} payments/mo`;
  }
  if (timing?.weekPlacementDay == null || timing.weekPlacementDay === '') return '';
  const day = Number(timing.weekPlacementDay);
  if (day === 1) return ' · 1st of month';
  if (day === 0) return ' · last day of prior month';
  if (day < 0) return ` · ${Math.abs(day)}d before month start`;
  return ` · day ${day}`;
}

/** Commits on blur (2026-08-24 fix, Kayee: "the selection is very laggy when i try to
 *  type which week does it land in") — typing a custom placement day used to call
 *  setWeekPlacementDay on every single keystroke via onChange, and each call flows
 *  all the way through onSetTiming into the shared cash-timing state, which re-runs
 *  the ENTIRE Weekly CF pipeline (every account, every visible week) plus a
 *  localStorage write — on every keystroke. Same "commit on blur, not on every
 *  keystroke" pattern as AssumptionField (payroll/AssumptionsBar.jsx) and every other
 *  editable number field in this app: keeps a local draft while typing, only commits
 *  the expensive real state update once, when the field loses focus. */
function CustomDayField({ value, onCommit }) {
  const [draft, setDraft] = useState(value);

  // Keep the draft in sync if the stored value changes from elsewhere (e.g. switching
  // the dropdown to "Custom day…" resets it to 0) without fighting the user's typing.
  useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <input
      type="number"
      className="sidebar-input"
      style={{ marginTop: 6 }}
      value={draft}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const n = Number(draft);
        onCommit(Number.isFinite(n) ? n : 0);
      }}
    />
  );
}

/** Same commit-on-blur pattern as CustomDayField, for a payment split's % share. */
function PctField({ value, onCommit }) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <span className="sidebar-pct-wrap">
      <input
        type="number"
        className="sidebar-input sidebar-pct-input"
        value={draft}
        onFocus={(e) => e.target.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const n = Number(draft);
          onCommit(Number.isFinite(n) ? n : 0);
        }}
      />
      <span className="sidebar-pct-suffix">%</span>
    </span>
  );
}

/** How many times a month, and on which day(s), this account's cash actually clears
 *  (2026-08-24, Kayee: "you might do multiply payments in each month for example
 *  salaries & benefits i do payroll twice a month... give the user the options to
 *  split the P&L cadence into different weeks... not only opex but also cogs").
 *  Defaults to ONE payment — the same Last day / 1st / Custom day picker this always
 *  had — so splitting is strictly opt-in and every account set up before this
 *  feature keeps behaving exactly as it did. This component is shared by BOTH the
 *  COGS Outflow and OpEx Outflow sections (see TimingSection/AccountTimingCard
 *  above), so there's nothing extra to wire up per section — split payments work
 *  the same everywhere an account can have custom timing at all.
 *
 *  Each split is { day, pct } — `day` uses the exact same "day of the payment month"
 *  convention as the single-payment picker (1 = the 1st, 0 = the last day of the
 *  PRIOR month, etc.), `pct` is that split's share of the month's total. Two payment
 *  days are always more than a week apart, so each lands in its own distinct week —
 *  see cashOutflowForWeek in weeklyCashProjection.js for why that's always safe. */
function PaymentSplitEditor({ account, timing, onSetTiming }) {
  const placements =
    Array.isArray(timing?.weekPlacements) && timing.weekPlacements.length > 0
      ? timing.weekPlacements
      : [{ day: timing?.weekPlacementDay ?? null, pct: 100 }];

  function commit(nextPlacements) {
    if (nextPlacements.length <= 1) {
      // Back down to one payment — drop weekPlacements entirely and store the day on
      // the original single-payment field, so a one-payment account's saved shape
      // never changes and stays byte-identical to accounts that never split at all.
      const day = nextPlacements[0]?.day ?? null;
      const { weekPlacements, ...rest } = timing || {};
      onSetTiming(account.id, day == null ? rest : { ...rest, weekPlacementDay: day });
    } else {
      onSetTiming(account.id, { ...timing, weekPlacementDay: undefined, weekPlacements: nextPlacements });
    }
  }

  function addPayment() {
    const evenPct = Math.round(100 / (placements.length + 1));
    commit([...placements.map((p) => ({ ...p, pct: evenPct })), { day: null, pct: evenPct }]);
  }

  function removePayment(idx) {
    const next = placements.filter((_, i) => i !== idx);
    commit(next.length > 0 ? next : [{ day: null, pct: 100 }]);
  }

  function setDay(idx, day) {
    commit(placements.map((p, i) => (i === idx ? { ...p, day } : p)));
  }

  function setPct(idx, pct) {
    commit(placements.map((p, i) => (i === idx ? { ...p, pct } : p)));
  }

  const totalPct = placements.reduce((s, p) => s + (Number(p.pct) || 0), 0);
  const multi = placements.length > 1;

  return (
    <div className="sidebar-control-group">
      <label className="sidebar-input-label">
        {multi ? 'Payment schedule this month' : 'Which week of that month does it land in?'}
      </label>
      {placements.map((p, idx) => (
        <div key={idx} className="sidebar-split-row">
          <select
            className="sidebar-select"
            value={p.day == null || p.day === '' ? 'last' : Number(p.day) === 1 ? 'first' : 'custom'}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'last') setDay(idx, null);
              else if (v === 'first') setDay(idx, 1);
              else {
                // Same "always land on a genuinely-custom value" fix as the original
                // single-payment picker — see the 2026-08-24 bug note further up.
                const isAlreadyCustom = p.day != null && p.day !== '' && Number(p.day) !== 1;
                setDay(idx, isAlreadyCustom ? p.day : 0);
              }
            }}
          >
            <option value="last">Last day of the month</option>
            <option value="first">1st of the month</option>
            <option value="custom">Custom day…</option>
          </select>
          {p.day != null && p.day !== '' && Number(p.day) !== 1 && (
            <CustomDayField value={p.day} onCommit={(n) => setDay(idx, n)} />
          )}
          {multi && <PctField value={p.pct} onCommit={(n) => setPct(idx, n)} />}
          {multi && (
            <button
              type="button"
              className="sidebar-card-remove"
              title="Remove this payment"
              onClick={() => removePayment(idx)}
            >
              ×
            </button>
          )}
        </div>
      ))}
      {multi && Math.round(totalPct) !== 100 && (
        <div className="sidebar-section-note sidebar-split-warning">
          Adds up to {Math.round(totalPct)}%, not 100% — the real month's total still
          gets split between these payments proportionally either way, but the % you
          typed won't match what actually lands in each week.
        </div>
      )}
      <button type="button" className="pr-schedule-add-link" onClick={addPayment}>
        + Split into another payment{!multi ? ' (e.g. twice a month)' : ''}
      </button>
      <div className="sidebar-section-note">
        {multi
          ? 'Each payment takes its own day of the month and its own share of the total — 1 = the 1st, 0 = the last day of the PRIOR month, 28–31 = month-end.'
          : 'Day of the payment month this clears — 1 = the 1st, 0 = the last day of the PRIOR month, negative = earlier than that, 28–31 = month-end.'}{' '}
        Only which week(s) it lands in changes; the month it's paid in still follows the cadence above.
      </div>
    </div>
  );
}

function timingTag(timing) {
  const mode = timing?.mode || 'followPL';
  const suffix = weekPlacementSuffix(timing);
  if (mode === 'manual') return 'Manual input';
  if (mode === 'followPL') return `Follow P&L${suffix}`;
  const frequency = timing?.frequency || 'monthly';
  if (frequency === 'monthly') return `Monthly${suffix}`;
  if (frequency === 'quarterly') return `Quarterly · M${Math.min(3, Math.max(1, Number(timing?.payMonth) || 3))}${suffix}`;
  return `Annually · ${CALENDAR_MONTHS[Math.min(12, Math.max(1, Number(timing?.payMonth) || 1)) - 1].slice(0, 3)}${suffix}`;
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
        ...timing,
        mode: 'interval',
        frequency: timing?.frequency && timing.frequency !== 'monthly' ? timing.frequency : 'quarterly',
        payMonth: timing?.payMonth || 3,
      });
    } else if (nextMode === 'manual') {
      onSetTiming(account.id, {
        ...timing,
        mode: 'manual',
        manualByMonth: timing?.manualByMonth || {},
      });
    } else {
      // Follow P&L cadence — keeps whatever weekPlacementDay override is already set,
      // just drops the quarterly/annual interval config.
      onSetTiming(account.id, { ...timing, mode: 'followPL' });
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

  // "Monthly" dropped as a Custom interval choice (2026-08-19, Kayee: "custom interval
  // doesn't need monthly because P&L is already monthly") — it was mathematically
  // identical to the implicit Follow P&L default, so it was just a confusing extra
  // step. A legacy stored 'monthly' entry still displays correctly (falls through to
  // quarterly/annually's sibling logic via cashOutflowForMonth's own default), it's
  // just no longer offered as a fresh choice here.
  const frequency = timing?.frequency && timing.frequency !== 'monthly' ? timing.frequency : 'quarterly';

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
            <div className="sidebar-input-label">How often is this paid?</div>
            {/* 2026-08-24 reworded (Kayee: "these three options needs to be more clear
                and precise... not formal") — plain-language labels + a one-line
                explanation under each, instead of jargon ("Follow P&L cadence",
                "Custom interval") that only made sense if you already knew what it
                meant. Each option's SECOND line is the actual explanation; the radio's
                own label stays short. */}
            <label className="sidebar-radio-label sidebar-radio-label-stacked">
              <span>
                <input type="radio" checked={mode !== 'interval' && mode !== 'manual'} onChange={() => setMode('followPL')} />
                Every month, same as the P&amp;L
              </span>
              <span className="sidebar-radio-sublabel">You only pick which week it lands in, below.</span>
            </label>
            <label className="sidebar-radio-label sidebar-radio-label-stacked">
              <span>
                <input type="radio" checked={mode === 'interval'} onChange={() => setMode('interval')} />
                Less often — quarterly or annually
              </span>
              <span className="sidebar-radio-sublabel">You pick how often it's paid, which month, and which week.</span>
            </label>
            {/* Manual input hidden for now (2026-08-24, Kayee: "you can remove manual
                input option for now. but we might bring it back so you can just hide
                this option for user") — SHOW_MANUAL_INPUT_OPTION flips it back on;
                setMode('manual')/mode==='manual' handling elsewhere in this component
                is untouched, so any account already saved in manual mode still works
                exactly as before, it just can't be freshly selected from this radio
                group right now. */}
            {SHOW_MANUAL_INPUT_OPTION && (
              <label className="sidebar-radio-label sidebar-radio-label-stacked">
                <span>
                  <input type="radio" checked={mode === 'manual'} onChange={() => setMode('manual')} />
                  Type the exact $ myself
                </span>
                <span className="sidebar-radio-sublabel">You enter the cash amount directly in the Cash Flow grid, month by month.</span>
              </label>
            )}
          </div>

          {mode !== 'manual' && (
            <PaymentSplitEditor account={account} timing={timing} onSetTiming={onSetTiming} />
          )}

          {mode === 'interval' && (
            <div className="sidebar-control-group">
              <label className="sidebar-input-label">How often?</label>
              <select
                className="sidebar-select"
                value={frequency}
                onChange={(e) => setFrequency(e.target.value)}
              >
                <option value="quarterly">Every quarter</option>
                <option value="annually">Once a year</option>
              </select>

              {frequency === 'quarterly' && (
                <>
                  <label className="sidebar-input-label">Which month of the quarter?</label>
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
                  <label className="sidebar-input-label">Which month of the year?</label>
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
            // 2026-08-19, Kayee: "manual input should be like in the screenshot... if I
            // input manual then I should be able to put it in the cash flow monthly
            // section" — typing now happens directly in this account's row in the CF
            // table below (every forecast month becomes a live input there), not in a
            // second list of month rows here. This card just confirms the mode is set.
            <div className="sidebar-control-group">
              <div className="sidebar-section-note">
                {account.label}&apos;s forecast months are now editable directly in the Cash Flow table below — type
                the actual cash $ right in each month&apos;s cell.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ManualMonthInput removed 2026-08-19 — manual-mode typing moved into the actual Cash
// Flow table (see cfOutflowCell in ReportsPanel.jsx), so this sidebar no longer renders
// a second per-month input list.
