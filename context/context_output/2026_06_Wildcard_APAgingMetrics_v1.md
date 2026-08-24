# AP Aging & Metrics — 2026-06 Wildcard

| Field | Value |
|---|---|
| Agent | `ap-aging-metrics` (`dpo` **ON** per `ctx_19`) |
| Client | Mems Studio, Inc. DBA Wildcard | Period | 2026-06 |
| Generated at | 2026-08-19 | Execution ID | APM-20260819-001 |
| Status | **escalated** |
| execution_completeness | **0.80** |
| Risk level | **high** |

---

## Step 1 — Client Isolation Check [HARD BLOCK] — PASSED

Wildcard / 2026-06 / read `…\context\` + `wildcard-fuel` / write `…\context\context_output\`. FM-confirmed
2026-08-19.

## Step 2 — Pre-flight gate — PASSED

`ap-controller-input-agent` v2 at `needs_review`. `ctx_19_ap-controller-config.md` now exists with
`dataSource = held`.

## Step 3 — Standing policy-hedge lookup: materiality — **NOT FOUND**

`ctx_17` records threshold and basis as ❌ MISSING; not stated in any other Inputs-folder document
or on any of the workbook's 12 tabs. Raised to the FM at Gate 2. **No number defaulted** —
`ap_controller_config` is explicitly forbidden as a fallback. The concentration-risk escalation is
therefore not evaluable.

---

## Step 4 — Validate → Analyse → Flag

### 4.1 Validate the AP export — **NO DATASET**

`ctx_19` sets `dataSource = held`: Wildcard operates no AP subledger. Verified independently against
the `wildcard-fuel` workbook on 2026-08-19:

| Check | Result |
|---|---|
| BS `Accounts Payable`, 2026-05 / 2026-06 | **0.00 / 0.00** |
| BS `Accounts Payable`, all 27 months (2024-04 → 2026-06) | **0.00 in every month** |
| AP category range in the workbook's `COA` tab | **none exists** — liabilities run Credit Card Payable 20000–23999, Deferred Revenue 24000–24999, Current Liabilities 25000–25199, Other Current Liabilities, Non Current Liability |
| Accounts matching `payable\|vendor\|bill\|supplier\|trade` among 65 distinct GL account names | **1** — `21001 American Express -- Delta Reserve Business Card -- 1002 Payable`, a card payable, not trade AP |
| `25100 Accrued Expenses` | 4 GL lines in 27 months, cumulative **0.00** |
| Current Liabilities 25000–25199 balance, last 12 periods | **0.00 in every period** |

**There are no bills.** No bill number, no bill date, no due date, no vendor-level open balance.
Required fields: 0 of 6 available.

### 4.2 Aging buckets — **NOT COMPUTABLE**

Nothing to age. Not a computation failure — an absence of the underlying obligation. Wildcard pays
by Amex card or immediate bank transfer (`ctx_03`, `ctx_12`), so no liability is ever recognised as
an open payable.

### 4.3 DPO

```
formula  DPO = (Accounts Payable / COGS in period) x Days in period
inputs   Accounts Payable = 0.00          (BS 2026-06, verified)
         COGS in period   = 42,395.75     (GL accounts 50000-59999, posting period 2026-06)
         Days in period   = 30
calculate  (0.00 / 42,395.75) x 30
result   DPO = 0.00 days
```

> ⚠️ **Arithmetically correct, analytically empty.** A DPO of 0.00 days is the true consequence of
> carrying no payables — it is not an error and not an estimate. But it measures nothing about how
> Wildcard actually pays vendors, because vendor obligations never pass through AP. Reported as
> 0.00 with this caveat rather than suppressed, and **not** substituted with a card-float proxy.
>
> Note also `ctx_08`: headcount is not split between COGS and OPEX consistently with Brennan's
> Operating Model, so the COGS denominator is itself not fully trustworthy. Immaterial here given a
> zero numerator, but it would matter once AP exists.

### 4.4 Vendor concentration — **NOT COMPUTABLE**

No AP balance to concentrate. Materiality unavailable in any case (Step 3).

### 4.5 Findings

| ID | Type | Severity | Finding |
|---|---|---|---|
| `APM-2026-06-001` | deterministic | Critical | **Wildcard operates no accounts-payable subledger.** BS AP is 0.00 in all 27 months; no AP account exists in the chart of accounts; `25100 Accrued Expenses` has 4 lines ever and a 0.00 balance. Consequence: AP aging, DPO as a behavioural measure, vendor concentration, discount capture, approval controls and three-way match have no dataset. |
| `APM-2026-06-002` | judgment | Mid | **Vendor obligations are recognised only at payment, not at invoice.** Per `ctx_12`, campaign-material purchases (150–300 per month) are charged to Amex by individual team members, and recurring vendors (Vetric, Altia, Demand Collective, Central, rent) are paid directly by bank. Expense is therefore recognised on the cash/card event rather than on the bill. Flagged because it means period-end accrual completeness rests on card-statement timing rather than on a bills register. |

### 4.6 Available-but-not-used: the card-payable proxy

Recorded for the FM's decision, **not run as AP output** (declined 2026-08-19):

| Metric | Value |
|---|---|
| `21001` Amex balance owed at 2026-06 | **$73,358.65** |
| `21001` GL lines, all periods | 7,566 |
| `21001` GL lines, 2026-06 | 884 |
| Vendor identity recoverable via `Journal Entry ID` join | **875 of 884 (99.0%)** |
| Distinct vendors, 2026-06 | **216** |
| Gross recovered spend, 2026-06 | **$81,621.02** |
| Top vendors | eBay 12,885.32 · Amazon 9,220.82 · Etsy 9,038.99 · FEDEX 4,464.05 · LinkedIn 1,821.87 |

This would measure **card float**, not vendor payment behaviour. Switching it on is an FM decision.

---

## Step 6 — Execution completeness scoring

| Component | Result |
|---|---|
| Client Isolation Check, pre-flight gate | ✅ |
| Materiality lookup exhausted all tiers, not defaulted | ✅ |
| Dataset absence independently verified, not assumed from config | ✅ 6 separate checks |
| DPO computed and disclosed rather than suppressed or proxied | ✅ |
| Aging / concentration | ❌ no dataset |
| Every read-path item inspected | ❌ 5 image-only PDFs unreadable |

**execution_completeness = 0.80** — above the 0.70 review threshold. This skill executed its own job
correctly; the absent dataset is a Group A gap, surfaced not skipped. Status is `escalated` because
of finding `APM-2026-06-001`, not because of this score.

---

## Escalations

```json
"escalations": [
  {
    "target_agent": "FM",
    "reason": "Wildcard operates no AP subledger. BS Accounts Payable is 0.00 in all 27 months and no AP account exists in the chart of accounts. Finding APM-2026-06-001. The whole AP Controller Workflow has no valid dataset.",
    "severity": "critical",
    "required_action": "Decide whether Wildcard should begin booking vendor bills to AP. Until it does, either keep the AP Controller Workflow deferred, or switch ctx_19 dataSource to the 21001 card-payable proxy as an explicitly separate analysis."
  },
  {
    "target_agent": "FM",
    "reason": "Expense is recognised at card/bank payment rather than at bill receipt, so period-end accrual completeness depends on card-statement timing rather than a bills register. Finding APM-2026-06-002.",
    "severity": "high",
    "required_action": "Confirm with Gohar Sahakyan how period-end cut-off is handled for card spend straddling month end, given no AP or accrual register exists."
  },
  {
    "target_agent": "FM",
    "reason": "Materiality threshold and basis MISSING in ctx_17 - the only permitted source. Concentration-risk escalation not evaluable.",
    "severity": "high",
    "required_action": "Record materiality threshold and basis in ctx_17."
  },
  {
    "target_agent": "FM",
    "reason": "Period 2026-06 books were not closed by Central as of 2026-08-11 per ctx_16.",
    "severity": "high",
    "required_action": "Confirm 2026-06 is final before relying on any figure here."
  }
]
```

---

*`ap-aging-metrics` v1 — 2026-06 Wildcard — status: escalated*
