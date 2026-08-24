import { auth } from '@clerk/nextjs/server';
import { cookies } from 'next/headers';
import { getDataSource } from '@/lib/data';
import { clientConfig } from '@/config/client.config';
import { DashboardApp } from '@/components/DashboardApp';

// Must match DashboardApp's own TABS list exactly.
const VALID_TABS = ['kpi', 'dashboard', 'reports', 'projection'];
const ACTIVE_TAB_COOKIE = 'fuel_wildcard_active_tab';

// This DataSource implementation (googleapis) needs the Node.js runtime, not Edge.
export const runtime = 'nodejs';

// Never statically prerender/cache this page at build time: every visitor is a
// signed-in session gated by Clerk (auth state is per-request, per-visitor, and
// can't be baked into a shared static build) — force a real per-request render.
// Data freshness within that is still controlled separately, at the fetch level
// (DEFAULT_REVALIDATE_SECONDS in lib/data/source.ts), not by this page's render mode.
export const dynamic = 'force-dynamic';

/**
 * The single entry point for the whole client-facing product (Portal + Main Finance
 * Page merged — see CLAUDE.md). Everything is fetched once, here, server-side, and
 * handed down to the client-side tab shell — no per-tab route, no refetch on tab
 * switch (functionality-spec.md §2).
 *
 * Auth: middleware.js gates the app, but Clerk's current guidance is to also check
 * "as close to the resource as possible" (https://clerk.com/docs/reference/nextjs/app-router/auth)
 * rather than rely on middleware alone — this page re-checks explicitly so financial
 * data is never rendered without a verified session, even if middleware config drifts.
 */
/**
 * GL Cash / GL Accrued are raw bookkeeping exports, more fragile than the fixed-shape
 * statement tabs — a missing tab or renamed column must degrade to a visible
 * "data source misconfigured" notice INSIDE the Customer Cash Flow section (CLAUDE.md),
 * never crash the whole page: every other tab still renders.
 */
async function safeGLTransactions(source, tab) {
  try {
    return await source.getGLTransactions(tab);
  } catch (err) {
    return { tab, transactions: [], error: err?.message || String(err) };
  }
}

export default async function HomePage() {
  const { isAuthenticated, redirectToSignIn } = await auth();
  if (!isAuthenticated) return redirectToSignIn();

  // 2026-08-20 (Kayee: "when i do a hard refresh in a specific tab it will always go
  // back to kpi and then go back again to my current tab" — a visible flash on every
  // hard refresh). The prior fix only used localStorage, which the SERVER can't read —
  // so the very first HTML painted on a hard refresh always showed the 'kpi' panel
  // (the only state the server can render), and only THEN did client JS run, read
  // localStorage, and correct it. That gap between server-paint and client-correction
  // is exactly the flash, no matter how early the client-side correction runs.
  // Reading the last-active tab from a cookie here instead means the server itself
  // already knows which tab to render on the very first response — no wrong tab is
  // ever painted, so there's nothing to flash away from.
  const savedTab = (await cookies()).get(ACTIVE_TAB_COOKIE)?.value;
  const initialActiveTab = VALID_TABS.includes(savedTab) ? savedTab : 'kpi';

  const source = getDataSource();

  const [kpiData, dashboardSummary, pl, cf, bs, weeklyCf, customReportsList, glCash, glAccrued] =
    await Promise.all([
      source.getKPIData(),
      source.getDashboardSummary(),
      source.getStatement('PL', '24M'),
      source.getStatement('CF', '24M'),
      source.getStatement('BS', '24M'),
      source.getWeeklyCashFlow(),
      source.listCustomReports(),
      safeGLTransactions(source, 'GL Cash'),
      safeGLTransactions(source, 'GL Accu'), // sheet tab is literally named "GL Accu"
    ]);

  return (
    <DashboardApp
      clientName={clientConfig.name}
      initialActiveTab={initialActiveTab}
      kpiData={kpiData}
      dashboardSummary={dashboardSummary}
      statements={{ PL: pl, CF: cf, BS: bs, WeeklyCF: weeklyCf }}
      customReportsList={customReportsList}
      glCash={glCash}
      glAccrued={glAccrued}
    />
  );
}
