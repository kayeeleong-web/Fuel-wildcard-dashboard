'use client';

import { useEffect, useState } from 'react';
import { seedAssumptionsState } from './assumptionsData';

const STORAGE_KEY = 'fuel_wildcard_assumptions_v1';

/**
 * Assumptions tab state, persisted to this browser's localStorage — same pattern as
 * Payroll's usePayrollState.js. Reopening the tab or refreshing restores whatever was
 * last saved on THIS browser; a different device/browser starts from the seed dataset
 * transcribed from Kayee's real assumptions sheet.
 */
export function useAssumptionsState() {
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
    setState(loaded || seedAssumptionsState());
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

  return { state, setState, hydrated };
}
