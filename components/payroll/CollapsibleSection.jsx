'use client';

/**
 * Outer grouping box for the Payroll tab (Kayee, 2026-08-06: "make existing into one
 * box... that way if I want to collapse existing the whole base and bonus will be
 * collapsed together"). Sits one level above the individual black-headed
 * .payroll-card tables — Existing wraps the Employees + Bonus (existing) cards,
 * Planned wraps the Hiring Plan + Bonus (planned) cards, so a single click hides an
 * entire side of the roster instead of two separate cards one at a time.
 *
 * `colorVar` (a CSS custom property name, e.g. "--blue") drives the small dot in this
 * box's header — Payroll Summary's rows show the exact same colored dot next to the
 * matching line item, so the color is the visual thread connecting "this number" to
 * "this section" without anyone needing to read labels closely. `id` is the DOM anchor
 * Payroll Summary's rows scroll to when clicked.
 */
export function CollapsibleSection({ id, title, subtitle, colorVar, note, collapsed, onToggle, headActions, children }) {
  return (
    <div className="pr-outer-section" id={id}>
      <div className="pr-outer-head">
        <button
          type="button"
          className="payroll-card-title-btn"
          style={{ color: 'inherit', flex: 1 }}
          onClick={onToggle}
          aria-expanded={!collapsed}
        >
          <span className={`pr-outer-chevron${collapsed ? '' : ' open'}`}>▸</span>
          <span className="pr-outer-dot" style={{ background: `var(${colorVar})` }} />
          <span className="pr-outer-title">{title}</span>
          {subtitle && <span className="pr-outer-sub">{subtitle}</span>}
        </button>
        {headActions}
      </div>
      {note && !collapsed && <p className="pr-outer-note">{note}</p>}
      {!collapsed && <div className="pr-outer-body">{children}</div>}
    </div>
  );
}
