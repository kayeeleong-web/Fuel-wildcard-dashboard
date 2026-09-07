'use client';

import { useEffect } from 'react';
import { usePlanningState } from '../planning/usePlanningState';
import {
  DEALS_STORAGE_KEY,
  DEAL_PROJECTION_STORAGE_KEY,
  buildDealProjectionHandoff,
  isValidDealsState,
  migrateDealsState,
  seedDealsState,
} from './dealsData';

/**
 * Persisted deal list + settings for the Customer tab's revenue projection — same
 * planning-storage layer as every other Projection sub-tab (Supabase durable copy +
 * localStorage cache/fallback, see lib/planning/planningStorage.js). Public shape:
 * { state, setState, hydrated, lastSavedAt, saveNow }.
 *
 * Also keeps the derived DEAL_PROJECTION_STORAGE_KEY handoff fresh: every time the deals
 * change, the computed monthly totals (accrual + cash, revenue + COGS) are written to
 * localStorage for the P&L / Cash Flow projections to read on mount (those are sibling
 * sub-tabs that remount on switch). Derived cache only — deliberately not sent to
 * Supabase; it's recomputed from the deals on every change.
 */
export function useDealsState({ writeHandoff = true } = {}) {
  const ctl = usePlanningState(DEALS_STORAGE_KEY, {
    seed: seedDealsState,
    isValid: isValidDealsState,
    migrate: migrateDealsState,
  });

  useEffect(() => {
    if (!writeHandoff || !ctl.hydrated || !ctl.state || typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(DEAL_PROJECTION_STORAGE_KEY, JSON.stringify(buildDealProjectionHandoff(ctl.state)));
    } catch {
      // Storage full/blocked — the P&L/CF simply keep whatever they last read.
    }
  }, [ctl.state, ctl.hydrated, writeHandoff]);

  return ctl;
}
