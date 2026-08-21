'use client';

import { useEffect, useMemo, useState } from 'react';
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
    // GL-roster customers the user has hidden from the projection grid (2026-08-20,
    // Kayee: "where did you get this list... brex? i want to have the option to
    // remove them too"). The GL roster is auto-built from every 4xxxx counterparty in
    // GL Cash, so a row like Brex can't be DELETED (it's real GL data) — hiding it
    // here just drops it from the planning grid; its actuals still show everywhere
    // else. Stored by name (the GL key), restorable via the header button.
    hiddenGlCustomers: [],
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
function CombinedDriverGrid({ title, subtitle, currentRows, plannedRows, inactiveRows = [], months, isEditableMonth, todayIso, getCount, onSetCount, getPrice, onSetPrice, getQty = () => 1, headActions }) {
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

  // Two rows per customer, back to back — 2026-08-20: both rows now repeat the
  // customer name (see the cells.name comment below). Shading BOTH rows of one
  // customer identically and alternating that shared shade customer-to-customer
  // (`driver-pair-even`/`driver-pair-odd` in globals.css) is what makes a pair read as
  // one visual block rather than two independently-striped rows.
  // `startIdx` lets the zebra shading continue counting across the Current/Planned
  // split below instead of resetting to "even" at the top of each group.
  function buildPairs(list, startIdx) {
    return list.flatMap((r, i) => {
      const idx = startIdx + i;
      const zebra = idx % 2 === 0 ? 'driver-pair-even' : 'driver-pair-odd';
      // Running customer number (2026-08-20, Kayee: "can you add numbering, like
      // accrual is 1, amplitude is 2") — one ordinal per CUSTOMER (both of its rows
      // show the same number), continuing across the Current → Planned group split
      // since startIdx carries over.
      const num = <span className="driver-row-num">{idx + 1}</span>;
      const withNum = (content) => (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          {num}
          <span style={{ flex: '1 1 auto', minWidth: 0 }}>{content}</span>
        </span>
      );
      return [
        {
          id: `${r.key}__campaigns`,
          className: `driver-pair-first ${zebra}`,
          cells: {
            name: withNum(r.nameCell ?? r.name),
            metric: <span className="driver-metric-label"># of Campaigns</span>,
            price: <MonthInput value={getPrice('campaigns', r.key)} onCommit={(n) => onSetPrice('campaigns', r.key, n)} />,
          },
          monthCells: monthCellsFor(r.key, 'campaigns'),
        },
        {
          id: `${r.key}__meetings`,
          className: `driver-pair-last ${zebra}`,
          cells: {
            // 2026-08-20 (Kayee: "you can repeat the customer name in both row so next
            // for # of campaign you will have fermat as well as # of meetings next to it
            // is fermat") — reverses the 2026-08-19 "blank on the second row" decision;
            // with plain alternating grey/white banding replacing the old per-row tint,
            // a repeated name is what actually ties the pair together now.
            // Plain text here, NOT r.nameCell (2026-08-20 follow-up, Kayee: "I dont
            // want to fill in the name twice... make the second row just use the first
            // row") — for manual/planned rows, nameCell is an EDITABLE input (+ delete
            // button), so repeating it gave two separate name boxes per customer. The
            // Meetings row now just mirrors whatever the Campaigns row's input says.
            name: withNum(r.name),
            metric: <span className="driver-metric-label"># of Meetings</span>,
            price: <MonthInput value={getPrice('meetings', r.key)} onCommit={(n) => onSetPrice('meetings', r.key, n)} />,
          },
          monthCells: monthCellsFor(r.key, 'meetings'),
        },
      ];
    });
  }

  const currentPairs = buildPairs(currentRows, 0);
  const plannedPairs = buildPairs(plannedRows, currentRows.length);

  function totalRowFor(kind, label) {
    const allRows = [...currentRows, ...plannedRows];
    return {
      id: `total:${kind}`,
      className: 'total',
      cells: { name: <b>{label}</b>, metric: '', price: '' },
      monthCells: Object.fromEntries(
        months.map((iso) => {
          // Counts multiply by each row's qty (2026-08-20) — a planned row standing
          // for 2 customers × 250 campaigns contributes 500 to TOTAL Campaigns.
          const sum = allRows.reduce((acc, r) => acc + getQty(r.key) * (getCount(kind, r.key, iso) || 0), 0);
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
        // 2026-08-20 (Kayee: "separate out planned and current customer... current
        // customer sort and then a line separating and then planned customer") — split
        // into two row groups instead of one flat sorted list; a `label` on a group
        // renders a full-width divider band (the same section-band convention Payroll's
        // Roster uses for its own sub-groups), so "Planned Customers" reads as a clear
        // line between the two, not just a sort-order coincidence.
        { key: 'current', label: null, rows: currentPairs },
        { key: 'planned', label: 'Planned Customers', rows: plannedPairs },
        // Hidden GL customers live in their own collapsed "Inactive" group at the
        // bottom (2026-08-20, Kayee: "no need to restore [button in the header]...
        // add an inactive section... default it to collapse... add the restore next
        // to the customer name") — each row is just the name + its own Restore button.
        { key: 'inactive', label: 'Inactive Customers', collapsible: true, defaultCollapsed: true, rows: inactiveRows },
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
  // Transaction vs Subscription revenue-stream toggle (2026-08-20, Kayee: "give me
  // another toggle to have this table to separate transactional and subscription
  // revenue") — same two streams the P&L/CF Assumptions model as "Transaction
  // Revenue" (account 42000) and "Subscription Revenue" (account 40000); 'all' keeps
  // every 4xxxx revenue account, including Services Revenue (41000) which belongs to
  // neither stream.
  const [revenueStream, setRevenueStream] = useState('all');
  // Both sections now start EXPANDED (2026-08-20, Kayee: "you can keep these two now
  // expand by default") — reverses the 2026-08-18 collapsed-by-default decision now
  // that the tab's contents are more settled.
  const [collapsedSections, setCollapsedSections] = useState({
    current: false,
    projection: false,
  });
  const { rows: planned, setRows: setPlanned, hydrated } = usePlannedCustomers();
  const { state: drivers, setState: setDrivers, hydrated: driversHydrated } = useCustomerDrivers();
  const [justAddedId, setJustAddedId] = useState(null);

  function toggleSection(key) {
    setCollapsedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const cashWaterfall = useMemo(
    () => buildCustomerWaterfall(glCash?.transactions, revenueStream),
    [glCash, revenueStream]
  );
  const accruedWaterfall = useMemo(
    () => buildCustomerWaterfall(glAccrued?.transactions, revenueStream),
    [glAccrued, revenueStream]
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

  // Cash In Projection — Campaigns & Meetings never shows anything before Jan 2026
  // (2026-08-20, Kayee, pointing at that grid specifically: "for this section, start
  // it at jan 2026 no need to show section for anything before that") — on the
  // Historical toggle, planMonths can reach back into 2025, but per-customer
  // campaign/meeting counts only ever get edited/tracked from Jan 2026 forward, so
  // earlier columns there are just empty scroll-past space. Scoped to this one grid,
  // not planMonths itself, so the Cash Coming In — Summary table above keeps showing
  // its full Historical range untouched.
  const driverGridMonths = planMonths.filter((iso) => iso >= '2026-01');

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
    // No confirm() dialog (2026-08-20, Kayee: "i dont want no pop up when i delete
    // stuff") — delete fires immediately, matching every other delete action in the app.
    const nextDriversByKey = { ...drivers.driversByKey };
    delete nextDriversByKey[`manual:${id}`];
    setDrivers({
      ...drivers,
      manualCustomers: drivers.manualCustomers.filter((c) => c.id !== id),
      driversByKey: nextDriversByKey,
    });
  }

  // Hide a GL-roster row from the projection grid (2026-08-20, Kayee: "brex? i want
  // to have the option to remove them too") — not a delete: the name goes into
  // drivers.hiddenGlCustomers and the row disappears from this grid only. Their real
  // GL actuals are untouched (waterfall, Cash Coming In actual months). Restorable
  // via the "Restore hidden" header button.
  // No confirm dialog (2026-08-20, Kayee: "i dont want this warning") — hiding is
  // freely reversible now that hidden rows land in the visible Inactive Customers
  // section below with their own Restore button, so a browser popup guarding it was
  // just friction.
  function hideGlCustomer(name) {
    if (!drivers) return;
    setDrivers({ ...drivers, hiddenGlCustomers: [...(drivers.hiddenGlCustomers || []), name] });
  }

  // Per-customer restore (2026-08-20, Kayee: "add the restore next to the customer
  // name" — replaces the earlier one-shot "Restore hidden (N)" header button).
  function restoreGlCustomer(name) {
    if (!drivers) return;
    setDrivers({ ...drivers, hiddenGlCustomers: (drivers.hiddenGlCustomers || []).filter((n) => n !== name) });
  }

  const hiddenGlCustomers = drivers?.hiddenGlCustomers || [];

  // Rows for the grid's collapsed "Inactive Customers" group — pre-built PayrollTable
  // rows (name + Restore), no driver/price/month cells: an inactive customer has
  // nothing to plan until it's restored.
  const inactiveDriverRows = [...hiddenGlCustomers]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    .map((name) => ({
      id: `inactive:${name}`,
      cells: {
        name: (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'space-between' }}>
            <span>{name}</span>
            <button type="button" className="btn" onClick={() => restoreGlCustomer(name)} title="Bring this customer back into the projection grid">
              Restore
            </button>
          </span>
        ),
        metric: '',
        price: '',
      },
      monthCells: {},
    }));

  // Current & pipeline driver rows: the live GL Cash roster (pre-populated,
  // name read-only — it IS the GL counterparty name, but hideable) + manually added
  // rows (fully editable/removable).
  const currentDriverRows = [
    ...cashWaterfall.customers
      .filter((c) => !hiddenGlCustomers.includes(c.name))
      .map((c) => ({
        key: `gl:${c.name}`,
        name: c.name,
        nameCell: (
          // Same layout as manual rows below — name first, trash on the right — but
          // the name is plain text (it's the GL counterparty, not editable) and the
          // trash HIDES rather than deletes (see hideGlCustomer above).
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'space-between' }}>
            <span>{c.name}</span>
            <button
              type="button"
              className="icon-btn"
              title="Hide this GL customer from the projection grid (restorable)"
              onClick={() => hideGlCustomer(c.name)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0l-1 14a2 2 0 01-2 2H7a2 2 0 01-2-2L4 6" />
              </svg>
            </button>
          </span>
        ),
      })),
    ...(drivers?.manualCustomers || []).map((c) => ({
      key: `manual:${c.id}`,
      name: c.name,
      nameCell: (
        // Trash on the RIGHT of the name input (2026-08-20, Kayee: "make the trash
        // can to the right, not on the left") — same order as the planned rows below.
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <TextInput value={c.name} placeholder="Customer name" onCommit={(v) => renameManualCustomer(c.id, v)} />
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
  // 2026-08-20 (Kayee): "Planned" pill tag REMOVED — planned rows already live under
  // the grid's own "Planned Customers" divider band, so the per-row tag was redundant
  // ("you dont need the planned bubble because you always put them under planned
  // customer"). In its place: a Qty multiplier ("did you give me options to multiply
  // with quantity? like this customer at this price point will be 2 of them") — every
  // planned row's cash-in is qty × (campaigns × price + meetings × price), so one row
  // can stand for N identical planned customers. Defaults to 1; see qtyForKey below.
  const plannedDriverRows = (planned || []).map((r) => ({
    key: `plan:${r.id}`,
    name: r.name,
    nameCell: (
      // Trash on the RIGHT (2026-08-20, Kayee) — delete last, so the destructive
      // control isn't the first thing in the cell.
      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <TextInput value={r.name} placeholder="Planned customer name" focusOnMount={r.id === justAddedId} onCommit={(v) => {
          updatePlanned(r.id, { name: v });
          if (r.id === justAddedId) setJustAddedId(null);
        }} />
        <span className="planned-qty" title="Quantity — how many identical planned customers this row stands for; all its $ multiply by this">
          ×
          <MonthInput value={Number(r.qty) || 1} onCommit={(n) => updatePlanned(r.id, { qty: Math.max(1, Math.round(n) || 1) })} />
        </span>
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
      </span>
    ),
  }));

  // Current/Pipeline and Planned stay as two SEPARATE groups in the grid (2026-08-20,
  // Kayee: "separate out planned and current customer... current customer sort and
  // then a line separating and then planned customer" — reverses the 2026-08-19
  // "one consolidated list" decision), each sorted alphabetically by name on its own
  // (2026-08-20: "arrange this in alphabet order"). The no-counterparty reconciling
  // bucket stays pinned to the very bottom of the Current group regardless of where
  // "U" would otherwise sort, matching the same pin used in
  // lib/data/customerData.js's waterfall — it's not a real customer name.
  const UNCATEGORIZED_DRIVER_NAME = 'Uncategorized (no counterparty)';
  function alphabetical(list) {
    return [...list].sort((a, b) => {
      if (a.name === UNCATEGORIZED_DRIVER_NAME) return 1;
      if (b.name === UNCATEGORIZED_DRIVER_NAME) return -1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
  }
  const sortedCurrentDriverRows = alphabetical(currentDriverRows);
  const sortedPlannedDriverRows = alphabetical(plannedDriverRows);

  const allCashInRows = [
    // Hidden GL customers excluded here too (2026-08-20) so hiding a row also drops
    // its forecast counts from the Cash Coming In summary and the CF feed — otherwise
    // a hidden row would keep silently adding invisible cash to the totals. Its saved
    // counts aren't deleted, so restoring the row brings its numbers straight back.
    ...cashWaterfall.customers
      .filter((c) => !hiddenGlCustomers.includes(c.name))
      .map((c) => ({
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

  /** Quantity multiplier (2026-08-20, Kayee: "this customer at this price point will
   *  be 2 of them") — planned rows only; one planned row can stand for N identical
   *  customers, and everything computed from it (both streams, grid totals, summary,
   *  CF feed) multiplies by N. Current/pipeline rows are real single customers → 1. */
  function qtyForKey(key) {
    if (!key.startsWith('plan:')) return 1;
    const row = (planned || []).find((r) => `plan:${r.id}` === key);
    return Math.max(1, Number(row?.qty) || 1);
  }

  /** Meeting $ for one customer key in one month: qty × meetings × that customer's
   *  per-meeting price — this IS "Transaction Revenue" (2026-08-20 breakdown, matching
   *  the P&L projection's own "Transaction Revenue = # of Meetings × Per Meeting Rate"
   *  naming, per Kayee: "transactional revenue is the calculation with the # of
   *  meeting * price per meeting"). */
  function meetingCashInFor(key, iso) {
    return qtyForKey(key) * getDriverCount('meetings', key, iso) * getCustomerPrice('meetings', key);
  }

  /** Campaign $ for one customer key in one month: qty × campaigns × that customer's
   *  campaign price — this IS "Subscription Revenue" ("and the subscription is the
   *  other [calculation]"), matching the P&L projection's "Subscription Revenue =
   *  # of Campaigns × Upfront Rate". */
  function campaignCashInFor(key, iso) {
    return qtyForKey(key) * getDriverCount('campaigns', key, iso) * getCustomerPrice('campaigns', key);
  }

  /** Computed cash in for one customer key in one FORECAST month: the sum of the two
   *  streams above (2026-08-19: per-customer rates, not one shared rate — see
   *  getCustomerPrice). */
  function cashInFor(key, iso) {
    return campaignCashInFor(key, iso) + meetingCashInFor(key, iso);
  }

  // CF PROJECTION FEED — the other half of the link documented in ReportsPanel.jsx.
  // Recomputed over the FULL horizon (not just the visible range toggle) so switching
  // the display range can never change what the CF projection reads. Forecast months
  // only: actual months are real GL cash, already on the CF statement. As of
  // 2026-08-20 this also splits the combined total into `transactionByMonth` (meeting
  // $, across every current/pipeline/planned row) and `subscriptionByMonth` (campaign
  // $) so the CF sheet's own "Transaction Revenue" / "Subscription Revenue" rows can
  // show these live, not just one lump "Customer Cash Inflow" total.
  const inflowTotalsByMonth = useMemo(() => {
    if (!driversHydrated || !drivers) return null;
    const totals = {};
    const transactionTotals = {};
    const subscriptionTotals = {};
    for (const iso of monthsForRange('all')) {
      if (!isEditableMonth(iso)) continue;
      let sum = 0;
      let meetingSum = 0;
      let campaignSum = 0;
      for (const row of allCashInRows) {
        meetingSum += meetingCashInFor(row.key, iso);
        campaignSum += campaignCashInFor(row.key, iso);
      }
      sum = meetingSum + campaignSum;
      totals[iso] = sum;
      transactionTotals[iso] = meetingSum;
      subscriptionTotals[iso] = campaignSum;
    }
    return { totalsByMonth: totals, transactionByMonth: transactionTotals, subscriptionByMonth: subscriptionTotals };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drivers, driversHydrated, planned, cashWaterfall, glLastIso]);

  useEffect(() => {
    if (!inflowTotalsByMonth) return;
    try {
      window.localStorage.setItem(
        CUSTOMER_INFLOW_STORAGE_KEY,
        JSON.stringify({
          version: 2,
          updatedAt: new Date().toISOString(),
          totalsByMonth: inflowTotalsByMonth.totalsByMonth,
          transactionByMonth: inflowTotalsByMonth.transactionByMonth,
          subscriptionByMonth: inflowTotalsByMonth.subscriptionByMonth,
        })
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
    // No confirm() dialog (2026-08-20, Kayee: "i dont want no pop up when i delete stuff").
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
  function buildSubtotalRow(label, rows, tone, valueFor = amountFor, toggle = null) {
    // 2026-08-19, Kayee: "the total current and total planned numbers and the entire
    // row the font doesn't need to be bold" — only the grand TOTAL (current+planned)
    // row stays bold; every row below it (including the new Meeting/Campaigns Cash In
    // breakdown lines, 2026-08-20) renders as plain weight text (still its own light-
    // grey row tone, just not bold).
    const bold = tone === 'grand';
    const wrap = (node) => (bold ? <b>{node}</b> : node);
    // 'pinned' tone (2026-08-20, Kayee: "make total current customer a slightly darker
    // grey and also make it stay on top... should have the ability to expand and see
    // meeting cash and campaign cash in") — darker than the plain 'sub' breakdown rows
    // below it, and sticky (see .summary-subtotal-pinned in globals.css) so it's still
    // visible once you've scrolled down into the long customer grid underneath.
    const className = bold ? 'summary-grand-total' : tone === 'pinned' ? 'summary-subtotal-pinned' : 'summary-subtotal';
    const nameNode = toggle ? (
      <button type="button" className="summary-row-toggle" onClick={toggle.onClick} aria-expanded={toggle.expanded}>
        <span className={`payroll-chevron${toggle.expanded ? ' open' : ''}`}>▸</span>
        {wrap(label)}
      </button>
    ) : (
      wrap(label)
    );
    return {
      id: `subtotal:${label}:${tone}`,
      className,
      cells: { name: nameNode, kind: '' },
      monthCells: Object.fromEntries(
        planMonths.map((iso) => {
          const sum = rows.reduce((acc, row) => acc + valueFor(row, iso), 0);
          return [iso, <span key={iso}>{wrap(formatPayrollAmount(sum) || '$0')}</span>];
        })
      ),
    };
  }

  // Split into Current (GL customers + manual pipeline rows) vs Planned — same split
  // used for the summary below.
  const currentKindRows = allCashInRows.filter((r) => r.kind !== 'Planned');
  const plannedKindRows = allCashInRows.filter((r) => r.kind === 'Planned');

  // Summary breakdown (2026-08-20, Kayee: "you should do meeting cash in and campaigns
  // cash in and then roll up to current customer and then same goes to planned
  // customer... rename it so that it doesn't just say total - current, just say total
  // current customer — something that fits in the FP&A world"). Each tier (Current,
  // then Planned) now shows its two component streams — Meeting Cash In (Transaction
  // Revenue) and Campaigns Cash In (Subscription Revenue), same naming the P&L/CF
  // statements use — right above the tier's own roll-up total, instead of a single
  // opaque number. Breakdown rows use meetingCashInFor/campaignCashInFor directly
  // (always driver × price, live) rather than amountFor's GL-protected total, so they
  // stay consistent with exactly what feeds the CF sheet's Transaction/Subscription
  // Revenue rows for forecast months; the roll-up total below them still uses
  // amountFor, so real GL cash keeps being the source of truth for actual months.
  // Expand/collapse for each tier's Meeting/Campaigns breakdown, nested under its own
  // Total row now instead of always shown above it (2026-08-20, Kayee: "make total
  // current customer... stay on top... should have the ability to expand and see
  // meeting cash and campaign cash in. and default to collapsed"). Defaults collapsed
  // — the breakdown is a drill-down, not part of the at-a-glance summary.
  const [summaryExpanded, setSummaryExpanded] = useState({ current: false, planned: false });
  const toggleSummaryTier = (tier) => setSummaryExpanded((s) => ({ ...s, [tier]: !s[tier] }));

  const summaryRows = [
    buildSubtotalRow('TOTAL (Current + Planned)', allCashInRows, 'grand'),
    buildSubtotalRow('Total Current Customer', currentKindRows, 'pinned', amountFor, {
      expanded: summaryExpanded.current,
      onClick: () => toggleSummaryTier('current'),
    }),
    ...(summaryExpanded.current
      ? [
          buildSubtotalRow('Meeting Cash In', currentKindRows, 'sub', (row, iso) => meetingCashInFor(row.key, iso)),
          buildSubtotalRow('Campaigns Cash In', currentKindRows, 'sub', (row, iso) => campaignCashInFor(row.key, iso)),
        ]
      : []),
    // Only shown once there's at least one planned customer — an always-visible
    // "Total Planned Customer $0" row when the plan is empty would just be noise.
    ...(plannedKindRows.length > 0
      ? [
          buildSubtotalRow('Total Planned Customer', plannedKindRows, 'pinned', amountFor, {
            expanded: summaryExpanded.planned,
            onClick: () => toggleSummaryTier('planned'),
          }),
          ...(summaryExpanded.planned
            ? [
                buildSubtotalRow('Meeting Cash In', plannedKindRows, 'sub', (row, iso) => meetingCashInFor(row.key, iso)),
                buildSubtotalRow('Campaigns Cash In', plannedKindRows, 'sub', (row, iso) => campaignCashInFor(row.key, iso)),
              ]
            : []),
        ]
      : []),
  ];

  /* ----------------------------------- Render ----------------------------------- */

  return (
    <>
      {/* No PageHead here (2026-08-20, Kayee: "waste of space") — the "Customer"
          sub-tab button directly above already labels this view, so a second
          "Customer Cash Flow" title right under it was pure redundancy. */}

      {/* Wide wrapper — the frozen leading columns eat most of the normal page width,
          so this section breaks out wider, exactly like the Payroll tab (.page-wide
          in globals.css). */}
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

        {/* ----------------------- Cash Inflow Projection ----------------------- */}
        {/* ONE card (2026-08-18) merging the former Cash Inflow Drivers + Customer
            Planning + Cash Coming In cards. Order inside: summary strip (prices +
            live monthly TOTAL) → current & pipeline driver grids → Planned Customers
            block (labeled divider, not a separate card) → computed per-customer
            Cash Coming In detail. */}
        <CollapsibleSection
          title="Cash Inflow Projection"
          subtitle="Prices & live monthly TOTAL · campaigns/meetings drivers · planned customers — feeds the Cash Flow Projection"
          // Matches Payroll's color scheme (2026-08-20, Kayee: "purple is planned and
          // whichever is current") — Current Customers above stays --blue (same as
          // Payroll's "Existing"); this section holds the planning/forecast side of the
          // tab (planned customers + forward-looking drivers), so it takes Payroll's
          // "Planned" purple instead of its old unrelated teal.
          colorVar="--purple"
          collapsed={collapsedSections.projection}
          onToggle={() => toggleSection('projection')}
        >
          {driversHydrated && drivers && hydrated && planned ? (
            <>
              {/* SUMMARY — one place at the top for the totals (2026-08-19, Kayee:
                  "there are too many sections... just have one at the top for summary.
                  like summary total of both current and planned customer and then
                  below by [tier] like total of current customer and then followed by
                  planned customer"). Three stacked TOTAL-style rows, nothing else.
                  2026-08-20 (Kayee: "give a space between summary and projection...
                  it need a space") — the 2026-08-19 .customer-driver-group wrapper
                  that joined Summary + grid into one gapless block is gone; they're
                  two separate cards again with the tab's normal 20px spacer. */}
              <PayrollTable
                title="Cash Coming In — Summary"
                subtitle="TOTAL (current + planned), then each broken out — feeds the Cash Flow Projection"
                tintForecast={false}
                frozenColumns={SUMMARY_FROZEN_COLUMNS}
                months={planMonths}
                todayIso={todayIso}
                rowGroups={[{ key: 'summary', label: null, rows: summaryRows }]}
              />

              {/* No explicit spacer divs between these cards (2026-08-20, Kayee:
                  "these spaces are too big, make it narrower like the same height as
                  the other spacing") — the parent .pr-outer-body's own 20px flex gap
                  already separates them; a spacer div on top of that gap doubled the
                  space (gap + spacer + gap). */}

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
                subtitle="Each customer priced individually, alphabetically · counts editable Jan 2026 onward · Current & Pipeline from the live GL Cash roster, plus rows you add · Planned customers in their own group below"
                currentRows={sortedCurrentDriverRows}
                plannedRows={sortedPlannedDriverRows}
                inactiveRows={inactiveDriverRows}
                months={driverGridMonths}
                isEditableMonth={isDriverEditableMonth}
                todayIso={todayIso}
                getCount={getDriverCount}
                onSetCount={setDriverCount}
                getPrice={getCustomerPrice}
                onSetPrice={setCustomerPrice}
                getQty={qtyForKey}
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

              {/* Price assumptions for PLANNED customers — moved to the very bottom
                  (2026-08-20, Kayee: "move this to the very bottom"; was the first
                  thing in the section). Same AssumptionField strip as the Payroll
                  tab's assumptions bar. */}
              <div className="payroll-assumptions customer-assumptions">
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
            </>
          ) : (
            <div className="cap">Loading saved cash inflow drivers…</div>
          )}
        </CollapsibleSection>
      </div>
    </>
  );
}
