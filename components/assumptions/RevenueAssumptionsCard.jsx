'use client';

import { AssumptionField } from '../payroll/AssumptionsBar';
import { MonthInput, PayrollTable } from '../payroll/PayrollTable';
import { MONTHS, currentIsoMonth, formatPayrollAmount } from '../../lib/payroll/payrollData';
import {
  campaignsForMonth,
  meetingsForMonth,
  upfrontRevenueForMonth,
  meetingRevenueForMonth,
  grossCollectedRevenueForMonth,
  netCollectedRevenueForMonth,
  costPerCampaignForMonth,
} from '../../lib/assumptions/assumptionsData';

const METRIC_COLUMN = [{ key: 'metric', label: '', width: 320 }];

/**
 * Revenue Assumptions — split into the three portions Kayee asked for (2026-08-04):
 * Rates (the constants), Subscription Revenue / Campaigns (monthly, editable — "how
 * many campaigns will I get month over month"), and Transactional Revenue / Meetings
 * (monthly, editable — "total # of meetings"). Upfront = subscription revenue,
 * Meeting = transactional/success-fee revenue, per Kayee's own framing.
 *
 * Campaigns and Meetings are genuinely monthly inputs now (not one flat number
 * repeated every month, which is what this card looked like before this rework) —
 * each is its own PayrollTable month-grid, same UI/interaction pattern as the Roster
 * and Bonus cards. A month with no meeting count entered yet shows an auto-suggested
 * figure (Meeting Conversion% x campaigns from N months ago) rather than a blank —
 * typing over it saves a real manual figure for that month, same as every other
 * editable cell in this app.
 */
export function RevenueAssumptionsCard({ revenue, onChange }) {
  const todayIso = currentIsoMonth();

  function setRate(key, value) {
    onChange({ ...revenue, [key]: value });
  }

  function setCampaign(iso, value) {
    onChange({ ...revenue, campaignsByMonth: { ...revenue.campaignsByMonth, [iso]: value } });
  }

  function setMeeting(iso, value) {
    onChange({ ...revenue, meetingsByMonth: { ...revenue.meetingsByMonth, [iso]: value } });
  }

  const campaignRows = [
    {
      id: 'campaigns',
      cells: { metric: '# of Campaigns' },
      monthCells: Object.fromEntries(
        MONTHS.map((iso) => [
          iso,
          <MonthInput key={iso} value={campaignsForMonth(revenue, iso)} onCommit={(n) => setCampaign(iso, n)} />,
        ])
      ),
    },
    {
      id: 'upfront',
      cells: { metric: <b>Upfront $ (Subscription Revenue)</b> },
      monthCells: Object.fromEntries(
        MONTHS.map((iso) => [iso, <b key={iso}>{formatPayrollAmount(upfrontRevenueForMonth(revenue, iso)) || '$0'}</b>])
      ),
    },
    {
      id: 'campaign-cost',
      cells: { metric: 'Cost Per Campaign (COGS, feeds next month)' },
      monthCells: Object.fromEntries(
        MONTHS.map((iso) => [iso, formatPayrollAmount(costPerCampaignForMonth(revenue, iso)) || '$0'])
      ),
    },
  ];

  const meetingRows = [
    {
      id: 'meetings',
      cells: { metric: '# of Meetings' },
      monthCells: Object.fromEntries(
        MONTHS.map((iso) => [
          iso,
          <MonthInput key={iso} value={meetingsForMonth(revenue, iso)} onCommit={(n) => setMeeting(iso, n)} />,
        ])
      ),
    },
    {
      id: 'meeting-revenue',
      cells: { metric: <b>Meeting $ (Transactional Revenue)</b> },
      monthCells: Object.fromEntries(
        MONTHS.map((iso) => [iso, <b key={iso}>{formatPayrollAmount(meetingRevenueForMonth(revenue, iso)) || '$0'}</b>])
      ),
    },
  ];

  const grossRow = {
    cells: { metric: <b>GROSS COLLECTED REVENUE</b> },
    monthCells: Object.fromEntries(
      MONTHS.map((iso) => [iso, <b key={iso}>{formatPayrollAmount(grossCollectedRevenueForMonth(revenue, iso)) || '$0'}</b>])
    ),
  };

  return (
    <div className="payroll-card">
      <div className="payroll-card-head">
        <span className="payroll-card-title-btn" style={{ cursor: 'default' }}>
          Revenue Assumptions
        </span>
        <span className="payroll-card-sub">Rates + monthly Campaigns &amp; Meetings drivers</span>
      </div>

      <div className="payroll-assumptions">
        <AssumptionField label="Upfront Rate" value={revenue.upfrontRate} onCommit={(v) => setRate('upfrontRate', v)} suffix="$" />
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
        <AssumptionField
          label="Meeting Conversion Time"
          value={revenue.meetingsLagMonths}
          onCommit={(v) => setRate('meetingsLagMonths', v)}
          suffix="mo"
        />
        {/* Renamed from "Uncollectible" (2026-08-10, Kayee's own naming: "name it risk
            buffer") — same underlying `uncollectiblePct` field, this is only the
            client-facing label. It nets out of Total Revenue on the P&L now too (see
            netCollectedRevenueForMonth / PL_REVENUE_PROJECTIONS in ReportsPanel.jsx) —
            Kayee's real sheet formula confirmed this is part of "Gross Collected
            Revenue" itself, not a Cash-Flow-only adjustment as first assumed. */}
        <AssumptionField label="Risk Buffer" value={revenue.uncollectiblePct} onCommit={(v) => setRate('uncollectiblePct', v)} />
        <AssumptionField
          label="Campaign Cost Rate"
          value={revenue.campaignCostRate}
          onCommit={(v) => setRate('campaignCostRate', v)}
          suffix="$"
        />
        <div className="pr-assumption-note">
          Upfront = subscription revenue, billed per campaign. Meeting = transactional success-fee revenue, billed
          per attended meeting. Meeting Conversion/Lag only auto-suggest a month's meeting count when nothing's
          been typed in for it yet — a typed-in figure always wins.
        </div>
      </div>

      <PayrollTable
        embedded
        title="Subscription Revenue — Campaigns"
        subtitle="Editable — how many campaigns per month"
        frozenColumns={METRIC_COLUMN}
        months={MONTHS}
        todayIso={todayIso}
        rowGroups={[{ key: 'campaigns', label: null, rows: campaignRows }]}
      />

      <PayrollTable
        embedded
        title="Transactional Revenue — Meetings"
        subtitle="Editable — how many meetings booked & attended per month"
        frozenColumns={METRIC_COLUMN}
        months={MONTHS}
        todayIso={todayIso}
        rowGroups={[{ key: 'meetings', label: null, rows: meetingRows }]}
      />

      <div className="assump-preview">
        <div className="assump-preview-row total">
          <span>Gross Collected Revenue ({todayIso})</span>
          <b>{formatPayrollAmount(grossCollectedRevenueForMonth(revenue, todayIso)) || '$0'}</b>
        </div>
        <div className="assump-preview-row">
          <span>Net of Risk Buffer</span>
          <b>{formatPayrollAmount(netCollectedRevenueForMonth(revenue, todayIso)) || '$0'}</b>
        </div>
      </div>
    </div>
  );
}
