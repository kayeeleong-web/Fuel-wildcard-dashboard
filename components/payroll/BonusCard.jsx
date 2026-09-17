'use client';

import { useEffect, useState } from 'react';
import {
  BONUS_TYPES,
  CAMPAIGN_BONUS_TYPES,
  bonusCashFlow,
  bonusMonthlyFlow,
  bonusTypeOf,
  campaignsPerPersonFor,
  coordinatorHeadcount,
  defaultBonusTypeForTitle,
  describeBonus,
  explainBonus,
  formatPayrollAmount,
  generateId,
  meetingsPerPersonFor,
  milestoneAchieversFor,
  milestoneModeOf,
  personKeyOf,
  resolveBonusDrivers,
} from '../../lib/payroll/payrollData';
import { csvDate, downloadCsv, todayStamp } from '../../lib/payroll/exportCsv';
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
  { key: 'type', label: 'Bonus type', width: 180 },
];
// Compact frozen block = 744px, same as Employees / Hiring Plan so month columns align.
const COMPACT_COLUMNS = [
  { key: 'termsRead', label: 'Terms', width: 170 },
  { key: 'payoutRead', label: 'Frequency', width: 64 },
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

  // ONE ROW PER PERSON (2026-09-17, Kayee: "Brennan is showing up twice... it's only one
  // person, one name should show up once"). Roster lines are grouped by personKeyOf (same
  // grouping as the Employees card); `current` = the line active today, else the newest,
  // and is what the bonus row attaches to. A person's bonus row may still point at an
  // older line from before this change — lookups match ANY of the person's line ids, and
  // the math uses person-level activity, so nothing is lost.
  const todayStr = new Date().toISOString().slice(0, 10);
  const personMap = new Map();
  for (const r of roster.filter(inScope)) {
    const key = personKeyOf(r);
    if (!personMap.has(key)) personMap.set(key, { key, lines: [] });
    personMap.get(key).lines.push(r);
  }
  const people = Array.from(personMap.values()).map((p) => {
    const lines = [...p.lines].sort((x, y) => String(y.startDate || '').localeCompare(String(x.startDate || '')));
    const current =
      lines.find((r) => r.startDate && r.startDate <= todayStr && (!r.endDate || r.endDate >= todayStr)) || lines[0];
    const dismissed = lines.every((r) => (r.employment || 'Active') === 'Dismissed');
    return { ...p, lines, current, dismissed, name: current.name, title: current.title, isRamp: !!current.isRamp };
  });
  const lineIds = (person) => new Set(person.lines.map((l) => l.id));
  const bonusFor = (person) => bonuses.find((b) => b && lineIds(person).has(b.employeeId));

  // Title default (2026-09-17, Kayee: "if title has coordinator then put them under
  // campaign milestone + meetings automatically, but if we want to override we could"):
  // anyone whose title defaults to a plan and has NO bonus row yet gets one created. A
  // stored row (including an explicit type 'none') is the override and is never touched.
  useEffect(() => {
    const additions = [];
    for (const person of people) {
      if (bonusFor(person)) continue;
      const type = defaultBonusTypeForTitle(person.title);
      if (!type) continue;
      additions.push({ id: generateId('bonus'), employeeId: person.current.id, type, ...TYPE_DEFAULTS[type], autoDefault: true });
    }
    if (additions.length) onChange([...bonuses, ...additions]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roster, bonuses]);

  function setType(person, type) {
    const existing = bonusFor(person);
    if (type === 'none') {
      // Keep an explicit 'none' row when the title would otherwise default a plan, so the
      // override sticks; otherwise just drop the row.
      if (defaultBonusTypeForTitle(person.title)) {
        const row = { id: existing?.id || generateId('bonus'), employeeId: person.current.id, type: 'none' };
        onChange(existing ? bonuses.map((b) => (b.id === existing.id ? row : b)) : [...bonuses, row]);
      } else {
        onChange(bonuses.filter((b) => !lineIds(person).has(b.employeeId)));
      }
      return;
    }
    const row = { id: existing?.id || generateId('bonus'), employeeId: person.current.id, type, ...TYPE_DEFAULTS[type] };
    onChange(existing ? bonuses.map((b) => (b.id === existing.id ? row : b)) : [...bonuses, row]);
  }
  function updateField(person, patch) {
    const ids = lineIds(person);
    onChange(bonuses.map((b) => (ids.has(b.employeeId) ? { ...b, ...patch } : b)));
  }

  const dash = <span className="pr-read-cell pr-read-open">—</span>;
  const headcountMode = milestoneModeOf(assumptions) === 'headcount';
  const hitRate = assumptions.milestoneHitRate == null ? 90 : assumptions.milestoneHitRate;

  // Dismissed people sit in their own band at the bottom, tagged, but keep their type /
  // terms editable so a mid-year leaver still accrues for the months they were here.
  const personRow = (person, section) => {
    const bonus = bonusFor(person);
    const type = section.type;
    const emp = person.current;
    const isCampaign = CAMPAIGN_BONUS_TYPES.includes(type);
    const monthCells = {};
    for (const iso of months) {
      let v = 0;
      if (bonus) for (const line of person.lines) v += flow(bonus, line, iso, assumptions, drivers, roster, bonuses);
      monthCells[iso] = bonus ? formatPayrollAmount(v) : '';
    }
    return {
      id: `p_${person.key}`,
      monthCells,
      cells: {
        actions: null,
        name: (
          <span className="pr-name-cell pr-nowrap-cell" title={bonus ? explainBonus(bonus, assumptions) : person.name}>
            {person.name || <i className="pr-comp-noname">(unnamed)</i>}
            {person.isRamp && <span className="pr-ramp-badge">Ramp</span>}
            {person.dismissed && <span className="pr-ramp-badge pr-dismissed-badge">Dismissed</span>}
          </span>
        ),
        role: (
          <span className="pr-read-cell pr-nowrap-cell" title={person.title}>
            {person.title || <i className="pr-comp-noname">no title</i>}
          </span>
        ),
        type: (
          <select className="pr-input pr-select" value={type} onChange={(e) => setType(person, e.target.value)} title={bonus ? describeBonus(bonus, assumptions) : 'Pick a bonus type'}>
            {BONUS_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        ),
        amount: type === 'none' ? dash : <MonthInput value={bonus.amount} onCommit={(n) => updateField(person, { amount: n })} />,
        per:
          isCampaign && !(headcountMode && type === 'coordinator') ? (
            <MonthInput value={bonus.per} onCommit={(n) => updateField(person, { per: n })} />
          ) : (
            dash
          ),
        perMeeting: isCampaign ? <MonthInput value={bonus.perMeeting} onCommit={(n) => updateField(person, { perMeeting: n })} /> : dash,
        termsRead: (
          <span className="pr-read-cell pr-nowrap-cell" title={bonus ? explainBonus(bonus, assumptions) : ''}>
            {bonus ? describeBonus(bonus, assumptions) : '—'}
          </span>
        ),
        payoutRead: <span className="pr-read-cell">{type === 'none' ? '—' : (bonus.payout || 'monthly') === 'quarterly' ? 'Quarterly' : 'Monthly'}</span>,
        startDate:
          type === 'none' ? dash : (
            <DateInput
              value={bonus.startDate || ''}
              placeholder={emp.startDate ? shortDate(emp.startDate) : 'hire date'}
              onCommit={(v) => updateField(person, { startDate: v })}
            />
          ),
        endDate:
          type === 'none' ? dash : (
            <DateInput
              value={bonus.endDate || ''}
              placeholder={emp.endDate ? shortDate(emp.endDate) : 'open'}
              onCommit={(v) => updateField(person, { endDate: v })}
            />
          ),
        payout:
          type === 'none' ? dash : (
            <select className="pr-input pr-select" value={bonus.payout || 'monthly'} onChange={(e) => updateField(person, { payout: e.target.value })}>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
            </select>
          ),
      },
    };
  };

  const active = people.filter((p) => !p.dismissed);
  const dismissedPeople = people.filter((p) => p.dismissed);
  const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });

  const rowGroups = SECTIONS.map((section) => {
    const members = active.filter((p) => bonusTypeOf(bonusFor(p)) === section.type).sort(byName);
    const rows = [];

    if (section.type === 'coordinator' && members.length > 0 && headcountMode) {
      // Section total at the top (Kayee: "10 coordinators → subject to $10k, but only $9k
      // — whole people only"): heads → achievers → $ pool, then meetings per person.
      const heads = {};
      const pool = {};
      const mtg = {};
      for (const iso of months) {
        const n = coordinatorHeadcount(bonuses, roster, iso);
        const k = milestoneAchieversFor(bonuses, roster, iso, assumptions);
        let sum = 0;
        for (const p of members) {
          const b = bonusFor(p);
          if (b) for (const line of p.lines) sum += flow(b, line, iso, assumptions, drivers, roster, bonuses);
        }
        heads[iso] = <span className="pr-driver-val">{n > 0 ? `${k} of ${n}` : ''}</span>;
        pool[iso] = <b>{formatPayrollAmount(sum)}</b>;
        const m = meetingsPerPersonFor(bonuses, roster, iso, drivers);
        mtg[iso] = <span className="pr-driver-val">{m > 0 ? Math.round(m).toLocaleString('en-US') : ''}</span>;
      }
      rows.push({
        id: 'drv_heads',
        className: 'pr-driver-row',
        monthCells: heads,
        cells: {
          name: <span className="pr-read-cell pr-driver-label">coordinators hitting milestone</span>,
          role: (
            <span className="pr-read-cell pr-driver-note pr-nowrap-cell" title="round(active coordinators × hit rate) — whole people. Change the rate or basis in Payroll Assumptions.">
              round(heads × {hitRate}%)
            </span>
          ),
        },
      });
      rows.push({
        id: 'drv_pool',
        className: 'pr-driver-row',
        monthCells: pool,
        cells: {
          name: <span className="pr-read-cell pr-driver-label"><b>section total</b></span>,
          role: <span className="pr-read-cell pr-driver-note pr-nowrap-cell">{view === 'cash' ? 'cash out' : 'P&L accrual'}</span>,
        },
      });
      rows.push({
        id: 'drv_m_coordinator',
        className: 'pr-driver-row',
        monthCells: mtg,
        cells: {
          name: <span className="pr-read-cell pr-driver-label">meetings · per person</span>,
          role: <span className="pr-read-cell pr-driver-note pr-nowrap-cell">{hasCampaignData ? 'from Customer tab' : 'no deals yet → $0'}</span>,
        },
      });
    } else if (CAMPAIGN_BONUS_TYPES.includes(section.type) && members.length > 0) {
      // Campaign-volume basis: the counts every person in the section is measured on.
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

    for (const person of members) rows.push(personRow(person, section));

    const hint =
      section.type === 'coordinator'
        ? headcountMode
          ? '$ per milestone × round(heads × hit rate), + $ per meeting'
          : '$ every N campaigns each, + $ per meeting'
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

  if (dismissedPeople.length) {
    rowGroups.push({
      key: 'dismissed',
      label: (
        <span className="pr-group-band">
          <span className="pr-group-band-name">Dismissed</span>
          <span className="pr-group-band-terms">no longer on payroll · set a type + dates to accrue for the months they were here</span>
        </span>
      ),
      rowModifier: 'pr-dismissed',
      collapsible: true,
      defaultCollapsed: true,
      rows: dismissedPeople.sort(byName).map((p) => personRow(p, { type: bonusTypeOf(bonusFor(p)) })),
    });
  }

  const totalRow = {
    cells: { name: <b>TOTAL</b> },
    monthCells: Object.fromEntries(
      months.map((iso) => {
        let sum = 0;
        for (const person of people) {
          const b = bonusFor(person);
          if (b) for (const line of person.lines) sum += flow(b, line, iso, assumptions, drivers, roster, bonuses);
        }
        return [iso, <b key={iso}>{formatPayrollAmount(sum)}</b>];
      })
    ),
  };

  const withBonus = people.filter((p) => bonusTypeOf(bonusFor(p)) !== 'none').length;

  // Export = one row per person with their bonus terms, in the on-screen section order
  // (2026-09-17, Kayee: "an export button... for the bonus part, I want it listed out").
  function exportCsv() {
    const headers = ['Bonus type', 'Name', 'Title', 'Terms', '$', 'Per campaigns', '$ / meeting', 'Frequency', 'Start Date', 'End Date'];
    const rows = [];
    const ordered = [...active.sort(byName), ...dismissedPeople.sort(byName)];
    for (const section of SECTIONS) {
      for (const person of ordered.filter((p) => bonusTypeOf(bonusFor(p)) === section.type)) {
        const b = bonusFor(person);
        const emp = person.current;
        const isCampaign = CAMPAIGN_BONUS_TYPES.includes(section.type);
        rows.push([
          section.label,
          (person.name || '') + (person.dismissed ? ' (dismissed)' : ''),
          person.title || '',
          b ? describeBonus(b, assumptions) : '',
          b ? Number(b.amount) || 0 : '',
          b && isCampaign ? Number(b.per) || 0 : '',
          b && isCampaign ? Number(b.perMeeting) || 0 : '',
          b ? ((b.payout || 'monthly') === 'quarterly' ? 'Quarterly' : 'Monthly') : '',
          b ? csvDate(b.startDate || emp.startDate) : '',
          b ? (b.endDate || emp.endDate ? csvDate(b.endDate || emp.endDate) : 'open') : '',
        ]);
      }
    }
    downloadCsv(`wildcard-bonus-${scope}-${todayStamp()}.csv`, headers, rows);
  }

  return (
    <PayrollTable
      title="Bonus"
      subtitle={`${withBonus} of ${people.length} ${scope === 'planned' ? 'planned roles' : 'people'} with a bonus · ${
        view === 'cash' ? 'cash paid out' : 'P&L accrual'
      } · milestone hit rate ${assumptions.milestoneHitRate == null ? 90 : assumptions.milestoneHitRate}%`}
      tintForecast={false}
      frozenColumns={frozenColumns}
      defaultCollapsed
      months={months}
      todayIso={todayIso}
      totalRow={totalRow}
      rowGroups={rowGroups}
      headActions={
        <>
          <button type="button" className="btn" onClick={exportCsv} title="Download each person's bonus terms as CSV — to confirm with accounting">
            Export
          </button>
          <div className="seg">
          <button type="button" className={view === 'accrual' ? 'active' : undefined} onClick={() => setView('accrual')}>
            Accrual
          </button>
          <button type="button" className={view === 'cash' ? 'active' : undefined} onClick={() => setView('cash')}>
            Cash
          </button>
          </div>
        </>
      }
    />
  );
}
