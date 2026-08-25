import { NextResponse } from 'next/server';

/**
 * Planning-data persistence route (2026-08-25) — the ONLY thing that talks to the
 * dedicated Wildcard Supabase project (CLAUDE.md "Planning data storage (Supabase)":
 * storage only, NOT auth). The browser calls this route; middleware.js's
 * clerkMiddleware + auth.protect() already gates every /api route, so only a
 * logged-in dashboard user can reach it — Supabase itself has RLS enabled with no
 * policies (deny-all for the public key), and the service-role key used here lives
 * only in this deployment's env vars, never client-side.
 *
 * Deliberately uses Supabase's PostgREST HTTP API via plain fetch instead of adding
 * the @supabase/supabase-js dependency — two tiny calls don't justify a new package.
 *
 * Env vars (add via Vercel project settings + .env.local for local dev):
 *   SUPABASE_URL                e.g. https://<project-ref>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY   the service_role secret from the Supabase dashboard
 * When they're missing, every response is 503 — planningStorage.js treats that as
 * "not configured" and falls back to localStorage-only, so the app keeps working
 * exactly as before the Supabase layer existed.
 */

// Only this app's own planning keys — never an arbitrary KV store for anything else.
const ALLOWED_KEY_PREFIX = 'fuel_wildcard_';
// jsonb payload cap — largest real state (payroll roster) is a few hundred KB at most.
const MAX_VALUE_BYTES = 1_000_000;

function supabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ''), key };
}

function notConfigured() {
  return NextResponse.json({ error: 'Supabase planning storage not configured' }, { status: 503 });
}

function badKey() {
  return NextResponse.json({ error: 'Invalid planning key' }, { status: 400 });
}

export async function GET(request) {
  const config = supabaseConfig();
  if (!config) return notConfigured();
  const key = new URL(request.url).searchParams.get('key');
  if (!key || !key.startsWith(ALLOWED_KEY_PREFIX)) return badKey();

  const res = await fetch(
    `${config.url}/rest/v1/planning_state?key=eq.${encodeURIComponent(key)}&select=value`,
    {
      headers: { apikey: config.key, Authorization: `Bearer ${config.key}` },
      cache: 'no-store',
    }
  );
  if (!res.ok) {
    return NextResponse.json({ error: `Supabase read failed (${res.status})` }, { status: 502 });
  }
  const rows = await res.json();
  return NextResponse.json({ value: rows.length > 0 ? rows[0].value : null });
}

export async function PUT(request) {
  const config = supabaseConfig();
  if (!config) return notConfigured();
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { key, value } = body || {};
  if (!key || typeof key !== 'string' || !key.startsWith(ALLOWED_KEY_PREFIX)) return badKey();
  if (value == null) return NextResponse.json({ error: 'Missing value' }, { status: 400 });
  const serialized = JSON.stringify(value);
  if (serialized.length > MAX_VALUE_BYTES) {
    return NextResponse.json({ error: 'Value too large' }, { status: 413 });
  }

  const res = await fetch(`${config.url}/rest/v1/planning_state?on_conflict=key`, {
    method: 'POST',
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      'Content-Type': 'application/json',
      // Upsert: insert or overwrite the existing row for this key (last write wins —
      // same semantics localStorage always had).
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify([{ key, value, updated_at: new Date().toISOString() }]),
  });
  if (!res.ok) {
    return NextResponse.json({ error: `Supabase write failed (${res.status})` }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
