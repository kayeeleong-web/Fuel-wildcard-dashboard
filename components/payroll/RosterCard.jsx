'use client';

import { useState } from 'react';
import {
  DEPARTMENT_OPTIONS,
  EMPLOYMENT_STATUSES,
  baseSalaryMonthlyFor,
  classificationForTitle,
  cogsPercentFor,
  formatPayrollAmount,
  generateId,
} from '../../lib/payroll/payrollData';
import { DateInput, MonthInput, PayrollTable, PickerInput, TextInput } from './PayrollTable';

// Narrowed across the board (2026-08-17, Kayee: "i can only see one month... push
// the width to further both side") — these 9 frozen columns alone used to run
// ~1154px before a single month column started; trimmed to ~1020px so more months
// fit in view, combined with the wider .page-wide cap in globals.css.
// Frozen block, Excel/Sheets "grouped columns" style (2026-09-15, Kayee: "the whole
// control section is too long, the monthly section is really small... handle it like
// Excel or Google Sheets where you click something and it expands... when you don't
// expand it, [show it] aligned"). Two column sets, toggled by the ▸/◂ button in the
// card header:
//  - COLLAPSED (default, ~660px): Name, Base Salary, then a compact READ-ONLY Role ·
//    Type · Start · End as four real aligned columns — not one dot-joined string.
//  - EXPANDED (~1080px): the same slots become the full editors (Department, Title,
//    CoGS/OpEx, % split, Start, End, Employment).
// Month cells are derived either way; nothing about the math depends on the toggle.
const BASE_COLUMNS = [
  { key: 'actions', label: '', width: 72 },
  { key: 'name', label: 'Name', width: 180 },
  { key: 'baseSalary', label: 'Base Salary', width: 98, align: 'right' },
];
const COMPACT_COLUMNS = [
  { key: 'roleRead', label: 'Role', width: 176 },
  { key: 'typeRead', label: 'Type', width: 66 },
  { key: 'startRead', label: 'Start', width: 76 },
  { key: 'endRead', label: 'End', width: 76 },
];
const EXPANDED_COLUMNS = [
  // Select cells sized to their longest option + chevron, so nothing renders as "O…"
  // (2026-09-15, Kayee: "the text is being covered"). "Employment" relabelled "Status".
  { key: 'department', label: 'Department', width: 124 },
  { key: 'title', label: 'Title', width: 190 },
  { key: 'costType', label: 'CoGS / OpEx', width: 112 },
  { key: 'cogsPercent', label: '% CoGS', width: 70, align: 'right' },
  { key: 'startDate', label: 'Start Date', width: 112 },
  { key: 'endDate', label: 'End Date', width: 112 },
  { key: 'employment', label: 'Status', width: 116 },
];

/** One block per PERSON: explicit personId when set, else the (case/space-insensitive)
 *  name, else the row id — so three "Brennan Keough" salary lines entered separately
 *  still roll into one block (2026-09-16, Kayee: "Brandon stay together"). */
function personKey(r) {
  const n = String(r.name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (n) return `name:${n}`; // same full name = same person, however the lines were added
  return r.personId || r.id;
}

/** MM/DD/YY for the compact read-only date columns (dates are stored YYYY-MM-DD). */
function shortDate(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr || '');
  return m ? `${m[2]}/${m[3]}/${m[1].slice(2)}` : dateStr || '';
}

function typeLabel(employee) {
  const pct = cogsPercentFor(employee);
  if (pct >= 100) return 'CoGS';
  if (pct <= 0) return 'OpEx';
  return `${pct}% CoGS`;
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
  // Excel-style grouped-columns toggle (2026-09-15): false = compact read-only Role /
  // Type / Start / End columns; true = the full editors inline.
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  // The toggle lives IN the column header of the first details column (Kayee: "it should
  // be at the top, on top of Role / Type / Start / End") — the same place Sheets puts its
  // column-group [+]/[−] control — instead of the card's far-right header bar.
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
                title={detailsExpanded ? 'Collapse to Role / Type / Start / End' : 'Expand to edit department, title, CoGS/OpEx split, dates, status'}
              >
                <span className="pr-colgroup-toggle-icon">{detailsExpanded ? '−' : '+'}</span>
                {col.label}
              </button>
            ),
          }
        : col
    ),
  ];

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
      // Blank until a title is typed — classificationForTitle then fills CoGS/OpEx, % and
      // department (was a hard 'OpEx' default, which coordinators kept inheriting by mistake).
      costType: '',
      title: '',
      startDate: '',
      endDate: '',
      employment: 'TBD',
      baseSalary: 0,
      monthlyOverrides: {},
    };
    onChange([...roster, newEmployee]);
    setJustAddedId(id);
    setDetailsExpanded(true); // new person: open the editor columns so the fields are right there
  }

  // Adds a new salary line to an EXISTING person (2026-08-17, Kayee: "when i add a new
  // person it will automatically populate the name if i expand it already if not it
  // will have no name populate") — this is the "already expanded" case: it always
  // pre-fills name/department/title/costType/employment from that person's own most
  // recent line, since the whole point is a second line for someone already on the
  // roster. A genuinely NEW person still goes through addEmployee() above (blank
  // name), which is the only way to reach a state with no name populated.
  function addLine(personId) {
    const groupRows = employees.filter((r) => personKey(r) === personId);
    const template = groupRows[groupRows.length - 1] || groupRows[0];
    if (!template) return;
    const id = generateId('emp');
    const newLine = {
      id,
      personId,
      name: template.name,
      department: template.department,
      costType: template.costType,
      cogsPercent: template.cogsPercent ?? null,
      costTypeManual: template.costTypeManual || false,
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
    setDetailsExpanded(true); // the new line's own start date is the first thing to fill in
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
      const pid = personKey(r);
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
      const pid = personKey(r);
      if (!rowsByPerson.has(pid)) {
        rowsByPerson.set(pid, []);
        order.push(pid);
      }
      rowsByPerson.get(pid).push(r);
    }
    // Ordering (2026-09-16, Kayee: "Brennan and Shane are the co-founders so they should
    // be at the top... followed by higher level people... go with salary"): one BLOCK per
    // person; blocks ranked by seniority using the person's highest base salary across
    // their lines (salary as the proxy for level — co-founders first, then heads, then
    // coordinators); equal salaries then group by Department, then Title, then name A→Z
    // (2026-09-17, Kayee: "after the current sort, sort by department and then title").
    // Inside a block, lines run newest start date first so a raise sits above the line it
    // replaced. Rule-based, so no drag handle.
    const topBase = (rows) => rows.reduce((m, r) => Math.max(m, Number(r.baseSalary) || 0), 0);
    for (const rows of rowsByPerson.values()) {
      rows.sort((x, y) => String(y.startDate || '').localeCompare(String(x.startDate || '')));
    }
    const cmp = (x, y) => String(x || '').localeCompare(String(y || ''), undefined, { sensitivity: 'base' });
    order.sort((a, b) => {
      const ra = rowsByPerson.get(a);
      const rb = rowsByPerson.get(b);
      const bySalary = topBase(rb) - topBase(ra);
      if (bySalary !== 0) return bySalary;
      // ra[0] / rb[0] = the person's newest line (sorted above)
      return cmp(ra[0].department, rb[0].department) || cmp(ra[0].title, rb[0].title) || cmp(ra[0].name, rb[0].name);
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
    const today = new Date().toISOString().slice(0, 10);
    const current =
      groupRows.find((r) => r.startDate && r.startDate <= today && (!r.endDate || r.endDate >= today)) ||
      [...groupRows].sort((x, y) => String(y.startDate || '').localeCompare(String(x.startDate || '')))[0];
    const monthCells = {};
    for (const iso of months) {
      const sum = groupRows.reduce((acc, e) => acc + baseSalaryMonthlyFor(e, iso), 0);
      monthCells[iso] = <b key={iso}>{formatPayrollAmount(sum)}</b>;
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
            {/* [+] only once the block is open — collapsed, it sat right next to the chevron
                and kept getting hit by mistake (2026-09-17, Kayee). */}
            {isExpanded && (
              <button type="button" className="icon-btn" title="Add another salary line for this person" onClick={() => addLine(personId)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
            )}
          </div>
        ),
        name: (
          <span className="pr-comp-group-name">
            {name || <i className="pr-comp-noname">Unnamed</i>} <span className="pr-comp-count">({groupRows.length})</span>
          </span>
        ),
        // Collapsed block shows the CURRENT line's details read-only (2026-09-16, Kayee:
        // "you don't have any information when Brennan and Shane are collapsed... show what
        // is the current one so it doesn't look so bare"). Current = the line active
        // today, else the newest by start date. Dates are left blank on the block row
        // (each line has its own). Expand the block to edit any line.
        baseSalary: <span className="pr-read-cell pr-read-num">{formatPayrollAmount(current.baseSalary)}</span>,
        roleRead: <span className="pr-read-cell pr-nowrap-cell" title={current.title}>{current.title || <i className="pr-comp-noname">—</i>}</span>,
        typeRead: <span className="pr-read-cell">{typeLabel(current)}</span>,
        department: <span className="pr-read-cell pr-nowrap-cell">{current.department}</span>,
        title: <span className="pr-read-cell pr-nowrap-cell" title={current.title}>{current.title}</span>,
        costType: <span className="pr-read-cell">{current.costType}</span>,
        cogsPercent: <span className="pr-read-cell pr-read-num">{cogsPercentFor(current) > 0 ? cogsPercentFor(current) : ''}</span>,
        employment: <span className="pr-read-cell">{current.employment || 'Active'}</span>,
      },
    };
  }

  function buildRow(employee, sectionKey, { dragKey, showDragHandle = false, isChild = false } = {}) {
    // Month cells are READ-ONLY (2026-09-15, Kayee: "why is the monthly amount
    // editable? the control is from the base annual salary... those shouldn't have
    // boxes, it should just have the amount"). Everything is derived from Base Salary
    // × load factor × the prorated days-active fraction (see payrollData.js
    // activeFractionFor), so there's nothing left to type per cell.
    // Month cells = BASE SALARY only (2026-09-16, Kayee: "in the existing people portion I
    // only want to see the monthly salary" — payroll taxes and benefits roll up to their
    // own P&L lines, so they're shown in the Payroll Summary, not per person here).
    // Still prorated by start/end date.
    const monthCells = {};
    for (const iso of months) {
      monthCells[iso] = formatPayrollAmount(baseSalaryMonthlyFor(employee, iso));
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

        // ---- compact (read-only, aligned) ----
        roleRead: (
          <span className="pr-nowrap-cell pr-read-cell" title={[employee.title, employee.department].filter(Boolean).join(' — ')}>
            {employee.title || <i className="pr-comp-noname">—</i>}
          </span>
        ),
        typeRead: <span className="pr-read-cell">{typeLabel(employee)}</span>,
        // No start date = the row costs $0 (payrollData.js isActiveInMonth) — flagged
        // here so a blank month grid is never a mystery.
        startRead: employee.startDate ? (
          <span className="pr-read-cell pr-read-date">{shortDate(employee.startDate)}</span>
        ) : (
          <span className="pr-read-cell pr-read-missing" title="No start date — this row costs $0 until one is set">missing</span>
        ),
        endRead: (
          <span className="pr-read-cell pr-read-date">{employee.endDate ? shortDate(employee.endDate) : <span className="pr-read-open">open</span>}</span>
        ),

        // ---- expanded (editors) ----
        department: (
          <PickerInput
            value={employee.department}
            options={departmentOptions}
            placeholder="Department"
            onCommit={(v) => updateEmployee(employee.id, { department: v })}
          />
        ),
        title: (
          <TextInput
            value={employee.title}
            placeholder="Title"
            onCommit={(v) => {
              // Typing a title defaults CoGS/OpEx, % and Department from the confirmed
              // role list (classificationForTitle) — unless this row's classification was
              // already set by hand, or the department was already filled in. Everything
              // stays editable; this only stops a new coordinator landing in OpEx.
              const patch = { title: v };
              const guess = classificationForTitle(v);
              if (guess && !employee.costTypeManual) {
                patch.costType = guess.costType;
                patch.cogsPercent = guess.cogsPercent;
                if (!employee.department) patch.department = guess.department;
              }
              updateEmployee(employee.id, patch);
            }}
          />
        ),
        costType: (
          <select
            className="pr-input pr-select"
            value={employee.costType || ''}
            onChange={(e) => {
              // Switching to a clean single bucket clears any split % so the row goes
              // back to a plain 100%/0% row (cogsPercentFor's costType fallback).
              // costTypeManual: a hand-set classification wins over title defaults.
              updateEmployee(employee.id, { costType: e.target.value, cogsPercent: null, costTypeManual: true });
            }}
          >
            <option value="">—</option>
            <option value="CoGS">CoGS</option>
            <option value="OpEx">OpEx</option>
          </select>
        ),
        cogsPercent: (
          <MonthInput
            value={cogsPercentFor(employee)}
            onCommit={(n) => updateEmployee(employee.id, { cogsPercent: Math.max(0, Math.min(100, n)), costTypeManual: true })}
          />
        ),
        startDate: <DateInput value={employee.startDate} onCommit={(v) => updateEmployee(employee.id, { startDate: v })} />,
        endDate: <DateInput value={employee.endDate} onCommit={(v) => updateEmployee(employee.id, { endDate: v })} placeholder="open" />,
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
      },
    };
  }

  const totalRow = {
    cells: { name: <b>TOTAL</b> },
    monthCells: Object.fromEntries(
      months.map((iso) => {
        const sum = employees.reduce((acc, e) => acc + baseSalaryMonthlyFor(e, iso), 0);
        return [iso, <b key={iso}>{formatPayrollAmount(sum)}</b>];
      })
    ),
  };

  const uniquePeopleCount = new Set(employees.map(personKey)).size;

  return (
    <PayrollTable
      title="Employees — Base Salary"
      subtitle={`${uniquePeopleCount} people`}
      tintForecast={false}
      frozenColumns={frozenColumns}
      defaultCollapsed
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
