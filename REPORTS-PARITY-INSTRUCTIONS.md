# Task: Make the Reports tab (P&L / Cash Flow / Balance Sheet) look identical to the Projection tab

This repo is a per-client copy of the same Fuel Finance dashboard template (Next.js, `components/panels/ReportsPanel.jsx` + `app/globals.css`). Another client's copy already had all of these fixes applied and verified. Apply the same changes here. The Reports tab is actuals-only (`mode="actual"`); Projection is `mode="projection"`. Both render through the same `StatementDoc` / `FragmentRows` components in `ReportsPanel.jsx` — the bugs below all come from styling/derivation logic being gated to projection mode only.

**Rule of thumb for every change:** Reports must look and behave exactly like Projection, with exactly three intentional exceptions — no blue FCST forecast styling, no editable inputs, no sidebar/Add-account controls.

## 1. ReportsPanel.jsx — actual-mode branch of `StatementDoc`

The actual-mode early-return branch (`if (mode !== 'projection')`) skipped ALL row transforms. Several of those transforms are pure fill-blanks arithmetic off values already on screen (no assumptions/forecast state needed), so they must run in actual mode too:

**Cash Flow (`statement.type === 'CF'`), before the return:**
- Call `withReorderedCashFlowRows(rows)` — moves Beginning Cash / Net Change in Cash / Ending Cash into the boxed "SUMMARY" formula block at the top (same as Projection).
- Add and call a new helper `withActualNetChangeInCash(rows, months)` — fills any blank Net Change in Cash cell with `Ending − Beginning` for that same month (never overwrites a real sheet value). This logic existed only inside `withCashFlowProjectionRows`, which early-returns when there are no forecast months — exactly the actual-mode case — so Reports' Net Change row was completely blank.
- Wrap each call in its own try/catch with a console.warn fallback (repo convention).

**P&L (`statement.type === 'PL'`), before the return, in this exact order:**
1. `withReorderedRevenueRows(rows)`
2. `withEbitdaRollup(rows, months)`
3. `withTotalNonOpexRollup(rows, months, lastActualIndex)`
4. `withNetIncomeRollup(rows, months)`
5. `withGrossProfitMarginRow(rows, months)`
6. `withMarginRowBelow(rows, months, ['EBITDA'], 'ebitda_margin_pct', 'EBITDA Margin %')`
7. `withMarginRowBelow(rows, months, ['Net Income'], 'net_income_margin_pct', 'Net Income Margin %')`

Order matters: EBITDA + Total Non OPEX must land before Net Income (which is EBITDA − Total Non OPEX), and margins run last. Each in its own try/catch. All of these are fill-blanks-only and read whatever values are already on screen, so they're safe for actuals.

## 2. ReportsPanel.jsx — `FragmentRows`: remove the isProjection styling gates

- **Collapse default:** all sections start collapsed in BOTH modes, except the CF cash-summary section and P&L's Profitability/EBITDA sections which stay open. Replace the old actual-mode default (only BS collapsed / only Non-Operating collapsed) with:
  `useState(isCashSummarySection ? false : !(isProfitabilitySection || isEbitdaSection))`
- **`mergeHeaderIntoTotal`:** drop the `isProjection &&` prefix. This is what fixes the "two lines per section" bug — a collapsed OpEx section must render as ONE row (`▸ SALARIES & BENEFITS` with totals inline), not an empty section band plus a separate Total row.
- **Section label:** the section header cell rendered `isProjection ? sectionDisplayLabel(section, statementType) : section` — always use `sectionDisplayLabel(...)`.
- **Total row classes:** the Total-row className ternary had `!isProjection ? 'total' : ...` forcing every Reports Total to plain black. Remove that branch so Reports gets the same treatment: hero totals (`isHeroTotalRow`) stay black, Total OPEX / Total Non OPEX get `total total-soft total-soft-open`, normal section totals get `total total-soft` (collapsed) / `total total-soft total-soft-open` (expanded).
- **CF summary box styling:** `isBeginningCashRow` / `isNetChangeRow` / `isEndingCashRow` were `isProjection && CASH_ROW_PATTERNS...` — drop the `isProjection &&` so the boxed card renders in Reports too (safe now that step 1 reorders the rows in actual mode).
- **Forecast blue — the one thing that must stay projection-only:** in the cell-rendering loop, change `const isForecast = i > lastActualIndex;` to `const isForecast = isProjection && i > lastActualIndex;` so Reports NEVER gets the blue `pr-fcst` tint, even with the cutoff override below.

## 3. ReportsPanel.jsx — pinned actual/forecast cutoff (optional but we use it)

Near `WEEKLY_HORIZON`, add `const ACTUAL_CUTOFF_OVERRIDE = '2026-06';` (set to `null` to disable). In `StatementDoc`'s `lastActualIndex` IIFE, the override only ever pulls the boundary EARLIER than the real data's last month, never later:

```js
const lastActualIndex = (() => {
  const realLastMonth = isWeekly ? monthlyActualCutoff : statement.months[statement.months.length - 1];
  const cutoff =
    ACTUAL_CUTOFF_OVERRIDE && (!realLastMonth || ACTUAL_CUTOFF_OVERRIDE < realLastMonth)
      ? ACTUAL_CUTOFF_OVERRIDE
      : realLastMonth;
  if (!isWeekly && !ACTUAL_CUTOFF_OVERRIDE) return statement.months.length - 1;
  if (!cutoff) return statement.months.length - 1;
  let idx = -1;
  for (let i = 0; i < statement.months.length; i++) {
    const owner = isWeekly ? primaryMonthForWeek(statement.months[i]) : statement.months[i];
    if (owner <= cutoff) idx = i;
    else break;
  }
  return idx;
})();
```

## 4. globals.css — row height / header parity

The compact row/header sizing was scoped to `.reports-with-sidebar .reports-main` (Projection's sidebar layout), so plain Reports fell back to taller rows. Re-scope to `.report-doc` so both match:

```css
.report-doc thead th { padding: 9px 12px; font-size: 9.5px; }
.report-doc .report-year-row th { padding: 0 12px; height: 22px; }
.report-doc tbody td { padding: 7px 12px; font-size: 11.5px; }
.report-doc tr.report-driver-row td:first-child { font-size: 10.5px; }
/* CRITICAL companion fix: the generic rule pins the month header at top:26px for a
   26px year band; the compact band is 22px, leaving a 4px transparent slot that
   scrolling body rows bleed through. Match the offset: */
.report-doc .report-year-row + tr th { top: 22px; }
```

(Delete the old `.reports-with-sidebar .reports-main ...` versions of these rules.)

## 5. globals.css — frozen first-column divider looked "different thickness"

It's a solid 2px inset shadow that reads heavy on black Total rows and invisible on white rows. Make it 1px semi-transparent so its weight is constant on any background:

```css
.report-doc table th:first-child,
.report-doc table td:first-child { box-shadow: inset -1px 0 0 rgba(131, 138, 150, .55), 2px 0 4px rgba(17,17,17,.04); }
```

## 6. Card hugs the table + rounded corners survive the scrollbar

Two-part fix. In `ReportsPanel.jsx`, BOTH `StatementDoc` return branches (actual + projection) wrap their `<div id="reports" className="table-wrap report-doc" ...>` in a new outer `<div className="report-clip">`. In `globals.css`:

```css
.report-clip {
  width: fit-content; max-width: 100%;
  background: var(--panel); border: 1px solid var(--border); border-radius: 14px;
  overflow: hidden; box-shadow: 0 1px 2px rgba(17,17,17,.03);
}
.report-clip > .table-wrap.report-doc {
  width: 100%; border: none; border-radius: 0; box-shadow: none;
  scrollbar-gutter: stable;
}
```

Why: (a) `fit-content` shrinks the card so its rounded corner sits flush against the last visible month column when a filtered range (e.g. 2026–2028) makes the table narrower than the page; `max-width:100%` restores full-width + horizontal scroll automatically for the All/Historical view. (b) Browsers paint scrollbars square over border-radius, so the outer wrapper owns border/radius and `overflow:hidden`-clips the inner scroller's scrollbar to the curve; `scrollbar-gutter: stable` keeps the reserved scrollbar width inside the fit-content measurement so no phantom horizontal scrollbar appears.

## 7. Small shared-renderer fixes (apply if not already present)

- `siblingValuesAtMonth` (Total-row hover breakdown): filter out null/zero components, then `.sort((a, b) => b.raw - a.raw)` so the popover lists highest → lowest.
- `.comp-row` (drill popover rows): `align-items: baseline; gap: 10px;` on the row, `flex: 1; min-width: 0;` on the label span, `white-space: nowrap; flex-shrink: 0;` on the `<b>` value so long labels wrap but numbers never break mid-digit. Widen `.drillable .drill-pop` to 260px.
- `.cell-zero { color: var(--muted-2); font-weight: 400; }` — dim genuine $0 cells; in the cell renderer wrap plain zeros in `<span className="cell-zero">`, and skip the DrillPopover entirely when the breakdown `components.length === 0` or the cell is zero/blank.

## Verify before finishing

Run `npm run build`. Then compare Reports vs Projection side by side for all three statements and confirm: same row heights, same collapsed one-row sections, same soft-green/grey Total styling, CF SUMMARY box with Net Change in Cash populated (= Ending − Beginning) on every actual month, margin rows present on Reports P&L, no blue anywhere on Reports, no content bleeding through the sticky header while scrolling, and the card's rounded corner flush against the last column in the filtered view.
