'use client';

import { usePlanningState } from '../planning/usePlanningState';
import { seedAssumptionsState, SEED_COST_ITEMS } from './assumptionsData';

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
/** Retrofits the new Software-tab fields (2026-08-27) onto an existing browser's
 *  already-saved 'software' / 'other-software' cost items — those two ids already
 *  existed before this feature, so without this they'd render as plain Non-Headcount
 *  Cost rows (no isSoftware flag) instead of showing up on the new Software tab. Every
 *  other cost item, and every other field already saved on these two, is left exactly
 *  as-is; missing Software-only fields fall back to the current seed's defaults.
 *
 *  A second pass, same function (2026-08-27, same day): the Fixed driver moved from a
 *  single softwareAmount/softwareCadence pair to a `periods` list a few minutes after
 *  first shipping (Kayee: "period like ok monthly but 1000 from which month to ongoing
 *  or an end date"), so ANY software item already saved anywhere — the two seeds above,
 *  or a vendor a browser already added in that brief window — gets backfilled with an
 *  equivalent single open-ended period if it doesn't have `periods` yet. Old
 *  softwareAmount/softwareCadence values are carried over as that period's starting
 *  values rather than discarded, so nobody's real numbers reset to $0. */
function migrateSoftwareItems(loaded) {
  const seedById = Object.fromEntries(SEED_COST_ITEMS.filter((i) => i.isSoftware).map((i) => [i.id, i]));
  return {
    ...loaded,
    costItems: (loaded.costItems || []).map((item) => {
      const seed = seedById[item.id];
      let next = item;
      if (seed && !item.isSoftware) {
        next = {
          isSoftware: true,
          active: true,
          driverType: 'fixed',
          unitLabel: '',
          unitRate: 0,
          unitsPerMonth: 0,
          revenuePercent: 0,
          seatRate: 0,
          seatDepartment: '',
          ...item,
        };
      }
      if (next.isSoftware && !Array.isArray(next.periods)) {
        next = {
          ...next,
          periods: [
            {
              id: `${next.id}-migrated`,
              fromMonth: '',
              toMonth: '',
              amount: next.softwareAmount ?? next.amount ?? 0,
              cadence: next.softwareCadence === 'Quarterly' ? 'Quarterly' : next.softwareCadence === 'Annual' ? 'Annual' : 'Monthly',
            },
          ],
        };
      }
      return next;
    }),
  };
}

export function useAssumptionsState() {
  return usePlanningState(STORAGE_KEY, {
    seed: seedAssumptionsState,
    isValid: isValidState,
    migrate: migrateSoftwareItems,
  });
}
