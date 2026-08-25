'use client';

/**
 * Planning-data storage backend (2026-08-25) — the "small abstraction parallel to
 * getDataSource()" promised in CLAUDE.md's "Planning data storage (Supabase)" section.
 * Every planning hook (useAssumptionsState, usePayrollState, useCashTimingState,
 * usePlannedCustomers, useCustomerDrivers) reads/writes through these three functions
 * instead of touching window.localStorage directly.
 *
 * WHY: planning data used to live only in each visitor's own browser localStorage,
 * which is per-ORIGIN — Kayee lost a full Customer-tab data entry session (2026-08-25:
 * "you did it for me but it's all gone now... maybe it's related to the url switch")
 * because the entry happened on a one-off Vercel deployment URL instead of the stable
 * branch alias. Supabase (dedicated Wildcard project, storage only, NOT auth — see
 * CLAUDE.md) is now the durable source of truth; localStorage stays as a fast local
 * cache and as the complete fallback whenever Supabase isn't configured/reachable.
 *
 * Contract:
 *  - loadPlanning(key): localStorage first (instant), then the server; a non-null
 *    remote value WINS and refreshes the local cache. If remote is empty but local
 *    has data, local is pushed UP (one-time migration of anything already entered in
 *    this browser). Any server failure (offline, env vars not set → 503, etc.)
 *    silently degrades to exactly the old localStorage-only behavior.
 *  - savePlanning(key, value): writes localStorage synchronously (same guarantee the
 *    hooks always had), then debounces a remote upsert ~1.5s so a burst of keystrokes
 *    doesn't become a burst of network writes.
 *  - flushPlanning(key, value): savePlanning without the debounce — for the explicit
 *    Save button, so "Saved <time>" reflects a real immediate push.
 *
 * All remote traffic goes through this app's own /api/planning route (Clerk-gated by
 * middleware.js like every other route) — the browser NEVER talks to Supabase
 * directly, and no Supabase key ships client-side.
 */

const DEBOUNCE_MS = 1500;
const timers = new Map(); // key -> timeout id

function readLocal(key) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeLocal(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // Private-browsing/storage-full — remote (if configured) still persists it.
    return false;
  }
}

async function pushRemote(key, value) {
  try {
    await fetch('/api/planning', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
    });
  } catch {
    // Offline / not configured — the localStorage copy is already written, and the
    // next successful save (or next hydrate's migrate-up) will catch remote up.
  }
}

export async function loadPlanning(key) {
  const local = readLocal(key);
  try {
    const res = await fetch(`/api/planning?key=${encodeURIComponent(key)}`, { cache: 'no-store' });
    if (res.ok) {
      const { value } = await res.json();
      if (value != null) {
        writeLocal(key, value); // refresh the local cache to match the durable copy
        return value;
      }
      // Remote is configured but has nothing for this key — migrate this browser's
      // existing local data up, so pre-Supabase entries survive the transition.
      if (local != null) void pushRemote(key, local);
    }
  } catch {
    // Server unreachable — behave exactly like the old localStorage-only world.
  }
  return local;
}

export function savePlanning(key, value) {
  const ok = writeLocal(key, value);
  clearTimeout(timers.get(key));
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      void pushRemote(key, value);
    }, DEBOUNCE_MS)
  );
  return ok;
}

export function flushPlanning(key, value) {
  const ok = writeLocal(key, value);
  clearTimeout(timers.get(key));
  timers.delete(key);
  void pushRemote(key, value);
  return ok;
}
