'use client';

import { AssumptionField } from '../payroll/AssumptionsBar';
import { CostItemsCard } from '../assumptions/CostItemsCard';

/**
 * P&L Assumptions sidebar (2026-08-06) — the Assumptions tab's Revenue Assumptions
 * (rates only; the monthly Campaigns/Meetings drivers now live embedded directly in
 * the P&L's Revenue section instead, see withRevenueDriverRows in ReportsPanel.jsx)
 * and Non-Headcount Costs table, merged into Reports so editing an assumption and
 * seeing its effect on the P&L happen in the same place (Kayee: "everything is being
 * in the same place, no need to switch between assumption and P&L").
 *
 * Stacks every rate field VERTICALLY (Kayee: "instead of horizontal make them
 * vertical... upfront fee first and then... per meeting rate and then the others") —
 * same <AssumptionField> used on the Payroll assumptions bar, just in a column
 * container instead of a wrapping row. Collapses to a slim hamburger rail so the P&L
 * table can reclaim the full page width when the sidebar isn't needed (Kayee: "like a
 * lot of major websites... if I click a button you can hide it into a hamburger").
 */
export function PLAssumptionsSidebar({ collapsed, onToggleCollapse, revenue, costItems, onRevenueChange, onCostItemsChange }) {
  if (collapsed) {
    // Full-height, brand-green rail (2026-08-07, Kayee: "make hamburger more obvious
    // because user might miss it") — a lone 28px icon square floating in an otherwise
    // empty column read as decoration, not a control. This spans the sidebar's whole
    // stretched height and carries a vertical "ASSUMPTIONS" label alongside the icon,
    // so there's no missing that something's tucked away here.
    return (
      <div className="reports-sidebar-rail">
        <button type="button" className="reports-sidebar-toggle-rail" title="Show Revenue Assumptions & Non-Headcount Costs" onClick={onToggleCollapse}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
          <span>Assumptions</span>
        </button>
      </div>
    );
  }

  if (!revenue || !costItems) {
    return (
      <div className="reports-sidebar">
        <div className="payroll-card">
          <div className="cap" style={{ padding: 18 }}>
            Loading saved assumptions…
          </div>
        </div>
      </div>
    );
  }

  function setRate(key, value) {
    onRevenueChange({ ...revenue, [key]: value });
  }

  return (
    <div className="reports-sidebar">
      <div className="payroll-card">
        <div className="payroll-card-head">
          <span className="payroll-card-title-btn" style={{ cursor: 'default' }}>
            Revenue Assumptions
          </span>
          <span className="payroll-card-actions">
            {/* Text label alongside the icon (2026-08-07) — same "make it obvious"
                reasoning as the collapsed rail; a bare icon in a black header bar full
                of other icon-less text was easy to skim past. */}
            <button type="button" className="reports-sidebar-toggle-open" title="Hide Assumptions" onClick={onToggleCollapse}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
              Hide
            </button>
          </span>
        </div>

        <div className="pr-assumption-sidebar-list">
          {/* Grouped + ordered to match the P&L itself (2026-08-07, Kayee: "arrange the
              boxes of revenue assumptions so that it will align with what's on the
              P&L... meeting rate should be next to transactional revenue... subscription
              revenue is # of Campaigns × Upfront Rate"). Transaction Revenue sits above
              Subscription Revenue on Kayee's sheet, so its rates come first here too —
              true row-for-row pixel alignment isn't possible across two independent
              layouts (unrelated P&L rows like Services Revenue sit between them), but
              grouping-by-stream in the same top-to-bottom order gets the same result:
              scroll to a group, and you're looking at the rates behind the matching P&L
              line right above it. */}
          <div className="pr-assumption-group">
            <div className="pr-assumption-group-label">Transaction Revenue</div>
            <div className="pr-assumption-group-grid">
              <AssumptionField
                label="Per Meeting Rate"
                value={revenue.perMeetingRate}
                onCommit={(v) => setRate('perMeetingRate', v)}
                suffix="$"
              />
              <AssumptionField
                label="Meeting Conversion"
                value={revenue.meetingConversionPct}
                onCommit={(v) => setRate('meetingConversionPct', v)}
              />
            </div>
            <AssumptionField
              label="Meeting Lag (months)"
              value={revenue.meetingsLagMonths}
              onCommit={(v) => setRate('meetingsLagMonths', v)}
              suffix="mo"
            />
          </div>

          <div className="pr-assumption-group">
            <div className="pr-assumption-group-label">Subscription Revenue</div>
            <div className="pr-assumption-group-grid">
              <AssumptionField label="Upfront Rate" value={revenue.upfrontRate} onCommit={(v) => setRate('upfrontRate', v)} suffix="$" />
              <AssumptionField
                label="Campaign Cost Rate"
                value={revenue.campaignCostRate}
                onCommit={(v) => setRate('campaignCostRate', v)}
                suffix="$"
              />
            </div>
          </div>

          <div className="pr-assumption-group">
            <div className="pr-assumption-group-label">Total Revenue</div>
            <AssumptionField label="Uncollectible" value={revenue.uncollectiblePct} onCommit={(v) => setRate('uncollectiblePct', v)} />
          </div>

          <p className="pr-assumption-note" style={{ marginLeft: 0, maxWidth: 'none' }}>
            # of Campaigns and # of Meetings are now edited directly on the P&L, under Subscription Revenue and
            Transaction Revenue.
          </p>
        </div>
      </div>

      <CostItemsCard costItems={costItems} onChange={onCostItemsChange} />
    </div>
  );
}
