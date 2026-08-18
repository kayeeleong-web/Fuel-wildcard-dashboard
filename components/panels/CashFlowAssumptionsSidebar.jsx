'use client';

import { useState } from 'react';

/**
 * Cash Flow Assumptions sidebar — control cash timing for each P&L line in the
 * Cash Flow projection. Same design as PLAssumptionsSidebar (2026-08-17, Kayee:
 * "cash timing is different... the flexibility to select pulling from p&l or
 * controlling cash timing like annually on which month or quarterly").
 */
export function CashFlowAssumptionsSidebar({ collapsed, onToggleCollapse, cashTimingState, onCashTimingChange }) {
  if (!cashTimingState) {
    return (
      <div className="reports-sidebar-rail">
        <button className="reports-sidebar-toggle" onClick={onToggleCollapse}>
          ☰
        </button>
      </div>
    );
  }

  const updateRowTiming = (rowKey, updates) => {
    const rows = cashTimingState.rowTimings || {};
    const current = rows[rowKey] || { mode: 'followPL' };
    const updated = { ...current, ...updates };
    onCashTimingChange({ ...cashTimingState, rowTimings: { ...rows, [rowKey]: updated } });
  };

  return (
    <>
      {!collapsed && (
        <div className="reports-sidebar">
          <div className="reports-sidebar-header">
            <h3>Cash Timing</h3>
            <button className="reports-sidebar-toggle" onClick={onToggleCollapse}>
              ✕
            </button>
          </div>

          <div className="sidebar-section">
            <h4 className="sidebar-section-label">Revenue</h4>
            <CashTimingCard
              rowKey="total_revenue"
              label="Total Revenue"
              timing={cashTimingState.rowTimings?.total_revenue}
              onUpdate={(updates) => updateRowTiming('total_revenue', updates)}
            />
          </div>

          <div className="sidebar-section">
            <h4 className="sidebar-section-label">COGS</h4>
            <CashTimingCard
              rowKey="total_cogs"
              label="Total COGS"
              timing={cashTimingState.rowTimings?.total_cogs}
              onUpdate={(updates) => updateRowTiming('total_cogs', updates)}
            />
          </div>

          <div className="sidebar-section">
            <h4 className="sidebar-section-label">OpEx</h4>
            <CashTimingCard
              rowKey="total_opex"
              label="Total OpEx"
              timing={cashTimingState.rowTimings?.total_opex}
              onUpdate={(updates) => updateRowTiming('total_opex', updates)}
            />
          </div>
        </div>
      )}

      {collapsed && (
        <div className="reports-sidebar-rail">
          <button className="reports-sidebar-toggle" onClick={onToggleCollapse}>
            ☰
          </button>
          <div className="reports-sidebar-rail-label">Cash Timing</div>
        </div>
      )}
    </>
  );
}

function CashTimingCard({ rowKey, label, timing, onUpdate }) {
  const mode = timing?.mode || 'followPL';
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="sidebar-card">
      <div className="sidebar-card-header">
        <span className="sidebar-card-label">{label}</span>
        <span className="sidebar-card-value">
          {mode === 'followPL' ? 'Follow P&L' : `Every ${timing.intervalMonths}mo`}
        </span>
      </div>

      {isExpanded && (
        <div className="sidebar-card-body">
          <div className="sidebar-control-group">
            <label className="sidebar-radio-label">
              <input
                type="radio"
                checked={mode === 'followPL'}
                onChange={() => onUpdate({ mode: 'followPL' })}
              />
              Follow P&L timing
            </label>

            <label className="sidebar-radio-label">
              <input
                type="radio"
                checked={mode === 'customInterval'}
                onChange={() => onUpdate({ mode: 'customInterval', intervalMonths: 3, payMonthOfCycle: 3 })}
              />
              Custom timing
            </label>
          </div>

          {mode === 'customInterval' && (
            <div className="sidebar-control-group" style={{ marginTop: '8px' }}>
              <label className="sidebar-input-label">Interval</label>
              <select
                value={timing.intervalMonths || 1}
                onChange={(e) => onUpdate({ intervalMonths: parseInt(e.target.value) })}
                className="sidebar-select"
              >
                <option value={1}>Monthly</option>
                <option value={3}>Quarterly</option>
                <option value={12}>Annually</option>
              </select>

              <label className="sidebar-input-label" style={{ marginTop: '6px' }}>
                Pay in month {timing.intervalMonths === 3 ? '(1-3)' : timing.intervalMonths === 12 ? '(1-12)' : ''}
              </label>
              <input
                type="number"
                min="1"
                max={timing.intervalMonths || 1}
                value={timing.payMonthOfCycle || 1}
                onChange={(e) => onUpdate({ payMonthOfCycle: parseInt(e.target.value) })}
                className="sidebar-input"
              />
            </div>
          )}
        </div>
      )}

      <button
        className="sidebar-card-toggle"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {isExpanded ? '▼' : '▶'} Details
      </button>
    </div>
  );
}
