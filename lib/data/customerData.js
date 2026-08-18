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
    // Kayee (2026-08-18): "bring them in so that we can match the total cash in with
    // this waterfall" — rows with no Counterparty Name were being silently dropped,
    // which understated the waterfall's total vs the Cash Flow statement's real
    // total. Bucket them under one named row instead of discarding.
    const name = String(t.counterparty ?? '').trim() || 'Uncategorized (no counterparty)';
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
  let grandTotal = 0;
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
    grandTotal += total;
    customers.push({ name: entry.name, startMonth, total, byMonth: entry.byMonth });
  }

  // GL sign convention: revenue (4xxxx) credits often export as NEGATIVE signed
  // amounts, which read wrong in a customer receipts table ("$-6,000 received").
  // If the aggregate is negative, the whole tab uses that convention — flip every
  // figure so cash/revenue received displays positive. (Aggregate check, not per-row,
  // so genuine refunds/credit memos keep their opposite sign relative to receipts.)
  if (grandTotal < 0) {
    for (const c of customers) {
      c.total = -c.total;
      for (const m of Object.keys(c.byMonth)) c.byMonth[m] = -c.byMonth[m];
    }
  }

  // Pin the no-counterparty bucket to the very bottom, regardless of its start
  // month — it's a reconciling line (unlabeled GL activity), not a real customer
  // cohort, so it shouldn't interleave with the actual start-month ordering above it.
  const UNCATEGORIZED = 'Uncategorized (no counterparty)';
  customers.sort((a, b) => {
    if (a.name === UNCATEGORIZED) return 1;
    if (b.name === UNCATEGORIZED) return -1;
    if (a.startMonth !== b.startMonth) return a.startMonth < b.startMonth ? -1 : 1;
    return b.total - a.total;
  });

  return { months, customers };
}
