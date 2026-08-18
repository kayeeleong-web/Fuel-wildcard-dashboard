'use client';

import { useEffect, useMemo, useState } from 'react';
import { PageHead } from '../ui/PageHead';
import { buildCustomerWaterfall } from '../../lib/data/customerData';
import { MonthInput, PayrollTable, TextInput } from '../payroll/PayrollTable';
import { AssumptionField } from '../payroll/AssumptionsBar';
import { CUSTOMER_INFLOW_STORAGE_KEY } from '../../lib/cashflow/cashProjection';
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
 * Sections:
 *  - Current Customers: TWO cohort-style waterfall tables built live from the raw GL
 *    exports — Cash (GL Cash tab: when money was actually received) and Accrued
 *    (GL Accrued tab: when revenue was recognized).
 *  - Cash Inflow Drivers (2026-08-18, matching Kayee's own Google-Sheet workflow —
 *    grids of customers × months): editable "# of campaigns purchased" and "# of
 *    meetings booked" per customer per forecast month, rows pre-populated from the
 *    live GL Cash roster plus manually added rows. Price per Campaign / Price per
 *    Meeting assumptions sit at the top.
 *  - Customer Planning: the planned-customer what-if table, PLUS the same two driver
 *    grids for planned customers (parallel grids keyed to the planned rows — cleaner
 *    than widening the planning table itself to 30+ month columns twice over).
 *  - Cash Coming In (computed, read-only): per customer per month = campaigns ×
 *    campaign price + meetings × meeting price, with a bold TOTAL row. Actual months
 *    for current customers show the real GL Cash receipts read-only.
 *
 * CF PROJECTION LINK (2026-08-18): whenever the driver inputs/prices change, this
 * panel writes the computed monthly Cash-Coming-In TOTALs (forecast months only) to
 * localStorage under CUSTOMER_INFLOW_STORAGE_KEY (lib/cashflow/cashProjection.js).
 * The Cash Flow Projection sub-tab (ReportsPanel, a sibling that remounts on every
 * tab switch) reads that key on mount and uses it as the forecast revenue inflow —
 * replacing the old sidebar "Revenue Inflow" assumptions entirely.
 *
 * All inputs persist to this browser's localStorage (hydrate-then-save, same pattern
 * as usePayrollState) — this is planning data, never written back to the sheet.
 */

const PLAN_STORAGE_KEY = 'fuel_wildcard_customer_plan_v1';
const DRIVERS_STORAGE_KEY = 'fuel_wildcard_customer_drivers_v1';

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

const DRIVER_FROZEN_COLUMNS = [{ key: 'name', label: 'Customer', width: 230 }];

const CASH_IN_FROZEN_COLUMNS = [
  { key: 'name', label: 'Customer', width: 200 },
  { key: 'kind', label: 'Type', width: 90 },
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

function seedDrivers() {
  return {
    version: 1,
    // Defaults per Kayee's sheet workflow — both editable, persisted on first change.
    campaignPrice: 1000,
    meetingPrice: 2000,
    // User-added rows that aren't in the GL roster yet: [{ id, name }]
    manualCustomers: [],
    // Per-customer monthly driver counts, keyed 'gl:<name>' | 'manual:<id>' |
    // 'plan:<id>' → { campaigns: { iso: n }, meetings: { iso: n } }
    driversByKey: {},
  };
}

function isValidDrivers(loaded) {
  return !!(
    loaded &&
    loaded.version === 1 &&
    typeof loaded.driversByKey === 'object' &&
    Array.isArray(loaded.manualCustomers)
  );
}

/** Campaign/meeting driver grids + prices, one versioned localStorage key,
 *  hydrate-then-save — same pattern as usePlannedCustomers above. */
function useCustomerDrivers() {
  const [state, setState] = useState(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let loaded = null;
    try {
      const raw = window.localStorage.getItem(DRIVERS_STORAGE_KEY);
      if (raw) loaded = JSON.parse(raw);
    } catch {
      loaded = null;
    }
    setState(isValidDrivers(loaded) ? loaded : seedDrivers());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || !state) return;
    try {
      window.localStorage.setItem(DRIVERS_STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Same private-browsing/storage-full caveat as every other hook here.
    }
  }, [state, hydrated]);

  return { state, setState, hydrated };
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

/** One editable customer × month count grid (campaigns or meetings) on the shared
 *  frozen-column PayrollTable shell. Only forecast months get an input — an actual
 *  month has no GL-backed campaign/meeting count, and showing an editable box there
 *  would read as data we don't have (CLAUDE.md: a wrong number that looks fine is
 *  worse than a visible blank). */
function DriverGrid({ title, subtitle, rows, months, isEditableMonth, todayIso, getCount, onSetCount, headActions }) {
  const tableRows = rows.map((r) => ({
    id: r.key,
    cells: { name: r.nameCell ?? r.name },
    monthCells: Object.fromEntries(
      months.map((iso) => [
        iso,
        isEditableMonth(iso) ? (
          <MonthInput key={`${r.key}_${iso}`} value={getCount(r.key, iso)} onCommit={(n) => onSetCount(r.key, iso, n)} />
        ) : (
          ''
        ),
      ])
    ),
  }));

  const totalRow = {
    cells: { name: <b>TOTAL</b> },
    monthCells: Object.fromEntries(
      months.map((iso) => {
        const sum = rows.reduce((acc, r) => acc + (getCount(r.key, iso) || 0), 0);
        return [iso, <b key={iso}>{sum ? sum.toLocaleString('en-US') : ''}</b>];
      })
    ),
  };

  return (
    <PayrollTable
      title={title}
      subtitle={subtitle}
      tintForecast={false}
      frozenColumns={DRIVER_FROZEN_COLUMNS}
      months={months}
      todayIso={todayIso}
      totalRow={totalRow}
      rowGroups={[{ key: 'rows', label: null, rows: tableRows }]}
      headActions={headActions}
    />
  );
}

export function CustomerPanel({ glCash, glAccrued }) {
  const todayIso = currentIsoMonth();
  const [range, setRange] = useState('default');
  const [collapsedSections, setCollapsedSections] = useState({
    current: false,
    inflow: false,
    planning: false,
    cashIn: false,
  });
  const { rows: planned, setRows: setPlanned, hydrated } = usePlannedCustomers();
  const { state: drivers, setState: setDrivers, hydrated: driversHydrated } = useCustomerDrivers();
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

  // Planning/driver-grid months come from the shared payroll horizon (2026-01..2028-12
  // by default, full range on Historical) — forward-looking grids must extend past the
  // GL's last actual month.
  const planMonths = monthsForRange(range);

  // The actual/forecast boundary for driver inputs: the GL Cash tab's last real month
  // (e.g. Jun-26 → editing starts Jul-26). Falls back to today's month if the GL tab
  // is misconfigured/empty, so the grids stay usable rather than locking every cell.
  const glLastIso = cashWaterfall.months.length > 0 ? cashWaterfall.months[cashWaterfall.months.length - 1] : null;
  const isEditableMonth = (iso) => (glLastIso ? iso > glLastIso : iso >= todayIso);

  /* ------------------------- Cash inflow driver helpers ------------------------- */

  const campaignPrice = drivers ? Number(drivers.campaignPrice) || 0 : 0;
  const meetingPrice = drivers ? Number(drivers.meetingPrice) || 0 : 0;

  function getDriverCount(kind, key, iso) {
    return Number(drivers?.driversByKey?.[key]?.[kind]?.[iso]) || 0;
  }

  function setDriverCount(kind, key, iso, n) {
    if (!drivers) return;
    const existing = drivers.driversByKey[key] || {};
    setDrivers({
      ...drivers,
      driversByKey: {
        ...drivers.driversByKey,
        [key]: { ...existing, [kind]: { ...(existing[kind] || {}), [iso]: n } },
      },
    });
  }

  function addManualCustomer() {
    if (!drivers) return;
    const id = generateId('mcust');
    setDrivers({ ...drivers, manualCustomers: [...drivers.manualCustomers, { id, name: '' }] });
  }

  function renameManualCustomer(id, name) {
    if (!drivers) return;
    setDrivers({
      ...drivers,
      manualCustomers: drivers.manualCustomers.map((c) => (c.id === id ? { ...c, name } : c)),
    });
  }

  function removeManualCustomer(id, name) {
    if (!drivers) return;
    if (
      typeof window !== 'undefined' &&
      !window.confirm(`Remove ${name || 'this customer row'} and its campaign/meeting inputs?`)
    ) {
      return;
    }
    const nextDriversByKey = { ...drivers.driversByKey };
    delete nextDriversByKey[`manual:${id}`];
    setDrivers({
      ...drivers,
      manualCustomers: drivers.manualCustomers.filter((c) => c.id !== id),
      driversByKey: nextDriversByKey,
    });
  }

  // Current & pipeline driver rows: the live GL Cash roster (pre-populated,
  // name read-only — it IS the GL counterparty name) + manually added rows.
  const currentDriverRows = [
    ...cashWaterfall.customers.map((c) => ({ key: `gl:${c.name}`, name: c.name })),
    ...(drivers?.manualCustomers || []).map((c) => ({
      key: `manual:${c.id}`,
      name: c.name,
      nameCell: (
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            type="button"
            className="icon-btn"
            title="Remove this customer row"
            onClick={() => removeManualCustomer(c.id, c.name)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0l-1 14a2 2 0 01-2 2H7a2 2 0 01-2-2L4 6" />
            </svg>
          </button>
          <TextInput value={c.name} placeholder="Customer name" onCommit={(v) => renameManualCustomer(c.id, v)} />
        </span>
      ),
    })),
  ];

  // Planned-customer driver rows — keyed to the planning table's own rows, so adding
  // a planned customer there automatically gives it a row in both planned grids.
  const plannedDriverRows = (planned || []).map((r) => ({
    key: `plan:${r.id}`,
    name: r.name || 'Untitled planned customer',
  }));

  const allCashInRows = [
    ...cashWaterfall.customers.map((c) => ({
      key: `gl:${c.name}`,
      name: c.name,
      kind: 'Current',
      glByMonth: c.byMonth,
    })),
    ...(drivers?.manualCustomers || []).map((c) => ({
      key: `manual:${c.id}`,
      name: c.name || 'Untitled',
      kind: 'Pipeline',
    })),
    ...plannedDriverRows.map((r) => ({ key: r.key, name: r.name, kind: 'Planned' })),
  ];

  /** Computed cash in for one customer key in one FORECAST month:
   *  campaigns × campaign price + meetings × meeting price. */
  function cashInFor(key, iso) {
    return (
      getDriverCount('campaigns', key, iso) * campaignPrice +
      getDriverCount('meetings', key, iso) * meetingPrice
    );
  }

  // CF PROJECTION FEED — the other half of the link documented in ReportsPanel.jsx.
  // Recomputed over the FULL horizon (not just the visible range toggle) so switching
  // the display range can never change what the CF projection reads. Forecast months
  // only: actual months are real GL cash, already on the CF statement.
  const inflowTotalsByMonth = useMemo(() => {
    if (!driversHydrated || !drivers) return null;
    const totals = {};
    for (const iso of monthsForRange('all')) {
      if (!isEditableMonth(iso)) continue;
      let sum = 0;
      for (const row of allCashInRows) {
        sum += cashInFor(row.key, iso);
      }
      totals[iso] = sum;
    }
    return totals;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drivers, driversHydrated, planned, cashWaterfall, glLastIso]);

  useEffect(() => {
    if (!inflowTotalsByMonth) return;
    try {
      window.localStorage.setItem(
        CUSTOMER_INFLOW_STORAGE_KEY,
        JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), totalsByMonth: inflowTotalsByMonth })
      );
    } catch {
      // Same private-browsing/storage-full caveat as the hooks above — the CF
      // projection just won't see fresher totals until a save succeeds.
    }
  }, [inflowTotalsByMonth]);

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
    // Also drop the planned customer's campaign/meeting driver inputs — otherwise the
    // orphaned counts would silently keep feeding the Cash Coming In totals.
    if (drivers?.driversByKey?.[`plan:${id}`]) {
      const nextDriversByKey = { ...drivers.driversByKey };
      delete nextDriversByKey[`plan:${id}`];
      setDrivers({ ...drivers, driversByKey: nextDriversByKey });
    }
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

  /* ------------------------- Cash Coming In (computed) ------------------------- */

  const cashInRows = allCashInRows.map((row) => {
    const monthCells = {};
    for (const iso of planMonths) {
      if (row.glByMonth && !isEditableMonth(iso)) {
        // Actual months for a current (GL) customer: the real cash received, read-only.
        monthCells[iso] = formatPayrollAmount(row.glByMonth[iso]);
      } else if (isEditableMonth(iso)) {
        monthCells[iso] = formatPayrollAmount(cashInFor(row.key, iso));
      } else {
        monthCells[iso] = '';
      }
    }
    return {
      id: row.key,
      monthCells,
      cells: { name: row.name, kind: row.kind },
    };
  });

  const cashInTotalRow = {
    cells: { name: <b>TOTAL</b> },
    monthCells: Object.fromEntries(
      planMonths.map((iso) => {
        let sum = 0;
        for (const row of allCashInRows) {
          if (row.glByMonth && !isEditableMonth(iso)) sum += row.glByMonth[iso] || 0;
          else if (isEditableMonth(iso)) sum += cashInFor(row.key, iso);
        }
        return [iso, <b key={iso}>{formatPayrollAmount(sum) || '$0'}</b>];
      })
    ),
  };

  /* ----------------------------------- Render ----------------------------------- */

  return (
    <>
      <PageHead
        title="Customer Cash Flow"
        subtitle="Current customers from GL Cash & GL Accrued — plus campaign/meeting cash-in drivers feeding the Cash Flow Projection"
      />

      {/* Same 2026-2028/Historical pair as Payroll & Reports — one piece of state
          drives the visible-month window of every table at once. */}
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

        {/* ------------------------- Cash Inflow Drivers ------------------------- */}
        <div style={{ marginBottom: '40px' }}>
          <div
            className="collapsible-section-header"
            onClick={() => toggleSection('inflow')}
            style={{ cursor: 'pointer', marginBottom: '16px' }}
          >
            <span className={`chevron${!collapsedSections.inflow ? ' open' : ''}`}>▸</span>
            <h3 style={{ margin: 0, display: 'inline' }}>Cash Inflow Drivers</h3>
            <span style={{ marginLeft: '12px', fontSize: '12px', color: 'var(--text-secondary)' }}>
              Campaigns purchased & meetings booked per customer per forecast month — feeds the Cash Flow Projection
            </span>
          </div>

          {!collapsedSections.inflow &&
            (driversHydrated && drivers ? (
              <>
                {/* Price assumptions — same AssumptionField strip as the Payroll tab's
                    assumptions bar, so the pattern reads identically across tabs. */}
                <div className="payroll-assumptions" style={{ marginBottom: 16 }}>
                  <AssumptionField
                    label="Price per Campaign"
                    value={drivers.campaignPrice}
                    suffix="$"
                    onCommit={(v) => setDrivers({ ...drivers, campaignPrice: v })}
                  />
                  <AssumptionField
                    label="Price per Meeting"
                    value={drivers.meetingPrice}
                    suffix="$"
                    onCommit={(v) => setDrivers({ ...drivers, meetingPrice: v })}
                  />
                  <div className="pr-assumption-note">
                    Cash Coming In = campaigns × campaign price + meetings × meeting price. The monthly TOTAL is
                    saved for the Cash Flow Projection tab. Editing starts after the GL&apos;s last actual month
                    {glLastIso ? ` (${formatMonthLabel(glLastIso)})` : ''}.
                  </div>
                </div>

                <DriverGrid
                  title="Current & Pipeline — Campaigns Purchased"
                  subtitle="# of campaigns purchased per customer per month · rows from the live GL Cash roster, plus rows you add"
                  rows={currentDriverRows}
                  months={planMonths}
                  isEditableMonth={isEditableMonth}
                  todayIso={todayIso}
                  getCount={(key, iso) => getDriverCount('campaigns', key, iso)}
                  onSetCount={(key, iso, n) => setDriverCount('campaigns', key, iso, n)}
                  headActions={
                    <button type="button" className="btn" onClick={addManualCustomer}>
                      + Add Customer Row
                    </button>
                  }
                />

                <div style={{ height: 20 }} />

                <DriverGrid
                  title="Current & Pipeline — # of Meetings Booked"
                  subtitle="# of meetings booked per customer per month · same rows as the campaigns grid above"
                  rows={currentDriverRows}
                  months={planMonths}
                  isEditableMonth={isEditableMonth}
                  todayIso={todayIso}
                  getCount={(key, iso) => getDriverCount('meetings', key, iso)}
                  onSetCount={(key, iso, n) => setDriverCount('meetings', key, iso, n)}
                />
              </>
            ) : (
              <div className="cap">Loading saved cash inflow drivers…</div>
            ))}
        </div>

        {/* --------------------------- Customer Planning -------------------------- */}
        <div style={{ marginBottom: '40px' }}>
          <div
            className="collapsible-section-header"
            onClick={() => toggleSection('planning')}
            style={{ cursor: 'pointer', marginBottom: '16px' }}
          >
            <span className={`chevron${!collapsedSections.planning ? ' open' : ''}`}>▸</span>
            <h3 style={{ margin: 0, display: 'inline' }}>Customer Planning</h3>
            <span style={{ marginLeft: '12px', fontSize: '12px', color: 'var(--text-secondary)' }}>
              Planned new customers — what-if amounts, plus their own campaign/meeting driver grids
            </span>
          </div>

          {!collapsedSections.planning &&
            (hydrated && planned ? (
              <>
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

                {/* Parallel driver grids for planned customers (2026-08-18) — same
                    campaigns/meetings shape as the current-customer grids above, rows
                    keyed to the planning table (add a planned customer there and it
                    appears here). Kept as separate grids rather than widening the
                    planning table itself — two more 30-column month sets inside one
                    table would bury the plan's own five setup columns. */}
                {driversHydrated && drivers && plannedDriverRows.length > 0 && (
                  <>
                    <div style={{ height: 20 }} />
                    <DriverGrid
                      title="Planned Customers — Campaigns Purchased"
                      subtitle="# of campaigns purchased per planned customer per month"
                      rows={plannedDriverRows}
                      months={planMonths}
                      isEditableMonth={isEditableMonth}
                      todayIso={todayIso}
                      getCount={(key, iso) => getDriverCount('campaigns', key, iso)}
                      onSetCount={(key, iso, n) => setDriverCount('campaigns', key, iso, n)}
                    />
                    <div style={{ height: 20 }} />
                    <DriverGrid
                      title="Planned Customers — # of Meetings Booked"
                      subtitle="# of meetings booked per planned customer per month"
                      rows={plannedDriverRows}
                      months={planMonths}
                      isEditableMonth={isEditableMonth}
                      todayIso={todayIso}
                      getCount={(key, iso) => getDriverCount('meetings', key, iso)}
                      onSetCount={(key, iso, n) => setDriverCount('meetings', key, iso, n)}
                    />
                  </>
                )}
              </>
            ) : (
              <div className="cap">Loading saved customer plan…</div>
            ))}
        </div>

        {/* ----------------------------- Cash Coming In ---------------------------- */}
        <div>
          <div
            className="collapsible-section-header"
            onClick={() => toggleSection('cashIn')}
            style={{ cursor: 'pointer', marginBottom: '16px' }}
          >
            <span className={`chevron${!collapsedSections.cashIn ? ' open' : ''}`}>▸</span>
            <h3 style={{ margin: 0, display: 'inline' }}>Cash Coming In</h3>
            <span style={{ marginLeft: '12px', fontSize: '12px', color: 'var(--text-secondary)' }}>
              Computed — campaigns × price + meetings × price per customer; TOTAL feeds the Cash Flow Projection
            </span>
          </div>

          {!collapsedSections.cashIn &&
            (driversHydrated && drivers ? (
              <PayrollTable
                title="Cash Coming In (computed)"
                subtitle="Read-only · actual months show real GL Cash receipts for current customers; forecast months are campaigns × price + meetings × price"
                tintForecast={false}
                frozenColumns={CASH_IN_FROZEN_COLUMNS}
                months={planMonths}
                todayIso={todayIso}
                totalRow={cashInTotalRow}
                rowGroups={[{ key: 'cashIn', label: null, rows: cashInRows }]}
              />
            ) : (
              <div className="cap">Loading saved cash inflow drivers…</div>
            ))}
        </div>
      </div>
    </>
  );
}
