'use client';

import { useEffect, useState } from 'react';
import { seedAssumptionsState } from './assumptionsData';

// Bumped v1 -> v2 on 2026-08-04 when Revenue's shape changed from flat fields
// (upfrontPerCampaign/currentMonthCampaigns/...) to monthly grids
// (campaignsByMonth/meetingsByMonth). A v1 value in an existing browser is
// structurally incompatible with the new code (e.g. `revenue.campaignsByMonth[iso]`
// throws on old data, which is exactly the client-side exception Kayee hit) — bumping
// the key makes the app ignore old-shaped data and reseed cleanly instead of crashing.
const STORAGE_KEY = 'fuel_wildcard_assumptions_v2';

/** Loose shape check — enough to catch "this is v1 data" or anything else
 *  incompatible, without needing a real schema/version migration for a tab this new. */
function isValidState(loaded) {
  return !!(loaded && loaded.revenue && loaded.revenue.campaignsByMonth && loaded.revenue.meetingsByMonth && Array.isArray(loaded.costItems));
}

/**
 * Assumptions tab state, persisted to this browser's localStorage — same pattern as
 * Payroll's usePayrollState.js. Reopening the tab or refreshing restores whatever was
 * last saved on THIS browser; a different device/browser (or a stale/incompatible
 * shape from an older version of this tab) starts from the seed dataset transcribed
 * from Kayee's real assumptions sheet.
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
    setState(isValidState(loaded) ? loaded : seedAssumptionsState());
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
