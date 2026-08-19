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

// 'qty' added 2026-08-19 (Kayee: "3 of the customer in this pricing, 4 in that
// pricing... when the planned customer come in as real customer, [need] a way to
// reduce that planned by 1") — one row can represent a COHORT of planned customers at
// the same pricing/timing rather than a single named prospect; Upfront/Monthly $ scale
// by Qty (see plannedAmountFor), and the −1 stepper next to it is how a row shrinks as
// members of that cohort actually close and show up in the GL roster.
const PLAN_FROZEN_COLUMNS = [
  { key: 'actions', label: '', width: 44 },
  { key: 'name', label: 'Customer', width: 170 },
  { key: 'qty', label: 'Qty', width: 90, align: 'right' },
  { key: 'startMonth', label: 'Start Month', width: 128 },
  { key: 'upfront', label: 'Upfront $', width: 104, align: 'right' },
  { key: 'monthly', label: 'Monthly $', width: 104, align: 'right' },
  { key: 'numMonths', label: '# Months', width: 84, align: 'right' },
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

/** Subtle labeled divider between blocks INSIDE the one Cash Inflow Projection card —
 *  deliberately not another CollapsibleSection (2026-08-18: "one section, one card,
 *  not three"). Reuses the embedded-table title typography and the --border token. */
function BlockDivider({ label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0' }}>
      <span className="payroll-embedded-title">{label}</span>
      <span style={{ flex: 1, borderTop: '1px solid var(--border)' }} />
    </div>
  );
}

/** Whole months from `startIso` ("YYYY-MM") to `iso` — 0 for the start month itself. */
function monthDiff(startIso, iso) {
  const [sy, sm] = startIso.split('-').map(Number);
  const [y, m] = iso.split('-').map(Number);
  return (y - sy) * 12 + (m - sm);
}

/** Projected cash for one planned customer ROW (possibly a cohort of several — see
 *  Qty, 2026-08-19) in one month: upfront lands in the start month; the recurring
 *  amount runs from the start month for `numMonths` months (blank/0 numMonths =
 *  ongoing with no end). Everything scales by Qty — a row of "3 at $1,000 upfront"
 *  produces $3,000 in its start month, not $1,000. */
function plannedAmountFor(row, iso) {
  if (!row.startMonth || iso < row.startMonth) return 0;
  const qty = Number(row.qty) || 0;
  if (qty <= 0) return 0;
  const idx = monthDiff(row.startMonth, iso);
  let amount = 0;
  if (idx === 0) amount += Number(row.upfront) || 0;
  const numMonths = Number(row.numMonths) || 0;
  if (numMonths === 0 || idx < numMonths) amount += Number(row.monthly) || 0;
  return amount * qty;
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

  // The Cash/Accrued waterfalls always show every month the GL actually has — Kayee
  // (2026-08-18): "this is ugly, the white space... I think we can show all months for
  // the cash and accrual waterfall." Filtering these to 2026+ left most customers
  // (started back in 2024) showing only a handful of real months, so the table was
  // much narrower than its .page-wide container — a wall of dead white space to the
  // right of a 6-column table. The 2026-2028/Historical toggle still governs the
  // driver grids and planning tables below, which are forward-looking by nature.
  const cashMonths = cashWaterfall.months;
  const accruedMonths = accruedWaterfall.months;

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

  function addPlannedCustomer() {
    const id = generateId('cust');
    setPlanned([
      ...(planned || []),
      { id, name: '', qty: 1, startMonth: '', upfront: 0, monthly: 0, numMonths: 0 },
    ]);
    setJustAddedId(id);
  }

  function updatePlanned(id, patch) {
    setPlanned((planned || []).map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  // −1 stepper (2026-08-19, Kayee: "when the planned customer come in as real
  // customer... a good ui to reduce that planned by 1") — just decrements Qty per her
  // choice; doesn't touch the Current & Pipeline grid, since that already flows in
  // from GL on its own. Floors at 0 rather than going negative or auto-removing the row.
  function decrementPlannedQty(id) {
    setPlanned((planned || []).map((r) => (r.id === id ? { ...r, qty: Math.max(0, (Number(r.qty) || 0) - 1) } : r)));
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
        qty: (
          <div className="pr-qty-stepper">
            <button
              type="button"
              className="icon-btn"
              title="One of this cohort just converted to a real (GL) customer — decrement Qty"
              disabled={(Number(row.qty) || 0) <= 0}
              onClick={() => decrementPlannedQty(row.id)}
            >
              −
            </button>
            <MonthInput value={row.qty ?? 1} onCommit={(n) => updatePlanned(row.id, { qty: Math.max(0, n) })} />
          </div>
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

  /** One customer row's cash-in amount for a month — same rule everywhere: real GL
   *  cash on actual months for current customers, campaigns×price + meetings×price
   *  on forecast months (current, pipeline, and planned rows alike). */
  function amountFor(row, iso) {
    if (row.glByMonth && !isEditableMonth(iso)) return row.glByMonth[iso] || 0;
    if (isEditableMonth(iso)) return cashInFor(row.key, iso);
    return 0;
  }

  // `tone`: 'grand' (medium grey) for the combined current+planned total, 'sub' (light
  // grey) for the Current-only / Planned-only rows below it — Kayee, 2026-08-19: "only
  // the top part up until the date is black. the total for current and planned is
  // medium grey and then total current and total planned is light grey so that it's
  // not all black." The card header + month-header row stay the shared black chrome;
  // only these row backgrounds change.
  function buildSubtotalRow(label, rows, tone) {
    return {
      id: `subtotal:${label}`,
      className: tone === 'grand' ? 'summary-grand-total' : 'summary-subtotal',
      cells: { name: <b>{label}</b>, kind: '' },
      monthCells: Object.fromEntries(
        planMonths.map((iso) => {
          const sum = rows.reduce((acc, row) => acc + amountFor(row, iso), 0);
          return [iso, <b key={iso}>{formatPayrollAmount(sum) || '$0'}</b>];
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
            <div className="seg" onClick={(e) => e.stopPropagation()}>
              <button className={waterfallView === 'cash' ? 'active' : undefined} onClick={() => setWaterfallView('cash')}>
                Cash
              </button>
              <button className={waterfallView === 'accrued' ? 'active' : undefined} onClick={() => setWaterfallView('accrued')}>
                Accrued
              </button>
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
          {driversHydrated && drivers ? (
            <>
              {/* 1 — SUMMARY STRIP. Price assumptions — same AssumptionField strip as
                  the Payroll tab's assumptions bar, so the pattern reads identically
                  across tabs — plus the computed Cash Coming In monthly TOTAL as a
                  TOTAL-only table (no data rows): it recalculates live as the driver
                  inputs below change, because it renders the same cashInTotalRow the
                  detail table at the bottom uses. */}
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
                <div className="pr-assumption-note">
                  These two defaults are a planning assumption for Planned Customers only — every current/pipeline
                  customer is priced individually in its own Price column below (each one is different, so there&apos;s
                  no shared rate for them). Cash Coming In = campaigns × that row&apos;s campaign price + meetings ×
                  that row&apos;s meeting price. Campaign/meeting counts are editable from Jan 2026 onward even where
                  actuals already exist, for plan-vs-actual comparison.
                </div>
              </div>

              {/* SUMMARY — one place at the top for the totals (2026-08-19, Kayee:
                  "there are too many sections... just have one at the top for summary.
                  like summary total of both current and planned customer and then
                  below by [tier] like total of current customer and then followed by
                  planned customer"). Three stacked TOTAL-style rows, nothing else —
                  the old separate "Cash Coming In — Detail" per-customer table was
                  removed; the driver grids below already show every customer's own
                  numbers, so that table was just repeating them. */}
              {/* Summary + Current & Pipeline grid render as ONE continuous block
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

                {/* 2 — current & pipeline driver grid (rows from the live GL Cash
                    roster plus manually added rows). One grid, two rows per customer
                    (# of Campaigns / # of Meetings), each with its own price. */}
                <CombinedDriverGrid
                  title="Current & Pipeline — Campaigns & Meetings"
                  subtitle="Each customer priced individually · counts editable Jan 2026 onward · rows from the live GL Cash roster, plus rows you add"
                  rows={currentDriverRows}
                  months={planMonths}
                  isEditableMonth={isDriverEditableMonth}
                  todayIso={todayIso}
                  getCount={getDriverCount}
                  onSetCount={setDriverCount}
                  getPrice={getCustomerPrice}
                  onSetPrice={setCustomerPrice}
                  headActions={
                    <button type="button" className="btn" onClick={addManualCustomer}>
                      + Add Customer Row
                    </button>
                  }
                />
              </div>

              {/* 3 — PLANNED CUSTOMERS block. Appended directly below the
                  current-customer grids in the SAME card — separated only by the
                  subtle labeled divider, not another section. */}
              <BlockDivider label="Planned Customers" />
              {hydrated && planned ? (
                <>
                  <PayrollTable
                    title="Planned Customers"
                    subtitle={`${planned.length} planned customer${
                      planned.length === 1 ? '' : 's'
                    } · Qty scales Upfront/Monthly $ (a row can be a cohort, e.g. "3 at this pricing") · −1 when one converts to a real GL customer · upfront lands in the start month, recurring runs for # Months (blank = ongoing)`}
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

                  {/* Parallel driver grid for planned customers (2026-08-18/19) — same
                      combined campaigns+meetings shape as the current-customer grid
                      above, rows keyed to the planning table (add a planned customer
                      there and it appears here). Price defaults to the shared
                      assumption above until a planned row gets its own rate. */}
                  {plannedDriverRows.length > 0 && (
                    <CombinedDriverGrid
                      title="Planned Customers — Campaigns & Meetings"
                      subtitle="Price defaults to the Planned Customer assumption above until overridden per row"
                      rows={plannedDriverRows}
                      months={planMonths}
                      isEditableMonth={isDriverEditableMonth}
                      todayIso={todayIso}
                      getCount={getDriverCount}
                      onSetCount={setDriverCount}
                      getPrice={getCustomerPrice}
                      onSetPrice={setCustomerPrice}
                    />
                  )}
                </>
              ) : (
                <div className="cap">Loading saved customer plan…</div>
              )}
            </>
          ) : (
            <div className="cap">Loading saved cash inflow drivers…</div>
          )}
        </CollapsibleSection>
      </div>
    </>
  );
}
