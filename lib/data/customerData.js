/**
 * Customer cash flow data layer (2026-08-17, Kayee: "I want it to be live... when
 * new data come in it will get refresh"). Consumes GLTransactionData.transactions
 * (already normalized by the DataSource — columns located by header name, never by
 * index) and builds the customer/month waterfall for the Customer Cash Flow tab.
 *
 * Live-refresh comes for free: the transactions arrive through the same cached
 * getValues() fetch as every other tab (DEFAULT_REVALIDATE_SECONDS in
 * lib/data/source.ts), so a sheet update shows up within that window.
 */

/**
 * Build a cohort-style waterfall from GL transactions:
 *  - keep only customer revenue accounts (account starts with "4")
 *  - group amounts by Counterparty Name x ISO month
 *  - a customer's first non-zero month is their start month
 *  - order by start month (cohort waterfall reading), then total descending
 *
 * @param {Array<{month: string, account: string, counterparty: string, amount: number}>} transactions
 * @returns {{ months: string[], customers: Array<{ name: string, startMonth: string, total: number, byMonth: Record<string, number> }> }}
 */
export function buildCustomerWaterfall(transactions) {
  const byCustomer = new Map();
  const monthSet = new Set();

  for (const t of transactions || []) {
    if (!String(t.account ?? '').trim().startsWith('4')) continue;
    const name = String(t.counterparty ?? '').trim();
    if (!name) continue;
    const month = t.month;
    const amount = Number(t.amount) || 0;
    if (!month || !amount) continue;

    monthSet.add(month);
    let entry = byCustomer.get(name);
    if (!entry) {
      entry = { name, byMonth: {} };
      byCustomer.set(name, entry);
    }
    entry.byMonth[month] = (entry.byMonth[month] || 0) + amount;
  }

  const months = Array.from(monthSet).sort();

  const customers = [];
  for (const entry of byCustomer.values()) {
    let total = 0;
    let startMonth = null;
    for (const m of months) {
      const v = entry.byMonth[m];
      if (!v) continue;
      total += v;
      if (!startMonth) startMonth = m; // first non-zero month = customer start
    }
    if (!startMonth) continue; // all-zero after aggregation — not a customer row
    customers.push({ name: entry.name, startMonth, total, byMonth: entry.byMonth });
  }

  customers.sort((a, b) => {
    if (a.startMonth !== b.startMonth) return a.startMonth < b.startMonth ? -1 : 1;
    return b.total - a.total;
  });

  return { months, customers };
}
