/**
 * Software tab — actual spend history data layer (Division 1: "Actual Spend to Date").
 *
 * Same shape/mechanics as lib/data/customerData.js's buildCustomerWaterfall, applied to
 * the two Software GL expense accounts on Wildcard's chart of accounts instead of the
 * 4xxxx revenue accounts: 52000 "Software - Cost of Revenue" (COGS) and 66200
 * "Software - Operating Expense" (OpEx). Consumes the same GLTransactionData.transactions
 * shape already flowing into the Customer tab (account/counterparty/month/amount),
 * so it's live the same way — no new data source, just a different account filter.
 */

// Per Wildcard's COA (Account ID -> Account Name), confirmed against the wildcard-fuel
// sheet's chart-of-accounts tab. Matched by exact account code, not a label string —
// GL transaction rows carry the code, not the account name.
export const SOFTWARE_ACCOUNTS = {
  CoGS: '52000', // Software - Cost of Revenue
  OpEx: '66200', // Software - Operating Expense
};

/**
 * Build a vendor x month spend history from GL transactions, filtered to the Software
 * accounts (both CoGS and OpEx combined, unless `category` narrows it to one).
 *
 * @param {Array<{month:string, account:string, counterparty:string, amount:number}>} transactions
 * @param {'all'|'CoGS'|'OpEx'} [category='all']
 * @returns {{ months: string[], vendors: Array<{name:string, category:string, total:number, byMonth:Record<string,number>}>, monthlyTotal: Record<string,number> }}
 */
export function buildSoftwareSpendHistory(transactions, category = 'all') {
  const wantAccounts =
    category === 'all'
      ? Object.values(SOFTWARE_ACCOUNTS)
      : [SOFTWARE_ACCOUNTS[category]].filter(Boolean);
  const accountToCategory = Object.fromEntries(
    Object.entries(SOFTWARE_ACCOUNTS).map(([cat, code]) => [code, cat])
  );

  const byVendor = new Map();
  const monthSet = new Set();

  for (const t of transactions || []) {
    const account = String(t.account ?? '').trim();
    if (!wantAccounts.includes(account)) continue;
    const name = String(t.counterparty ?? '').trim() || 'Uncategorized (no vendor)';
    const month = t.month;
    const amount = Number(t.amount) || 0;
    if (!month || !amount) continue;

    monthSet.add(month);
    const key = `${account}::${name}`;
    let entry = byVendor.get(key);
    if (!entry) {
      entry = { name, category: accountToCategory[account] || 'OpEx', byMonth: {} };
      byVendor.set(key, entry);
    }
    entry.byMonth[month] = (entry.byMonth[month] || 0) + amount;
  }

  const months = Array.from(monthSet).sort();

  const vendors = [];
  let grandTotal = 0;
  for (const entry of byVendor.values()) {
    let total = 0;
    for (const m of months) total += entry.byMonth[m] || 0;
    if (!total) continue;
    grandTotal += total;
    vendors.push({ name: entry.name, category: entry.category, total, byMonth: entry.byMonth });
  }

  // Same GL-sign-convention guard as buildCustomerWaterfall: expense accounts sometimes
  // export as negative (a credit-normal artifact); if the aggregate reads negative,
  // flip every figure so "spend" always displays as a positive dollar amount.
  if (grandTotal < 0) {
    for (const v of vendors) {
      v.total = -v.total;
      for (const m of Object.keys(v.byMonth)) v.byMonth[m] = -v.byMonth[m];
    }
  }

  vendors.sort((a, b) => b.total - a.total);

  const monthlyTotal = {};
  for (const m of months) {
    monthlyTotal[m] = vendors.reduce((acc, v) => acc + (v.byMonth[m] || 0), 0);
  }

  return { months, vendors, monthlyTotal };
}
