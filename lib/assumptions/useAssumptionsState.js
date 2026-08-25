'use client';

import { usePlanningState } from '../planning/usePlanningState';
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
 * Assumptions tab state — persisted through the shared planning storage layer
 * (2026-08-25: Supabase via /api/planning as the durable copy, localStorage as the
 * fast cache/fallback — see lib/planning/planningStorage.js for the full story;
 * previously localStorage-only, which silently lost data across URL/browser changes).
 * Same public shape as always: { state, setState, hydrated, lastSavedAt, saveNow }.
 */
export function useAssumptionsState() {
  return usePlanningState(STORAGE_KEY, {
    seed: seedAssumptionsState,
    isValid: isValidState,
  });
}
