'use client';

import { useState } from 'react';
import {
  DEPARTMENT_OPTIONS,
  EMPLOYMENT_STATUSES,
  cogsPercentFor,
  formatPayrollAmount,
  generateId,
  monthlyCostFor,
} from '../../lib/payroll/payrollData';
import { DateInput, MonthInput, PayrollTable, PickerInput, TextInput } from './PayrollTable';

// Narrowed across the board (2026-08-17, Kayee: "i can only see one month... push
// the width to further both side") — these 9 frozen columns alone used to run
// ~1154px before a single month column started; trimmed to ~1020px so more months
// fit in view, combined with the wider .page-wide cap in globals.css.
// Frozen block slimmed from ~1150px to 600px (2026-09-15, Kayee: "the whole control
// section is too long, the monthly section is really small space for me to look at
// things... simplify it but don't make it so annoying"). Only what you read at a
// glance stays frozen — Name, Base Salary, and a one-line read-only summary of the
// rest (title · CoGS/OpEx · dates). Everything editable beyond the name and base
// (department, CoGS/OpEx + % split, title, start/end date, employment) lives in a
// full-width "Details" panel that opens UNDER the row (the pencil button), using the
// same isExpanded/expandedContent mechanism the Software tab's Planning table added
// on 2026-08-27 — so the date inputs finally have room to show the full year too.
const FROZEN_COLUMNS = [
  { key: 'actions', label: '', width: 100 },
  { key: 'name', label: 'Name', width: 190 },
  { key: 'baseSalary', label: 'Base Salary', width: 100, align: 'right' },
  { key: 'summary', label: 'Role · Type · Dates', width: 210 },
];

function shortDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${String(d.getFullYear()).slice(2)}`;
}

/** The read-only summary shown in the frozen block for one roster line. */
function summarizeEmployee(employee) {
  const pct = cogsPercentFor(employee);
  const type = pct >= 100 ? 'CoGS' : pct <= 0 ? 'OpEx' : `${pct}% CoGS`;
  // No start date = the row costs $0 every month (payrollData.js isActiveInMonth) —
  // say so right in the summary so a blank month grid is never a mystery.
  const dates = employee.startDate ? `${shortDate(employee.startDate)} → ${shortDate(employee.endDate) || 'open'}` : 'NO START DATE → $0';
  return [employee.title, type, dates].filter(Boolean).join(' · ');
}

const SECTION_ORDER = [
  { key: 'Active', label: 'Active', rowModifier: '' },
  { key: 'TBD', label: 'Planned (TBD)', rowModifier: 'pr-tbd' },
  { key: 'Dismissed', label: 'Dismissed', rowModifier: 'pr-dismissed' },
];

/**
 * Employees — the editable heart of the Payroll tab, but ONLY current real people
 * (Active / Planned (TBD) / Dismissed, per each person's actual "Employment" field).
 * Not-yet-hired roles with a ramping headcount live on their own Hiring Plan card
 * instead (Kayee, 2026-08-05: "create a separate section for hiring plan, leave current
 * employees in their own sections") — this card still receives the FULL roster array
 * (and writes the full array back via onChange) so Hiring Plan rows pass through
 * untouched, it just never renders or edits them. Frozen leading columns (Name → Base
 * Salary) stay put while the monthly $ grid scrolls. A TOTAL row is pinned at the top
 * so the running headcount cost (of real people only) is visible without scrolling.
 * "+ Add Employee" lives on this card's own header (Kayee, 2026-08-06: "move the add
 * employee button to the employee roster section") rather than the page-level header,
 * so it sits right next to the list it actually adds to — same self-contained-add
 * pattern as the Hiring Plan and Bonus cards' own add controls.
 */
export function RosterCard({ roster, assumptions, months, todayIso, onChange }) {
  const employees = roster.filter((r) => !r.isRamp);
  const [justAddedId, setJustAddedId] = useState(null);

  // Multi-line-per-person rollup (2026-08-17, Kayee: "people will have multiple lines
  // with multiple salary rate but it will get roll up to one line, only expand if i
  // want to see"). `personId` is the new grouping key — every row still calculates
  // exactly like an independent roster entry (monthlyCostFor, the Payroll totals, the
  // P&L wiring all just sum every roster row regardless of grouping), so NOTHING about
  // the underlying math changes; this is purely how multiple rows for the same person
  // (e.g. current salary + an already-scheduled future raise) are DISPLAYED. Existing
  // saved rows have no `personId` yet — falling back to `r.id` below means an
  // old/ungrouped row just renders as its own singleton group, no migration needed.
  // Scoped to this card only (Kayee: "existing only") — Hiring Plan keeps its simpler
  // one-row-per-role layout.
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  // Which roster lines have their Details editor panel open (2026-09-15).
  const [openDetails, setOpenDetails] = useState(new Set());

  function toggleDetails(id) {
    setOpenDetails((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleGroup(personId) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(personId)) next.delete(personId);
      else next.add(personId);
      return next;
    });
  }

  function addEmployee() {
    const id = generateId('emp');
    const newEmployee = {
      id,
      personId: id,
      name: '',
      department: '',
      costType: 'OpEx',
      title: '',
      startDate: '',
      endDate: '',
      employment: 'TBD',
      baseSalary: 0,
      monthlyOverrides: {},
    };
    onChange([...roster, newEmployee]);
    setJustAddedId(id);
    setOpenDetails((prev) => new Set(prev).add(id)); // new person: open Details so the fields are right there
  }

  // Adds a new salary line to an EXISTING person (2026-08-17, Kayee: "when i add a new
  // person it will automatically populate the name if i expand it already if not it
  // will have no name populate") — this is the "already expanded" case: it always
  // pre-fills name/department/title/costType/employment from that person's own most
  // recent line, since the whole point is a second line for someone already on the
  // roster. A genuinely NEW person still goes through addEmployee() above (blank
  // name), which is the only way to reach a state with no name populated.
  function addLine(personId) {
    const groupRows = employees.filter((r) => (r.personId || r.id) === personId);
    const template = groupRows[groupRows.length - 1] || groupRows[0];
    if (!template) return;
    const id = generateId('emp');
    const newLine = {
      id,
      personId,
      name: template.name,
      department: template.department,
      costType: template.costType,
      title: template.title,
      startDate: '',
      endDate: '',
      employment: template.employment || 'Active',
      baseSalary: 0,
      monthlyOverrides: {},
    };
    onChange([...roster, newLine]);
    setExpandedGroups((prev) => new Set(prev).add(personId));
    setJustAddedId(id);
    setOpenDetails((prev) => new Set(prev).add(id)); // the new line's own start date is the first thing to fill in
  }

  // Drag-to-reorder (Kayee, 2026-08-05: "turn it into draggable so people can rearrange
  // people") — scoped to within one section only (Active/Planned/Dismissed don't mix),
  // per Kayee's call, so dragging never silently changes someone's Employment status.
  // Now reorders by GROUP (personId), not individual row id (2026-08-17 rollup change)
  // — a person with multiple salary lines has to move as one block, or dragging could
  // silently interleave their lines with someone else's.
  const [draggedGroupId, setDraggedGroupId] = useState(null);

  function reorderGroupsWithinSection(sectionKey, fromPersonId, toPersonId) {
    if (fromPersonId === toPersonId) return;
    const sectionRows = employees.filter((r) => (r.employment || 'Active') === sectionKey);
    const order = [];
    const rowsByPerson = new Map();
    for (const r of sectionRows) {
      const pid = r.personId || r.id;
      if (!rowsByPerson.has(pid)) {
        rowsByPerson.set(pid, []);
        order.push(pid);
      }
      rowsByPerson.get(pid).push(r);
    }
    const fromIndex = order.indexOf(fromPersonId);
    const toIndex = order.indexOf(toPersonId);
    if (fromIndex === -1 || toIndex === -1) return;
    const reorderedIds = [...order];
    const [moved] = reorderedIds.splice(fromIndex, 1);
    reorderedIds.splice(toIndex, 0, moved);
    const newSectionRows = reorderedIds.flatMap((pid) => rowsByPerson.get(pid));

    // Walk the roster in its existing order, and wherever a row belongs to this
    // section, substitute the next row off the freshly-ordered (group-block) list —
    // every other row (and every other section's rows) stays exactly where it was.
    let cursor = 0;
    const newRoster = roster.map((r) => {
      // Ramp rows can share the same 'TBD' employment value but live on the Hiring
      // Plan card, not here — excluded so they never get pulled into this reorder.
      if (r.isRamp || (r.employment || 'Active') !== sectionKey) return r;
      const next = newSectionRows[cursor];
      cursor += 1;
      return next;
    });
    onChange(newRoster);
  }

  function updateEmployee(id, patch) {
    onChange(roster.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function removeEmployee(id, name) {
    // No confirm() dialog (2026-08-20, Kayee: "i dont want no pop up when i delete stuff").
    onChange(roster.filter((r) => r.id !== id));
  }

  const departmentOptions = Array.from(
    new Set([...DEPARTMENT_OPTIONS, ...employees.map((r) => r.department).filter(Boolean)])
  );

  // Groups each section's rows by personId (falls back to the row's own id, so an
  // old/ungrouped saved row just renders as a singleton group). A group of 1 renders
  // exactly like the old flat table always did; a group of >1 renders one collapsed
  // summary row (name + count badge + the SUM of every line's monthly cost) and, only
  // when expanded, each individual line below it — Kayee: "it will get roll up to one
  // line, only expand if i want to see."
  const rowGroups = SECTION_ORDER.map((section) => {
    const sectionEmployees = employees.filter((r) => (r.employment || 'Active') === section.key);
    const order = [];
    const rowsByPerson = new Map();
    for (const r of sectionEmployees) {
      const pid = r.personId || r.id;
      if (!rowsByPerson.has(pid)) {
        rowsByPerson.set(pid, []);
        order.push(pid);
      }
      rowsByPerson.get(pid).push(r);
    }
    // Automatic sort within each section (2026-09-15, Kayee: "sort it descending by
    // base salary, then followed by Cost of goods sold or OpEx, then followed by
    // department"). A multi-line person sorts by their highest base (their current /
    // latest rate is what you'd look for). Because ordering is now rule-based, the
    // drag-to-reorder handle is hidden — a manual drag would just snap back.
    const rank = (rows) => {
      const top = rows.reduce((best, r) => (Number(r.baseSalary) || 0) > (Number(best.baseSalary) || 0) ? r : best, rows[0]);
      return top;
    };
    order.sort((a, b) => {
      const ra = rank(rowsByPerson.get(a));
      const rb = rank(rowsByPerson.get(b));
      const baseDiff = (Number(rb.baseSalary) || 0) - (Number(ra.baseSalary) || 0);
      if (baseDiff !== 0) return baseDiff;
      const typeDiff = String(ra.costType || 'zz').localeCompare(String(rb.costType || 'zz'));
      if (typeDiff !== 0) return typeDiff; // 'CoGS' before 'OpEx', blanks last
      return String(ra.department || 'zz').localeCompare(String(rb.department || 'zz'));
    });
    const rows = [];
    for (const pid of order) {
      const groupRows = rowsByPerson.get(pid);
      if (groupRows.length === 1) {
        rows.push(buildRow(groupRows[0], section.key, { dragKey: pid, showDragHandle: false }));
        continue;
      }
      rows.push(buildGroupSummaryRow(pid, groupRows, section.key));
      if (expandedGroups.has(pid)) {
        for (const emp of groupRows) rows.push(buildRow(emp, section.key, { isChild: true }));
      }
    }
    return { key: section.key, label: section.label, rowModifier: section.rowModifier, rows };
  });

  function buildGroupSummaryRow(personId, groupRows, sectionKey) {
    const isExpanded = expandedGroups.has(personId);
    const name = groupRows[0]?.name || '';
    const monthCells = {};
    for (const iso of months) {
      const sum = groupRows.reduce((acc, e) => acc + monthlyCostFor(e, iso, assumptions), 0);
      monthCells[iso] = <b key={iso}>{formatPayrollAmount(sum) || '$0'}</b>;
    }
    return {
      id: `group_${personId}`,
      monthCells,
      className: `pr-comp-group-row${draggedGroupId === personId ? ' pr-dragging' : ''}`,
      draggable: false, // ordering is rule-based now (see the sort above)
      onDragStart: (e) => {
        if (!e.target.closest('[data-drag-handle]')) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.effectAllowed = 'move';
        // Firefox refuses to start a drag at all unless SOME data is set (2026-09-15,
        // Kayee: "the hamburger next to the employee name doesn't work") — Chrome
        // doesn't care, which is why it looked fine in earlier testing.
        try { e.dataTransfer.setData('text/plain', personId); } catch { /* older engines */ }
        setDraggedGroupId(personId);
      },
      onDragOver: (e) => e.preventDefault(),
      onDrop: (e) => {
        e.preventDefault();
        if (draggedGroupId) reorderGroupsWithinSection(sectionKey, draggedGroupId, personId);
        setDraggedGroupId(null);
      },
      onDragEnd: () => setDraggedGroupId(null),
      cells: {
        actions: (
          <div className="pr-row-actions">
            <button
              type="button"
              className="icon-btn pr-comp-expand-toggle"
              onClick={() => toggleGroup(personId)}
              title={isExpanded ? 'Collapse lines' : 'Expand lines'}
            >
              <span className={`pr-comp-chevron${isExpanded ? ' open' : ''}`}>▸</span>
            </button>
            <button type="button" className="icon-btn" title="Add another salary line for this person" onClick={() => addLine(personId)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </div>
        ),
        name: (
          <span className="pr-comp-group-name">
            {name || <i className="pr-comp-noname">Unnamed</i>} <span className="pr-comp-count">({groupRows.length})</span>
          </span>
        ),
      },
    };
  }

  function buildRow(employee, sectionKey, { dragKey, showDragHandle = false, isChild = false } = {}) {
    // Month cells are READ-ONLY (2026-09-15, Kayee: "why is the monthly amount
    // editable? the control is from the base annual salary... those shouldn't have
    // boxes, it should just have the amount"). Everything is derived from Base Salary
    // × load factor × the prorated days-active fraction (see payrollData.js
    // activeFractionFor), so there's nothing left to type per cell.
    const monthCells = {};
    for (const iso of months) {
      monthCells[iso] = formatPayrollAmount(monthlyCostFor(employee, iso, assumptions));
    }

    return {
      id: employee.id,
      monthCells,
      className: [isChild ? 'pr-comp-child-row' : null, showDragHandle && draggedGroupId === dragKey ? 'pr-dragging' : null]
        .filter(Boolean)
        .join(' ') || undefined,
      draggable: showDragHandle,
      // Row itself is draggable (HTML5 DnD requires that), but the drag only actually
      // starts if the gesture began on the handle icon specifically — otherwise
      // clicking/dragging to select text inside a Name field would trigger a row drag.
      // A single-line-per-person row IS the group (dragKey = its own personId), so
      // dragging still moves the whole "group" — which here is just itself.
      onDragStart: showDragHandle
        ? (e) => {
            if (!e.target.closest('[data-drag-handle]')) {
              e.preventDefault();
              return;
            }
            e.dataTransfer.effectAllowed = 'move';
            try { e.dataTransfer.setData('text/plain', dragKey); } catch { /* see note above */ }
            setDraggedGroupId(dragKey);
          }
        : undefined,
      onDragOver: showDragHandle ? (e) => e.preventDefault() : undefined,
      onDrop: showDragHandle
        ? (e) => {
            e.preventDefault();
            if (draggedGroupId) reorderGroupsWithinSection(sectionKey, draggedGroupId, dragKey);
            setDraggedGroupId(null);
          }
        : undefined,
      onDragEnd: showDragHandle ? () => setDraggedGroupId(null) : undefined,
      isExpanded: openDetails.has(employee.id),
      expandedContent: (
        <div className="pr-details-grid">
          <label className="pr-details-field">
            <span>Department</span>
            <PickerInput
              value={employee.department}
              options={departmentOptions}
              placeholder="Department"
              onCommit={(v) => updateEmployee(employee.id, { department: v })}
            />
          </label>
          <label className="pr-details-field">
            <span>Title</span>
            <TextInput value={employee.title} placeholder="Title" onCommit={(v) => updateEmployee(employee.id, { title: v })} />
          </label>
          <label className="pr-details-field">
            <span>CoGS or OpEx?</span>
            <select
              className="pr-input pr-select"
              value={employee.costType || ''}
              onChange={(e) => {
                // Switching to a clean single bucket clears any split % so the row goes
                // back to a plain 100%/0% row (cogsPercentFor's costType fallback)
                // instead of silently keeping a stale split around.
                updateEmployee(employee.id, { costType: e.target.value, cogsPercent: null });
              }}
            >
              <option value="">—</option>
              <option value="CoGS">CoGS</option>
              <option value="OpEx">OpEx</option>
            </select>
          </label>
          <label className="pr-details-field">
            <span>% CoGS (split)</span>
            <MonthInput
              value={cogsPercentFor(employee)}
              onCommit={(n) => updateEmployee(employee.id, { cogsPercent: Math.max(0, Math.min(100, n)) })}
            />
          </label>
          <label className="pr-details-field">
            <span>Start Date</span>
            <DateInput value={employee.startDate} onCommit={(v) => updateEmployee(employee.id, { startDate: v })} />
          </label>
          <label className="pr-details-field">
            <span>End Date</span>
            <DateInput value={employee.endDate} onCommit={(v) => updateEmployee(employee.id, { endDate: v })} />
          </label>
          <label className="pr-details-field">
            <span>Employment</span>
            <select
              className="pr-input pr-select"
              value={employee.employment || 'Active'}
              onChange={(e) => updateEmployee(employee.id, { employment: e.target.value })}
            >
              {EMPLOYMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <div className="pr-details-note">
            Monthly cost = Base ÷ 12 × (1 + Tax + Benefits), prorated by days in the start/end month. A raise = add a new
            line for this person (the + on the name row) with its own start date; end-date the old line the day before.
          </div>
        </div>
      ),
      cells: {
        actions: (
          <div className="pr-row-actions">
            {showDragHandle && (
              <span className="icon-btn pr-drag-handle" data-drag-handle title="Drag to reorder within this section">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 7h16M4 12h16M4 17h16" />
                </svg>
              </span>
            )}
            <button
              type="button"
              className={`icon-btn${openDetails.has(employee.id) ? ' is-active' : ''}`}
              title={openDetails.has(employee.id) ? 'Hide details' : 'Edit details (department, type, title, dates, status)'}
              onClick={() => toggleDetails(employee.id)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
            </button>
            <button
              type="button"
              className="icon-btn"
              title={isChild ? 'Remove this line' : 'Remove from roster'}
              onClick={() => removeEmployee(employee.id, employee.name)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0l-1 14a2 2 0 01-2 2H7a2 2 0 01-2-2L4 6" />
              </svg>
            </button>
          </div>
        ),
        name: (
          <TextInput
            value={employee.name}
            placeholder="Name"
            focusOnMount={employee.id === justAddedId}
            onCommit={(v) => {
              updateEmployee(employee.id, { name: v });
              if (employee.id === justAddedId) setJustAddedId(null);
            }}
          />
        ),
        baseSalary: (
          <MonthInput
            value={employee.baseSalary}
            onCommit={(n) => updateEmployee(employee.id, { baseSalary: n })}
          />
        ),
        summary: (
          <span className="pr-nowrap-cell pr-row-summary" title={summarizeEmployee(employee) || 'No details yet — click the pencil'}>
            {summarizeEmployee(employee) || <i className="pr-comp-noname">no details</i>}
          </span>
        ),
      },
    };
  }

  const totalRow = {
    cells: { name: <b>TOTAL</b> },
    monthCells: Object.fromEntries(
      months.map((iso) => {
        const sum = employees.reduce((acc, e) => acc + monthlyCostFor(e, iso, assumptions), 0);
        return [iso, <b key={iso}>{formatPayrollAmount(sum) || '$0'}</b>];
      })
    ),
  };

  const uniquePeopleCount = new Set(employees.map((r) => r.personId || r.id)).size;

  return (
    <PayrollTable
      title="Employees"
      subtitle={`${uniquePeopleCount} people`}
      tintForecast={false}
      frozenColumns={FROZEN_COLUMNS}
      months={months}
      todayIso={todayIso}
      totalRow={totalRow}
      rowGroups={rowGroups}
      headActions={
        // Plain .btn (white bg), not .btn.primary — .btn.primary is solid black and
        // would disappear against this card's own black header bar.
        <button type="button" className="btn" onClick={addEmployee}>
          + Add Employee
        </button>
      }
    />
  );
}
