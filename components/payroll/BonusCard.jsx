'use client';

import { useState } from 'react';
import {
  BONUS_TYPES,
  activeBonusHeadcount,
  bonusCashFlow,
  bonusMonthlyFlow,
  bonusTypeOf,
  describeBonus,
  explainBonus,
  formatPayrollAmount,
  generateId,
  resolveBonusDrivers,
} from '../../lib/payroll/payrollData';
import { DateInput, MonthInput, PayrollTable, TextInput } from './PayrollTable';

/**
 * Bonus — ONE ROW PER PERSON, grouped into sections by bonus plan (2026-09-15 v3,
 * Kayee: "go back to the version where you have each person listed out, and then put
 * them into different groups").
 *
 * How to read it:
 *   ▸ Section band = a bonus PLAN, e.g. "Campaign Coordinators — $1,000 per 55
 *     campaigns each + $100 per meeting · paid monthly". The terms live in the band.
 *     Everyone under the band is on that plan — that's the whole rule. Adding a person
 *     to the Coordinators section IS what gives them the $1,000-per-55 bonus.
 *   ▸ Rows = people: Name · Role · which plan they're on (a dropdown — pick a different
 *     plan and they move sections) · their projected bonus per month.
 *   ▸ "Edit terms" on a band opens that plan's editor rows (type, $, per, share, paid,
 *     dates). Closed by default so the card stays a clean people list.
 *   ▸ For campaign-driven plans a muted "campaigns / person" line under the band shows
 *     the number each person is being measured on (from the Customer tab's deals).
 *
 * Data: `bonuses` = plan components (lib/payroll/payrollData.js — BONUS_TYPES,
 * bonusMonthlyFlow). Components sharing a `groupLabel` form one plan; `memberIds` on
 * every component of the plan lists who's on it. Accrual/Cash toggle: what the P&L
 * books vs. what leaves the bank per the plan's Paid setting.
 */
const FROZEN_COLUMNS = [
  { key: 'actions', label: '', width: 52 },
  { key: 'name', label: 'Name', width: 200 },
  { key: 'role', label: 'Role', width: 160 },
  { key: 'plan', label: 'Bonus plan', width: 220 },
];

const PAYOUT_LABEL = { monthly: 'paid monthly', quarterly: 'paid quarterly' };

export function BonusCard({ bonuses, roster, assumptions, months, todayIso, onChange, scope = 'all', drivers }) {
  const rosterById = Object.fromEntries(roster.map((e) => [e.id, e]));
  const inScope = (emp) => (scope === 'planned' ? !!emp?.isRamp : scope === 'existing' ? !emp?.isRamp : true);
  const [view, setView] = useState('accrual');
  const [editing, setEditing] = useState(new Set()); // group labels with terms editor open
  const flow = view === 'cash' ? bonusCashFlow : bonusMonthlyFlow;
  const d = resolveBonusDrivers(drivers);
  const hasCampaignData = Object.values(d.campaignsByMonth).some((v) => Number(v) > 0);

  // ---- plans (groups) ----
  const groups = [];
  const byLabel = new Map();
  for (const plan of bonuses) {
    const label = plan.groupLabel || 'Other';
    if (!byLabel.has(label)) {
      byLabel.set(label, { label, plans: [] });
      groups.push(byLabel.get(label));
    }
    byLabel.get(label).plans.push(plan);
  }
  const membersOf = (g) => [...new Set(g.plans.flatMap((p) => p.memberIds || []))];
  const groupOf = (employeeId) => groups.find((g) => membersOf(g).includes(employeeId));

  function setPlans(next) {
    onChange(next);
  }
  function updatePlan(id, patch) {
    setPlans(bonuses.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }
  function renameGroup(label, next) {
    if (!next || next === label) return;
    setPlans(bonuses.map((b) => ((b.groupLabel || 'Other') === label ? { ...b, groupLabel: next } : b)));
  }
  function removeComponent(id) {
    setPlans(bonuses.filter((b) => b.id !== id));
  }
  function addComponent(label, memberIds) {
    setPlans([
      ...bonuses,
      { id: generateId('plan'), groupLabel: label, memberIds: [...memberIds], type: 'fixed', amount: 0, per: 0, sharePct: 100, payout: 'monthly', startDate: '', endDate: '' },
    ]);
  }
  /** Move a person onto a plan (removing them from whichever plan they were on). */
  function assignPerson(employeeId, label) {
    setPlans(
      bonuses.map((b) => {
        const isTarget = (b.groupLabel || 'Other') === label;
        const has = (b.memberIds || []).includes(employeeId);
        if (isTarget && !has) return { ...b, memberIds: [...(b.memberIds || []), employeeId] };
        if (!isTarget && has) return { ...b, memberIds: b.memberIds.filter((id) => id !== employeeId) };
        return b;
      })
    );
  }
  function removePerson(employeeId) {
    setPlans(bonuses.map((b) => ((b.memberIds || []).includes(employeeId) ? { ...b, memberIds: b.memberIds.filter((id) => id !== employeeId) } : b)));
  }
  function addGroup() {
    const label = `New plan ${groups.length + 1}`;
    addComponent(label, []);
    setEditing((prev) => new Set(prev).add(label));
  }
  function toggleEditing(label) {
    setEditing((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }
  function changeType(plan, type) {
    const defaults = {
      milestone: { amount: 1000, per: 55 },
      teamMilestone: { amount: 1000, per: plan.per || 0 },
      perMeeting: { amount: 100, per: 0 },
      fixed: { amount: plan.amount || 0, per: 0 },
      quarterly: { amount: 10000, per: 0, payout: 'quarterly' },
    }[type];
    updatePlan(plan.id, { type, ...defaults });
  }

  const usesPer = (t) => t === 'milestone' || t === 'teamMilestone';
  const usesShare = (t) => t === 'milestone' || t === 'perMeeting';
  const trashIcon = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0l-1 14a2 2 0 01-2 2H7a2 2 0 01-2-2L4 6" />
    </svg>
  );

  /** One-line, human terms for a plan's band: "$1,000 per 55 campaigns each + $100 per meeting · paid monthly". */
  function termsLine(g) {
    const parts = g.plans.map((p) => describeBonus(p));
    const payouts = [...new Set(g.plans.map((p) => p.payout || (bonusTypeOf(p) === 'quarterly' ? 'quarterly' : 'monthly')))];
    return `${parts.join(' + ')}${parts.length ? ' · ' : ''}${payouts.map((x) => PAYOUT_LABEL[x]).join(' / ')}`;
  }

  // ---- rows ----
  const rowGroups = [];
  const unassigned = roster.filter((e) => inScope(e) && !groupOf(e.id));

  for (const g of groups) {
    const ids = membersOf(g);
    const people = ids.map((id) => rosterById[id]).filter((e) => e && inScope(e));
    if (people.length === 0 && (scope === 'planned' || bonuses.length === 0)) continue;
    const rows = [];
    const isEditing = editing.has(g.label);

    // Terms editor — one full-width panel under a single "Plan terms" row, only while
    // editing. One block per part of the plan (a coordinator plan has two parts:
    // milestone + per-meeting), each a row of small labelled fields.
    if (isEditing) {
      rows.push({
        id: `edit_${g.label}`,
        className: 'pr-plan-row',
        monthCells: {},
        isExpanded: true,
        expandedContent: (
          <div className="pr-terms-editor">
            {g.plans.map((p) => {
              const t = bonusTypeOf(p);
              const payout = p.payout || (t === 'quarterly' ? 'quarterly' : 'monthly');
              return (
                <div key={p.id} className="pr-terms-part">
                  <div className="pr-terms-fields">
                    <label>
                      <span>Type</span>
                      <select className="pr-input pr-select pr-terms-type" value={t} onChange={(e) => changeType(p, e.target.value)}>
                        {BONUS_TYPES.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>$</span>
                      <MonthInput value={p.amount} onCommit={(n) => updatePlan(p.id, { amount: n })} />
                    </label>
                    {usesPer(t) && (
                      <label>
                        <span>{t === 'teamMilestone' ? 'per team campaigns' : 'per campaigns each'}</span>
                        <MonthInput value={p.per} onCommit={(n) => updatePlan(p.id, { per: n })} />
                      </label>
                    )}
                    {usesShare(t) && (
                      <label title="What % of the company's projected campaigns / meetings this plan's people handle — split evenly among them">
                        <span>share of company %</span>
                        <MonthInput value={p.sharePct == null ? 100 : p.sharePct} onCommit={(n) => updatePlan(p.id, { sharePct: Math.max(0, Math.min(100, n)) })} />
                      </label>
                    )}
                    <label>
                      <span>Paid</span>
                      <select className="pr-input pr-select" value={payout} onChange={(e) => updatePlan(p.id, { payout: e.target.value })}>
                        <option value="monthly">Monthly</option>
                        <option value="quarterly">Quarterly</option>
                      </select>
                    </label>
                    <label>
                      <span>From</span>
                      <DateInput value={p.startDate} onCommit={(v) => updatePlan(p.id, { startDate: v })} placeholder="open" />
                    </label>
                    <label>
                      <span>Until</span>
                      <DateInput value={p.endDate} onCommit={(v) => updatePlan(p.id, { endDate: v })} placeholder="open" />
                    </label>
                    <button type="button" className="icon-btn" title="Remove this part of the plan" onClick={() => removeComponent(p.id)} style={{ alignSelf: 'flex-end' }}>
                      {trashIcon}
                    </button>
                  </div>
                  <div className="pr-terms-explain">{explainBonus(p, assumptions)}</div>
                </div>
              );
            })}
            <button type="button" className="pr-mini-btn" onClick={() => addComponent(g.label, ids)}>
              + Add another part (e.g. coordinators = milestone part + per-meeting part)
            </button>
          </div>
        ),
        cells: {
          name: <span className="pr-read-cell pr-driver-label">Plan terms</span>,
          role: <span className="pr-read-cell pr-driver-note">editing — click Done on the band when finished</span>,
        },
      });
    }

    // Driver line for campaign plans: what each person is measured on.
    const campaignPart = g.plans.find((p) => usesPer(bonusTypeOf(p)));
    if (campaignPart) {
      const t = bonusTypeOf(campaignPart);
      const share = (Number(campaignPart.sharePct == null ? 100 : campaignPart.sharePct) || 0) / 100;
      const monthCells = {};
      for (const iso of months) {
        const total = Number(d.campaignsByMonth[iso]) || 0;
        const heads = activeBonusHeadcount(campaignPart, roster, iso);
        const v = t === 'teamMilestone' ? total : heads > 0 ? (total * share) / heads : 0;
        monthCells[iso] = <span className="pr-driver-val">{v > 0 ? Math.round(v).toLocaleString('en-US') : ''}</span>;
      }
      rows.push({
        id: `drv_${g.label}`,
        className: 'pr-driver-row',
        monthCells,
        cells: {
          name: <span className="pr-read-cell pr-driver-label">{t === 'teamMilestone' ? 'campaigns · team total' : 'campaigns · per person'}</span>,
          role: (
            <span className="pr-read-cell pr-driver-note">
              {hasCampaignData ? 'from Customer tab deals' : 'no deals in Customer tab yet → bonus $0'}
            </span>
          ),
        },
      });
    }

    // People
    for (const emp of people) {
      const monthCells = {};
      for (const iso of months) {
        const sum = g.plans.reduce((a, p) => a + flow(p, emp, iso, assumptions, drivers, roster), 0);
        monthCells[iso] = formatPayrollAmount(sum);
      }
      rows.push({
        id: `p_${emp.id}`,
        monthCells,
        cells: {
          actions: (
            <div className="pr-row-actions">
              <button type="button" className="icon-btn" title="Remove bonus for this person" onClick={() => removePerson(emp.id)}>
                {trashIcon}
              </button>
            </div>
          ),
          name: (
            <span className="pr-name-cell pr-nowrap-cell" title={emp.name}>
              {emp.name || <i className="pr-comp-noname">(unnamed)</i>}
              {emp.isRamp && <span className="pr-ramp-badge">Ramp</span>}
            </span>
          ),
          role: (
            <span className="pr-read-cell pr-nowrap-cell" title={emp.title}>
              {emp.title || <i className="pr-comp-noname">no title</i>}
            </span>
          ),
          plan: (
            <select className="pr-input pr-select" value={g.label} onChange={(e) => assignPerson(emp.id, e.target.value)} title="Move this person to a different plan">
              {groups.map((x) => (
                <option key={x.label} value={x.label}>
                  {x.label}
                </option>
              ))}
            </select>
          ),
        },
      });
    }
    if (people.length === 0) {
      rows.push({
        id: `empty_${g.label}`,
        monthCells: {},
        cells: { name: <i className="pr-comp-noname">Nobody on this plan — pick it in someone's "Bonus plan" dropdown</i> },
      });
    }

    const label = (
      <span className="pr-group-band">
        {isEditing ? (
          <span onClick={(e) => e.stopPropagation()}>
            <TextInput value={g.label} placeholder="Plan name" onCommit={(v) => renameGroup(g.label, v)} />
          </span>
        ) : (
          <span className="pr-group-band-name">{g.label}</span>
        )}
        <span className="pr-group-band-terms" title={g.plans.map((p) => explainBonus(p, assumptions)).join('\n')}>
          {termsLine(g)}
        </span>
        <span className="pr-group-band-actions" onClick={(e) => e.stopPropagation()}>
          <button type="button" className={`pr-mini-btn${isEditing ? ' is-active' : ''}`} onClick={() => toggleEditing(g.label)}>
            {isEditing ? 'Done' : 'Edit terms'}
          </button>
        </span>
      </span>
    );
    rowGroups.push({ key: g.label, label, rows });
  }

  // People with no bonus plan yet — listed so nobody is forgotten; pick a plan to move them.
  if (unassigned.length > 0) {
    rowGroups.push({
      key: '__none',
      label: (
        <span className="pr-group-band">
          <span className="pr-group-band-name">No bonus</span>
          <span className="pr-group-band-terms">pick a plan in the dropdown to add one</span>
        </span>
      ),
      rowModifier: 'pr-dismissed',
      rows: unassigned.map((emp) => ({
        id: `u_${emp.id}`,
        monthCells: {},
        cells: {
          name: (
            <span className="pr-name-cell pr-nowrap-cell" title={emp.name}>
              {emp.name || <i className="pr-comp-noname">(unnamed)</i>}
              {emp.isRamp && <span className="pr-ramp-badge">Ramp</span>}
            </span>
          ),
          role: (
            <span className="pr-read-cell pr-nowrap-cell" title={emp.title}>
              {emp.title || <i className="pr-comp-noname">no title</i>}
            </span>
          ),
          plan: (
            <select className="pr-input pr-select" value="" onChange={(e) => e.target.value && assignPerson(emp.id, e.target.value)}>
              <option value="">— none —</option>
              {groups.map((x) => (
                <option key={x.label} value={x.label}>
                  {x.label}
                </option>
              ))}
            </select>
          ),
        },
      })),
    });
  }

  const totalRow = {
    cells: { name: <b>TOTAL</b> },
    monthCells: Object.fromEntries(
      months.map((iso) => {
        let sum = 0;
        for (const g of groups) {
          for (const id of membersOf(g)) {
            const emp = rosterById[id];
            if (emp && inScope(emp)) for (const p of g.plans) sum += flow(p, emp, iso, assumptions, drivers, roster);
          }
        }
        return [iso, <b key={iso}>{formatPayrollAmount(sum) || '$0'}</b>];
      })
    ),
  };

  const peopleCount = new Set(groups.flatMap(membersOf).filter((id) => inScope(rosterById[id]))).size;

  return (
    <PayrollTable
      title="Bonus"
      subtitle={`${peopleCount} ${scope === 'planned' ? 'planned role' : 'people'}${scope === 'planned' && peopleCount !== 1 ? 's' : ''} on ${groups.length} plan${
        groups.length === 1 ? '' : 's'
      } · ${view === 'cash' ? 'cash paid out' : 'P&L accrual'} · milestone hit rate ${assumptions.milestoneHitRate == null ? 90 : assumptions.milestoneHitRate}%`}
      tintForecast={false}
      frozenColumns={FROZEN_COLUMNS}
      months={months}
      todayIso={todayIso}
      totalRow={totalRow}
      rowGroups={rowGroups}
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
          <button type="button" className="btn" onClick={addGroup}>
            + New plan
          </button>
        </div>
      }
    />
  );
}
