import { auth } from '@clerk/nextjs/server';
import { getDataSource } from '@/lib/data';
import { clientConfig } from '@/config/client.config';
import { DashboardApp } from '@/components/DashboardApp';

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

  const source = getDataSource();

  const [kpiData, dashboardSummary, pl, cf, bs, customReportsList, glCash, glAccrued] =
    await Promise.all([
      source.getKPIData(),
      source.getDashboardSummary(),
      source.getStatement('PL', '24M'),
      source.getStatement('CF', '24M'),
      source.getStatement('BS', '24M'),
      source.listCustomReports(),
      safeGLTransactions(source, 'GL Cash'),
      safeGLTransactions(source, 'GL Accu'), // sheet tab is literally named "GL Accu"
    ]);

  return (
    <DashboardApp
      clientName={clientConfig.name}
      kpiData={kpiData}
      dashboardSummary={dashboardSummary}
      statements={{ PL: pl, CF: cf, BS: bs }}
      customReportsList={customReportsList}
      glCash={glCash}
      glAccrued={glAccrued}
    />
  );
}
