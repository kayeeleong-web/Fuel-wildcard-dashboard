/**
 * Cash flow projection data layer (2026-08-17, Kayee: "let's start building out
 * cash inflow mechanism for projection... current customer total plus projection
 * how many client they have... it needs to be granular").
 *
 * Two sides:
 * - Inflow: current customers × (upfront + meetings × price per meeting) + new
 *   customers projected via assumptions
 * - Outflow: P&L accrual lines with cash timing overrides per GL account
 */

/**
 * Calculate cash inflow for a month based on current + projected customers and
 * revenue assumptions (meeting price, upfront per customer).
 *
 * Current customers: pulled from GL (e.g., "Cash Coming In" section per client)
 * Projected customers: user-entered assumptions + ramp-up assumptions
 */
export function calculateCashInflowForMonth(iso, assumptions) {
  if (!assumptions) return 0;

  const { currentCustomers = 0, projectedNewCustomers = 0, meetingPrice = 0, upfrontPerCustomer = 0 } = assumptions;
  const totalCustomers = currentCustomers + projectedNewCustomers;

  // Simple model: all customers pay upfront once, then meetings generate additional cash
  // Future: can be extended to handle staggered upfront (e.g., quarterly renewal)
  const upfrontCash = totalCustomers * upfrontPerCustomer;
  const meetingCash = projectedNewCustomers * meetingPrice; // Only new customers' meetings drive incremental

  return upfrontCash + meetingCash;
}

/**
 * Apply cash timing to a P&L accrual amount for a specific GL account.
 *
 * If timing mode is 'followPL', return the accrual amount as-is.
 * If 'customInterval', distribute the accrual across the cycle months.
 *
 * Example: accrual=$12,000/year (monthly=$1,000), timing=annual+month 12
 * → return 0 for months 1-11, return $12,000 in month 12 (December)
 *
 * @param {number} accrualAmount - Monthly or period accrual from P&L
 * @param {string} iso - ISO month (YYYY-MM)
 * @param {object} timing - { mode: 'followPL' | 'customInterval', intervalMonths, payMonthOfCycle }
 * @returns {number} Cash amount for this month
 */
export function applyCashTiming(accrualAmount, iso, timing) {
  if (!timing || timing.mode === 'followPL') {
    return accrualAmount;
  }

  if (timing.mode === 'customInterval') {
    const { intervalMonths, payMonthOfCycle } = timing;
    const [year, month] = iso.split('-').map(Number);

    // Which month of the cycle are we in? (1-indexed)
    const monthOfCycle = ((month - 1) % intervalMonths) + 1;

    // Pay out only in the designated month of the cycle
    if (monthOfCycle === payMonthOfCycle) {
      // Return the full cycle's accrual at once
      return accrualAmount * intervalMonths;
    } else {
      return 0;
    }
  }

  return accrualAmount;
}

/**
 * Given a set of P&L rows (accrual basis) and timing overrides per GL account,
 * return cash flow rows with cash timing applied.
 *
 * For each GL account in the P&L, check if there's a timing override.
 * If yes, apply custom cash timing. If no, use default (follow P&L).
 */
export function applyCashTimingToRows(plRows, months, cashTimingByAccount) {
  return plRows.map((row) => {
    const timing = cashTimingByAccount?.[row.glAccountId];
    if (!timing) {
      // No custom timing for this account, use accrual as-is
      return row;
    }

    // Apply custom timing to each month
    const cashValues = {};
    for (const iso of months) {
      const accrual = row.values[iso] || 0;
      cashValues[iso] = applyCashTiming(accrual, iso, timing);
    }

    return { ...row, values: cashValues };
  });
}
