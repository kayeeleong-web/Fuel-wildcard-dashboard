# AR Controller — Consolidated Report — 2026-06 Wildcard

| Field | Value |
|---|---|
| Agent | `ar-controller-consolidator` (Consolidation role, runs once at end of pipeline) |
| Client | Mems Studio, Inc. DBA Wildcard |
| Period | 2026-06 |
| Generated at | 2026-08-19 |
| Status | **escalated** |
| **AR Controller Score** | **100%** (nothing confirmed yet) — **potential 49%** if all findings confirmed |
| session_coverage | **2 of 4 fresh**, 2 skipped by config |
| Paired artifacts | `…_v1.xlsx` (the file the FM edits) · `…_v1.html` (read-only overview) |

---

## Executive summary

Wildcard's **AR control total is trustworthy; the detail beneath it is not.**

The $237,000 closing AR balance for 2026-06 ties to the Balance Sheet at **0.00 variance**, and the
rollforward proves out to the cent: opening 250,900 + 292,000 invoiced − 305,900 collected = 237,000.
The Balance Sheet itself balances. That is real assurance and it is worth stating plainly.

What cannot be produced is anything *beneath* that total. The configured source — the `GL Accu` tab of
the `wildcard-fuel` workbook — carries **no due date, no invoice number, no invoice-level balance, and
no customer name on any of 335 AR lines across 27 months**. Consequently: no aging, no CEI, no
customer concentration, and no verifiable cash application. One metric survived — DSO at 19.53 days,
and only with total revenue substituted for credit sales, so treat it as a floor.

This is a **source-grain problem, not a bookkeeping problem.** The GL is the right place to get the AR
control total and the wrong place to get AR detail. Stripe holds the invoices and is already live with
viewer access.

## AR Controller Score

```
formula  AR Controller Score = 100% - (Critical_confirmed x 8 + Mid_confirmed x 3 + Low_confirmed x 1),
                               floored at 0%
inputs   Critical_confirmed = 0    Mid_confirmed = 0    Low_confirmed = 0
         (first run for this client - no FM decisions recorded yet, so no finding is confirmed)
result   AR Controller Score = 100%

potential additional impact if all open findings are confirmed:
         Critical_open = 6  ->  48        Mid_open = 1  ->  3        Low_open = 0  ->  0
         100% - 51 = 49%
```

> **100% is not assurance.** It reflects that no finding has yet been marked `Error` by the FM in the
> paired `.xlsx`. Six Critical findings are open. Weights 8/3/1 are the company-wide defaults, not a
> formula invented for this workflow. This is the only number this Consolidator computes itself —
> everything else below is relayed from the Sub-agent that produced it.

## Findings — 7 open, 0 confirmed

| ID | Sub-agent | Type | Severity |
|---|---|---|---|
| `ARM-2026-06-001` | ar-aging-metrics | deterministic | Critical |
| `ARM-2026-06-002` | ar-aging-metrics | deterministic | Critical |
| `ARM-2026-06-003` | ar-aging-metrics | deterministic | Critical |
| `ARM-2026-06-004` | ar-aging-metrics | deterministic | Critical |
| `ARP-2026-06-001` | ar-cash-application | deterministic | Critical |
| `ARP-2026-06-002` | ar-cash-application | deterministic | Critical |
| `ARP-2026-06-003` | ar-cash-application | judgment | Mid |

Full text and evidence for each: `…_v1.xlsx` sheet **Findings**, and the `…_v1.html` overview.
Every deterministic finding is Critical by definition, per the company standard.

## Sub-agent execution — relayed, not recomputed

| Sub-agent | Coverage | Run status | exec_completeness | Weakest upstream link |
|---|---|---|---|---|
| `ar-controller-input-agent` | fresh | needs_review | 0.85 | none (opens the chain) |
| `ar-aging-metrics` | fresh | needs_review | 0.70 | input-agent (0.85) |
| `ar-collections-review` | **skipped by config** | not run | — | n/a |
| `ar-dispute-credit-review` | **skipped by config** | not run | — | n/a |
| `ar-cash-application` | fresh | **escalated** | **0.65** | input-agent (0.85) |

**Compounded reliability chain:** 0.85 → 0.70 (aging) and 0.85 → 0.65 (cash application). The two
skips are **deliberate config decisions**, not gaps: `collectionsWorkflow` and `disputeCreditHold` are
OFF in `ctx_18` because Wildcard tracks no follow-up dates, promises-to-pay, dispute status, credit
limits, or credit-hold policy anywhere. Running them would have produced empty panels.

`ar-cash-application` at 0.65 is **below the 0.70 review threshold** — the only Sub-agent this period
to breach it.

## What verified

| Check | Result |
|---|---|
| AR control total 2026-06, GL vs BS | **$237,000.00 both — 0.00 variance** ✅ |
| AR control total 2026-05, GL vs BS | **$250,900.00 both — 0.00 variance** ✅ |
| AR rollforward 2026-06 | 250,900 + 292,000 − 305,900 = **237,000 — ties exactly** ✅ |
| Balance Sheet balances at 2026-06 | 519,363.38 = 116,358.64 + 403,004.74 ✅ |
| Deferred Revenue, GL vs BS | 39,999.99 both ✅ |
| Payments booked as proper double entries | 12 of 13 (92.3%) hit a cash account in the same journal entry ✅ |
| DSO | **19.53 days** ⚠️ revenue-as-credit-sales proxy — a floor, not a measurement |
| CEI | `null` ❌ needs Ending Current AR → needs a valid aging |
| Aging buckets | not computable ❌ |
| Top-5 customer concentration | not computable ❌ |

## Open items for the FM, in priority order

1. **Get AR detail at invoice grain.** Invoice number, invoice date, **due date**, total, balance,
   **customer**. Stripe is live with viewer access (`ctx_05`) and holds the invoices. Without this,
   four of the five things this workflow exists to produce stay unavailable every period.
2. **Record materiality threshold + basis in `ctx_17`.** All three permitted lookup tiers were
   exhausted; no number was defaulted. Every materiality-gated finding in both workflows is inert
   until this exists.
3. **Fix or switch off `cashApplication`.** Connect Chase — or Chase + Stripe, since `ctx_03` records
   most customers pay by ACH rather than through Stripe — or set the flag OFF in `ctx_18` rather than
   run it against a source that represents no application at all.
4. **Confirm the credit-sales split** for 2026-06 so DSO stops being a floor.
5. **Confirm 2026-06 is actually closed.** `ctx_16` records June books as not closed by the prior
   bookkeeper as of 2026-08-11, unresolved. Every figure here comes from that period.
6. **Fiscal year end** — ❌ MISSING in `ctx_01`, ask Brennan Keough.

## Escalations

```json
"escalations": [
  {
    "target_agent": "FM",
    "reason": "6 Critical findings open across 2 fresh Sub-agents. AR aging, CEI, customer concentration and cash-application verification are all unavailable because the configured source carries no due date, invoice number, invoice-level balance or customer name.",
    "severity": "critical",
    "required_action": "Supply an invoice-grain AR source before the next period's run. Stripe is the most likely candidate and is already connected."
  },
  {
    "target_agent": "FM",
    "reason": "ar-cash-application execution_completeness 0.65 is below the 0.70 review threshold.",
    "severity": "critical",
    "required_action": "Connect a real payments feed with remittance detail, or switch cashApplication OFF in ctx_18."
  },
  {
    "target_agent": "FM",
    "reason": "Materiality threshold and basis MISSING in ctx_17 - the only permitted source for every materiality-gated finding in this workflow.",
    "severity": "high",
    "required_action": "Record materiality threshold and basis in ctx_17_accounting-policy-framework.md."
  },
  {
    "target_agent": "FM",
    "reason": "Period 2026-06 books were not closed by Central as of 2026-08-11 per ctx_16, unresolved.",
    "severity": "high",
    "required_action": "Confirm 2026-06 is final before relying on the 237,000.00 AR balance or the 19.53-day DSO."
  }
]
```

---

**FINAL pointer** — always overwritten in place. Versioned artifacts for this period:
`2026_06_Wildcard_ARControllerConsolidation_v1.xlsx` + `.html`.

*`ar-controller-consolidator` — 2026-06 Wildcard — status: escalated*
