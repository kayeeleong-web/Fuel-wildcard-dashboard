'use client';

import { useState } from 'react';
import {
  BONUS_TYPES,
  activeBonusHeadcount,
  bonusCashFlow,
  bonusMonthlyFlow,
  bonusPlanCashTotal,
  bonusPlanMonthlyTotal,
  bonusTypeOf,
  describeBonus,
  explainBonus,
  formatPayrollAmount,
  generateId,
} from '../../lib/payroll/payrollData';
import { DateInput, MonthInput, PayrollTable, TextInput } from './PayrollTable';

/**
 * Bonus — plans per ROLE GROUP (2026-09-15 redesign, Kayee: "group people based on their
 * title... you don't have to edit each one of them that way", "I like the mechanism you
 * have for employee, apply the same for bonus", "when you move people from employee to
 * bonus, bring their titles too").
 *
 * Layout mirrors RosterCard's Excel-style grouped columns: a [+]/[−] toggle in the
 * column header swaps a compact READ-ONLY view (Plan · Terms · Paid, aligned) for the
 * inline editors (Plan type, $, Per, Share %, Paid, Start, End). No per-row pencil, no
 * panel under the row.
 *
 * Rows, per group:
 *   ▸ Group header   — group name (editable), member count, the group's monthly total.
 *     Plan rows      — one per component (e.g. Individual milestone $1,000 per 55
 *                      campaigns; Per meeting $100), each with its own monthly total.
 *     Member rows    — each person (name · roster title) with THEIR share, so a
 *                      coordinator's row reads as their actual projected bonus.
 * Where the math lives: lib/payroll/payrollData.js (BONUS_TYPES + bonusMonthlyFlow).
 * Campaign-linked plans read the Customer tab's projected campaigns/meetings per month.
 *
 * Accrual / Cash toggle: what the P&L books vs. what leaves the bank per each plan's
 * Paid setting (monthly = same month; quarterly = Mar/Jun/Sep/Dec lump).
 *
 * `scope` ('existing' | 'planned') filters which MEMBERS are shown/summed (real people
 * vs. Hiring Plan ramp roles); plans themselves are shared — both instances write the
 * same `bonuses` array.
 */
const BASE_COLUMNS = [
  { key: 'actions', label: '', width: 72 },
  { key: 'name', label: 'Group / Person', width: 220 },
  { key: 'role', label: 'Role', width: 140 },
];
const COMPACT_COLUMNS = [
  { key: 'planRead', label: 'Plan', width: 150 },
  { key: 'termsRead', label: 'Terms', width: 200 },
  { key: 'paidRead', label: 'Paid', width: 74 },
];
const EXPANDED_COLUMNS = [
  { key: 'type', label: 'Plan', width: 160 },
  { key: 'amount', label: '$', width: 88, align: 'right' },
  { key: 'per', label: 'Per (campaigns)', width: 104, align: 'right' },
  { key: 'sharePct', label: 'Share %', width: 72, align: 'right' },
  { key: 'payout', label: 'Paid', width: 104 },
  { key: 'startDate', label: 'Plan start', width: 108 },
  { key: 'endDate', label: 'Plan end', width: 108 },
];

const PAYOUT_LABEL = { monthly: 'Monthly', quarterly: 'Quarterly' };

export function BonusCard({ bonuses, roster, assumptions, months, todayIso, onChange, scope = 'all', drivers }) {
  const rosterById = Object.fromEntries(roster.map((e) => [e.id, e]));
  const inScope = (emp) => (scope === 'planned' ? !!emp?.isRamp : scope === 'existing' ? !emp?.isRamp : true);
  const [view, setView] = useState('accrual');
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState(new Set());

  const flow = view === 'cash' ? bonusCashFlow : bonusMonthlyFlow;
  const planTotal = view === 'cash' ? bonusPlanCashTotal : bonusPlanMonthlyTotal;

  // Group plans by label, preserving first-seen order. Only groups with at least one
  // in-scope member (or no members at all, so an empty new group is still visible on
  // the Existing card) render in this instance.
  const groups = [];
  const byLabel = new Map();
  for (const plan of bonuses) {
    const label = plan.groupLabel || 'Ungrouped';
    if (!byLabel.has(label)) {
      byLabel.set(label, { label, plans: [] });
      groups.push(byLabel.get(label));
    }
    byLabel.get(label).plans.push(plan);
  }
  const visibleGroups = groups.filter((g) => {
    const members = new Set(g.plans.flatMap((p) => p.memberIds || []));
    if (members.size === 0) return scope !== 'planned';
    return [...members].some((id) => inScope(rosterById[id]));
  });

  function updatePlan(id, patch) {
    onChange(bonuses.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }
  function updateGroup(label, patch) {
    onChange(bonuses.map((b) => ((b.groupLabel || 'Ungrouped') === label ? { ...b, ...patch } : b)));
  }
  function removePlan(id) {
    onChange(bonuses.filter((b) => b.id !== id)); // no confirm() (2026-08-20 rule)
  }
  function addPlanToGroup(group) {
    const template = group.plans[0];
    onChange([
      ...bonuses,
      {
        id: generateId('plan'),
        groupLabel: group.label,
        memberIds: [...(template?.memberIds || [])],
        type: 'fixed',
        amount: 0,
        per: 0,
        sharePct: 100,
        payout: 'monthly',
        startDate: '',
        endDate: '',
      },
    ]);
    setDetailsExpanded(true);
  }
  function addGroup() {
    const label = `New group ${groups.length + 1}`;
    onChange([
      ...bonuses,
      { id: generateId('plan'), groupLabel: label, memberIds: [], type: 'fixed', amount: 0, per: 0, sharePct: 100, payout: 'monthly', startDate: '', endDate: '' },
    ]);
    setDetailsExpanded(true);
  }
  function addMember(group, employeeId) {
    if (!employeeId) return;
    onChange(bonuses.map((b) => ((b.groupLabel || 'Ungrouped') === group.label && !(b.memberIds || []).includes(employeeId) ? { ...b, memberIds: [...(b.memberIds || []), employeeId] } : b)));
  }
  function removeMember(group, employeeId) {
    onChange(bonuses.map((b) => ((b.groupLabel || 'Ungrouped') === group.label ? { ...b, memberIds: (b.memberIds || []).filter((id) => id !== employeeId) } : b)));
  }
  function changeType(plan, type) {
    const defaults = {
      milestone: { amount: 1000, per: 55, payout: 'monthly' },
      teamMilestone: { amount: 1000, per: plan.per || 0, payout: 'monthly' },
      perMeeting: { amount: 100, per: 0, payout: 'monthly' },
      fixed: { amount: plan.amount || 0, per: 0, payout: 'monthly' },
      quarterly: { amount: 10000, per: 0, payout: 'quarterly' },
    }[type];
    updatePlan(plan.id, { type, ...defaults });
  }
  function toggleGroupCollapsed(label) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  const usesPer = (type) => type === 'milestone' || type === 'teamMilestone';
  const usesShare = (type) => type === 'milestone' || type === 'perMeeting';

  const trashIcon = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0l-1 14a2 2 0 01-2 2H7a2 2 0 01-2-2L4 6" />
    </svg>
  );

  const rows = [];
  for (const group of visibleGroups) {
    const memberIds = [...new Set(group.plans.flatMap((p) => p.memberIds || []))];
    const members = memberIds.map((id) => rosterById[id]).filter((e) => e && inScope(e));
    const collapsed = collapsedGroups.has(group.label);
    const addable = roster.filter((e) => inScope(e) && !memberIds.includes(e.id));

    // ---- group header ----
    const groupCells = {};
    for (const iso of months) {
      const sum = group.plans.reduce((acc, p) => acc + members.reduce((a, m) => a + flow(p, m, iso, assumptions, drivers, roster), 0), 0);
      groupCells[iso] = <b key={iso}>{formatPayrollAmount(sum) || '$0'}</b>;
    }
    rows.push({
      id: `group_${group.label}`,
      className: 'pr-comp-group-row',
      monthCells: groupCells,
      cells: {
        actions: (
          <div className="pr-row-actions">
            <button type="button" className="icon-btn pr-comp-expand-toggle" onClick={() => toggleGroupCollapsed(group.label)} title={collapsed ? 'Show plans & people' : 'Hide plans & people'}>
              <span className={`pr-comp-chevron${collapsed ? '' : ' open'}`}>▸</span>
            </button>
            <button type="button" className="icon-btn" title="Add another plan to this group" onClick={() => addPlanToGroup(group)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </div>
        ),
        name: detailsExpanded ? (
          <TextInput value={group.label} placeholder="Group name" onCommit={(v) => v && updateGroup(group.label, { groupLabel: v })} />
        ) : (
          <span className="pr-comp-group-name pr-nowrap-cell" title={group.label}>
            {group.label} <span className="pr-comp-count">({members.length})</span>
          </span>
        ),
        role: addable.length > 0 && (
          <select className="pr-input pr-select pr-add-bonus" value="" onChange={(e) => addMember(group, e.target.value)} title="Add a person to this group">
            <option value="">+ Add person…</option>
            {addable.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name || '(unnamed)'}
              </option>
            ))}
          </select>
        ),
      },
    });
    if (collapsed) continue;

    // ---- plan rows ----
    for (const plan of group.plans) {
      const type = bonusTypeOf(plan);
      const monthCells = {};
      for (const iso of months) {
        const sum = members.reduce((a, m) => a + flow(plan, m, iso, assumptions, drivers, roster), 0);
        monthCells[iso] = <span className="pr-plan-total">{formatPayrollAmount(sum)}</span>;
      }
      const payout = plan.payout || (type === 'quarterly' ? 'quarterly' : 'monthly');
      const typeLabel = BONUS_TYPES.find((t) => t.id === type)?.label || type;
      rows.push({
        id: plan.id,
        className: 'pr-plan-row',
        monthCells,
        cells: {
          actions: (
            <div className="pr-row-actions">
              <button type="button" className="icon-btn" title="Remove this plan" onClick={() => removePlan(plan.id)}>
                {trashIcon}
              </button>
            </div>
          ),
          name: <span className="pr-read-cell pr-plan-label" title={explainBonus(plan, assumptions)}>↳ {typeLabel}</span>,
          role: null,
          // compact
          planRead: <span className="pr-read-cell">{typeLabel}</span>,
          termsRead: (
            <span className="pr-read-cell pr-nowrap-cell" title={explainBonus(plan, assumptions)}>
              {describeBonus(plan)}
              {usesShare(type) && (plan.sharePct == null ? 100 : plan.sharePct) !== 100 ? ` · ${plan.sharePct}% share` : ''}
            </span>
          ),
          paidRead: <span className="pr-read-cell">{PAYOUT_LABEL[payout]}</span>,
          // expanded
          type: (
            <select className="pr-input pr-select" value={type} onChange={(e) => changeType(plan, e.target.value)}>
              {BONUS_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          ),
          amount: <MonthInput value={plan.amount} onCommit={(n) => updatePlan(plan.id, { amount: n })} />,
          per: usesPer(type) ? <MonthInput value={plan.per} onCommit={(n) => updatePlan(plan.id, { per: n })} /> : <span className="pr-read-cell pr-read-open">—</span>,
          sharePct: usesShare(type) ? (
            <MonthInput value={plan.sharePct == null ? 100 : plan.sharePct} onCommit={(n) => updatePlan(plan.id, { sharePct: Math.max(0, Math.min(100, n)) })} />
          ) : (
            <span className="pr-read-cell pr-read-open">—</span>
          ),
          payout: (
            <select className="pr-input pr-select" value={payout} onChange={(e) => updatePlan(plan.id, { payout: e.target.value })}>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
            </select>
          ),
          startDate: <DateInput value={plan.startDate} onCommit={(v) => updatePlan(plan.id, { startDate: v })} placeholder="open" />,
          endDate: <DateInput value={plan.endDate} onCommit={(v) => updatePlan(plan.id, { endDate: v })} placeholder="open" />,
        },
      });
    }

    // ---- member rows ----
    for (const emp of members) {
      const monthCells = {};
      for (const iso of months) {
        const sum = group.plans.reduce((a, p) => a + flow(p, emp, iso, assumptions, drivers, roster), 0);
        monthCells[iso] = formatPayrollAmount(sum);
      }
      rows.push({
        id: `member_${group.label}_${emp.id}`,
        className: 'pr-comp-child-row',
        monthCells,
        cells: {
          actions: (
            <div className="pr-row-actions">
              <button type="button" className="icon-btn" title="Remove from this group" onClick={() => removeMember(group, emp.id)}>
                {trashIcon}
              </button>
            </div>
          ),
          name: (
            <span className="pr-name-cell pr-nowrap-cell pr-member-name" title={emp.name}>
              {emp.name || <i className="pr-comp-noname">(unnamed)</i>}
              {emp.isRamp && <span className="pr-ramp-badge">Ramp</span>}
            </span>
          ),
          role: (
            <span className="pr-read-cell pr-nowrap-cell" title={emp.title}>
              {emp.title || <i className="pr-comp-noname">no title</i>}
            </span>
          ),
        },
      });
    }
  }

  const detailCols = detailsExpanded ? EXPANDED_COLUMNS : COMPACT_COLUMNS;
  const frozenColumns = [
    ...BASE_COLUMNS,
    ...detailCols.map((col, i) =>
      i === 0
        ? {
            ...col,
            label: (
              <button
                type="button"
                className="pr-colgroup-toggle"
                onClick={() => setDetailsExpanded((v) => !v)}
                title={detailsExpanded ? 'Collapse to Plan / Terms / Paid' : 'Expand to edit plan type, $, thresholds, share, payout, dates'}
              >
                <span className="pr-colgroup-toggle-icon">{detailsExpanded ? '−' : '+'}</span>
                {col.label}
              </button>
            ),
          }
        : col
    ),
  ];

  const totalRow = {
    cells: { name: <b>TOTAL</b> },
    monthCells: Object.fromEntries(
      months.map((iso) => {
        let sum = 0;
        for (const g of visibleGroups) {
          const ids = [...new Set(g.plans.flatMap((p) => p.memberIds || []))];
          for (const p of g.plans) for (const id of ids) {
            const emp = rosterById[id];
            if (emp && inScope(emp)) sum += flow(p, emp, iso, assumptions, drivers, roster);
          }
        }
        return [iso, <b key={iso}>{formatPayrollAmount(sum) || '$0'}</b>];
      })
    ),
  };

  const peopleCount = new Set(visibleGroups.flatMap((g) => g.plans.flatMap((p) => p.memberIds || [])).filter((id) => inScope(rosterById[id]))).size;

  return (
    <PayrollTable
      title="Bonus"
      subtitle={`${visibleGroups.length} group${visibleGroups.length === 1 ? '' : 's'} · ${peopleCount} ${scope === 'planned' ? 'planned role' : 'people'}${
        scope === 'planned' && peopleCount !== 1 ? 's' : ''
      } · ${view === 'cash' ? 'cash paid out' : 'P&L accrual'} · hit rate ${assumptions.milestoneHitRate == null ? 90 : assumptions.milestoneHitRate}%`}
      tintForecast={false}
      frozenColumns={frozenColumns}
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
          <button type="button" className="btn" onClick={addGroup}>
            + Add group
          </button>
        </div>
      }
    />
  );
}
