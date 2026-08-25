'use client';

import { useCallback } from 'react';
import { usePlanningState } from '../planning/usePlanningState';
import { migrateRampRoles, seedPayrollState } from './payrollData';

const STORAGE_KEY = 'fuel_wildcard_payroll_v1';

/**
 * Payroll tab state — persisted through the shared planning storage layer
 * (2026-08-25: Supabase durable copy + localStorage cache/fallback, see
 * lib/planning/planningStorage.js; previously localStorage-only per the original
 * payrollData.js decision). Same public shape as always:
 * { state, setState, hydrated, resetToSeed, lastSavedAt, saveNow }.
 *
 * The roster ramp-role migration (2026-08-05/06) carries over unchanged: it retrofits
 * the headcount-ramp shape onto a save from before that feature existed, and a
 * migration failure falls back to the saved data as-is instead of crashing the app
 * (usePlanningState wraps migrate in its own try/catch — same guarantee as before).
 */
export function usePayrollState() {
  const planning = usePlanningState(STORAGE_KEY, {
    // Any truthy stored value counts (matching the original `loaded || seed` rule —
    // payroll never had a stricter shape check).
    isValid: (loaded) => !!loaded,
    seed: seedPayrollState,
    migrate: (loaded) => (loaded?.roster ? { ...loaded, roster: migrateRampRoles(loaded.roster) } : loaded),
  });

  const { setState } = planning;
  const resetToSeed = useCallback(() => {
    setState(seedPayrollState());
  }, [setState]);

  return { ...planning, resetToSeed };
}
