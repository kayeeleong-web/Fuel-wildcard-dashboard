'use client';

import { useState } from 'react';
import { AssumptionField } from '../payroll/AssumptionsBar';
import { CostItemsCard } from '../assumptions/CostItemsCard';
import { ScheduledRateField } from './RateScheduleControl';

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
export function PLAssumptionsSidebar({ collapsed, onToggleCollapse, revenue, costItems, onRevenueChange, onCostItemsChange, costItemOrder }) {
  // 2026-08-20 (Kayee: "make it collapsable so that it's not just fit into one page...
  // keep it default collapse for each section, that way you can keep each and stay
  // when scroll") — collapsed by default so Revenue Assumptions + the CoGS/OpEx cost
  // cards below it stack to a short list inside the sticky sidebar (globals.css
  // .reports-sidebar) instead of overflowing/clipping past viewport height. Local to
  // this component, not persisted — reopens fresh each time the tab mounts.
  const [revenueOpen, setRevenueOpen] = useState(false);
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
      {/* Hide toggle sits ABOVE the cards, not inside the Revenue Assumptions header
          (2026-08-20, Kayee: "dont make the hide button inside of revenue assumption,
          make it like on top") — it collapses the WHOLE sidebar, so nesting it in one
          card's header made it read like it only hid that card. Text label alongside
          the icon (2026-08-07) — same "make it obvious" reasoning as the collapsed
          rail. */}
      <div className="reports-sidebar-toolbar">
        <button type="button" className="reports-sidebar-toggle-open" title="Hide Assumptions" onClick={onToggleCollapse}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
          Hide
        </button>
      </div>
      {/* Save button moved OUT of this sidebar entirely (2026-08-24, Kayee: first "move
          save button here... make it like a color so user wont miss" put it in
          ReportsPanel's legend row, then "sabe button is really ugly... right align
          all the way to the right" moved it again). It now lives in ProjectionPanel's
          own toolbar — the one row that spans the FULL page width — styled as a plain
          .btn like every other button, not a special color. That toolbar owns the one
          real useAssumptionsState() instance for this whole Projection tab now (see
          ProjectionPanel.jsx), so there's nothing to plumb through this component. */}

      <div className="payroll-card">
        <div className="payroll-card-head">
          <button
            type="button"
            className="payroll-card-title-btn"
            onClick={() => setRevenueOpen((o) => !o)}
            aria-expanded={revenueOpen}
          >
            <span className={`payroll-chevron${revenueOpen ? ' open' : ''}`}>▸</span>
            Revenue Assumptions
          </button>
        </div>

        {revenueOpen && (
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
          {/* Redesigned 2026-08-07 after Kayee's UX/FP&A framing question ("this is
              covering what's behind... maybe the apply a rate change can be hidden,
              only show up when I want it") — each schedulable field now uses
              <ScheduledRateField>, which keeps the CURRENT value front and center,
              shows any already-scheduled future change as one quiet line (no clicking
              needed to see it), and hides the actual add-a-change form behind a
              "+ Schedule a future change" link until it's wanted. See
              RateScheduleControl.jsx for the full reasoning. */}
          <div className="pr-assumption-group">
            <div className="pr-assumption-group-label">Transaction Revenue</div>
            <ScheduledRateField
              label="Per Meeting Rate"
              value={revenue.perMeetingRate}
              onCommit={(v) => setRate('perMeetingRate', v)}
              suffix="$"
              revenue={revenue}
              scheduleKey="perMeetingRateSchedule"
              onChange={onRevenueChange}
            />
            <ScheduledRateField
              label="Meeting Conversion"
              value={revenue.meetingConversionPct}
              onCommit={(v) => setRate('meetingConversionPct', v)}
              suffix="%"
              revenue={revenue}
              scheduleKey="meetingConversionPctSchedule"
              onChange={onRevenueChange}
            />
            {/* "Meeting Conversion Time" (2026-08-07, Kayee: "it's not called a
                meeting lag, the client sheet has it as Meeting Conversion Time") —
                same underlying `meetingsLagMonths` field, this is just the
                client-facing label correction. Not schedulable — it's a lag COUNT
                (months to look back), not a $ or % rate. */}
            <AssumptionField
              label="Meeting Conversion Time"
              value={revenue.meetingsLagMonths}
              onCommit={(v) => setRate('meetingsLagMonths', v)}
              suffix="mo"
            />
          </div>

          <div className="pr-assumption-group">
            <div className="pr-assumption-group-label">Subscription Revenue</div>
            <ScheduledRateField
              label="Upfront Rate"
              value={revenue.upfrontRate}
              onCommit={(v) => setRate('upfrontRate', v)}
              suffix="$"
              revenue={revenue}
              scheduleKey="upfrontRateSchedule"
              onChange={onRevenueChange}
            />
          </div>

          {/* Reinstated 2026-08-10 (Kayee, quoting her real sheet's actual formula:
              "=(Upfront$+Meeting$) - ((Upfront$+Meeting$)*RiskBuffer%)") — this WAS
              removed from the P&L view entirely on 2026-08-07 on the theory that an
              uncollectible-cash adjustment belongs on Cash Flow, not an accrual P&L.
              Kayee's own sheet proved that assumption wrong: the risk-buffer haircut
              is baked directly into "Gross Collected Revenue," which IS what feeds
              this P&L's Total Revenue line. Renamed "Uncollectible" -> "Risk Buffer"
              per Kayee's preference, same underlying `uncollectiblePct` field. Own
              group since it applies to the revenue TOTAL, not one stream. */}
          <div className="pr-assumption-group">
            <div className="pr-assumption-group-label">Total Revenue</div>
            <AssumptionField
              label="Risk Buffer"
              value={revenue.uncollectiblePct}
              onCommit={(v) => setRate('uncollectiblePct', v)}
              suffix="%"
            />
          </div>

          {/* Own group, separate from Subscription Revenue (2026-08-07, Kayee: "in
              cost, we should have another COGS assumption there for Cost per
              campaign") — Campaign Cost Rate feeds the "Cost of campaigns" COGS line,
              not a revenue line, so it doesn't belong grouped with a revenue rate even
              though it's driven by the same campaign count. */}
          <div className="pr-assumption-group">
            <div className="pr-assumption-group-label">COGS</div>
            <ScheduledRateField
              label="Cost Per Campaign Rate"
              value={revenue.campaignCostRate}
              onCommit={(v) => setRate('campaignCostRate', v)}
              suffix="$"
              revenue={revenue}
              scheduleKey="campaignCostRateSchedule"
              onChange={onRevenueChange}
            />
          </div>

        </div>
        )}
      </div>

      {/* Split into one card per Category (2026-08-10, Kayee: "can you divide non
          headcount cost to cogs and opex? so that user no longer need to select
          those") — which card's "+ Add Cost" you use IS the category now, instead of a
          per-row picker. `costItems`/`onCostItemsChange` are the full list in both
          cases; each card just filters to its own category for display (see
          CostItemsCard's own doc comment). An "Other Costs" card only shows up if
          there's actually a non-operating item to show — most clients will never see
          it, so it doesn't compete for attention with the two real categories. */}
      <CostItemsCard
        costItems={costItems}
        onChange={onCostItemsChange}
        itemOrder={costItemOrder}
        category="CoGS"
        title="Non-Headcount Cost - CoGS"
        addLabel="+ Add CoGS Cost"
        defaultCollapsed
      />
      <CostItemsCard
        costItems={costItems}
        onChange={onCostItemsChange}
        itemOrder={costItemOrder}
        category="OpEx"
        title="Non-Headcount Cost - OpEx"
        addLabel="+ Add OpEx Cost"
        defaultCollapsed
      />
      {costItems.some((i) => i.category === 'Other') && (
        <CostItemsCard
          costItems={costItems}
          onChange={onCostItemsChange}
          itemOrder={costItemOrder}
          category="Other"
          title="Non-Headcount Cost - Other"
          addLabel="+ Add Cost"
          defaultCollapsed
        />
      )}
    </div>
  );
}
