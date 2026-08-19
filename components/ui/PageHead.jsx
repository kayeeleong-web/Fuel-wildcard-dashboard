/**
 * Page head pattern — design-rules.md §2. h1 (+ optional one-line muted description)
 * on the left, page-specific controls/actions on the right. This left/right split is
 * fixed across every tab — don't move the title or bury actions on the left.
 *
 * subtitle is optional (2026-08-18, Kayee: "so much space wasted... I already know
 * that this in in report" — every tab's subtitle just restated what the tab name and
 * its own sub-nav already said). Omitting it drops the whole <p> including its
 * margin-top, so a tab that no longer passes subtitle actually gets the space back
 * rather than rendering an empty paragraph that still takes up a line.
 */
export function PageHead({ title, subtitle, children }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children && <div className="head-actions">{children}</div>}
    </div>
  );
}
