'use client';

import { useState } from 'react';
import {
  BONUS_TYPES,
  annualBonusTarget,
  bonusCashFlow,
  bonusMonthlyFlow,
  bonusTypeOf,
  describeBonus,
  formatPayrollAmount,
  generateId,
} from '../../lib/payroll/payrollData';
import { DateInput, MonthInput, PayrollTable } from './PayrollTable';

// Slim frozen block, same reasoning as RosterCard's 2026-09-15 change (Kayee: "the whole
// control section is too long, the monthly section is really small") — Name, plan type,
// payout timing, and a read-only one-liner of the plan's numbers. The numbers themselves
// (and the plan's own start/end dates) are edited in the Details panel under the row.
const FROZEN_COLUMNS = [
  { key: 'actions', label: '', width: 80 },
  { key: 'name', label: 'Name', width: 190 },
  { key: 'type', label: 'Plan', width: 150 },
  { key: 'payout', label: 'Paid', width: 92 },
  { key: 'summary', label: 'Terms', width: 200 },
];

/**
 * Bonus (2026-09-15 redesign — Kayee: "bonus is not going to be a type-in situation...
 * the bonus section should be adjusted according to what the Fireflies said... give the
 * user the freedom to adjust it, but also refer to data coming from other tabs").
 *
 * Each row is one bonus PLAN attached to a roster person (or a Hiring Plan ramp role —
 * per-person figures × that month's headcount). A person can have several plans (e.g.
 * a coordinator's Campaign-milestone plan AND their Per-meeting plan). Plan types and
 * their math live in lib/payroll/payrollData.js (BONUS_TYPES / bonusMonthlyFlow):
 *   Fixed annual       → Bonus $ × Bonus Attainment % ÷ 12 (the original model)
 *   Campaign milestone → projected campaigns × % share ÷ N per milestone × $ × Hit Rate
 *   Per meeting        → projected meetings × % share × $ per meeting
 *   Quarterly fixed    → $ per quarter ÷ 3 accrued monthly
 * "Projected campaigns/meetings" are the Customer tab's deal projection (the same
 * numbers the P&L uses) — so bonus cost moves with the sales forecast automatically.
 *
 * Two views of the same rows: ACCRUAL (what the P&L books each month) and CASH (what
 * actually leaves the bank, per each plan's Paid = monthly / quarterly setting — the Cash
 * Flow projection's Bonuses row uses this). Month cells are read-only: derived, not typed.
 *
 * `scope` ('existing' | 'planned') restricts which people this instance shows/adds —
 * both instances read/write the SAME `bonuses` array via onChange.
 */
export function BonusCard({ bonuses, roster, assumptions, months, todayIso, onChange, scope = 'all', drivers }) {
  const rosterById = Object.fromEntries(roster.map((e) => [e.id, e]));
  const [view, setView] = useState('accrual');
  const [openDetails, setOpenDetails] = useState(new Set());

  const scopedBonuses = bonuses.filter((b) => {
    if (scope === 'all') return true;
    const employee = rosterById[b.employeeId];
    const isRamp = !!employee?.isRamp;
    return scope === 'planned' ? isRamp : !isRamp;
  });
  const scopedRoster = roster.filter((e) => (scope === 'planned' ? e.isRamp : scope === 'existing' ? !e.isRamp : true));

  const flow = view === 'cash' ? bonusCashFlow : bonusMonthlyFlow;

  function toggleDetails(id) {
    setOpenDetails((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function updateBonus(id, patch) {
    onChange(bonuses.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }

  function removeBonus(id) {
    // No confirm() dialog (2026-08-20, Kayee: "i dont want no pop up when i delete stuff").
    onChange(bonuses.filter((b) => b.id !== id));
  }

  function addBonus(employeeId) {
    if (!employeeId) return;
    const id = generateId('bonus');
    onChange([
      ...bonuses,
      { id, employeeId, type: 'fixed', bonusAmount: 0, payout: 'monthly', startDate: '', endDate: '', monthlyOverrides: {} },
    ]);
    setOpenDetails((prev) => new Set(prev).add(id));
  }

  function changeType(bonus, type) {
    // Sensible defaults from the Sept 2026 conversations so a new plan isn't a wall of zeros.
    const defaults = {
      fixed: { bonusAmount: bonus.bonusAmount || 0, payout: 'monthly' },
      milestone: { amountPerMilestone: 1000, campaignsPerMilestone: 55, sharePct: bonus.sharePct ?? 20, payout: 'monthly' },
      perMeeting: { amountPerMeeting: 100, sharePct: bonus.sharePct ?? 20, payout: 'monthly' },
      quarterly: { amountPerQuarter: 10000, payout: 'quarterly' },
    }[type];
    updateBonus(bonus.id, { type, ...defaults });
  }

  function field(label, child) {
    return (
      <label className="pr-details-field">
        <span>{label}</span>
        {child}
      </label>
    );
  }

  function detailsFor(bonus) {
    const type = bonusTypeOf(bonus);
    return (
      <div className="pr-details-grid">
        {type === 'fixed' &&
          field('Annual bonus $', <MonthInput value={bonus.bonusAmount} onCommit={(n) => updateBonus(bonus.id, { bonusAmount: n })} />)}
        {type === 'quarterly' &&
          field('$ per quarter', <MonthInput value={bonus.amountPerQuarter} onCommit={(n) => updateBonus(bonus.id, { amountPerQuarter: n })} />)}
        {type === 'milestone' && (
          <>
            {field('$ per milestone', <MonthInput value={bonus.amountPerMilestone} onCommit={(n) => updateBonus(bonus.id, { amountPerMilestone: n })} />)}
            {field('Campaigns per milestone', <MonthInput value={bonus.campaignsPerMilestone} onCommit={(n) => updateBonus(bonus.id, { campaignsPerMilestone: n })} />)}
            {field('% of team campaigns', <MonthInput value={bonus.sharePct} onCommit={(n) => updateBonus(bonus.id, { sharePct: Math.max(0, Math.min(100, n)) })} />)}
          </>
        )}
        {type === 'perMeeting' && (
          <>
            {field('$ per meeting', <MonthInput value={bonus.amountPerMeeting} onCommit={(n) => updateBonus(bonus.id, { amountPerMeeting: n })} />)}
            {field('% of team meetings', <MonthInput value={bonus.sharePct} onCommit={(n) => updateBonus(bonus.id, { sharePct: Math.max(0, Math.min(100, n)) })} />)}
          </>
        )}
        {field('Plan start (optional)', <DateInput value={bonus.startDate} onCommit={(v) => updateBonus(bonus.id, { startDate: v })} />)}
        {field('Plan end (optional)', <DateInput value={bonus.endDate} onCommit={(v) => updateBonus(bonus.id, { endDate: v })} />)}
        <div className="pr-details-note">
          {type === 'fixed' && 'Accrues Annual $ × Bonus Attainment % ÷ 12 while the person is on payroll (and within the plan dates).'}
          {type === 'quarterly' && 'Accrues ÷ 3 each month on the P&L; with Paid = Quarterly the cash lands in Mar / Jun / Sep / Dec.'}
          {type === 'milestone' &&
            `Projected campaigns that month (Customer tab) × % share ÷ campaigns-per-milestone × $ × Milestone Hit Rate (${
              assumptions.milestoneHitRate == null ? 90 : assumptions.milestoneHitRate
            }%, in Payroll Assumptions).`}
          {type === 'perMeeting' && 'Projected meetings that month (Customer tab) × % share × $ per meeting — only for campaigns this person worked on.'}
          {' '}Plan dates bound this plan only; the person's own roster dates always apply too.
        </div>
      </div>
    );
  }

  const rows = scopedBonuses.map((bonus) => {
    const employee = rosterById[bonus.employeeId];
    const type = bonusTypeOf(bonus);
    const monthCells = {};
    for (const iso of months) {
      monthCells[iso] = formatPayrollAmount(flow(bonus, employee, iso, assumptions, drivers));
    }
    const target = annualBonusTarget(bonus);
    return {
      id: bonus.id,
      monthCells,
      isExpanded: openDetails.has(bonus.id),
      expandedContent: detailsFor(bonus),
      cells: {
        actions: (
          <div className="pr-row-actions">
            <button
              type="button"
              className={`icon-btn${openDetails.has(bonus.id) ? ' is-active' : ''}`}
              title={openDetails.has(bonus.id) ? 'Hide plan details' : 'Edit plan details'}
              onClick={() => toggleDetails(bonus.id)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
            </button>
            <button type="button" className="icon-btn" title="Remove this plan" onClick={() => removeBonus(bonus.id)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0l-1 14a2 2 0 01-2 2H7a2 2 0 01-2-2L4 6" />
              </svg>
            </button>
          </div>
        ),
        name: employee ? (
          <span className="pr-name-cell pr-nowrap-cell" title={employee.name}>
            {employee.name}
            {employee.isRamp && <span className="pr-ramp-badge">Ramp</span>}
          </span>
        ) : (
          <span className="pr-missing">Removed from roster</span>
        ),
        type: (
          <select className="pr-input pr-select" value={type} onChange={(e) => changeType(bonus, e.target.value)}>
            {BONUS_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        ),
        payout: (
          <select
            className="pr-input pr-select"
            value={bonus.payout || (type === 'quarterly' ? 'quarterly' : 'monthly')}
            onChange={(e) => updateBonus(bonus.id, { payout: e.target.value })}
            title="When the cash actually goes out — Monthly = same month it's earned; Quarterly = lump in Mar/Jun/Sep/Dec"
          >
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
          </select>
        ),
        summary: (
          <span className="pr-nowrap-cell pr-row-summary" title={describeBonus(bonus)}>
            {describeBonus(bonus)}
            {target != null && target > 0 ? ` · ${formatPayrollAmount(target)}/yr` : ''}
          </span>
        ),
      },
    };
  });

  const totalRow = {
    cells: { name: <b>TOTAL</b> },
    monthCells: Object.fromEntries(
      months.map((iso) => {
        const sum = scopedBonuses.reduce((acc, b) => acc + flow(b, rosterById[b.employeeId], iso, assumptions, drivers), 0);
        return [iso, <b key={iso}>{formatPayrollAmount(sum) || '$0'}</b>];
      })
    ),
  };

  const peopleCount = new Set(scopedBonuses.map((b) => b.employeeId)).size;

  return (
    <PayrollTable
      title="Bonus"
      subtitle={`${scopedBonuses.length} plan${scopedBonuses.length === 1 ? '' : 's'} · ${peopleCount} ${
        scope === 'planned' ? (peopleCount === 1 ? 'role' : 'roles') : 'people'
      } · ${view === 'cash' ? 'Cash paid out' : 'P&L accrual'}`}
      tintForecast={false}
      frozenColumns={FROZEN_COLUMNS}
      months={months}
      todayIso={todayIso}
      totalRow={totalRow}
      rowGroups={[{ key: 'all', label: null, rows }]}
      headActions={
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div className="seg">
            <button type="button" className={view === 'accrual' ? 'active' : undefined} onClick={() => setView('accrual')}>
              Accrual
            </button>
            <button type="button" className={view === 'cash' ? 'active' : undefined} onClick={() => setView('cash')}>
              Cash
            </button>
          </div>
          <select className="pr-input pr-select pr-add-bonus" value="" onChange={(e) => addBonus(e.target.value)}>
            <option value="">+ Add plan for…</option>
            {scopedRoster.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name || '(unnamed)'}
              </option>
            ))}
          </select>
        </div>
      }
    />
  );
}
