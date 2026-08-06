'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatMonthLabel } from '../../lib/payroll/payrollData';

/**
 * Shared sticky-column table shell for the Payroll tab's three cards (Roster, Bonus,
 * Total Comp). Handles: the collapsible dark-header card (Wildcard's --black chrome, not
 * a client-specific palette), the frozen leading-column block (fixed pixel widths +
 * precomputed cumulative left offsets, table-layout:fixed — get this wrong and the
 * frozen columns silently misalign the instant a cell's content is wider than expected),
 * the bounded-height scrolling month grid, and a pinned-at-top TOTAL row.
 *
 * Callers supply already-built cell content (inputs for an editable table, plain text
 * for a read-only one) — this component only owns the table mechanics.
 */
export function PayrollTable({
  title,
  subtitle,
  defaultCollapsed = false,
  frozenColumns, // [{ key, label, width, align }]
  months,
  monthWidth = 92,
  todayIso,
  // Whether future months get the app's ACT/FCST blue tint at all. Defaults to true
  // for tabs like Reports, which mix real reported months with genuine projections.
  // The whole Payroll tab is user-entered projection/calculation, never a pulled
  // "actual" figure, so every Payroll card passes tintForecast={false} — otherwise
  // every month after today reads as a misleading "this one's different" blue wash
  // (Kayee, 2026-08-05: "everything in here is only projection and calculations").
  tintForecast = true,
  totalRow, // { cells: {[frozenKey]: node}, monthCells: { [iso]: node } } | null
  rowGroups, // [{ key, label, rowModifier, rows: [{ id, cells: {...}, monthCells: {...}, className }] }]
  headActions,
  footer,
  // Skips the outer dark card chrome (background/border/collapse-toggle) and renders
  // just a small plain label + the table itself, so several of these can sit inside
  // ONE parent .payroll-card instead of each becoming its own separate box. Added for
  // the Assumptions tab's Revenue card (2026-08-04, Kayee: "all revenue related stuff
  // should be in one box") — defaults to false so Roster/Bonus/Total Comp, which DO
  // want to be their own distinct collapsible cards, are completely unaffected.
  embedded = false,
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  const offsets = useMemo(() => {
    const left = [];
    let acc = 0;
    for (const col of frozenColumns) {
      left.push(acc);
      acc += col.width;
    }
    return { left, totalWidth: acc };
  }, [frozenColumns]);

  const tableWidth = offsets.totalWidth + months.length * monthWidth;

  const tableMarkup = !collapsed && (
    <>
      <div className="payroll-table-wrap">
        <table className="payroll-table" style={{ width: tableWidth }}>
          <thead>
            <tr>
              {frozenColumns.map((col, i) => (
                <th
                  key={col.key}
                  className="pr-frozen pr-frozen-head"
                  style={{ width: col.width, left: offsets.left[i], textAlign: col.align || 'left' }}
                >
                  {col.label}
                </th>
              ))}
              {months.map((iso) => (
                <th key={iso} className={monthHeadClass(iso, todayIso, tintForecast)} style={{ width: monthWidth }}>
                  {formatMonthLabel(iso)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {totalRow && (
              // "total" (not a bespoke class) is exactly the app's existing black-band
              // total-row convention (globals.css `tbody tr.total td`) — reused here
              // rather than reinvented, per design-rules.md "reuse the reference
              // build's class names for the same purpose."
              <tr className="total">
                {frozenColumns.map((col, i) => (
                  <td
                    key={col.key}
                    className="pr-frozen"
                    style={{ width: col.width, left: offsets.left[i], textAlign: col.align || 'left' }}
                  >
                    {totalRow.cells[col.key]}
                  </td>
                ))}
                {months.map((iso) => (
                  <td key={iso} className={monthTintClass(iso, todayIso, tintForecast)} style={{ width: monthWidth }}>
                    {totalRow.monthCells[iso]}
                  </td>
                ))}
              </tr>
            )}

            {rowGroups.map((group) => (
              <RowGroup
                key={group.key}
                group={group}
                frozenColumns={frozenColumns}
                offsets={offsets}
                months={months}
                monthWidth={monthWidth}
                todayIso={todayIso}
                tintForecast={tintForecast}
              />
            ))}
          </tbody>
        </table>
      </div>
      {footer && <div className="payroll-card-footer">{footer}</div>}
    </>
  );

  if (embedded) {
    return (
      <div className="payroll-embedded">
        {(title || subtitle || headActions) && (
          <div className="payroll-embedded-head">
            {title && <span className="payroll-embedded-title">{title}</span>}
            {subtitle && <span className="payroll-embedded-sub">{subtitle}</span>}
            {headActions && <span className="payroll-card-actions">{headActions}</span>}
          </div>
        )}
        {tableMarkup}
      </div>
    );
  }

  return (
    <div className="payroll-card">
      {/* The collapse toggle is its own <button> (title + chevron only) rather than
          wrapping the whole header — headActions can contain a <select>/<button> of its
          own (e.g. Bonus's "+ Add bonus for…" picker), and nesting interactive elements
          inside a <button> is invalid HTML that misbehaves in real browsers. */}
      <div className="payroll-card-head">
        <button
          type="button"
          className="payroll-card-title-btn"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
        >
          <span className={`payroll-chevron${collapsed ? '' : ' open'}`}>▸</span>
          {title}
        </button>
        {subtitle && <span className="payroll-card-sub">{subtitle}</span>}
        {headActions && <span className="payroll-card-actions">{headActions}</span>}
      </div>

      {tableMarkup}
    </div>
  );
}

function monthHeadClass(iso, todayIso, tintForecast) {
  return `pr-month-head ${monthTintClass(iso, todayIso, tintForecast)}`;
}

function monthTintClass(iso, todayIso, tintForecast) {
  let cls = tintForecast && iso > todayIso ? 'pr-fcst' : 'pr-act';
  if (iso.endsWith('-01')) cls += ' pr-year-start';
  return cls;
}

function RowGroup({ group, frozenColumns, offsets, months, monthWidth, todayIso, tintForecast }) {
  if (!group.rows.length) return null;
  return (
    <>
      {group.label && (
        // "section" reuses the app's existing green-tinted section-band convention
        // (globals.css `tbody tr.section td`); `group.rowModifier` ('pr-tbd' /
        // 'pr-dismissed') swaps the tint for the Payroll tab's Planned/Dismissed
        // sub-sections, which don't exist anywhere else in this app.
        <tr className={`section${group.rowModifier ? ` ${group.rowModifier}` : ''}`}>
          <td
            className="pr-frozen pr-frozen-section"
            colSpan={frozenColumns.length}
            style={{ width: offsets.totalWidth, left: 0 }}
          >
            {group.label}
          </td>
          <td colSpan={months.length} />
        </tr>
      )}
      {group.rows.map((row) => (
        // draggable/onDrag*/onDrop are optional passthrough — only Roster rows supply
        // them (drag-to-reorder within a section), so Bonus/Total Comp/Summary rows
        // just render a plain, non-draggable <tr> as before (undefined props are a
        // no-op on a DOM element).
        <tr
          key={row.id}
          className={row.className}
          draggable={row.draggable}
          onDragStart={row.onDragStart}
          onDragOver={row.onDragOver}
          onDrop={row.onDrop}
          onDragEnd={row.onDragEnd}
        >
          {frozenColumns.map((col, i) => (
            <td
              key={col.key}
              className="pr-frozen"
              style={{ width: col.width, left: offsets.left[i], textAlign: col.align || 'left' }}
            >
              {row.cells[col.key]}
            </td>
          ))}
          {months.map((iso) => (
            <td key={iso} className={`pr-month-cell ${monthTintClass(iso, todayIso, tintForecast)}`} style={{ width: monthWidth }}>
              {row.monthCells[iso]}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/**
 * Editable monthly $ cell — commit on blur (never on keystroke, so typing "40000" digit
 * by digit doesn't spam onCommit), select-all + clear-if-zero on focus (written straight
 * to the DOM input so .select() grabs the right text before the next render), zero
 * renders as blank. Reused by both the Roster and Bonus cards.
 */
export function MonthInput({ value, onCommit }) {
  const [draft, setDraft] = useState(value ? String(Math.round(value)) : '');
  const [focused, setFocused] = useState(false);

  const display = focused ? draft : value ? String(Math.round(value)) : '';

  return (
    <input
      type="text"
      inputMode="decimal"
      className="pr-input pr-input-month"
      value={display}
      placeholder=""
      onFocus={(e) => {
        const current = value ? String(Math.round(value)) : '';
        const next = current === '0' ? '' : current;
        e.target.value = next;
        setDraft(next);
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
  );
}

/** Headcount-ramp month cell — used only on the Hiring Plan card: a role we don't have
 *  anyone in yet, planned to fill with several people over time (e.g. "Junior Creative
 *  Hire" ramping to 3 people by Dec 2026), matching the source sheet's own "New Hires
 *  per Month" headcount table (Kayee, 2026-08-05). The editable figure here is the
 *  INCREMENTAL new-hire count for that specific month (usually 0, occasionally 1+) —
 *  not a running total, so the user never has to retype the same cumulative number
 *  across every month after a hire (Kayee, 2026-08-05: "plug in the number month over
 *  month and it will count"). The $ caption underneath is always the resulting running
 *  cost (headcount-to-date x per-person loaded cost), computed automatically in
 *  payrollData.js (monthlyCostFor / cumulativeHeadcountFor), never typed directly. */
export function HeadcountMonthInput({ count, costPreview, onCommit }) {
  const [draft, setDraft] = useState(count ? String(count) : '');
  const [focused, setFocused] = useState(false);

  const display = focused ? draft : count ? String(count) : '';

  return (
    <div className="pr-headcount-cell">
      <input
        type="text"
        inputMode="numeric"
        className="pr-input pr-input-headcount"
        value={display}
        placeholder="0"
        onFocus={(e) => {
          const current = count ? String(count) : '';
          const next = current === '0' ? '' : current;
          e.target.value = next;
          setDraft(next);
          setFocused(true);
          e.target.select();
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const n = Math.max(0, Math.round(Number(String(draft).replace(/[^0-9.-]/g, '')) || 0));
          setFocused(false);
          onCommit(n);
        }}
      />
      {costPreview && <span className="pr-headcount-cost">{costPreview}</span>}
    </div>
  );
}

/** Free-typed text cell (name, title, custom department, etc.) — same commit-on-blur
 *  convention as MonthInput, so a click-away or tab-out is what actually saves it.
 *  `focusOnMount` is used for a newly-added roster row, so the user can start typing
 *  the name immediately instead of hunting for the new (collapsed-into-the-list) row. */
export function TextInput({ value, onCommit, placeholder, align, focusOnMount }) {
  const [draft, setDraft] = useState(value || '');
  const ref = useRef(null);

  useEffect(() => {
    if (focusOnMount && ref.current) {
      ref.current.scrollIntoView({ block: 'center', inline: 'nearest' });
      ref.current.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusOnMount]);

  return (
    <input
      ref={ref}
      type="text"
      className="pr-input"
      style={align ? { textAlign: align } : undefined}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={() => onCommit(draft)}
    />
  );
}

/** Discrete picker (date) — commits immediately on change, no typing session to debounce. */
export function DateInput({ value, onCommit }) {
  return (
    <input
      type="date"
      className="pr-input pr-input-date"
      value={value || ''}
      onChange={(e) => onCommit(e.target.value)}
    />
  );
}

/** Dropdown of known values plus a "+ Add new…" escape hatch that swaps in a text input
 *  for a one-off custom value — used for Department (design-rules-style convention
 *  carried over from the Payroll tab build notes). */
export function PickerInput({ value, options, onCommit, placeholder }) {
  const [customMode, setCustomMode] = useState(value ? !options.includes(value) : false);

  if (customMode) {
    return (
      <TextInput
        value={value}
        placeholder={placeholder}
        onCommit={(v) => {
          if (!v) setCustomMode(false);
          onCommit(v);
        }}
      />
    );
  }

  return (
    <select
      className="pr-input pr-select"
      value={value || ''}
      onChange={(e) => {
        if (e.target.value === '__add_new__') {
          setCustomMode(true);
          return;
        }
        onCommit(e.target.value);
      }}
    >
      <option value="">—</option>
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
      <option value="__add_new__">+ Add new…</option>
    </select>
  );
}

/** Small inline "fill a range with one value" bulk-edit control — pick a start month, end
 *  month, and value, apply across every month in between. Saves editing 20+ monthly
 *  cells by hand one at a time (Payroll build notes).
 *
 *  The popover is rendered through a portal into document.body at a `position: fixed`
 *  spot computed from the trigger button's own bounding box, rather than as a plain
 *  `position: absolute` child of the button. Roster/Bonus rows live inside
 *  `.payroll-table-wrap`, which needs `overflow: auto` for the sticky-column scrolling
 *  to work at all — an absolutely-positioned popover nested inside that ancestor gets
 *  clipped to its scroll box, so only a sliver of the popover's corner was ever visible
 *  (Kayee, 2026-08-05: "I click it but nothing show up but like a corner of the box").
 *  Escaping to a body-level portal sidesteps that clipping entirely. */
export function FillRangeButton({ months, onApply, valueLabel = 'Value', valuePlaceholder = '$' }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(months[0]);
  const [to, setTo] = useState(months[months.length - 1]);
  const [value, setValue] = useState('');
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const popRef = useRef(null);

  function updatePosition() {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 6, left: rect.left });
  }

  function toggleOpen() {
    if (!open) updatePosition();
    setOpen((o) => !o);
  }

  useEffect(() => {
    if (!open) return;
    function handleReposition() {
      updatePosition();
    }
    function handleOutside(e) {
      if (popRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    window.addEventListener('scroll', handleReposition, true);
    window.addEventListener('resize', handleReposition);
    document.addEventListener('mousedown', handleOutside);
    return () => {
      window.removeEventListener('scroll', handleReposition, true);
      window.removeEventListener('resize', handleReposition);
      document.removeEventListener('mousedown', handleOutside);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div className="pr-fill-wrap">
      {/* A small cell-with-a-fill-arrow icon (not three lines — that reads as a drag
          handle in almost every app, which this button isn't; Kayee, 2026-08-05: "why
          would I do it with the three lines click?"). This one visually says "take this
          one value and spread it across a range" instead. */}
      <button ref={btnRef} type="button" className="icon-btn" title="Fill a range of months with one value" onClick={toggleOpen}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="9" width="6" height="6" rx="1" />
          <path d="M9 12h8m0 0l-3-3m3 3l-3 3" />
        </svg>
      </button>
      {open &&
        pos &&
        createPortal(
          <div ref={popRef} className="pr-fill-pop" style={{ position: 'fixed', top: pos.top, left: pos.left }}>
            <div className="pr-fill-row">
              <label>From</label>
              <select value={from} onChange={(e) => setFrom(e.target.value)}>
                {months.map((m) => (
                  <option key={m} value={m}>
                    {formatMonthLabel(m)}
                  </option>
                ))}
              </select>
            </div>
            <div className="pr-fill-row">
              <label>To</label>
              <select value={to} onChange={(e) => setTo(e.target.value)}>
                {months.map((m) => (
                  <option key={m} value={m}>
                    {formatMonthLabel(m)}
                  </option>
                ))}
              </select>
            </div>
            <div className="pr-fill-row">
              <label>{valueLabel}</label>
              <input
                type="text"
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={valuePlaceholder}
              />
            </div>
            <div className="pr-fill-actions">
              <button type="button" className="btn" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  const n = Number(String(value).replace(/[^0-9.-]/g, '')) || 0;
                  const targetMonths = months.filter((m) => m >= from && m <= to);
                  onApply(targetMonths, n);
                  setOpen(false);
                  setValue('');
                }}
              >
                Apply
              </button>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
