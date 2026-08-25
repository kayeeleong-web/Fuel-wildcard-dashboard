'use client';

import { usePlanningState } from '../planning/usePlanningState';

// Per-GL-account cash-timing config for the Cash Flow projection sidebar —
// { timingByAccount: { [accountId]: { mode, frequency, payMonth, manualByMonth } } }.
// accountId is the P&L row's key (or label when the sheet row has no key) — see
// lib/cashflow/cashProjection.js plExpenseAccounts.
const STORAGE_KEY = 'fuel_wildcard_cf_timing_v1';

function seedState() {
  return { timingByAccount: {} };
}

function isValidState(loaded) {
  return !!(loaded && typeof loaded === 'object' && loaded.timingByAccount && typeof loaded.timingByAccount === 'object');
}

/**
 * Cash-timing state — persisted through the shared planning storage layer
 * (2026-08-25: Supabase durable copy + localStorage cache/fallback, see
 * lib/planning/planningStorage.js; previously localStorage-only). Same public shape
 * as always: { state, setState, hydrated, lastSavedAt, saveNow }.
 */
export function useCashTimingState() {
  return usePlanningState(STORAGE_KEY, {
    seed: seedState,
    isValid: isValidState,
  });
}
