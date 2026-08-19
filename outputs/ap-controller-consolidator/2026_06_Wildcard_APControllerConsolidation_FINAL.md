# AP Controller — Consolidated Report — 2026-06 Wildcard

| Field | Value |
|---|---|
| Agent | `ap-controller-consolidator` (Consolidation role, runs once at end of pipeline) |
| Client | Mems Studio, Inc. DBA Wildcard |
| Period | 2026-06 |
| Generated at | 2026-08-19 |
| Status | **escalated** |
| **AP Controller Score** | **100%** (nothing confirmed yet) — **potential 59%** if all findings confirmed |
| session_coverage | **4 of 5 fresh**, 1 skipped by config |
| Paired artifacts | `…_v1.xlsx` (the file the FM edits) · `…_v1.html` (read-only overview) |

---

## Executive summary

**Wildcard operates no accounts-payable subledger.** That single fact is the report.

Verified six independent ways against the `wildcard-fuel` workbook: Balance Sheet AP is **$0.00 in all
27 months** (2024-04 → 2026-06); the chart of accounts has **no AP category range at all**; `25100
Accrued Expenses` has **4 GL lines in 27 months** and a $0.00 balance; Current Liabilities are $0.00 in
every one of the last 12 periods; and of **65 distinct GL account names**, the only one matching
`payable|vendor|bill|supplier|trade` is `21001 American Express -- Delta Reserve Business Card -- 1002
Payable` — a card payable, not trade AP.

The cause is structural, not an error. Per `ctx_03` and `ctx_12`, Wildcard pays by Amex card (campaign
materials, charged by individual team members) or by immediate bank transfer (Vetric, Altia, Demand
Collective, Central, rent). **No obligation is ever recognised as an open payable**, so there is
nothing to age, no due dates, no payment terms, and no discount deadlines.

Four of five Sub-agents were enabled and each escalated for absence of dataset. Nothing was fabricated
and no proxy was silently substituted. **A zero-finding AP result here is not assurance that AP
controls are working — it is the consequence of there being no AP to control.**

## AP Controller Score

```
formula  AP Controller Score = 100% - (Critical_confirmed x 8 + Mid_confirmed x 3 + Low_confirmed x 1),
                               floored at 0%
inputs   Critical_confirmed = 0    Mid_confirmed = 0    Low_confirmed = 0   (first run, no FM decisions)
result   AP Controller Score = 100%

potential additional impact if all open findings are confirmed:
         Critical_open = 4  ->  32        Mid_open = 3  ->  9        Low_open = 0  ->  0
         100% - 41 = 59%
```

> Weights 8/3/1 are the company-wide defaults. This is the only number this Consolidator computes
> itself; every severity and completeness figure below is relayed verbatim from the Sub-agent that
> produced it.

## Findings — 7 open, 0 confirmed

| ID | Sub-agent | Type | Severity |
|---|---|---|---|
| `APM-2026-06-001` | ap-aging-metrics | deterministic | Critical |
| `APM-2026-06-002` | ap-aging-metrics | judgment | Mid |
| `APX-2026-06-001` | ap-duplicate-detection | deterministic | Critical |
| `APD-2026-06-001` | ap-discount-capture | judgment | Mid |
| `APA-2026-06-001` | ap-approval-controls | deterministic | Critical |
| `APA-2026-06-002` | ap-approval-controls | deterministic | Critical |
| `APA-2026-06-003` | ap-approval-controls | judgment | Mid |

Full text and evidence: `…_v1.xlsx` sheet **Findings**, and the `…_v1.html` overview.

## Sub-agent execution — relayed, not recomputed

| Sub-agent | Coverage | Run status | exec_completeness | Weakest upstream link |
|---|---|---|---|---|
| `ap-controller-input-agent` | fresh | needs_review | 0.85 | none (opens the chain) |
| `ap-aging-metrics` | fresh | escalated | 0.80 | input-agent (0.85) |
| `ap-discount-capture` | fresh | escalated | 0.80 | input-agent (0.85) |
| `ap-duplicate-detection` | fresh | escalated | 0.75 | input-agent (0.85) |
| `ap-approval-controls` | fresh | escalated | **0.70** | input-agent (0.85) |
| `ap-three-way-match` | **skipped by config** | not run | — | n/a |

**No Sub-agent fell below the 0.70 review threshold** — each executed its own job correctly. The
completeness scores are high precisely *because* the absent dataset was surfaced rather than silently
skipped, which is a Group A gap, not a deduction. Every `escalated` status is driven by findings, not
by a low score.

`ap-three-way-match` was skipped deliberately: `threeWayMatch` is OFF in `ctx_19` because no PO or
receiving system exists in `ctx_05`'s connected tools, and `poRequiredThreshold` was left unset rather
than guessed.

## The one metric that computed

```
DPO = (Accounts Payable / COGS in period) x Days in period
    = (0.00 / 42,395.75) x 30
    = 0.00 days
```

Arithmetically correct and analytically empty. It is the true consequence of carrying no payables, not
an error and not an estimate. It measures nothing about how Wildcard actually pays vendors. Reported
rather than suppressed, and **not** substituted with a card-float proxy.

## Declined alternative — the card-payable proxy

The FM held `dataSource` on 2026-08-19 rather than substitute a proxy. Recorded so the option stays
available:

| Metric | Value |
|---|---|
| Amex `21001` balance owed at 2026-06 | **$73,358.65** |
| `21001` GL lines — all periods / 2026-06 | 7,566 / 884 |
| Vendor identity recoverable via `Journal Entry ID` join | **875 of 884 (99.0%)** |
| Distinct vendors, 2026-06 | **216** |
| Gross recovered spend, 2026-06 | **$81,621.02** |
| Top vendors | eBay 12,885.32 · Amazon 9,220.82 · Etsy 9,038.99 · FEDEX 4,464.05 · LinkedIn 1,821.87 |
| Diagnostic duplicate scan | 1,239 pairs ≤10 days; **87 same-day across different journal entries** |

This would measure **card float, not vendor payment behaviour**. The 1,239-pair result on 884 lines is
itself evidence the duplicate test is mis-applied to card data — it matches the normal texture of
repeat micro-purchases and per-seat SaaS billing, not exceptions.

## Open items for the FM, in priority order

1. **Decide whether Wildcard should begin booking vendor bills to AP.** This is the root decision.
   Until it is made, the AP Controller Workflow cannot produce a valid result in any period.
2. **Get real approval logic from Brennan Keough** — already flagged in `ctx_03` as a first-working-
   session item — and **remove the provisional tiers from `ctx_19`** so no future run mistakes them for
   approved policy. `ap-approval-controls` currently has neither a dataset nor a valid policy.
3. **Address distributed card-spend authority.** 884 card lines, 216 vendors, $81,621.02 gross in one
   month, charged by individual team members with no approval evidence and no campaign-level
   reconciliation — `ctx_12` already calls this Wildcard's "biggest flagged pain point."
4. **Record materiality threshold + basis in `ctx_17`.** All permitted tiers exhausted; nothing
   defaulted.
5. **Consider switching `discountCapture` OFF.** It is the one enabled AP flag whose zero result is
   likely genuine rather than a data gap — no vendor offers documented early-payment terms.
6. **Confirm period-end cut-off handling** with Gohar Sahakyan for card spend straddling month end,
   given no AP or accrual register exists.
7. **Confirm 2026-06 is actually closed** (`ctx_16`: June books not closed by Central as of
   2026-08-11, unresolved).

Separately, and **not** this workflow's finding: `ctx_12` records Vetric's quarterly $5,250 prepayment
as needing amortisation, and `ctx_17` lists prepaid-expense treatment as identified but not
formalised. That belongs to the accounting close, not to AP discount capture.

## Escalations

```json
"escalations": [
  {
    "target_agent": "FM",
    "reason": "Wildcard operates no AP subledger - verified six independent ways. BS AP is 0.00 in all 27 months and no AP category exists in the chart of accounts. All four enabled Sub-agents escalated for absence of dataset. Findings APM-2026-06-001, APX-2026-06-001, APA-2026-06-001, APA-2026-06-002.",
    "severity": "critical",
    "required_action": "Decide whether Wildcard should begin booking vendor bills to AP. Until then keep this workflow deferred, or switch ctx_19 dataSource to the 21001 card-payable proxy as an explicitly separate and separately-labelled analysis."
  },
  {
    "target_agent": "FM",
    "reason": "ap-approval-controls has neither a dataset nor a valid policy. approvalStatus/approvalTier do not exist as fields, ctx_03 records approval logic as MISSING, and ctx_19 carries only FM-flagged provisional tiers created for test purposes.",
    "severity": "critical",
    "required_action": "Get Wildcard's real approval logic from Brennan Keough and replace the provisional tiers in ctx_19. Until then this Sub-agent's zero-finding output must not be read as approval assurance."
  },
  {
    "target_agent": "FM",
    "reason": "884 card lines across 216 vendors totalling $81,621.02 gross in 2026-06 were charged by individual team members with no recorded approval and no campaign-level reconciliation. Finding APA-2026-06-003, a control-design gap.",
    "severity": "high",
    "required_action": "Raise distributed card-spend authority with Brennan Keough. Decide whether an approval or spend-management control is warranted at Wildcard's current scale."
  },
  {
    "target_agent": "FM",
    "reason": "Materiality threshold and basis MISSING in ctx_17 - the only permitted source for every materiality-gated finding in this workflow.",
    "severity": "high",
    "required_action": "Record materiality threshold and basis in ctx_17_accounting-policy-framework.md."
  },
  {
    "target_agent": "FM",
    "reason": "ctx_19 contains an internal tension by FM direction: dataSource is held (no dataset) while four feature flags are ON. An enabled Sub-agent with no dataset can only escalate.",
    "severity": "medium",
    "required_action": "Confirm the flags record intent for when AP exists rather than an instruction to run against nothing, or switch dataSource to the proxy to get real numbers this period."
  },
  {
    "target_agent": "FM",
    "reason": "Period 2026-06 books were not closed by Central as of 2026-08-11 per ctx_16, unresolved.",
    "severity": "high",
    "required_action": "Confirm 2026-06 is final before relying on any figure here."
  }
]
```

---

**FINAL pointer** — always overwritten in place. Versioned artifacts for this period:
`2026_06_Wildcard_APControllerConsolidation_v1.xlsx` + `.html`.

*`ap-controller-consolidator` — 2026-06 Wildcard — status: escalated*
