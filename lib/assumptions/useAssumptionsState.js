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
  // Visible save confirmation (2026-08-24, Kayee: "why did you remove my input in
  // blue cell. dont do that again" / "if a save button would solve the issue" —
  // the real cause that session was a different preview URL being a different
  // localStorage origin, not a failed save, but Kayee reasonably wants proof this
  // browser actually has the write, not just my word for it). `lastSavedAt` is a
  // timestamp of the most recent successful localStorage write, null until the
  // first one happens; PLAssumptionsSidebar renders it as "Saved <time>".
  const [lastSavedAt, setLastSavedAt] = useState(null);

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
      setLastSavedAt(Date.now());
    } catch {
      // localStorage can throw in private-browsing/storage-full edge cases — the tab
      // still works for the session, it just won't survive a refresh in that case.
      // lastSavedAt deliberately NOT updated here, so the sidebar's "Saved" indicator
      // correctly stops advancing instead of falsely claiming a write that failed.
    }
  }, [state, hydrated]);

  // Manual re-flush (2026-08-24) — every edit already writes to localStorage on its
  // own via the effect above, so this doesn't do anything MORE than what already
  // happens automatically. It exists purely so the "Save" button in the sidebar has
  // something real to call and a real, freshly-updated `lastSavedAt` to show right
  // after the click, instead of being a fake button that doesn't do anything (this
  // repo's own CLAUDE.md rule: never ship a control that visibly does nothing).
  function saveNow() {
    if (!hydrated || !state) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      setLastSavedAt(Date.now());
    } catch {
      // Surfaced by the sidebar simply not updating its "Saved" timestamp.
    }
  }

  return { state, setState, hydrated, lastSavedAt, saveNow };
}
