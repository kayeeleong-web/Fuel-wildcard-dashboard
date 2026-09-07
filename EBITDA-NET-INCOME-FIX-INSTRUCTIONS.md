# EBITDA / Net Income / Cash Flow $0 bug — fix instructions for the sibling client repo

All of this lives in `components/panels/ReportsPanel.jsx`. Same file, same functions,
in both repos (this one was duplicated from the other originally), so every fix below
should apply to the sibling project with no changes beyond maybe the exact cutoff date.

## The one root cause behind all of it

The connected Google Sheet provisions columns for future months before there's any
real GL data in them. Those columns' SUMIFS formulas evaluate to a **literal `0`**, not
an empty cell. Once `ACTUAL_CUTOFF_OVERRIDE` (a manual pin on the actual/forecast
boundary — see near the top of the file) moves the boundary *earlier* than those
already-provisioned columns, every one of those columns falls inside the "forecast"
range that's supposed to get recalculated — but several rollup functions had a guard
that just checked `if (value != null) continue`, with no awareness of where the
actual/forecast boundary actually is. `0 != null` is `true`, so the guard read the
sheet's placeholder `0` as "real data, don't touch," and the row stayed frozen at $0
forever, even though every input it depends on had real projected numbers.

This exact bug shape hit four different rows over two days, because the same guard
pattern had been copy-pasted into each one independently:

1. **EBITDA** — `withEbitdaRollup`
2. **Net Income** — `withNetIncomeRollup`
3. **Total Cash In / Total Cash Out / Total Cash Out from Operations** — `withCashFlowGrandTotals`
4. **Total Non OPEX** — `withTotalNonOpexRollup` (fixed a day earlier than the other three)

The fix is the same shape every time: give the function `lastActualIndex` (the index of
the last real/actual month), and change the guard from a blanket `!= null` check to an
**index-gated** one — only protect a cell that's genuinely inside the actual range;
always recompute anything in the forecast range regardless of what's already sitting
there.

```js
// WRONG — protects a placeholder-0 forecast cell forever:
if (patchedValues[iso] != null) continue;

// RIGHT — only protects real actual-month data, always recomputes forecast:
if (i <= (lastActualIndex ?? months.length - 1) && patchedValues[iso] != null) continue;
```

(This requires switching the loop from `for (const iso of months)` to an indexed
`for (let i = 0; i < months.length; i++) { const iso = months[i]; ... }` so `i` is
available to compare against `lastActualIndex`.)

**Important gotcha that cost an extra round-trip:** changing a function's signature to
accept `lastActualIndex` is not enough — every call site has to actually be updated to
pass it. `lastActualIndex` defaults to `months.length - 1` (the very last column) when
omitted, which silently reproduces the *old*, broken "protect everything" behavior.
Grep for the function name and check **every** call site, not just the one you're
actively working on — several of these functions are called from two different places
(the plain "Reports"/actuals-only pipeline AND the "Projection" pipeline), and it's easy
to fix one and miss the other.

---

## Fix 1 — EBITDA (`withEbitdaRollup`)

**Signature:** `withEbitdaRollup(rows, months, lastActualIndex)` — third param added.

**Guard**, inside the fill loop:
```js
for (let i = 0; i < months.length; i++) {
  const iso = months[i];
  if (i <= (lastActualIndex ?? months.length - 1) && patchedValues[iso] != null) continue;
  const gpVal = grossProfitRow.values[iso];
  const opexVal = totalOpexRow.values[iso];
  if (gpVal != null && opexVal != null) {
    patchedValues[iso] = gpVal - opexVal;
  }
}
```

**Call sites** (there are two — update both):
```js
rows = withEbitdaRollup(rows, months, lastActualIndex);
```

---

## Fix 2 — Net Income (`withNetIncomeRollup`)

This one was worse than EBITDA's bug — it never had an actual/forecast boundary check
at all, just a blanket `if (patchedValues[iso] != null) continue;`. Net Income = EBITDA
− Total Non OPEX.

**Signature:** `withNetIncomeRollup(rows, months, lastActualIndex)` — third param added.

**Guard:**
```js
for (let i = 0; i < months.length; i++) {
  const iso = months[i];
  if (i <= (lastActualIndex ?? months.length - 1) && patchedValues[iso] != null) continue;
  const ebitdaVal = ebitdaRow.values[iso];
  const nonOpexVal = totalNonOpexRow.values[iso];
  if (ebitdaVal != null && nonOpexVal != null) {
    patchedValues[iso] = ebitdaVal - nonOpexVal;
  }
}
```

**Call sites** (two — update both):
```js
rows = withNetIncomeRollup(rows, months, lastActualIndex);
```

**Ordering matters**: `withEbitdaRollup` and `withTotalNonOpexRollup` must both run
*before* `withNetIncomeRollup` in the pipeline, since Net Income reads their already-
patched values off the same `rows` array.

---

## Fix 3 — Cash Flow grand totals (`withCashFlowGrandTotals`)

Already fixed the day before this batch, included here for completeness since it's the
same bug class. Uses a `skipMonth` helper instead of an inline check:

```js
const skipMonth = (values, m, i) => i <= (lastActualIndex ?? months.length - 1) && values[m] != null;
```

Every fill loop inside this function (Total Cash In, Total Cash Out from Operations,
Total Cash Out, Net Burn) calls `skipMonth(values, m, i)` instead of a bare
`if (values[m] != null) continue`. Signature: `withCashFlowGrandTotals(rows, months, lastActualIndex)`.

`withSectionTotalRollups` (Total COGS / Total OpEx / etc.) was fixed the same day —
that one just has **no** skip guard at all inside its forecast-range loop, since the
loop already only ever iterates the forecast range to begin with (`fillFrom` starts at
`lastActualIndex + 1`), so there's nothing for a guard to protect there.

---

## Fix 4 — Net Change in Cash ≠ Total Cash In − Total Cash Out

Separate bug, same day, different mechanism — not the placeholder-zero pattern.

**Symptom:** the "Net Change in Cash" row (used in the Beginning/Net Change/Ending Cash
rollforward) didn't always equal Total Cash In − Total Cash Out, off by a consistent
few hundred dollars a month in the forecast range.

**Root cause:** `withCashFlowProjectionRows` (monthly) and `withWeeklyCashFlowRollforward`
(weekly) each computed their own **separate** inflow/outflow number from scratch —
iterating `plExpenseAccounts()`'s COGS/OpEx account list and summing
`cashOutflowForMonth`/`cashOutflowForWeek` for each one. That account list always
appends a synthetic `"Headcount (Payroll)"` COGS account that isn't reconciled against
whatever's actually rendered in the Total Cash Out row, so the two numbers could
silently drift apart.

**Fix:** both functions now read the **already-computed** "Total Cash In" / "Total Cash
Out" rows directly off `rows` (both are computed earlier in the same pipeline, by
`withCashFlowGrandTotals`, and Total Cash Out already folds in Investing + Financing) —
so Net Change is now *always* Total Cash In − Total Cash Out for every forecast month,
by construction, not by a second parallel calculation that has to agree with the first
one:

```js
const cashInRow = rows.find((r) => r.isTotal && CF_GRAND_TOTAL_LABELS.cashIn.test(String(r.label ?? '').trim()));
const cashOutRow = rows.find((r) => r.isTotal && CF_GRAND_TOTAL_LABELS.cashOut.test(String(r.label ?? '').trim()));

for (const iso of forecastMonths) {
  const totalIn = cashInRow?.values[iso];
  const totalOut = cashOutRow?.values[iso];
  if (totalIn != null && totalOut != null) {
    netValues[iso] = Number(totalIn) - Number(totalOut);
    continue;
  }
  // ...fallback to the old direct inflow/outflow calc, only reached if Total Cash
  // In/Out genuinely aren't on this sheet at all
}
```

Requires `withCashFlowProjectionRows` / `withWeeklyCashFlowRollforward` to run **after**
`withCashFlowGrandTotals` in the pipeline (they already do, in both repos, as of this
fix — just don't reorder the pipeline without preserving that).

---

## Fix 5 — "Total Non OPEX" row hidden (cosmetic, optional)

Only relevant if the other client's Non-Operating/Uncategorized section also has just
one line item. The "Total Non OPEX" row was showing the exact same number as the one
line item sitting right above it ("Non-Operating Income & Expenses"), which read as
redundant.

Added a new function that runs *after* `withNetIncomeRollup` (so Net Income has already
read the Total Non OPEX value it needs) and simply filters that row out of what
renders — the underlying calculation is untouched, only the display row disappears:

```js
function withoutTotalNonOpexRow(rows) {
  return rows.filter((r) => !(r.isTotal && /^total\s*non[\s-]?opex$/i.test(String(r.label ?? '').trim())));
}
```

Called right after `withNetIncomeRollup` in both pipeline branches:
```js
rows = withNetIncomeRollup(rows, months, lastActualIndex);
rows = withoutTotalNonOpexRow(rows);
```

Skip this one for the other client if their Non-Operating section actually has more
than one real line item — in that case Total Non OPEX isn't redundant, it's a genuine
sum worth keeping visible.

---

## How to verify it worked

1. Open the Projection tab → P&L. Pick any forecast month (past the actual/forecast
   cutoff). EBITDA, Net Income, and their margin % rows should all show real non-zero
   numbers, not a flat $0 across every forecast column.
2. Open the Projection tab → Cash Flow. For any forecast month: Total Cash In − Total
   Cash Out should equal the Net Change in Cash row exactly (not off by a fixed few
   hundred dollars). Beginning + Net Change should equal Ending Cash for every month,
   actual and forecast alike (this part was never broken, but worth re-checking after
   touching the file).
3. If anything still reads $0/blank in the forecast range, grep the file for
   `!= null) continue` and check whether it's missing the `i <= (lastActualIndex ?? ...)`
   guard — that's the signature of this exact bug class recurring somewhere new.
