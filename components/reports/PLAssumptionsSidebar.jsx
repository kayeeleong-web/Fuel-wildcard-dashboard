'use client';

import { AssumptionField } from '../payroll/AssumptionsBar';
import { CostItemsCard } from '../assumptions/CostItemsCard';
import { RateScheduleControl } from './RateScheduleControl';

// Which rates each group lets you schedule a future change for (2026-08-07, Kayee:
// "if they want to switch from 3500 to 4500 in 2027... apply it and it will show up
// on a monthly basis"). Keyed to the exact revenue field + its companion `*Schedule`
// map in lib/assumptions/assumptionsData.js. Meeting Lag isn't here — it's a lag
// COUNT (months to look back), not a $ or % rate, so "schedule a change" doesn't
// apply to it the same way.
const TRANSACTION_SCHEDULE_FIELDS = [
  { key: 'perMeetingRate', scheduleKey: 'perMeetingRateSchedule', label: 'Per Meeting Rate', suffix: '$' },
  { key: 'meetingConversionPct', scheduleKey: 'meetingConversionPctSchedule', label: 'Meeting Conversion', suffix: '%' },
];
const SUBSCRIPTION_SCHEDULE_FIELDS = [
  { key: 'upfrontRate', scheduleKey: 'upfrontRateSchedule', label: 'Upfront Rate', suffix: '$' },
];
const COGS_SCHEDULE_FIELDS = [{ key: 'campaignCostRate', scheduleKey: 'campaignCostRateSchedule', label: 'Cost Per Campaign Rate', suffix: '$' }];

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
    // Full-height, black/white rail (2026-08-07, Kayee: "make hamburger more obvious
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
          {/* Each group is now 3 sections across (2026-08-07, Kayee: "you can arrange
              it so that the section fit... the apply one can be the third section, on
              the right"): the base rate field(s) on the left/middle, and a "schedule a
              future change" panel on the right — the base field still sets the rate
              used everywhere with no override; the panel on the right layers a
              date-ranged override on top of it (see RateScheduleControl). */}
          <div className="pr-assumption-group">
            <div className="pr-assumption-group-label">Transaction Revenue</div>
            <div className="pr-assumption-group-body">
              <div className="pr-assumption-group-fields">
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
              <RateScheduleControl fields={TRANSACTION_SCHEDULE_FIELDS} revenue={revenue} onChange={onRevenueChange} />
            </div>
          </div>

          <div className="pr-assumption-group">
            <div className="pr-assumption-group-label">Subscription Revenue</div>
            <div className="pr-assumption-group-body">
              <div className="pr-assumption-group-fields">
                <AssumptionField label="Upfront Rate" value={revenue.upfrontRate} onCommit={(v) => setRate('upfrontRate', v)} suffix="$" />
              </div>
              <RateScheduleControl fields={SUBSCRIPTION_SCHEDULE_FIELDS} revenue={revenue} onChange={onRevenueChange} />
            </div>
          </div>

          {/* Own group, separate from Subscription Revenue (2026-08-07, Kayee: "in
              cost, we should have another COGS assumption there for Cost per
              campaign") — Campaign Cost Rate feeds the "Cost of campaigns" COGS line,
              not a revenue line, so it doesn't belong grouped with a revenue rate even
              though it's driven by the same campaign count. */}
          <div className="pr-assumption-group">
            <div className="pr-assumption-group-label">COGS</div>
            <div className="pr-assumption-group-body">
              <div className="pr-assumption-group-fields">
                <AssumptionField
                  label="Cost Per Campaign Rate"
                  value={revenue.campaignCostRate}
                  onCommit={(v) => setRate('campaignCostRate', v)}
                  suffix="$"
                />
              </div>
              <RateScheduleControl fields={COGS_SCHEDULE_FIELDS} revenue={revenue} onChange={onRevenueChange} />
            </div>
          </div>

          <p className="pr-assumption-note" style={{ marginLeft: 0, maxWidth: 'none' }}>
            # of Campaigns and # of Meetings are now edited directly on the P&L, under Subscription Revenue and
            Transaction Revenue. Uncollectible % moved off this P&L view (2026-08-07) — it's a cash-collection
            adjustment, not an accrual one, so it belongs on Cash Flow instead; still editable on the Assumptions tab.
          </p>
        </div>
      </div>

      <CostItemsCard costItems={costItems} onChange={onCostItemsChange} />
    </div>
  );
}
