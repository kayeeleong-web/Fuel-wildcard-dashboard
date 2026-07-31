'use client';

import { useCallback, useEffect, useState } from 'react';
import { seedPayrollState } from './payrollData';

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
