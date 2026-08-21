'use client';

import { useState } from 'react';
import {
  DEPARTMENT_OPTIONS,
  EMPLOYMENT_STATUSES,
  formatPayrollAmount,
  generateId,
  monthlyCostFor,
} from '../../lib/payroll/payrollData';
import { DateInput, FillRangeButton, MonthInput, PayrollTable, PickerInput, TextInput } from './PayrollTable';

// Narrowed across the board (2026-08-17, Kayee: "i can only see one month... push
// the width to further both side") — these 9 frozen columns alone used to run
// ~1154px before a single month column started; trimmed to ~1020px so more months
// fit in view, combined with the wider .page-wide cap in globals.css.
const FROZEN_COLUMNS = [
  // Widened 64 -> 100 (2026-08-20, Kayee: "is there an option to delete? i added a
  // few rows but i dont need all three") — a full (non-child, non-grouped) row packs
  // 3 icon buttons in here (drag handle, fill-range, trash), each 28px wide with 4px
  // gaps = 92px of icons alone; 64px was clipping the trash button off the edge of
  // this sticky column, making "Remove from roster" invisible even though the button
  // (and its onClick) was there all along.
  { key: 'actions', label: '', width: 100 },
  { key: 'name', label: 'Name', width: 200 },
  { key: 'department', label: 'Department', width: 105 },
  { key: 'costType', label: 'CoGS or OpEx?', width: 90 },
  { key: 'title', label: 'Title', width: 140 },
  { key: 'startDate', label: 'Start Date', width: 110 },
  { key: 'endDate', label: 'End Date', width: 110 },
  { key: 'employment', label: 'Employment', width: 90 },
  { key: 'baseSalary', label: 'Base Salaries', width: 105, align: 'right' },
];

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

  function updateMonthly(id, iso, value) {
    onChange(
      roster.map((r) =>
        r.id === id ? { ...r, monthlyOverrides: { ...r.monthlyOverrides, [iso]: value } } : r
      )
    );
  }

  function fillRange(id, targetMonths, value) {
    onChange(
      roster.map((r) => {
        if (r.id !== id) return r;
        const patch = {};
        for (const m of targetMonths) patch[m] = value;
        return { ...r, monthlyOverrides: { ...r.monthlyOverrides, ...patch } };
      })
    );
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
    const rows = [];
    for (const pid of order) {
      const groupRows = rowsByPerson.get(pid);
      if (groupRows.length === 1) {
        rows.push(buildRow(groupRows[0], section.key, { dragKey: pid, showDragHandle: true }));
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
      draggable: true,
      onDragStart: (e) => {
        if (!e.target.closest('[data-drag-handle]')) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.effectAllowed = 'move';
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
            <span className="icon-btn pr-drag-handle" data-drag-handle title="Drag to reorder within this section">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </span>
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
    const monthCells = {};
    for (const iso of months) {
      const val = monthlyCostFor(employee, iso, assumptions);
      monthCells[iso] = <MonthInput value={val} onCommit={(n) => updateMonthly(employee.id, iso, n)} />;
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
            <FillRangeButton months={months} onApply={(targetMonths, value) => fillRange(employee.id, targetMonths, value)} />
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
        department: (
          <PickerInput
            value={employee.department}
            options={departmentOptions}
            placeholder="Department"
            onCommit={(v) => updateEmployee(employee.id, { department: v })}
          />
        ),
        costType: (
          <select
            className="pr-input pr-select"
            value={employee.costType || ''}
            onChange={(e) => updateEmployee(employee.id, { costType: e.target.value })}
          >
            <option value="">—</option>
            <option value="CoGS">CoGS</option>
            <option value="OpEx">OpEx</option>
          </select>
        ),
        title: (
          <TextInput
            value={employee.title}
            placeholder="Title"
            onCommit={(v) => updateEmployee(employee.id, { title: v })}
          />
        ),
        startDate: <DateInput value={employee.startDate} onCommit={(v) => updateEmployee(employee.id, { startDate: v })} />,
        endDate: <DateInput value={employee.endDate} onCommit={(v) => updateEmployee(employee.id, { endDate: v })} />,
        employment: (
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
        ),
        baseSalary: (
          <MonthInput
            value={employee.baseSalary}
            onCommit={(n) => updateEmployee(employee.id, { baseSalary: n })}
          />
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
