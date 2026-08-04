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
    countKey: 'reportsCount',
  },
  {
    id: 'custom',
    label: 'Custom',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="4" y1="6" x2="20" y2="6" />
        <circle cx="9" cy="6" r="2" fill="currentColor" stroke="none" />
        <line x1="4" y1="12" x2="20" y2="12" />
        <circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" />
        <line x1="4" y1="18" x2="20" y2="18" />
        <circle cx="11" cy="18" r="2" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    id: 'payroll',
    label: 'Payroll',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v10M9.5 9.5c0-1.1 1.1-2 2.5-2s2.5.75 2.5 1.75-1 1.5-2.5 1.75-2.5.75-2.5 1.75S10.6 15 12 15s2.5-.9 2.5-2" />
      </svg>
    ),
  },
  {
    id: 'assumptions',
    label: 'Assumptions',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9 3H5a2 2 0 00-2 2v4M15 3h4a2 2 0 012 2v4M9 21H5a2 2 0 01-2-2v-4M15 21h4a2 2 0 002-2v-4" />
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
