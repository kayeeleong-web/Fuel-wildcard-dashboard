'use client';

import { useState } from 'react';

/**
 * Cash Flow Assumptions sidebar — control cash timing for each P&L line in the
 * Cash Flow projection. Same left-hand sidebar pattern as PLAssumptionsSidebar
 * (2026-08-17, Kayee: "cash timing is different... the flexibility to select pulling
 * from p&l or controlling cash timing like annually on which month or quarterly").
 *
 * For each row, choose: follow P&L accrual timing, or override with:
 * - Interval + month: "quarterly, pay in month 1/2/3" or "annual, pay in December"
 * - (Future: manual monthly distribution)
 */
export function CashFlowAssumptionsSidebar({ collapsed, onToggleCollapse, cashTimingState, onCashTimingChange }) {
  const [expandedRow, setExpandedRow] = useState(null);

  if (!cashTimingState) {
    return (
      <div className="reports-sidebar-rail">
        <button className="reports-sidebar-toggle" onClick={onToggleCollapse}>
          ☰
        </button>
      </div>
    );
  }

  const toggleRowTiming = (rowKey) => {
    setExpandedRow(expandedRow === rowKey ? null : rowKey);
  };

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

          <div className="cash-timing-container">
            <div className="cash-timing-note">
              Control when cash flows compared to P&L accrual. Default: follow P&L timing.
            </div>

            {/* Revenue rows — typically accrual-based in P&L but collected differently */}
            <div className="cash-timing-section">
              <h4 className="cash-timing-section-title">Revenue Timing</h4>
              <CashTimingRow
                rowKey="total_revenue"
                label="Total Revenue"
                timing={cashTimingState.rowTimings?.total_revenue}
                isExpanded={expandedRow === 'total_revenue'}
                onToggle={() => toggleRowTiming('total_revenue')}
                onUpdate={(updates) => updateRowTiming('total_revenue', updates)}
              />
            </div>

            {/* COGS — typically accrued but paid on different schedule */}
            <div className="cash-timing-section">
              <h4 className="cash-timing-section-title">COGS Timing</h4>
              <CashTimingRow
                rowKey="total_cogs"
                label="Total COGS"
                timing={cashTimingState.rowTimings?.total_cogs}
                isExpanded={expandedRow === 'total_cogs'}
                onToggle={() => toggleRowTiming('total_cogs')}
                onUpdate={(updates) => updateRowTiming('total_cogs', updates)}
              />
            </div>

            {/* OpEx — often accrued monthly but some costs (e.g., software) paid quarterly/annually */}
            <div className="cash-timing-section">
              <h4 className="cash-timing-section-title">OpEx Timing</h4>
              <CashTimingRow
                rowKey="total_opex"
                label="Total OpEx"
                timing={cashTimingState.rowTimings?.total_opex}
                isExpanded={expandedRow === 'total_opex'}
                onToggle={() => toggleRowTiming('total_opex')}
                onUpdate={(updates) => updateRowTiming('total_opex', updates)}
              />
            </div>
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

function CashTimingRow({ rowKey, label, timing, isExpanded, onToggle, onUpdate }) {
  const mode = timing?.mode || 'followPL';

  return (
    <div className="cash-timing-row">
      <button className="cash-timing-row-header" onClick={onToggle}>
        <span className={`cash-timing-chevron${isExpanded ? ' open' : ''}`}>▸</span>
        <span className="cash-timing-row-label">{label}</span>
        <span className="cash-timing-row-summary">
          {mode === 'followPL' ? 'Follow P&L' : mode === 'customInterval' ? `Every ${timing.intervalMonths}mo, month ${timing.payMonthOfCycle}` : ''}
        </span>
      </button>

      {isExpanded && (
        <div className="cash-timing-row-detail">
          <div className="cash-timing-mode-picker">
            <label className="cash-timing-option">
              <input
                type="radio"
                name={`${rowKey}-mode`}
                value="followPL"
                checked={mode === 'followPL'}
                onChange={() => onUpdate({ mode: 'followPL' })}
              />
              <span>Follow P&L timing</span>
            </label>

            <label className="cash-timing-option">
              <input
                type="radio"
                name={`${rowKey}-mode`}
                value="customInterval"
                checked={mode === 'customInterval'}
                onChange={() => onUpdate({ mode: 'customInterval', intervalMonths: 1, payMonthOfCycle: 1 })}
              />
              <span>Custom interval</span>
            </label>
          </div>

          {mode === 'customInterval' && (
            <div className="cash-timing-custom-controls">
              <div className="cash-timing-control-group">
                <label htmlFor={`${rowKey}-interval`}>Interval</label>
                <select
                  id={`${rowKey}-interval`}
                  value={timing.intervalMonths || 1}
                  onChange={(e) => onUpdate({ intervalMonths: parseInt(e.target.value) })}
                >
                  <option value={1}>Monthly</option>
                  <option value={3}>Quarterly</option>
                  <option value={12}>Annually</option>
                </select>
              </div>

              <div className="cash-timing-control-group">
                <label htmlFor={`${rowKey}-payMonth`}>
                  {timing.intervalMonths === 3
                    ? 'Which quarter month (1-3)'
                    : timing.intervalMonths === 12
                      ? 'Which month (1-12)'
                      : 'Month'}
                </label>
                <input
                  id={`${rowKey}-payMonth`}
                  type="number"
                  min="1"
                  max={timing.intervalMonths || 1}
                  value={timing.payMonthOfCycle || 1}
                  onChange={(e) => onUpdate({ payMonthOfCycle: parseInt(e.target.value) })}
                />
              </div>

              {timing.intervalMonths === 12 && (
                <div className="cash-timing-helper-text">
                  Month 12 = December, Month 1 = January, etc.
                </div>
              )}
              {timing.intervalMonths === 3 && (
                <div className="cash-timing-helper-text">
                  Month 1 = 1st month of quarter (Jan/Apr/Jul/Oct), Month 3 = last month
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
