'use client';

import { useEffect, useMemo, useState } from 'react';
import { PageHead } from '../ui/PageHead';
import { buildCustomerWaterfall } from '../../lib/data/customerData';
import { MonthInput, PayrollTable, TextInput } from '../payroll/PayrollTable';
import {
  currentIsoMonth,
  formatMonthLabel,
  formatPayrollAmount,
  generateId,
  monthsForRange,
} from '../../lib/payroll/payrollData';

/**
 * Customer Cash Flow tab — part of Projection (2026-08-17, Kayee: "let's build a
 * customer tab just like payroll inside of projection... i want to see the flow like
 * month over month cash movement for customer from GL Cash and then Accrued GL").
 *
 * Two sections:
 *  - Current Customers: TWO cohort-style waterfall tables built live from the raw GL
 *    exports — Cash (GL Cash tab: when money was actually received) and Accrued
 *    (GL Accrued tab: when revenue was recognized). Customers are ordered by start
 *    month (first non-zero month) so each table reads like a cohort waterfall.
 *  - Customer Planning: a hiring-plan-style what-if table — planned customers with an
 *    upfront payment + monthly recurring amount, saved to this browser's localStorage
 *    (same pattern as the Payroll tab, lib/payroll/usePayrollState.js — deliberately
 *    NOT written back to the Google Sheet).
 *
 * Live data: glCash/glAccrued arrive through getDataSource().getGLTransactions() —
 * same 5-minute fetch cache as every other tab, so sheet updates flow through
 * automatically. A missing GL tab or renamed column arrives as `{ error }` and renders
 * as a visible "data source misconfigured" notice (CLAUDE.md: never silently zeroed).
 */

const PLAN_STORAGE_KEY = 'fuel_wildcard_customer_plan_v1';

const WATERFALL_FROZEN_COLUMNS = [
  { key: 'name', label: 'Customer', width: 200 },
  { key: 'startMonth', label: 'Start', width: 84 },
  { key: 'total', label: 'Total', width: 104, align: 'right' },
];

const PLAN_FROZEN_COLUMNS = [
  { key: 'actions', label: '', width: 44 },
  { key: 'name', label: 'Customer', width: 190 },
  { key: 'startMonth', label: 'Start Month', width: 128 },
  { key: 'upfront', label: 'Upfront $', width: 104, align: 'right' },
  { key: 'monthly', label: 'Monthly $', width: 104, align: 'right' },
  { key: 'numMonths', label: '# Months', width: 84, align: 'right' },
];

/** Whole months from `startIso` ("YYYY-MM") to `iso` — 0 for the start month itself. */
function monthDiff(startIso, iso) {
  const [sy, sm] = startIso.split('-').map(Number);
  const [y, m] = iso.split('-').map(Number);
  return (y - sy) * 12 + (m - sm);
}

/** Projected cash for one planned customer in one month: upfront lands in the start
 *  month; the recurring amount runs from the start month for `numMonths` months
 *  (blank/0 numMonths = ongoing with no end). */
function plannedAmountFor(row, iso) {
  if (!row.startMonth || iso < row.startMonth) return 0;
  const idx = monthDiff(row.startMonth, iso);
  let amount = 0;
  if (idx === 0) amount += Number(row.upfront) || 0;
  const numMonths = Number(row.numMonths) || 0;
  if (numMonths === 0 || idx < numMonths) amount += Number(row.monthly) || 0;
  return amount;
}

/** Planned-customer rows, persisted to THIS browser's localStorage — same
 *  hydrate-then-save pattern as usePayrollState (and the same reason: this is a
 *  what-if planning tool, not GL data, so it never writes to the sheet). */
function usePlannedCustomers() {
  const [rows, setRows] = useState(null); // null until the localStorage read resolves
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let loaded = null;
    try {
      const raw = window.localStorage.getItem(PLAN_STORAGE_KEY);
      if (raw) loaded = JSON.parse(raw);
    } catch {
      loaded = null;
    }
    setRows(Array.isArray(loaded) ? loaded : []);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || !rows) return;
    try {
      window.localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify(rows));
    } catch {
      // localStorage can throw in private-browsing/storage-full edge cases — the tab
      // still works for the session, it just won't survive a refresh in that case.
    }
  }, [rows, hydrated]);

  return { rows, setRows, hydrated };
}

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
        name: customer.name,
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

export function CustomerPanel({ glCash, glAccrued }) {
  const todayIso = currentIsoMonth();
  const [range, setRange] = useState('default');
  const [collapsedSections, setCollapsedSections] = useState({
    current: false,
    planning: false,
  });
  const { rows: planned, setRows: setPlanned, hydrated } = usePlannedCustomers();
  const [justAddedId, setJustAddedId] = useState(null);

  function toggleSection(key) {
    setCollapsedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const cashWaterfall = useMemo(
    () => buildCustomerWaterfall(glCash?.transactions),
    [glCash]
  );
  const accruedWaterfall = useMemo(
    () => buildCustomerWaterfall(glAccrued?.transactions),
    [glAccrued]
  );

  // Range toggle: default hides pre-2026 history; Historical shows every month the GL
  // actually has (same 2026-2028/Historical pair as Payroll & Reports).
  function visibleGLMonths(allMonths) {
    if (range === 'all') return allMonths;
    return allMonths.filter((m) => m >= '2026-01');
  }
  const cashMonths = visibleGLMonths(cashWaterfall.months);
  const accruedMonths = visibleGLMonths(accruedWaterfall.months);

  // Planning table months come from the shared payroll horizon (2026-01..2028-12 by
  // default, full range on Historical) — planned customers are forward-looking, so
  // the grid must extend past the GL's last actual month.
  const planMonths = monthsForRange(range);

  /* ------------------------- Customer Planning handlers ------------------------- */

  function addPlannedCustomer() {
    const id = generateId('cust');
    setPlanned([
      ...(planned || []),
      { id, name: '', startMonth: '', upfront: 0, monthly: 0, numMonths: 0 },
    ]);
    setJustAddedId(id);
  }

  function updatePlanned(id, patch) {
    setPlanned((planned || []).map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function removePlanned(id, name) {
    if (
      typeof window !== 'undefined' &&
      !window.confirm(`Remove ${name || 'this planned customer'} from the plan?`)
    ) {
      return;
    }
    setPlanned((planned || []).filter((r) => r.id !== id));
  }

  const planRows = (planned || []).map((row) => {
    const monthCells = {};
    for (const iso of planMonths) {
      monthCells[iso] = formatPayrollAmount(plannedAmountFor(row, iso));
    }
    return {
      id: row.id,
      monthCells,
      cells: {
        actions: (
          <div className="pr-row-actions">
            <button
              type="button"
              className="icon-btn"
              title="Remove planned customer"
              onClick={() => removePlanned(row.id, row.name)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0l-1 14a2 2 0 01-2 2H7a2 2 0 01-2-2L4 6" />
              </svg>
            </button>
          </div>
        ),
        name: (
          <TextInput
            value={row.name}
            placeholder="Customer name"
            focusOnMount={row.id === justAddedId}
            onCommit={(v) => {
              updatePlanned(row.id, { name: v });
              if (row.id === justAddedId) setJustAddedId(null);
            }}
          />
        ),
        startMonth: (
          <input
            type="month"
            className="pr-input pr-input-date"
            value={row.startMonth || ''}
            onChange={(e) => updatePlanned(row.id, { startMonth: e.target.value })}
          />
        ),
        upfront: <MonthInput value={row.upfront} onCommit={(n) => updatePlanned(row.id, { upfront: n })} />,
        monthly: <MonthInput value={row.monthly} onCommit={(n) => updatePlanned(row.id, { monthly: n })} />,
        numMonths: <MonthInput value={row.numMonths} onCommit={(n) => updatePlanned(row.id, { numMonths: n })} />,
      },
    };
  });

  const planTotalRow = {
    cells: { name: <b>TOTAL</b> },
    monthCells: Object.fromEntries(
      planMonths.map((iso) => {
        const sum = (planned || []).reduce((acc, r) => acc + plannedAmountFor(r, iso), 0);
        return [iso, <b key={iso}>{formatPayrollAmount(sum) || '$0'}</b>];
      })
    ),
  };

  /* ----------------------------------- Render ----------------------------------- */

  return (
    <>
      <PageHead
        title="Customer Cash Flow"
        subtitle="Current customers from GL Cash & GL Accrued — plus planned new customers, saved to this browser"
      />

      {/* Same 2026-2028/Historical pair as Payroll & Reports — one piece of state
          drives the visible-month window of all three tables at once. */}
      <div className="toolbar">
        <div className="seg right">
          <button className={range === 'default' ? 'active' : undefined} onClick={() => setRange('default')}>
            2026 – 2028
          </button>
          <button className={range === 'all' ? 'active' : undefined} onClick={() => setRange('all')}>
            Historical
          </button>
        </div>
      </div>

      {/* Wide wrapper — the frozen leading columns eat most of the normal page width,
          so this section breaks out wider, exactly like the Payroll tab (.page-wide
          in globals.css). PageHead above stays at the normal page width. */}
      <div className="page-wide">
        {/* -------------------------- Current Customers -------------------------- */}
        <div style={{ marginBottom: '40px' }}>
          <div
            className="collapsible-section-header"
            onClick={() => toggleSection('current')}
            style={{ cursor: 'pointer', marginBottom: '16px' }}
          >
            <span className={`chevron${!collapsedSections.current ? ' open' : ''}`}>▸</span>
            <h3 style={{ margin: 0, display: 'inline' }}>Current Customers</h3>
            <span style={{ marginLeft: '12px', fontSize: '12px', color: 'var(--text-secondary)' }}>
              Waterfall by start month — Cash (received) vs Accrued (recognized) · GL accounts 4xxxx
            </span>
          </div>

          {!collapsedSections.current && (
            <>
              {glCash?.error ? (
                <MisconfiguredNotice tab="GL Cash" message={glCash.error} />
              ) : (
                <WaterfallTable
                  title="Cash Waterfall — GL Cash"
                  subtitle={`${cashWaterfall.customers.length} customer${
                    cashWaterfall.customers.length === 1 ? '' : 's'
                  } · cash received per month, ordered by start month`}
                  waterfall={cashWaterfall}
                  months={cashMonths}
                  todayIso={todayIso}
                />
              )}

              <div style={{ height: 20 }} />

              {glAccrued?.error ? (
                <MisconfiguredNotice tab="GL Accrued" message={glAccrued.error} />
              ) : (
                <WaterfallTable
                  title="Accrued Waterfall — GL Accrued"
                  subtitle={`${accruedWaterfall.customers.length} customer${
                    accruedWaterfall.customers.length === 1 ? '' : 's'
                  } · revenue recognized per month, ordered by start month`}
                  waterfall={accruedWaterfall}
                  months={accruedMonths}
                  todayIso={todayIso}
                />
              )}
            </>
          )}
        </div>

        {/* --------------------------- Customer Planning -------------------------- */}
        <div>
          <div
            className="collapsible-section-header"
            onClick={() => toggleSection('planning')}
            style={{ cursor: 'pointer', marginBottom: '16px' }}
          >
            <span className={`chevron${!collapsedSections.planning ? ' open' : ''}`}>▸</span>
            <h3 style={{ margin: 0, display: 'inline' }}>Customer Planning</h3>
            <span style={{ marginLeft: '12px', fontSize: '12px', color: 'var(--text-secondary)' }}>
              Planned new customers — upfront + monthly recurring cash, saved to this browser
            </span>
          </div>

          {!collapsedSections.planning && (
            hydrated && planned ? (
              <PayrollTable
                title="Planned Customers"
                subtitle={`${planned.length} planned customer${
                  planned.length === 1 ? '' : 's'
                } · upfront lands in the start month, recurring runs for # Months (blank = ongoing)`}
                tintForecast={false}
                frozenColumns={PLAN_FROZEN_COLUMNS}
                months={planMonths}
                todayIso={todayIso}
                totalRow={planTotalRow}
                rowGroups={[{ key: 'planned', label: null, rows: planRows }]}
                headActions={
                  // Plain .btn (white bg), not .btn.primary — solid black would vanish
                  // against the card's own black header bar (same contrast fix as the
                  // Payroll tab's "+ Add Role", 2026-08-05).
                  <button type="button" className="btn" onClick={addPlannedCustomer}>
                    + Add Customer
                  </button>
                }
              />
            ) : (
              <div className="cap">Loading saved customer plan…</div>
            )
          )}
        </div>
      </div>
    </>
  );
}
