'use client';

import { useCallback, useEffect, useState } from 'react';
import { migrateRampRoles, seedPayrollState } from './payrollData';

const STORAGE_KEY = 'fuel_wildcard_payroll_v1';

/**
 * Payroll tab state, persisted to this browser's localStorage (Kayee's choice — see
 * payrollData.js header). Reopening the tab or refreshing the page restores whatever was
 * last saved on THIS browser; a different device/browser starts from the seed dataset
 * transcribed from the real Wildcard payroll sheet.
 */
export function usePayrollState() {
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
    // Retrofit the headcount-ramp shape onto a save from before that feature existed
    // (2026-08-05) — every other field the user already entered is untouched. Wrapped in
    // its own try/catch (2026-08-06 fix): every panel on the Payroll tab mounts as soon
    // as the app loads, even while a different tab is showing, so an uncaught error here
    // took down the ENTIRE app on every page load ("Application error: a client-side
    // exception has occurred"), not just Payroll — caused by a browser's real saved
    // roster having drifted through several data shapes across a day of testing. If
    // migration itself ever throws for a shape it doesn't recognize, fall back to the
    // roster exactly as saved (unmigrated) rather than crashing the whole app — worst
    // case a ramp role's cost needs re-entering, instead of nothing loading at all.
    if (loaded?.roster) {
      try {
        loaded = { ...loaded, roster: migrateRampRoles(loaded.roster) };
      } catch (err) {
        console.warn('Payroll roster migration failed, using saved data as-is:', err);
      }
    }
    setState(loaded || seedPayrollState());
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const resetToSeed = useCallback(() => {
    setState(seedPayrollState());
  }, []);

  return { state, setState, hydrated, resetToSeed };
}
