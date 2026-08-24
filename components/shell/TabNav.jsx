'use client';

/**
 * Tab navigation — design-rules.md §2 / functionality-spec.md §2.
 * Click hides every panel, shows the one matching the tab id — no page reload, no
 * data refetch (all data for all tabs is fetched once, server-side, in app/page.js
 * and passed down as props to every panel regardless of which is visible).
 */
const TABS = [
  {
    id: 'kpi',
    label: 'KPI Report',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 3v18h18" />
        <path d="M7 15l4-5 3 3 5-7" />
      </svg>
    ),
  },
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="7" height="9" rx="1" />
        <rect x="14" y="3" width="7" height="5" rx="1" />
        <rect x="14" y="12" width="7" height="9" rx="1" />
        <rect x="3" y="16" width="7" height="5" rx="1" />
      </svg>
    ),
  },
  {
    id: 'reports',
    label: 'Reports',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <path d="M14 2v6h6" />
      </svg>
    ),
    // countKey removed (2026-08-24, Kayee: "what does the 4 means. remove the 4") —
    // was showing customReportsList.length + 3 (the 3 fixed statement types + any
    // Custom reports) as a badge next to "Reports". Not useful info at a glance, so
    // dropped rather than relabeled.
  },
  // 2026-08-17: Moved Payroll and Assumptions into Projection sub-tabs (Kayee:
  // "you can now remove these two since you've already move to the projection tab")
  {
    id: 'projection',
    label: 'Projection',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="23 6 13.5 15.5 8 10 1 17" />
        <polyline points="17 6 23 6 23 12" />
      </svg>
    ),
  },
];

export function TabNav({ activeTab, onChange, reportsCount }) {
  return (
    <div className="tabnav-wrap">
      <div className="tabnav">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={tab.id === activeTab ? 'active' : undefined}
            onClick={() => onChange(tab.id)}
          >
            {tab.icon}
            {tab.label}
            {tab.countKey && typeof reportsCount === 'number' && (
              <span className="count">{reportsCount}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
