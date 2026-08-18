'use client';

import { useState } from 'react';

/**
 * Cash Flow Assumptions sidebar (2026-08-17, Kayee: "let's start building out
 * cash inflow mechanism... current customer total plus projection how many client
 * they have... it needs to be granular"). Three sections: Revenue (customer
 * assumptions + pricing), COGS (GL accounts + timing), OpEx (GL accounts + timing).
 */
export function CashFlowAssumptionsSidebar({ collapsed, onToggleCollapse, cashFlowState, onCashFlowChange }) {
  if (!cashFlowState) {
    return (
      <div className="reports-sidebar-rail">
        <button className="reports-sidebar-toggle" onClick={onToggleCollapse}>
          ☰
        </button>
      </div>
    );
  }

  const updateRevenue = (updates) => {
    onCashFlowChange({ ...cashFlowState, revenue: { ...cashFlowState.revenue, ...updates } });
  };

  const updateAccountTiming = (glAccountId, timing) => {
    const timingByAccount = cashFlowState.timingByAccount || {};
    onCashFlowChange({
      ...cashFlowState,
      timingByAccount: { ...timingByAccount, [glAccountId]: timing },
    });
  };

  return (
    <>
      {!collapsed && (
        <div className="reports-sidebar">
          <div className="reports-sidebar-header">
            <h3>Cash Assumptions</h3>
            <button className="reports-sidebar-toggle" onClick={onToggleCollapse}>
              ✕
            </button>
          </div>

          {/* Revenue Inflow Section */}
          <div className="sidebar-section">
            <h4 className="sidebar-section-label">Revenue Inflow</h4>
            <div className="sidebar-card">
              <div className="sidebar-card-header">
                <span className="sidebar-card-label">Customer Assumptions</span>
              </div>
              <div className="sidebar-card-body">
                <div className="sidebar-control-group">
                  <label className="sidebar-input-label">Current Customers</label>
                  <input
                    type="number"
                    value={cashFlowState.revenue?.currentCustomers || 0}
                    onChange={(e) => updateRevenue({ currentCustomers: parseInt(e.target.value) || 0 })}
                    className="sidebar-input"
                  />
                </div>
                <div className="sidebar-control-group">
                  <label className="sidebar-input-label">New Customers (Projected)</label>
                  <input
                    type="number"
                    value={cashFlowState.revenue?.projectedNewCustomers || 0}
                    onChange={(e) => updateRevenue({ projectedNewCustomers: parseInt(e.target.value) || 0 })}
                    className="sidebar-input"
                  />
                </div>
                <div className="sidebar-control-group">
                  <label className="sidebar-input-label">Upfront Per Customer ($)</label>
                  <input
                    type="number"
                    value={cashFlowState.revenue?.upfrontPerCustomer || 0}
                    onChange={(e) => updateRevenue({ upfrontPerCustomer: parseInt(e.target.value) || 0 })}
                    className="sidebar-input"
                  />
                </div>
                <div className="sidebar-control-group">
                  <label className="sidebar-input-label">Meeting Price Per Customer ($)</label>
                  <input
                    type="number"
                    value={cashFlowState.revenue?.meetingPrice || 0}
                    onChange={(e) => updateRevenue({ meetingPrice: parseInt(e.target.value) || 0 })}
                    className="sidebar-input"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* COGS Outflow Section */}
          <div className="sidebar-section">
            <h4 className="sidebar-section-label">COGS Outflow</h4>
            {cashFlowState.cogsAccounts?.map((account) => (
              <CashTimingAccountCard
                key={account.id}
                account={account}
                timing={cashFlowState.timingByAccount?.[account.id]}
                onUpdate={(timing) => updateAccountTiming(account.id, timing)}
              />
            ))}
          </div>

          {/* OpEx Outflow Section */}
          <div className="sidebar-section">
            <h4 className="sidebar-section-label">OpEx Outflow</h4>
            {cashFlowState.opexAccounts?.map((account) => (
              <CashTimingAccountCard
                key={account.id}
                account={account}
                timing={cashFlowState.timingByAccount?.[account.id]}
                onUpdate={(timing) => updateAccountTiming(account.id, timing)}
              />
            ))}
          </div>
        </div>
      )}

      {collapsed && (
        <div className="reports-sidebar-rail">
          <button className="reports-sidebar-toggle" onClick={onToggleCollapse}>
            ☰
          </button>
          <div className="reports-sidebar-rail-label">Cash Assumptions</div>
        </div>
      )}
    </>
  );
}

function CashTimingAccountCard({ account, timing, onUpdate }) {
  const mode = timing?.mode || 'followPL';
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="sidebar-card" style={{ marginBottom: '8px' }}>
      <div className="sidebar-card-header">
        <span className="sidebar-card-label">{account.label}</span>
        <span className="sidebar-card-value">{mode === 'followPL' ? 'Follow P&L' : `Every ${timing?.intervalMonths}mo`}</span>
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
                onChange={() => onUpdate({ mode: 'customInterval', intervalMonths: 1, payMonthOfCycle: 1 })}
              />
              Custom timing
            </label>
          </div>

          {mode === 'customInterval' && (
            <div className="sidebar-control-group" style={{ marginTop: '8px' }}>
              <label className="sidebar-input-label">Interval</label>
              <select value={timing?.intervalMonths || 1} onChange={(e) => onUpdate({ ...timing, intervalMonths: parseInt(e.target.value) })} className="sidebar-select">
                <option value={1}>Monthly</option>
                <option value={3}>Quarterly</option>
                <option value={12}>Annually</option>
              </select>

              <label className="sidebar-input-label" style={{ marginTop: '6px' }}>
                Pay in month {timing?.intervalMonths === 3 ? '(1-3)' : timing?.intervalMonths === 12 ? '(1-12)' : ''}
              </label>
              <input
                type="number"
                min="1"
                max={timing?.intervalMonths || 1}
                value={timing?.payMonthOfCycle || 1}
                onChange={(e) => onUpdate({ ...timing, payMonthOfCycle: parseInt(e.target.value) })}
                className="sidebar-input"
              />
            </div>
          )}
        </div>
      )}

      <button className="sidebar-card-toggle" onClick={() => setIsExpanded(!isExpanded)}>
        {isExpanded ? '▼' : '▶'} Details
      </button>
    </div>
  );
}
