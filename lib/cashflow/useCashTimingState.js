'use client';

import { useEffect, useState } from 'react';

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
 * Cash-timing state, persisted to this browser's localStorage — same
 * hydrate-then-save pattern as usePayrollState / useAssumptionsState (and the same
 * reason: this is per-user what-if planning config, never written to the sheet).
 */
export function useCashTimingState() {
  const [state, setState] = useState(null); // null until the localStorage read resolves
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let loaded = null;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) loaded = JSON.parse(raw);
    } catch {
      loaded = null;
    }
    setState(isValidState(loaded) ? loaded : seedState());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || !state) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // localStorage can throw in private-browsing/storage-full edge cases — the tab
      // still works for the session, it just won't survive a refresh in that case.
    }
  }, [state, hydrated]);

  return { state, setState, hydrated };
}
