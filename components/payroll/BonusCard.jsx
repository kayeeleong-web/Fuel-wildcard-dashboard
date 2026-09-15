'use client';

import { useState } from 'react';
import {
  BONUS_TYPES,
  CAMPAIGN_BONUS_TYPES,
  bonusCashFlow,
  bonusMonthlyFlow,
  bonusTypeOf,
  campaignsPerPersonFor,
  describeBonus,
  explainBonus,
  formatPayrollAmount,
  generateId,
  meetingsPerPersonFor,
  resolveBonusDrivers,
} from '../../lib/payroll/payrollData';
import { DateInput, MonthInput, PayrollTable } from './PayrollTable';

/**
 * Bonus — one row per person, exactly like the Employees card (2026-09-15 v4, Kayee:
 * "keep it simple: each person's name just like the employee section, and a dropdown
 * to select how much they get per campaign or per meeting"). No expanding, no panels.
 *
 * Columns: Name · Role · Bonus type (dropdown) · $ · per campaigns · $ / meeting · Paid,
 * then the person's projected bonus per month. Only the fields a type uses are editable
 * on that row; the rest show "—". Rows are grouped into sections by type (Campaign
 * milestone + meetings / Team milestone / Fixed annual / Fixed quarterly / No bonus),
 * the way Employees is grouped Active / Planned / Dismissed. Everyone in the roster is
 * listed — pick a type to give someone a bonus, "No bonus" to remove it.
 *
 * Math: lib/payroll/payrollData.js (BONUS_TYPES, bonusMonthlyFlow). Campaign types read
 * the Customer tab's projected campaigns/meetings; the "campaigns per person" line at
 * the top of that section shows the count each coordinator is measured on.
 * Accrual / Cash toggle = P&L accrual vs. cash out per the row's Paid setting.
 *
 * `scope` ('existing' | 'planned') = real people vs. Hiring Plan ramp roles; both
 * instances write the same `bonuses` array.
 */
// Same Excel-style grouped columns as the Employees card (Kayee: "use the same collapse
// method you had in the employees section... so the controls section doesn't get too
// wide"). Compact = Bonus type (dropdown) + read-only Terms + Frequency; the [+] in the
// header swaps in the editors ($, per campaigns, $/meeting, Frequency, Start, End).
const BASE_COLUMNS = [
  { key: 'name', label: 'Name', width: 180 },
  { key: 'role', label: 'Role', width: 150 },
  { key: 'type', label: 'Bonus type', width: 208 },
];
const COMPACT_COLUMNS = [
  { key: 'termsRead', label: 'Terms', width: 196 },
  { key: 'payoutRead', label: 'Frequency', width: 80 },
];
const EXPANDED_COLUMNS = [
  { key: 'amount', label: '$', width: 84, align: 'right' },
  { key: 'per', label: 'per campaigns', width: 96, align: 'right' },
  { key: 'perMeeting', label: '$ / meeting', width: 84, align: 'right' },
  { key: 'payout', label: 'Frequency', width: 124 },
  // Bonus start/end default to the person's own roster dates (shown greyed as the
  // placeholder); typing a date here overrides just the bonus window.
  { key: 'startDate', label: 'Start', width: 104 },
  { key: 'endDate', label: 'End', width: 104 },
];

/** MM/DD/YY of a stored YYYY-MM-DD date, for the greyed default in the Start/End boxes. */
function shortDate(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr || '');
  return m ? `${m[2]}/${m[3]}/${m[1].slice(2)}` : dateStr || '';
}

const SECTIONS = [
  { type: 'coordinator', label: 'Campaign milestone + meetings' },
  { type: 'teamMilestone', label: 'Team milestone + meetings' },
  { type: 'fixed', label: 'Fixed annual' },
  { type: 'quarterly', label: 'Fixed quarterly' },
  { type: 'none', label: 'No bonus', rowModifier: 'pr-dismissed' },
];

const TYPE_DEFAULTS = {
  coordinator: { amount: 1000, per: 55, perMeeting: 100, payout: 'monthly' },
  teamMilestone: { amount: 1000, per: 0, perMeeting: 100, payout: 'monthly' },
  fixed: { amount: 0, per: 0, perMeeting: 0, payout: 'monthly' },
  quarterly: { amount: 10000, per: 0, perMeeting: 0, payout: 'quarterly' },
  none: { amount: 0, per: 0, perMeeting: 0, payout: 'monthly' },
};

export function BonusCard({ bonuses, roster, assumptions, months, todayIso, onChange, scope = 'all', drivers }) {
  const inScope = (emp) => (scope === 'planned' ? !!emp?.isRamp : scope === 'existing' ? !emp?.isRamp : true);
  const [view, setView] = useState('accrual');
  const [detailsExpanded, setDetailsExpanded] = useState(false);
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
                title={detailsExpanded ? 'Collapse to Terms / Frequency' : 'Expand to edit $, thresholds, frequency, start/end'}
              >
                <span className="pr-colgroup-toggle-icon">{detailsExpanded ? '−' : '+'}</span>
                {col.label}
              </button>
            ),
          }
        : col
    ),
  ];
  const flow = view === 'cash' ? bonusCashFlow : bonusMonthlyFlow;
  const d = resolveBonusDrivers(drivers);
  const hasCampaignData = Object.values(d.campaignsByMonth).some((v) => Number(v) > 0);

  const bonusFor = (employeeId) => bonuses.find((b) => b && b.employeeId === employeeId);

  function setType(emp, type) {
    const existing = bonusFor(emp.id);
    if (type === 'none') {
      onChange(bonuses.filter((b) => b.employeeId !== emp.id));
      return;
    }
    const row = { id: existing?.id || generateId('bonus'), employeeId: emp.id, type, ...TYPE_DEFAULTS[type] };
    onChange(existing ? bonuses.map((b) => (b.id === existing.id ? row : b)) : [...bonuses, row]);
  }
  function updateField(employeeId, patch) {
    onChange(bonuses.map((b) => (b.employeeId === employeeId ? { ...b, ...patch } : b)));
  }

  const people = roster.filter(inScope);
  const dash = <span className="pr-read-cell pr-read-open">—</span>;

  const rowGroups = SECTIONS.map((section) => {
    const members = people.filter((emp) => bonusTypeOf(bonusFor(emp.id)) === section.type);
    const rows = [];

    // Campaign sections: the counts every person in them is measured on.
    if (CAMPAIGN_BONUS_TYPES.includes(section.type) && members.length > 0) {
      const isTeam = section.type === 'teamMilestone';
      const camp = {};
      const mtg = {};
      for (const iso of months) {
        const c = isTeam ? Number(d.campaignsByMonth[iso]) || 0 : campaignsPerPersonFor(bonuses, roster, iso, drivers);
        const m = meetingsPerPersonFor(bonuses, roster, iso, drivers);
        camp[iso] = <span className="pr-driver-val">{c > 0 ? Math.round(c).toLocaleString('en-US') : ''}</span>;
        mtg[iso] = <span className="pr-driver-val">{m > 0 ? Math.round(m).toLocaleString('en-US') : ''}</span>;
      }
      const note = hasCampaignData ? 'from Customer tab' : 'no deals yet → $0';
      rows.push({
        id: `drv_c_${section.type}`,
        className: 'pr-driver-row',
        monthCells: camp,
        cells: {
          name: <span className="pr-read-cell pr-driver-label">{isTeam ? 'campaigns · team total' : 'campaigns · per person'}</span>,
          role: <span className="pr-read-cell pr-driver-note pr-nowrap-cell" title="Company projected campaigns (Customer tab deals) ÷ people on campaign plans">{note}</span>,
        },
      });
      rows.push({
        id: `drv_m_${section.type}`,
        className: 'pr-driver-row',
        monthCells: mtg,
        cells: { name: <span className="pr-read-cell pr-driver-label">meetings · per person</span> },
      });
    }

    for (const emp of members) {
      const bonus = bonusFor(emp.id);
      const type = section.type;
      const isCampaign = CAMPAIGN_BONUS_TYPES.includes(type);
      const monthCells = {};
      for (const iso of months) {
        monthCells[iso] = bonus ? formatPayrollAmount(flow(bonus, emp, iso, assumptions, drivers, roster, bonuses)) : '';
      }
      rows.push({
        id: `p_${emp.id}`,
        monthCells,
        cells: {
          actions: null,
          name: (
            <span className="pr-name-cell pr-nowrap-cell" title={bonus ? explainBonus(bonus, assumptions) : emp.name}>
              {emp.name || <i className="pr-comp-noname">(unnamed)</i>}
              {emp.isRamp && <span className="pr-ramp-badge">Ramp</span>}
            </span>
          ),
          role: (
            <span className="pr-read-cell pr-nowrap-cell" title={emp.title}>
              {emp.title || <i className="pr-comp-noname">no title</i>}
            </span>
          ),
          type: (
            <select className="pr-input pr-select" value={type} onChange={(e) => setType(emp, e.target.value)} title={bonus ? describeBonus(bonus) : 'Pick a bonus type'}>
              {BONUS_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          ),
          amount:
            type === 'none' ? dash : (
              <MonthInput
                value={bonus.amount}
                onCommit={(n) => updateField(emp.id, { amount: n })}
              />
            ),
          per: isCampaign ? <MonthInput value={bonus.per} onCommit={(n) => updateField(emp.id, { per: n })} /> : dash,
          perMeeting: isCampaign ? <MonthInput value={bonus.perMeeting} onCommit={(n) => updateField(emp.id, { perMeeting: n })} /> : dash,
          termsRead: <span className="pr-read-cell pr-nowrap-cell" title={bonus ? explainBonus(bonus, assumptions) : ''}>{bonus ? describeBonus(bonus) : '—'}</span>,
          payoutRead: <span className="pr-read-cell">{type === 'none' ? '—' : (bonus.payout || 'monthly') === 'quarterly' ? 'Quarterly' : 'Monthly'}</span>,
          startDate:
            type === 'none' ? dash : (
              <DateInput
                value={bonus.startDate || ''}
                placeholder={emp.startDate ? shortDate(emp.startDate) : 'hire date'}
                onCommit={(v) => updateField(emp.id, { startDate: v })}
              />
            ),
          endDate:
            type === 'none' ? dash : (
              <DateInput
                value={bonus.endDate || ''}
                placeholder={emp.endDate ? shortDate(emp.endDate) : 'open'}
                onCommit={(v) => updateField(emp.id, { endDate: v })}
              />
            ),
          payout:
            type === 'none' ? dash : (
              <select className="pr-input pr-select" value={bonus.payout || 'monthly'} onChange={(e) => updateField(emp.id, { payout: e.target.value })}>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
              </select>
            ),
        },
      });
    }

    const hint =
      section.type === 'coordinator'
        ? '$ every N campaigns each, + $ per meeting'
        : section.type === 'teamMilestone'
          ? '$ every N team campaigns, + $ per meeting'
          : section.type === 'fixed'
            ? '$ per year × attainment'
            : section.type === 'quarterly'
              ? '$ per quarter'
              : 'pick a type to add one';
    return {
      key: section.type,
      label: (
        <span className="pr-group-band">
          <span className="pr-group-band-name">{section.label}</span>
          <span className="pr-group-band-terms">{hint}</span>
        </span>
      ),
      rowModifier: section.rowModifier || '',
      rows,
    };
  });

  const totalRow = {
    cells: { name: <b>TOTAL</b> },
    monthCells: Object.fromEntries(
      months.map((iso) => {
        let sum = 0;
        for (const emp of people) {
          const b = bonusFor(emp.id);
          if (b) sum += flow(b, emp, iso, assumptions, drivers, roster, bonuses);
        }
        return [iso, <b key={iso}>{formatPayrollAmount(sum)}</b>];
      })
    ),
  };

  const withBonus = people.filter((emp) => bonusFor(emp.id)).length;

  return (
    <PayrollTable
      title="Bonus"
      subtitle={`${withBonus} of ${people.length} ${scope === 'planned' ? 'planned roles' : 'people'} with a bonus · ${
        view === 'cash' ? 'cash paid out' : 'P&L accrual'
      } · milestone hit rate ${assumptions.milestoneHitRate == null ? 90 : assumptions.milestoneHitRate}%`}
      tintForecast={false}
      frozenColumns={frozenColumns}
      months={months}
      todayIso={todayIso}
      totalRow={totalRow}
      rowGroups={rowGroups}
      headActions={
        <div className="seg">
          <button type="button" className={view === 'accrual' ? 'active' : undefined} onClick={() => setView('accrual')}>
            Accrual
          </button>
          <button type="button" className={view === 'cash' ? 'active' : undefined} onClick={() => setView('cash')}>
            Cash
          </button>
        </div>
      }
    />
  );
}
