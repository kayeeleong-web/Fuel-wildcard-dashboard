/**
 * Deal-based customer revenue projection — data model + math (2026-09-07).
 *
 * Replaces the old "type in # of campaigns / # of meetings per customer per month"
 * Cash Inflow Projection on the Customer tab. Ported from Kayee's Google Sheet model
 * ("New" tab, wildcard-fuel sheet) and the rules agreed on the 2026-09-03
 * Wildcard <> FuelFinance weekly sync:
 *
 *  - One row per contract line item ("deal"). Every field is meant to arrive from the
 *    CSM/CRM (Slurp Bot) by default — `deal.csm` holds whatever the import supplied —
 *    but the user can override any field in the Customer tab (`deal.overrides`). The
 *    effective value is overrides ?? csm ?? default (see effectiveDeal). The CSM dataset
 *    doesn't exist yet, so today every deal is manual (csm = null); the shape is ready for
 *    when it lands (applyCsmDeals below).
 *  - Pipeline deals only project once their probability clears the threshold (70%).
 *  - Revenue recognition ("Contract Accrual" → P&L Subscription Revenue): the contract
 *    value spread evenly from the recognition start month over the contract term PLUS
 *    `recognitionExtensionMonths` (2) — the call's "a 3-month pilot is really 5 months"
 *    rule, applied to every term (6 → 8, 9 → 11, 12 → 14).
 *  - Contract Cash: lump sum / monthly / quarterly, landing `paymentTermsDays` (net 15/30/
 *    60/90) after the invoice month.
 *  - Success Fee Accrual (→ P&L Transaction Revenue) = meetings that month × avg success
 *    fee; meetings come from the CSM (or typed in per month). Success Fee Cash = the same
 *    figure shifted by the invoice lag (billed monthly, per Shane).
 *  - Campaign COGS Accrual = (campaigns/month × cost per campaign × term) spread evenly
 *    over the same recognized period as revenue (term + 2).
 *  - Campaign COGS Cash: month 1 of the deal is always $0 (cards/net terms — nothing is
 *    paid the month the contract starts), then a weighted % of the deal's TOTAL campaign
 *    cost lands each month, from a per-term weight table the user can edit (defaults:
 *    3-month = 0 / 30 / 33 / 33 / 4 across 5 months; longer terms stretch that same shape
 *    across term + 2 months).
 *
 * Sign convention: everything here is stored/returned POSITIVE. The Customer tab renders
 * COGS rows in parentheses; the P&L/CF engine already treats cost rows as positive
 * outflows.
 */

import { generateId } from '../payroll/payrollData';
import { nextMonth } from '../assumptions/assumptionsData';

export const DEALS_STORAGE_KEY = 'fuel_wildcard_customer_deals_v1';
/** Computed monthly totals handed to the P&L / Cash Flow projections (raw localStorage,
 *  same pattern as the old CUSTOMER_INFLOW_STORAGE_KEY — a derived cache, not source data). */
export const DEAL_PROJECTION_STORAGE_KEY = 'fuel_wildcard_deal_projection_v1';

export const DEAL_STAGES = ['Signed', 'Pipeline', 'Lost'];
export const RECOGNITION_RULES = [
  { value: 'signing', label: 'Signing Month' },
  { value: 'monthAfter', label: 'Month After Signing' },
];
export const CASH_TIMINGS = [
  { value: 'lump', label: 'Lump Sum at Signing' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
];
export const PAYMENT_TERMS = [0, 15, 30, 60, 90];

/** Months every deal projection is computed over — wide enough to cover the P&L's
 *  2030-12 projection horizon. */
export const DEAL_MONTHS = buildMonths('2025-01', '2030-12');

function buildMonths(from, to) {
  const out = [];
  let iso = from;
  while (iso <= to) {
    out.push(iso);
    iso = nextMonth(iso, 1);
  }
  return out;
}

/* --------------------------------- Defaults --------------------------------- */

export const DEAL_FIELD_DEFAULTS = {
  stage: 'Pipeline',
  probabilityPct: 50,
  contractValue: null, // null = auto (perCampaignPrice × campaignsPerMonth × termMonths)
  termMonths: 3,
  signingMonth: '',
  recognitionRule: 'signing',
  cashTiming: 'lump',
  paymentTermsDays: 30,
  avgSuccessFee: 0,
  campaignsPerMonth: 0,
  perCampaignPrice: 0,
  campaignCostRate: null, // null = use settings.defaultCampaignCostRate
  successFeeInvoiceLag: 1,
};

/** Human labels for the CSM-default hint / reset affordance in the editor. */
export const DEAL_FIELD_LABELS = {
  stage: 'Stage',
  probabilityPct: 'Probability %',
  contractValue: 'Contract Value ($)',
  termMonths: 'Contract Term (months)',
  signingMonth: 'Signing / Expected Close Month',
  recognitionRule: 'Recognition Start Rule',
  cashTiming: 'Cash Timing',
  paymentTermsDays: 'Payment Terms (net days)',
  avgSuccessFee: 'Avg Success Fee $/Meeting',
  campaignsPerMonth: 'Expected Campaigns / month',
  perCampaignPrice: 'Price per Campaign ($)',
  campaignCostRate: 'Cost per Campaign ($)',
  successFeeInvoiceLag: 'Success Fee Invoice Lag (months)',
};

/** Base cash-out shape for a 3-month contract (5 months incl. the $0 first month) —
 *  straight from the 2026-09-03 call: "30% ... 33% ... 33% ... 4%". */
const BASE_COGS_CASH_WEIGHTS = [0, 30, 33, 33, 4];
const BASE_TERM = 3;

/** Stretches the 3-month shape to `termMonths + extension` buckets: month 1 stays 0%,
 *  the remaining 30/33/33/4 buckets are spread proportionally over the other months
 *  (so a 6-month deal pays over 8 months, a 12-month deal over 14). Rounded to 0.1%;
 *  the rounding remainder goes on the last bucket so every row sums to exactly 100. */
export function stretchedCogsCashWeights(termMonths, extension = 2) {
  const total = Math.max(2, Math.round(Number(termMonths) || BASE_TERM) + extension);
  const tail = BASE_COGS_CASH_WEIGHTS.slice(1); // [30, 33, 33, 4]
  const targetBuckets = total - 1;
  const weights = [0];
  const per = tail.length / targetBuckets; // base buckets covered by one target bucket
  for (let i = 0; i < targetBuckets; i++) {
    const start = i * per;
    const end = start + per;
    let sum = 0;
    for (let b = 0; b < tail.length; b++) {
      const overlap = Math.max(0, Math.min(end, b + 1) - Math.max(start, b));
      sum += tail[b] * overlap;
    }
    weights.push(Math.round(sum * 10) / 10);
  }
  const drift = Math.round((100 - weights.reduce((a, b) => a + b, 0)) * 10) / 10;
  weights[weights.length - 1] = Math.round((weights[weights.length - 1] + drift) * 10) / 10;
  return weights;
}

export function seedDealSettings() {
  return {
    pipelineThresholdPct: 70,
    recognitionExtensionMonths: 2,
    defaultCampaignCostRate: 250,
    // Editable per-term weight rows; any term not listed falls back to the stretched
    // default at read time (cogsCashWeightsForTerm).
    cogsCashWeightsByTerm: {
      3: stretchedCogsCashWeights(3),
      6: stretchedCogsCashWeights(6),
      9: stretchedCogsCashWeights(9),
      12: stretchedCogsCashWeights(12),
    },
  };
}

export function seedDealsState() {
  return { version: 1, settings: seedDealSettings(), deals: [] };
}

export function isValidDealsState(loaded) {
  return !!(loaded && loaded.version === 1 && Array.isArray(loaded.deals) && loaded.settings && typeof loaded.settings === 'object');
}

/** Backfills any settings key a saved state predates (additive only). */
export function migrateDealsState(loaded) {
  const seed = seedDealSettings();
  return {
    ...loaded,
    settings: {
      ...seed,
      ...(loaded.settings || {}),
      cogsCashWeightsByTerm: { ...seed.cogsCashWeightsByTerm, ...((loaded.settings || {}).cogsCashWeightsByTerm || {}) },
    },
    deals: (loaded.deals || []).map((d) => ({
      ...d,
      id: d.id || generateId('deal'),
      name: d.name || '',
      csm: d.csm || null,
      overrides: d.overrides || {},
      meetingsByMonth: d.meetingsByMonth || {},
      csmMeetingsByMonth: d.csmMeetingsByMonth || null,
    })),
  };
}

/* ------------------------------ Deals: CRUD helpers ------------------------------ */

export function makeDeal(overrides = {}) {
  return {
    id: generateId('deal'),
    name: '',
    // Raw field values as supplied by the CSM import (null until the integration lands).
    csm: null,
    // User edits made in the Customer tab — win over csm.
    overrides: {},
    // Meetings scheduled per month (success-fee driver) — user-typed. CSM-supplied
    // counts live in csmMeetingsByMonth; a typed value wins for that month.
    meetingsByMonth: {},
    csmMeetingsByMonth: null,
    ...overrides,
  };
}

/** The value the projection actually uses for one field: user override → CSM → default. */
export function dealField(deal, field) {
  if (deal.overrides && deal.overrides[field] !== undefined && deal.overrides[field] !== null && deal.overrides[field] !== '') {
    return deal.overrides[field];
  }
  if (deal.csm && deal.csm[field] !== undefined && deal.csm[field] !== null && deal.csm[field] !== '') {
    return deal.csm[field];
  }
  return DEAL_FIELD_DEFAULTS[field];
}

/** True when the user has overridden a field that the CSM also supplied — drives the
 *  "↺ CSM: x" reset hint in the editor. */
export function isOverriddenCsmField(deal, field) {
  return !!(deal.csm && deal.csm[field] != null && deal.overrides && deal.overrides[field] != null && deal.overrides[field] !== deal.csm[field]);
}

export function effectiveDeal(deal, settings) {
  const e = {};
  for (const field of Object.keys(DEAL_FIELD_DEFAULTS)) e[field] = dealField(deal, field);
  e.termMonths = Math.max(1, Math.round(Number(e.termMonths) || 1));
  e.probabilityPct = Number(e.probabilityPct) || 0;
  e.campaignsPerMonth = Number(e.campaignsPerMonth) || 0;
  e.perCampaignPrice = Number(e.perCampaignPrice) || 0;
  e.avgSuccessFee = Number(e.avgSuccessFee) || 0;
  e.paymentTermsDays = Number(e.paymentTermsDays) || 0;
  e.successFeeInvoiceLag = Math.max(0, Math.round(Number(e.successFeeInvoiceLag) || 0));
  e.campaignCostRate = e.campaignCostRate == null || e.campaignCostRate === '' ? Number(settings?.defaultCampaignCostRate) || 0 : Number(e.campaignCostRate) || 0;
  e.contractValueIsAuto = e.contractValue == null || e.contractValue === '';
  e.contractValue = e.contractValueIsAuto ? e.perCampaignPrice * e.campaignsPerMonth * e.termMonths : Number(e.contractValue) || 0;
  return e;
}

export function meetingsForDealMonth(deal, iso) {
  const typed = deal.meetingsByMonth?.[iso];
  if (typed != null && typed !== '') return Number(typed) || 0;
  const fromCsm = deal.csmMeetingsByMonth?.[iso];
  return fromCsm != null ? Number(fromCsm) || 0 : 0;
}

/** Merges a CSM export into the saved deals: matches on `csmId` (or name), refreshes
 *  each deal's `csm` block + csmMeetingsByMonth, never touches user overrides. New CSM
 *  rows are appended; deals the CSM no longer lists are left alone (the user decides). */
export function applyCsmDeals(state, csmRows) {
  const byKey = new Map(state.deals.map((d) => [d.csmId || d.name, d]));
  const next = [...state.deals];
  for (const row of csmRows || []) {
    const key = row.csmId || row.name;
    const existing = byKey.get(key);
    const csm = { ...row.fields };
    if (existing) {
      const idx = next.indexOf(existing);
      next[idx] = { ...existing, csmId: row.csmId || existing.csmId, csm, csmMeetingsByMonth: row.meetingsByMonth || existing.csmMeetingsByMonth };
    } else {
      next.push(makeDeal({ name: row.name, csmId: row.csmId, csm, csmMeetingsByMonth: row.meetingsByMonth || null }));
    }
  }
  return { ...state, deals: next };
}

/* ----------------------------------- Math ----------------------------------- */

export function cogsCashWeightsForTerm(settings, termMonths) {
  const ext = Math.max(0, Math.round(Number(settings?.recognitionExtensionMonths) || 0));
  const saved = settings?.cogsCashWeightsByTerm?.[termMonths];
  if (Array.isArray(saved) && saved.length > 0) return saved.map((w) => Number(w) || 0);
  return stretchedCogsCashWeights(termMonths, ext);
}

export function paymentLagMonths(paymentTermsDays) {
  const days = Number(paymentTermsDays) || 0;
  return days <= 0 ? 0 : Math.ceil(days / 30);
}

export function isDealActive(effective, settings) {
  if (effective.stage === 'Signed') return true;
  if (effective.stage === 'Pipeline') return effective.probabilityPct >= (Number(settings?.pipelineThresholdPct) || 0);
  return false;
}

function addTo(map, iso, amount) {
  if (!iso || !amount) return;
  map[iso] = (map[iso] || 0) + amount;
}

/** Every projected line for one deal, keyed by iso month. All amounts positive. */
export function projectDeal(deal, settings) {
  const e = effectiveDeal(deal, settings);
  const lines = {
    contractAccrual: {},
    contractCash: {},
    successFeeAccrual: {},
    successFeeCash: {},
    meetings: {},
    cogsAccrual: {},
    cogsCash: {},
  };
  const active = isDealActive(e, settings);
  if (!active || !e.signingMonth || !/^\d{4}-\d{2}$/.test(e.signingMonth)) return { effective: e, active, lines };

  const ext = Math.max(0, Math.round(Number(settings?.recognitionExtensionMonths) || 0));
  const recMonths = e.termMonths + ext;
  const start = e.recognitionRule === 'monthAfter' ? nextMonth(e.signingMonth, 1) : e.signingMonth;
  const payLag = paymentLagMonths(e.paymentTermsDays);

  // Contract accrual — even spread over term + extension.
  if (e.contractValue > 0) {
    const perMonth = e.contractValue / recMonths;
    for (let k = 0; k < recMonths; k++) addTo(lines.contractAccrual, nextMonth(start, k), perMonth);
  }

  // Contract cash.
  if (e.contractValue > 0) {
    if (e.cashTiming === 'monthly') {
      const perMonth = e.contractValue / e.termMonths;
      for (let k = 0; k < e.termMonths; k++) addTo(lines.contractCash, nextMonth(start, k + payLag), perMonth);
    } else if (e.cashTiming === 'quarterly') {
      const perMonth = e.contractValue / e.termMonths;
      for (let q = 0; q * 3 < e.termMonths; q++) {
        const monthsInQuarter = Math.min(3, e.termMonths - q * 3);
        addTo(lines.contractCash, nextMonth(start, q * 3 + payLag), perMonth * monthsInQuarter);
      }
    } else {
      // Lump sum, invoiced at signing.
      addTo(lines.contractCash, nextMonth(e.signingMonth, payLag), e.contractValue);
    }
  }

  // Success fees — meetings × fee, cash lagged by the invoice lag.
  for (const iso of DEAL_MONTHS) {
    const meetings = meetingsForDealMonth(deal, iso);
    if (!meetings) continue;
    lines.meetings[iso] = meetings;
    const fee = meetings * e.avgSuccessFee;
    if (!fee) continue;
    addTo(lines.successFeeAccrual, iso, fee);
    addTo(lines.successFeeCash, nextMonth(iso, e.successFeeInvoiceLag), fee);
  }

  // Campaign COGS.
  const totalCogs = e.campaignsPerMonth * e.campaignCostRate * e.termMonths;
  if (totalCogs > 0) {
    const perMonth = totalCogs / recMonths;
    for (let k = 0; k < recMonths; k++) addTo(lines.cogsAccrual, nextMonth(start, k), perMonth);
    const weights = cogsCashWeightsForTerm(settings, e.termMonths);
    weights.forEach((w, k) => addTo(lines.cogsCash, nextMonth(start, k), (totalCogs * (Number(w) || 0)) / 100));
  }

  return { effective: e, active, lines };
}

/** Sums every deal into the totals the P&L / CF read. Campaign counts per month are
 *  the sum of campaignsPerMonth across every deal in its contract term (for the P&L's
 *  read-only "# of Campaigns" driver row). */
export function projectAllDeals(state) {
  const settings = state?.settings || seedDealSettings();
  const perDeal = (state?.deals || []).map((deal) => ({ deal, ...projectDeal(deal, settings) }));
  const totals = {
    contractAccrual: {},
    contractCash: {},
    successFeeAccrual: {},
    successFeeCash: {},
    cogsAccrual: {},
    cogsCash: {},
    meetings: {},
    campaigns: {},
  };
  for (const p of perDeal) {
    for (const key of Object.keys(totals)) {
      if (key === 'campaigns') continue;
      for (const [iso, amt] of Object.entries(p.lines[key] || {})) addTo(totals[key], iso, amt);
    }
    if (p.active && p.effective.signingMonth && p.effective.campaignsPerMonth) {
      const start = p.effective.recognitionRule === 'monthAfter' ? nextMonth(p.effective.signingMonth, 1) : p.effective.signingMonth;
      for (let k = 0; k < p.effective.termMonths; k++) addTo(totals.campaigns, nextMonth(start, k), p.effective.campaignsPerMonth);
    }
  }
  return { perDeal, totals, settings };
}

/** The handoff object written to DEAL_PROJECTION_STORAGE_KEY and read by the P&L/CF
 *  projections (see readDealProjection in lib/cashflow/cashProjection.js). Keeps the
 *  old customer-inflow field names (totalsByMonth / transactionByMonth /
 *  subscriptionByMonth) so the existing CF revenue-row code keeps working unchanged. */
export function buildDealProjectionHandoff(state) {
  const { totals } = projectAllDeals(state);
  const totalsByMonth = {};
  for (const iso of new Set([...Object.keys(totals.contractCash), ...Object.keys(totals.successFeeCash)])) {
    totalsByMonth[iso] = (totals.contractCash[iso] || 0) + (totals.successFeeCash[iso] || 0);
  }
  return {
    version: 3,
    updatedAt: new Date().toISOString(),
    // 0 deals = the P&L/CF keep using the legacy flat-rate model rather than projecting
    // $0 revenue (readDealProjection treats an empty deal list as "not driving yet").
    dealCount: (state?.deals || []).length,
    totalsByMonth,
    subscriptionByMonth: totals.contractCash,
    transactionByMonth: totals.successFeeCash,
    cogsCashByMonth: totals.cogsCash,
    accrual: {
      subscriptionByMonth: totals.contractAccrual,
      transactionByMonth: totals.successFeeAccrual,
      cogsByMonth: totals.cogsAccrual,
    },
    campaignsByMonth: totals.campaigns,
    meetingsByMonth: totals.meetings,
  };
}
