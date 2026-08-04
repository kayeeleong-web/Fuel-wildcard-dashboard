'use client';

import { AssumptionField } from '../payroll/AssumptionsBar';
import { formatPayrollAmount } from '../../lib/payroll/payrollData';
import {
  upfrontRevenue,
  meetingRevenue,
  grossCollectedRevenue,
  netCollectedRevenue,
  costPerCampaign,
} from '../../lib/assumptions/assumptionsData';

/**
 * Revenue (+ shared campaign-cost) driver inputs — matches Kayee's "Gross Collected
 * Revenue in Summary from Customers and Revenue" sheet section. Every input here feeds
 * lib/assumptions/assumptionsData.js's revenue formulas, which are locked in and
 * verified against that sheet (see that file's header comment). This card also shows
 * the live computed result inline so a changed input is immediately checkable against
 * the source sheet.
 */
export function RevenueAssumptionsCard({ revenue, onChange }) {
  function set(key, value) {
    onChange({ ...revenue, [key]: value });
  }

  const upfront = upfrontRevenue(revenue);
  const meeting = meetingRevenue(revenue);
  const gross = grossCollectedRevenue(revenue);
  const net = netCollectedRevenue(revenue);
  const perCampaign = costPerCampaign(revenue);

  return (
    <div className="payroll-card">
      <div className="payroll-card-head">
        <span className="payroll-card-title-btn" style={{ cursor: 'default' }}>
          Revenue Assumptions
        </span>
        <span className="payroll-card-sub">Drives every projected month's Revenue &amp; Cost Per Campaign</span>
      </div>

      <div className="payroll-assumptions">
        <AssumptionField
          label="Uncollectible"
          value={revenue.uncollectiblePct}
          onCommit={(v) => set('uncollectiblePct', v)}
        />
        <AssumptionField
          label="Upfront $"
          value={revenue.upfrontPerCampaign}
          onCommit={(v) => set('upfrontPerCampaign', v)}
          suffix="$"
        />
        <AssumptionField
          label="Current Month Campaigns"
          value={revenue.currentMonthCampaigns}
          onCommit={(v) => set('currentMonthCampaigns', v)}
          suffix="#"
        />
        <AssumptionField
          label="Per Meeting $"
          value={revenue.perMeeting}
          onCommit={(v) => set('perMeeting', v)}
          suffix="$"
        />
        <AssumptionField
          label="Meeting Conversion"
          value={revenue.meetingConversionPct}
          onCommit={(v) => set('meetingConversionPct', v)}
        />
        <AssumptionField
          label={`Meetings (${revenue.meetingsLagMonths}mo lag)`}
          value={revenue.meetingsLagCount}
          onCommit={(v) => set('meetingsLagCount', v)}
          suffix="#"
        />
        <AssumptionField
          label="Campaign Cost"
          value={revenue.campaignCost}
          onCommit={(v) => set('campaignCost', v)}
          suffix="$"
        />
        <AssumptionField
          label="Last Month Campaigns"
          value={revenue.lastMonthCampaigns}
          onCommit={(v) => set('lastMonthCampaigns', v)}
          suffix="#"
        />
      </div>

      <div className="assump-preview">
        <div className="assump-preview-row">
          <span>Upfront Revenue</span>
          <b>{formatPayrollAmount(upfront) || '$0'}</b>
        </div>
        <div className="assump-preview-row">
          <span>Meeting Revenue</span>
          <b>{formatPayrollAmount(meeting) || '$0'}</b>
        </div>
        <div className="assump-preview-row">
          <span>Gross Collected Revenue</span>
          <b>{formatPayrollAmount(gross) || '$0'}</b>
        </div>
        <div className="assump-preview-row total">
          <span>Gross Collected Revenue — Uncollectible</span>
          <b>{formatPayrollAmount(net) || '$0'}</b>
        </div>
        <div className="assump-preview-row">
          <span>Cost Per Campaign (feeds COGS)</span>
          <b>{formatPayrollAmount(perCampaign) || '$0'}</b>
        </div>
      </div>
    </div>
  );
}
