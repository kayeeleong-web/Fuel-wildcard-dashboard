'use client';

import { useEffect, useMemo, useState } from 'react';
import { PageHead } from '../ui/PageHead';
import { buildCustomerWaterfall } from '../../lib/data/customerData';
import { MonthInput, PayrollTable, TextInput } from '../payroll/PayrollTable';
import { AssumptionField } from '../payroll/AssumptionsBar';
import { CollapsibleSection } from '../payroll/CollapsibleSection';
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
 * Sections (2026-08-18, Kayee: merged the three inflow cards into ONE — "one section,
 * one card", summary promoted to the top):
 *  - Current Customers: TWO cohort-style waterfall tables built live from the raw GL
 *    exports — Cash (GL Cash tab: when money was actually received) and Accrued
 *    (GL Accrued tab: when revenue was recognized).
 *  - Cash Inflow Projection (the former "Cash Inflow Drivers" + "Customer Planning" +
 *    "Cash Coming In" cards, now one card), top to bottom:
 *      1. Summary strip: Price per Campaign / Price per Meeting assumptions plus the
 *         computed Cash Coming In monthly TOTAL row as a compact live summary that
 *         recalculates as the inputs below change.
 *      2. Current & pipeline driver grids (matching Kayee's own Google-Sheet
 *         workflow — grids of customers × months): editable "# of campaigns
 *         purchased" and "# of meetings booked" per customer per forecast month,
 *         rows pre-populated from the live GL Cash roster plus manually added rows.
 *      3. "Planned Customers" block (subtle labeled divider, same card): the
 *         planned-customer what-if table, PLUS the same two driver grids for planned
 *         customers (parallel grids keyed to the planned rows — cleaner than widening
 *         the planning table itself to 30+ month columns twice over).
 *      4. Cash Coming In detail (computed, read-only): per customer per month =
 *         campaigns × campaign price + meetings × meeting price. Actual months for
 *         current customers show the real GL Cash receipts read-only; its TOTAL is
 *         the same row shown in the summary strip at the top.
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

// 'price' column added 2026-08-19 (Kayee, from her own Google Sheet: each customer has
// its own negotiated $/campaign and $/meeting rate — Ashby $1,000 upfront/$2,000 per
// meeting, Amplitude $1,500/$0, etc. — not one flat rate for everyone). 'metric' added
// the same day when Campaigns + Meetings were combined into one grid (each customer
// now contributes two rows) so it's clear which row a given price/count line is for.
const DRIVER_FROZEN_COLUMNS = [
  { key: 'name', label: 'Customer', width: 200 },
  { key: 'metric', label: 'Driver', width: 120 },
  { key: 'price', label: 'Price', width: 90, align: 'right' },
];

// The top-of-section summary strip is a TOTAL-only PayrollTable (no data rows), so it
// only needs the one frozen label column — width matches the driver grids below it.
const SUMMARY_FROZEN_COLUMNS = [{ key: 'name', label: '', width: 230 }];


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
    // Act as the FALLBACK rate for any customer row that hasn't been given its own
    // per-customer price below (pricesByKey) — most sheets have a per-customer rate,
    // but a brand-new manual/planned row starts on the shared default until set.
    campaignPrice: 1000,
    meetingPrice: 2000,
    // User-added rows that aren't in the GL roster yet: [{ id, name }]
    manualCustomers: [],
    // Per-customer monthly driver counts, keyed 'gl:<name>' | 'manual:<id>' |
    // 'plan:<id>' → { campaigns: { iso: n }, meetings: { iso: n } }
    driversByKey: {},
    // Per-customer $/campaign and $/meeting overrides (2026-08-19, Kayee: "each one of
    // them has a different pricing for the calculation" — matches her sheet's
    // per-customer Manual Calcs columns). Same key shape as driversByKey:
    // { [key]: { campaigns: $, meetings: $ } }. Missing/blank falls back to the
    // campaignPrice/meetingPrice default above.
    pricesByKey: {},
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

/** Combined customer × month grid — each customer contributes TWO rows (# of
 *  Campaigns, # of Meetings) instead of two entirely separate tables (2026-08-19,
 *  Kayee: "combine these two... format commerce will have two lines below is the # of
 *  campaign and # of meeting and pair with # of campaign and price per campaign and
 *  then pair with # of meeting is price per meeting... consolidated"). Halves the
 *  number of tables on screen and puts each row's own price right next to its counts.
 *
 *  `isEditableMonth` governs the count inputs (2026-08-19: open Jan-2026 forward
 *  regardless of whether GL actuals already exist for a month — Kayee: "bring back the
 *  editable input for jan to jun so that we can also do projection... variance
 *  analysis" — separate from the actual/forecast boundary the Cash Coming In summary
 *  and CF feed still use). `getCount`/`onSetCount` take (kind, key, iso);
 *  `getPrice`/`onSetPrice` take (kind, key) — generic signatures so one component
 *  covers both the campaigns row and the meetings row per customer. */
function CombinedDriverGrid({ title, subtitle, rows, months, isEditableMonth, todayIso, getCount, onSetCount, getPrice, onSetPrice, headActions }) {
  function monthCellsFor(key, kind) {
    return Object.fromEntries(
      months.map((iso) => [
        iso,
        isEditableMonth(iso) ? (
          <MonthInput
            key={`${key}_${kind}_${iso}`}
            value={getCount(kind, key, iso)}
            onCommit={(n) => onSetCount(kind, key, iso, n)}
          />
        ) : (
          ''
        ),
      ])
    );
  }

  // Two rows per customer, back to back — the name only shows on the first (Campaigns)
  // row; the second (Meetings) row leaves it blank. 2026-08-19 (Kayee: "would your eye
  // know that the row below is also for Fermat Commerce?" — answer: not with the
  // default alternating-row striping, which shaded every OTHER ROW rather than every
  // other CUSTOMER, so a pair could end up split across two different shades). Fixed
  // by shading BOTH rows of one customer identically and alternating that shared shade
  // customer-to-customer instead — `driver-pair-even`/`driver-pair-odd` in globals.css.
  // `driver-pair-last` also gets a bottom border so consecutive customers stay visually
  // separated without another divider row.
  const dataRows = rows.flatMap((r, idx) => {
    const zebra = idx % 2 === 0 ? 'driver-pair-even' : 'driver-pair-odd';
    return [
      {
        id: `${r.key}__campaigns`,
        className: `driver-pair-first ${zebra}`,
        cells: {
          name: r.nameCell ?? r.name,
          metric: <span className="driver-metric-label"># of Campaigns</span>,
          price: <MonthInput value={getPrice('campaigns', r.key)} onCommit={(n) => onSetPrice('campaigns', r.key, n)} />,
        },
        monthCells: monthCellsFor(r.key, 'campaigns'),
      },
      {
        id: `${r.key}__meetings`,
        className: `driver-pair-last ${zebra}`,
        cells: {
          name: '',
          metric: <span className="driver-metric-label"># of Meetings</span>,
          price: <MonthInput value={getPrice('meetings', r.key)} onCommit={(n) => onSetPrice('meetings', r.key, n)} />,
        },
        monthCells: monthCellsFor(r.key, 'meetings'),
      },
    ];
  });

  function totalRowFor(kind, label) {
    return {
      id: `total:${kind}`,
      className: 'total',
      cells: { name: <b>{label}</b>, metric: '', price: '' },
      monthCells: Object.fromEntries(
        months.map((iso) => {
          const sum = rows.reduce((acc, r) => acc + (getCount(kind, r.key, iso) || 0), 0);
          return [iso, <b key={iso}>{sum ? sum.toLocaleString('en-US') : ''}</b>];
        })
      ),
    };
  }

  return (
    <PayrollTable
      title={title}
      subtitle={subtitle}
      tintForecast={false}
      frozenColumns={DRIVER_FROZEN_COLUMNS}
      months={months}
      todayIso={todayIso}
      rowGroups={[
        {
          key: 'totals',
          label: null,
          rows: [totalRowFor('campaigns', 'TOTAL Campaigns'), totalRowFor('meetings', 'TOTAL Meetings')],
        },
        { key: 'rows', label: null, rows: dataRows },
      ]}
      headActions={headActions}
      // Kayee, 2026-08-19: "I dont like the input box bubble... more simple like a
      // spreadsheet" — scopes a flatter, faint-gridline input style to just these
      // driver grids (Current/Planned Campaigns/Meetings) without touching the blue
      // pill `.pr-input` style used everywhere else (Payroll, P&L sidebar). See
      // .customer-driver-grid in globals.css.
      className="customer-driver-grid"
    />
  );
}

export function CustomerPanel({ glCash, glAccrued }) {
  const todayIso = currentIsoMonth();
  const [range, setRange] = useState('default');
  // Cash vs Accrued waterfall toggle (2026-08-19, Kayee: "instead of having two
  // section can you just create a toggle in an obvious place? like switch between
  // accrual and cash... so that it's not that redundant and clunky") — one table shown
  // at a time instead of both stacked, switched via a toggle right on the section's
  // own header (CollapsibleSection's headActions slot), same obvious placement as the
  // 2026-2028/Historical toggle elsewhere in the app.
  const [waterfallView, setWaterfallView] = useState('cash');
  // Both sections start collapsed (2026-08-18, Kayee: "make the section in customer
  // stay collapsed default when open the page") — the tab opens quiet, the user
  // expands whichever section they actually want to work in.
  const [collapsedSections, setCollapsedSections] = useState({
    current: true,
    projection: true,
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

  // The Cash/Accrued waterfalls now respect the 2026-2028/Historical toggle too
  // (2026-08-20, Kayee: the toggle "not working" turned out to mean these tables
  // specifically — she expected clicking it to filter these, same as everywhere else
  // in the app; reverses the 2026-08-18 decision to always show full history here).
  // 'default' spans the FULL Jan-2026..Dec-2028 window via monthsForRange (not just
  // whatever real GL months happen to fall in it) — most customers' actual cash only
  // runs through whatever the latest closed month is, so filtering to just the real
  // months left a short, few-column table sitting in the wide page-wide container with
  // a big dead white gap next to it (2026-08-20, Kayee: "I dont like that there's a
  // white space here"). Extending to the full window instead fills the header row
  // properly; months with no real GL entry simply render blank (no $0, no placeholder —
  // formatPayrollAmount already returns '' for 0/undefined), same as "just [show] the
  // month and without the numbers" per her ask. 'all' keeps every month the GL actually
  // has — no reason to pad that past whatever data really exists.
  const cashMonths = range === 'all' ? cashWaterfall.months : monthsForRange('default');
  const accruedMonths = range === 'all' ? accruedWaterfall.months : monthsForRange('default');

  // Planning/driver-grid months come from the shared payroll horizon (2026-01..2028-12
  // by default, full range on Historical) — forward-looking grids must extend past the
  // GL's last actual month.
  const planMonths = monthsForRange(range);

  // The actual/forecast boundary for driver inputs: the GL Cash tab's last real month
  // (e.g. Jun-26 → editing starts Jul-26). Falls back to today's month if the GL tab
  // is misconfigured/empty, so the grids stay usable rather than locking every cell.
  const glLastIso = cashWaterfall.months.length > 0 ? cashWaterfall.months[cashWaterfall.months.length - 1] : null;
  const isEditableMonth = (iso) => (glLastIso ? iso > glLastIso : iso >= todayIso);

  // Driver-grid (Campaigns Purchased / Meetings Booked) inputs are open for every
  // visible month from Jan-2026 forward (2026-08-19, Kayee: "bring back the editable
  // input for jan to jun so that we can also do projection... variance analysis") —
  // deliberately NOT gated by glLastIso like isEditableMonth above, so entering
  // counts for a month that already has real GL data is allowed (for comparing plan
  // vs. actual) without affecting what the Cash Coming In table or CF feed treat as
  // "actual" cash.
  const isDriverEditableMonth = (iso) => iso >= '2026-01';

  /* ------------------------- Cash inflow driver helpers ------------------------- */

  const campaignPrice = drivers ? Number(drivers.campaignPrice) || 0 : 0;
  const meetingPrice = drivers ? Number(drivers.meetingPrice) || 0 : 0;

  function getDriverCount(kind, key, iso) {
    return Number(drivers?.driversByKey?.[key]?.[kind]?.[iso]) || 0;
  }

  // Per-customer $/campaign or $/meeting rate. Kayee, 2026-08-19: "this only apply to
  // the planned customer. this is a assumption for plan customer. for current customer
  // we want to put it in ourself since everyone is different" — the shared
  // campaignPrice/meetingPrice default is a PLANNING assumption only ('plan:' keys);
  // current/pipeline customers ('gl:'/'manual:' keys) never fall back to it — an unset
  // price there shows blank/0 until that specific customer's own rate is entered.
  function getCustomerPrice(kind, key) {
    const override = drivers?.pricesByKey?.[key]?.[kind];
    if (override != null && override !== '') return Number(override) || 0;
    if (key.startsWith('plan:')) return kind === 'campaigns' ? campaignPrice : meetingPrice;
    return 0;
  }

  function setCustomerPrice(kind, key, value) {
    if (!drivers) return;
    const existing = drivers.pricesByKey?.[key] || {};
    setDrivers({
      ...drivers,
      pricesByKey: { ...(drivers.pricesByKey || {}), [key]: { ...existing, [kind]: value } },
    });
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

  // Planned-customer driver rows (2026-08-19, Kayee: "we dont need a separate section
  // for plan customer, just put it in the Current & Pipeline section... they can input
  // the # of campaign and meeting same as the current and pipeline and then just
  // consolidate it") — planned customers are now rows in the SAME combined grid as
  // current/pipeline, added the same way (name + campaigns/meetings counts + price),
  // no more separate Qty/Start Month/Upfront/Monthly economics model. A "Planned" tag
  // next to the name is the only thing distinguishing them for the Current/Planned
  // summary split below.
  const plannedDriverRows = (planned || []).map((r) => ({
    key: `plan:${r.id}`,
    name: r.name,
    nameCell: (
      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <button
          type="button"
          className="icon-btn"
          title="Remove this planned customer"
          onClick={() => removePlanned(r.id, r.name)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0l-1 14a2 2 0 01-2 2H7a2 2 0 01-2-2L4 6" />
          </svg>
        </button>
        <TextInput value={r.name} placeholder="Planned customer name" focusOnMount={r.id === justAddedId} onCommit={(v) => {
          updatePlanned(r.id, { name: v });
          if (r.id === justAddedId) setJustAddedId(null);
        }} />
        <span className="pr-tag">Planned</span>
      </span>
    ),
  }));

  // One consolidated set of rows for the single Campaigns & Meetings grid — current,
  // pipeline, and planned all rendered together (2026-08-19 consolidation).
  const combinedDriverRows = [...currentDriverRows, ...plannedDriverRows];

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
    ...(planned || []).map((r) => ({ key: `plan:${r.id}`, name: r.name || 'Untitled planned customer', kind: 'Planned' })),
  ];

  /** Computed cash in for one customer key in one FORECAST month:
   *  campaigns × that customer's campaign price + meetings × that customer's meeting
   *  price (2026-08-19: per-customer rates, not one shared rate — see getCustomerPrice). */
  function cashInFor(key, iso) {
    return (
      getDriverCount('campaigns', key, iso) * getCustomerPrice('campaigns', key) +
      getDriverCount('meetings', key, iso) * getCustomerPrice('meetings', key)
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

  /* ------------------------ Planned-customer handlers ------------------------ */
  // Simplified 2026-08-19 (Kayee: "we dont need a separate section for plan customer...
  // they can input the # of campaign and meeting same as the current and pipeline and
  // then just consolidate it") — a planned customer is now just a name; it's priced and
  // driven exactly like a pipeline row (campaigns × price + meetings × price) in the
  // same combined grid. The old Qty/Start Month/Upfront $/Monthly $/# Months cohort
  // model is gone — it was a second, disconnected way to price a planned customer that
  // never actually fed the Cash Coming In totals (those always used the driver-grid
  // campaigns/meetings math), so it was pure redundancy.

  function addPlannedCustomer() {
    const id = generateId('cust');
    setPlanned([...(planned || []), { id, name: '' }]);
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

  /* ------------------------- Cash Coming In (computed) ------------------------- */

  /** One customer row's cash-in amount for a month. Current (GL-sourced) customers show
   *  their real GL cash before the actual/forecast boundary and campaigns×price +
   *  meetings×price after it. Pipeline and Planned rows have no GL history at all — bug
   *  fixed 2026-08-19 (Kayee: "why the calculation only work for August but not
   *  January" — she'd entered counts in Jan-26, a month before the GL boundary, and the
   *  summary silently returned $0 there since `row.glByMonth` doesn't exist for these
   *  rows and the old code only computed campaigns×price after the boundary). Since
   *  there's no real "actual" data to protect for these rows, always compute from their
   *  driver counts, for every visible month — matching the driver grid, which already
   *  lets you type counts into any month from Jan 2026 onward. */
  function amountFor(row, iso) {
    if (!row.glByMonth) return cashInFor(row.key, iso);
    return isEditableMonth(iso) ? cashInFor(row.key, iso) : row.glByMonth[iso] || 0;
  }

  // `tone`: 'grand' (medium grey) for the combined current+planned total, 'sub' (light
  // grey) for the Current-only / Planned-only rows below it — Kayee, 2026-08-19: "only
  // the top part up until the date is black. the total for current and planned is
  // medium grey and then total current and total planned is light grey so that it's
  // not all black." The card header + month-header row stay the shared black chrome;
  // only these row backgrounds change.
  function buildSubtotalRow(label, rows, tone) {
    // 2026-08-19, Kayee: "the total current and total planned numbers and the entire
    // row the font doesn't need to be bold" — only the grand TOTAL (current+planned)
    // row stays bold; the Current-only / Planned-only rows below it render as plain
    // weight text (still their own light-grey row tone, just not bold).
    const bold = tone === 'grand';
    const wrap = (node) => (bold ? <b>{node}</b> : node);
    return {
      id: `subtotal:${label}`,
      className: bold ? 'summary-grand-total' : 'summary-subtotal',
      cells: { name: wrap(label), kind: '' },
      monthCells: Object.fromEntries(
        planMonths.map((iso) => {
          const sum = rows.reduce((acc, row) => acc + amountFor(row, iso), 0);
          return [iso, <span key={iso}>{wrap(formatPayrollAmount(sum) || '$0')}</span>];
        })
      ),
    };
  }

  // Split into Current (GL customers + manual pipeline rows) vs Planned — same split
  // used for the summary below.
  const currentKindRows = allCashInRows.filter((r) => r.kind !== 'Planned');
  const plannedKindRows = allCashInRows.filter((r) => r.kind === 'Planned');

  // ONE summary, three rows (2026-08-19, Kayee: "there are too many sections... just
  // have one at the top for summary. like summary total of both current and planned
  // customer and then below by [tier] like total of current customer and then followed
  // by planned customer"). Replaces both the old single-TOTAL summary strip and the
  // separate "Cash Coming In — Detail" per-customer table — the driver grids below
  // already show every customer's own numbers, so a third table repeating them was
  // just more sections without more information.
  const summaryRows = [
    buildSubtotalRow('TOTAL (Current + Planned)', allCashInRows, 'grand'),
    buildSubtotalRow('Total — Current', currentKindRows, 'sub'),
    // Only shown once there's at least one planned customer — an always-visible
    // "Total — Planned $0" row when the plan is empty would just be noise.
    ...(plannedKindRows.length > 0 ? [buildSubtotalRow('Total — Planned', plannedKindRows, 'sub')] : []),
  ];

  /* ----------------------------------- Render ----------------------------------- */

  return (
    <>
      <PageHead title="Customer Cash Flow" />

      {/* Wide wrapper — the frozen leading columns eat most of the normal page width,
          so this section breaks out wider, exactly like the Payroll tab (.page-wide
          in globals.css). PageHead above stays at the normal page width. */}
      <div className="page-wide">
        {/* Each of the 2 sections is a CollapsibleSection card — the exact same
            .pr-outer-section "outer folder" shell the Payroll tab uses for Existing /
            Planned / Total Comp, so both Projection tabs read identically: tinted
            header bar with chevron + colored dot + title + caption, black-headed
            tables inside, one consistent 20px rhythm (spacer divs between cards,
            .pr-outer-body's own gap inside them) instead of ad hoc margins. */}
        {/* -------------------------- Current Customers -------------------------- */}
        <CollapsibleSection
          title="Current Customers"
          subtitle="Waterfall by start month — Cash (received) or Accrued (recognized) · GL accounts 4xxxx"
          colorVar="--blue"
          collapsed={collapsedSections.current}
          onToggle={() => toggleSection('current')}
          headActions={
            // 2026-08-20 (Kayee): the page-level 2026-2028/Historical toolbar sat far
            // enough away from the Cash/Accrued toggle that it read as unrelated to this
            // section — moved into this same header, right next to Cash/Accrued, so
            // both toggles that affect this table live in one obvious place.
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
                } · cash received per month, ordered by start month`}
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
              } · revenue recognized per month, ordered by start month`}
              waterfall={accruedWaterfall}
              months={accruedMonths}
              todayIso={todayIso}
            />
          )}
        </CollapsibleSection>

        <div style={{ height: 20 }} />

        {/* ----------------------- Cash Inflow Projection ----------------------- */}
        {/* ONE card (2026-08-18) merging the former Cash Inflow Drivers + Customer
            Planning + Cash Coming In cards. Order inside: summary strip (prices +
            live monthly TOTAL) → current & pipeline driver grids → Planned Customers
            block (labeled divider, not a separate card) → computed per-customer
            Cash Coming In detail. */}
        <CollapsibleSection
          title="Cash Inflow Projection"
          subtitle="Prices & live monthly TOTAL · campaigns/meetings drivers · planned customers — feeds the Cash Flow Projection"
          colorVar="--teal"
          collapsed={collapsedSections.projection}
          onToggle={() => toggleSection('projection')}
        >
          {driversHydrated && drivers && hydrated && planned ? (
            <>
              {/* 1 — SUMMARY STRIP. Price assumptions — same AssumptionField strip as
                  the Payroll tab's assumptions bar. No explanatory paragraph anymore
                  (2026-08-19, Kayee: "the text is wasting space with the explanation,
                  just remove it") — the field labels themselves already say who the
                  default is for. */}
              <div className="payroll-assumptions">
                <AssumptionField
                  label="Planned Customer Price per Campaign"
                  value={drivers.campaignPrice}
                  suffix="$"
                  onCommit={(v) => setDrivers({ ...drivers, campaignPrice: v })}
                />
                <AssumptionField
                  label="Planned Customer Price per Meeting"
                  value={drivers.meetingPrice}
                  suffix="$"
                  onCommit={(v) => setDrivers({ ...drivers, meetingPrice: v })}
                />
              </div>

              {/* SUMMARY — one place at the top for the totals (2026-08-19, Kayee:
                  "there are too many sections... just have one at the top for summary.
                  like summary total of both current and planned customer and then
                  below by [tier] like total of current customer and then followed by
                  planned customer"). Three stacked TOTAL-style rows, nothing else. */}
              {/* Summary + the combined grid render as ONE continuous block
                  (2026-08-19, Kayee: drew an arrow from the Summary down to this grid,
                  "move this here" → attach them with no gap instead of two separate
                  cards) — .customer-driver-group in globals.css zeroes the gap between
                  just these two and joins their corners into a single visual card. */}
              <div className="customer-driver-group">
                <PayrollTable
                  title="Cash Coming In — Summary"
                  subtitle="TOTAL (current + planned), then each broken out — feeds the Cash Flow Projection"
                  tintForecast={false}
                  frozenColumns={SUMMARY_FROZEN_COLUMNS}
                  months={planMonths}
                  todayIso={todayIso}
                  rowGroups={[{ key: 'summary', label: null, rows: summaryRows }]}
                />

                {/* ONE combined grid for current, pipeline, AND planned customers
                    (2026-08-19 consolidation, Kayee: "we dont need a separate section
                    for plan customer, just put it in the Current & Pipeline
                    section... rename it to cash in projection or something... they can
                    input the # of campaign and meeting same as the current and
                    pipeline and then just consolidate it"). Planned rows sit at the
                    bottom of the same table, tagged "Planned" next to their name, and
                    are added with their own button so it's still clear which kind of
                    row you're creating — but priced/driven identically to every other
                    row here (campaigns × price + meetings × price). */}
                <CombinedDriverGrid
                  title="Cash In Projection — Campaigns & Meetings"
                  subtitle="Each customer priced individually · counts editable Jan 2026 onward · Current & Pipeline from the live GL Cash roster, plus rows you add · Planned rows tagged below"
                  rows={combinedDriverRows}
                  months={planMonths}
                  isEditableMonth={isDriverEditableMonth}
                  todayIso={todayIso}
                  getCount={getDriverCount}
                  onSetCount={setDriverCount}
                  getPrice={getCustomerPrice}
                  onSetPrice={setCustomerPrice}
                  headActions={
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="button" className="btn" onClick={addManualCustomer}>
                        + Add Customer Row
                      </button>
                      <button type="button" className="btn" onClick={addPlannedCustomer}>
                        + Add Planned Customer
                      </button>
                    </div>
                  }
                />
              </div>
            </>
          ) : (
            <div className="cap">Loading saved cash inflow drivers…</div>
          )}
        </CollapsibleSection>
      </div>
    </>
  );
}
