'use client';

import { useCallback, useEffect, useState } from 'react';
import { flushPlanning, loadPlanning, savePlanning } from './planningStorage';

/**
 * Shared hydrate-then-save planning state hook (2026-08-25) — the one place the
 * hydrate/auto-save/saveNow pattern that useAssumptionsState, usePayrollState,
 * useCashTimingState, usePlannedCustomers and useCustomerDrivers each hand-rolled
 * against window.localStorage now lives, wired through planningStorage.js (Supabase
 * via /api/planning, localStorage as cache/fallback) instead of localStorage
 * directly. Each of those hooks keeps its exact public shape
 * ({ state, setState, hydrated, lastSavedAt, saveNow }) — callers don't change.
 *
 * @param storageKey  the existing localStorage key (kept identical so this browser's
 *                    pre-Supabase data hydrates and migrates up seamlessly)
 * @param seed        () => fresh default state, used when nothing is stored anywhere
 * @param isValid     (loaded) => boolean — shape check; invalid stored data reseeds
 *                    instead of crashing (same rule every hook already followed)
 * @param migrate     optional (loaded) => loaded, applied to VALID stored data before
 *                    use (usePayrollState's roster migration). Throwing inside is
 *                    caught: falls back to the unmigrated data, never crashes the app.
 */
export function usePlanningState(storageKey, { seed, isValid, migrate }) {
  const [state, setState] = useState(null); // null until hydration resolves
  const [hydrated, setHydrated] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let loaded = null;
      try {
        loaded = await loadPlanning(storageKey);
      } catch {
        loaded = null;
      }
      if (cancelled) return;
      let next = loaded != null && isValid(loaded) ? loaded : seed();
      if (migrate && loaded != null && next === loaded) {
        try {
          next = migrate(loaded) ?? loaded;
        } catch (err) {
          console.warn(`Planning state migration failed for ${storageKey}, using saved data as-is:`, err);
        }
      }
      setState(next);
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    if (!hydrated || !state) return;
    if (savePlanning(storageKey, state)) setLastSavedAt(Date.now());
    // lastSavedAt deliberately NOT updated on a failed local write, so the "Saved"
    // indicator correctly stops advancing instead of claiming a write that failed.
  }, [state, hydrated, storageKey]);

  const saveNow = useCallback(() => {
    if (!hydrated || !state) return;
    if (flushPlanning(storageKey, state)) setLastSavedAt(Date.now());
  }, [state, hydrated, storageKey]);

  return { state, setState, hydrated, lastSavedAt, saveNow };
}
