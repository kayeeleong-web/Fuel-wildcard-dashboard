'use client';

import { useMemo, useState } from 'react';
import { buildCustomerWaterfall } from '../../lib/data/customerData';
import { PayrollTable } from '../payroll/PayrollTable';
import { CollapsibleSection } from '../payroll/CollapsibleSection';
import { DealProjectionSection } from '../customer/DealProjectionSection';
import { useDealsState } from '../../lib/deals/useDealsState';
import { currentIsoMonth, formatMonthLabel, formatPayrollAmount, monthsForRange } from '../../lib/payroll/payrollData';

/**
 * Customer Cash Flow tab — part of Projection (2026-08-17, Kayee: "let's build a
 * customer tab just like payroll inside of projection... i want to see the flow like
 * month over month cash movement for customer from GL Cash and then Accrued GL").
 *
 * Sections (2026-08-18, Kayee: merged the three inflow cards into ONE — "one section,
 * one card", summary promoted to the top):
 *  - Current Customers: TWO cohort-style waterfall tables built live from the raw GL
 *    exports — Cash (GL Cash tab: when money was actually received) and Accrued
 *    (GL Accrued tab: when revenue was recognized).
 *  - Customer Revenue Projection (2026-09-07 — REPLACES the former "Cash Inflow
 *    Projection" campaigns/meetings grids, Kayee: "what we had before, we don't want it
 *    anymore"): the deal-based framework from Kayee's Google Sheet model. One block per
 *    contract line item (Stage / Probability / Contract Value / Term / Signing month /
 *    Recognition Start Rule / Cash Timing / Payment Terms / Success Fee / Campaigns per
 *    month / Price & Cost per campaign / Invoice Lag), each computing Contract Accrual &
 *    Cash, Success Fee Accrual & Cash, Meetings Scheduled, Campaign COGS Accrual & Cash;
 *    the four TOTAL rows at the top (Accrual Revenue, Cash In, Accrual COGS, Cash Out)
 *    are what the P&L and Cash Flow projections read. Every deal field is meant to come
 *    from the CSM (Slurp Bot) by default with an in-tab override — see
 *    components/customer/DealProjectionSection.jsx + lib/deals/dealsData.js.
 *
 * P&L / CF LINK: useDealsState writes the computed monthly totals to localStorage under
 * DEAL_PROJECTION_STORAGE_KEY (lib/deals/dealsData.js) on every change; ReportsPanel
 * (a sibling that remounts on tab switch) reads it on mount via readCustomerInflowTotals /
 * readDealProjection and attaches it to the revenue object every P&L/CF driver reads
 * (`revenue.dealProjection`, see lib/assumptions/assumptionsData.js).
 *
 * All inputs persist to this browser's localStorage (hydrate-then-save, same pattern
 * as usePayrollState) — this is planning data, never written back to the sheet.
 */

// Suffix appended to the waterfall subtitle when the Transaction/Subscription
// revenue-stream toggle narrows the table below "All" (2026-08-20).
const REVENUE_STREAM_SUBTITLE = {
  all: '',
  transaction: ' · Transaction Revenue only (account 42000)',
  subscription: ' · Subscription Revenue only (account 40000)',
};

const WATERFALL_FROZEN_COLUMNS = [
  { key: 'name', label: 'Customer', width: 200 },
  { key: 'startMonth', label: 'Start', width: 84 },
  { key: 'total', label: 'Total', width: 104, align: 'right' },
];

/** The Dashboard tab's established misconfigured-data pattern (h3 + .cap) — a GL tab
 *  that's missing or has renamed columns must be VISIBLY broken, never quietly empty. */
function MisconfiguredNotice({ tab, message }) {
  return (
    <div style={{ margin: '8px 0 16px' }}>
      <h3>{tab} — data source misconfigured</h3>
      <div className="cap">
        {message} See the GL tab contract in <code>lib/data/sources/googleSheets.ts</code>.
      </div>
    </div>
  );
}

/** One read-only cohort waterfall table (Cash or Accrued), on the shared frozen-column
 *  PayrollTable shell — same mechanics as the Payroll tab's wide tables. */
function WaterfallTable({ title, subtitle, waterfall, months, todayIso }) {
  const rows = waterfall.customers.map((customer) => {
    const monthCells = {};
    for (const iso of months) {
      monthCells[iso] = formatPayrollAmount(customer.byMonth[iso]);
    }
    return {
      id: customer.name,
      monthCells,
      cells: {
        // Never let a long name wrap to a second line (2026-08-20, Kayee, pointing at
        // "Uncategorized (no counterparty)" wrapping: "because this text is longer it
        // went into the wrap in the second row which makes the entire row bigger. i
        // want the height of each row the same") — one line, ellipsis if it overruns
        // the 200px column, full name on hover via title.
        name: (
          <span className="pr-nowrap-cell" title={customer.name}>
            {customer.name}
          </span>
        ),
        startMonth: formatMonthLabel(customer.startMonth),
        total: <b>{formatPayrollAmount(customer.total) || '$0'}</b>,
      },
    };
  });

  const totalRow = {
    cells: {
      name: <b>TOTAL</b>,
      total: (
        <b>
          {formatPayrollAmount(waterfall.customers.reduce((acc, c) => acc + c.total, 0)) || '$0'}
        </b>
      ),
    },
    monthCells: Object.fromEntries(
      months.map((iso) => {
        const sum = waterfall.customers.reduce((acc, c) => acc + (c.byMonth[iso] || 0), 0);
        return [iso, <b key={iso}>{formatPayrollAmount(sum) || '$0'}</b>];
      })
    ),
  };

  return (
    <PayrollTable
      title={title}
      subtitle={subtitle}
      tintForecast={false}
      frozenColumns={WATERFALL_FROZEN_COLUMNS}
      months={months}
      todayIso={todayIso}
      totalRow={totalRow}
      rowGroups={[{ key: 'customers', label: null, rows }]}
    />
  );
}

/* ----------------------------------- Panel ----------------------------------- */

export function CustomerPanel({ glCash, glAccrued, dealsCtl }) {
  const todayIso = currentIsoMonth();
  const [range, setRange] = useState('default');
  // Cash vs Accrued waterfall toggle (2026-08-19, Kayee: "instead of having two
  // section can you just create a toggle in an obvious place? like switch between
  // accrual and cash... so that it's not that redundant and clunky").
  const [waterfallView, setWaterfallView] = useState('cash');
  // Transaction vs Subscription revenue-stream toggle (2026-08-20) — same two streams
  // the P&L/CF model as "Transaction Revenue" (account 42000) and "Subscription
  // Revenue" (account 40000); 'all' keeps every 4xxxx revenue account.
  const [revenueStream, setRevenueStream] = useState('all');
  const [collapsedSections, setCollapsedSections] = useState({ current: false, projection: false });

  // ProjectionPanel owns the deals hook so its toolbar Save button acts on the same
  // live state (2026-08-24 pattern); falls back to an internal hook when mounted alone.
  const internalDeals = useDealsState({ writeHandoff: !dealsCtl });
  const deals = dealsCtl || internalDeals;

  function toggleSection(key) {
    setCollapsedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const cashWaterfall = useMemo(() => buildCustomerWaterfall(glCash?.transactions, revenueStream), [glCash, revenueStream]);
  const accruedWaterfall = useMemo(() => buildCustomerWaterfall(glAccrued?.transactions, revenueStream), [glAccrued, revenueStream]);

  // 'default' spans the full Jan-2026..Dec-2028 window (2026-08-20, Kayee: "I dont like
  // that there's a white space here"); 'all' keeps every month the GL actually has.
  const cashMonths = range === 'all' ? cashWaterfall.months : monthsForRange('default');
  const accruedMonths = range === 'all' ? accruedWaterfall.months : monthsForRange('default');

  // Deal projection months: Jan-2026 forward (nothing to project before that), full
  // 2026-2028 window by default; 'all' reaches back through 2025 for the same grid.
  const planMonths = monthsForRange(range).filter((iso) => range === 'all' || iso >= '2026-01');

  return (
    <>
      <div className="page-wide">
        {/* -------------------------- Current Customers -------------------------- */}
        <CollapsibleSection
          title="Current Customers"
          subtitle="Waterfall by start month — Cash (received) or Accrued (recognized) · GL accounts 4xxxx"
          colorVar="--blue"
          collapsed={collapsedSections.current}
          onToggle={() => toggleSection('current')}
          headActions={
            <div style={{ display: 'flex', gap: 8 }} onClick={(e) => e.stopPropagation()}>
              <div className="seg">
                <button className={range === 'default' ? 'active' : undefined} onClick={() => setRange('default')}>
                  2026 – 2028
                </button>
                <button className={range === 'all' ? 'active' : undefined} onClick={() => setRange('all')}>
                  All
                </button>
              </div>
              <div className="seg">
                <button className={waterfallView === 'cash' ? 'active' : undefined} onClick={() => setWaterfallView('cash')}>
                  Cash
                </button>
                <button className={waterfallView === 'accrued' ? 'active' : undefined} onClick={() => setWaterfallView('accrued')}>
                  Accrued
                </button>
              </div>
              <div className="seg">
                <button className={revenueStream === 'all' ? 'active' : undefined} onClick={() => setRevenueStream('all')}>
                  All
                </button>
                <button className={revenueStream === 'transaction' ? 'active' : undefined} onClick={() => setRevenueStream('transaction')}>
                  Transaction
                </button>
                <button className={revenueStream === 'subscription' ? 'active' : undefined} onClick={() => setRevenueStream('subscription')}>
                  Subscription
                </button>
              </div>
            </div>
          }
        >
          {waterfallView === 'cash' ? (
            glCash?.error ? (
              <MisconfiguredNotice tab="GL Cash" message={glCash.error} />
            ) : (
              <WaterfallTable
                title="Cash Waterfall — GL Cash"
                subtitle={`${cashWaterfall.customers.length} customer${
                  cashWaterfall.customers.length === 1 ? '' : 's'
                } · cash received per month, ordered by start month${REVENUE_STREAM_SUBTITLE[revenueStream]}`}
                waterfall={cashWaterfall}
                months={cashMonths}
                todayIso={todayIso}
              />
            )
          ) : glAccrued?.error ? (
            <MisconfiguredNotice tab="GL Accrued" message={glAccrued.error} />
          ) : (
            <WaterfallTable
              title="Accrued Waterfall — GL Accrued"
              subtitle={`${accruedWaterfall.customers.length} customer${
                accruedWaterfall.customers.length === 1 ? '' : 's'
              } · revenue recognized per month, ordered by start month${REVENUE_STREAM_SUBTITLE[revenueStream]}`}
              waterfall={accruedWaterfall}
              months={accruedMonths}
              todayIso={todayIso}
            />
          )}
        </CollapsibleSection>

        <div style={{ height: 20 }} />

        {/* ---------------------- Customer Revenue Projection ---------------------- */}
        <CollapsibleSection
          title="Customer Revenue Projection"
          subtitle="Per-deal accrual & cash · contract + success fees + campaign COGS · fields default from the CSM, editable here — feeds the P&L and Cash Flow Projections"
          colorVar="--purple"
          collapsed={collapsedSections.projection}
          onToggle={() => toggleSection('projection')}
        >
          <DealProjectionSection dealsCtl={deals} months={planMonths} todayIso={todayIso} />
        </CollapsibleSection>
      </div>
    </>
  );
}
