# AP Discount Capture — 2026-06 Wildcard

| Field | Value |
|---|---|
| Agent | `ap-discount-capture` (`discountCapture` **ON** per `ctx_19`) |
| Client | Mems Studio, Inc. DBA Wildcard | Period | 2026-06 |
| Generated at | 2026-08-19 | Execution ID | APD-20260819-001 |
| Status | **escalated** |
| execution_completeness | **0.80** |
| Risk level | **medium** |

---

## Step 1 — Client Isolation Check [HARD BLOCK] — PASSED
## Step 2 — Pre-flight gate — PASSED. `ctx_19` has `dataSource = held`.
## Step 3 — Materiality lookup — **NOT FOUND** in `ctx_17`; all tiers exhausted, no number defaulted.

## Step 4 — Analyse

### 4.1 Required input — **NO DATASET, AND NO UNDERLYING TERMS**

This skill needs `status.discountTerms`, `status.discountDeadline`, `status.discountCaptured`,
`status.discountAmount` at bill grain. Two independent blockers:

**Blocker 1 — no AP subledger.** See `ap-aging-metrics` finding `APM-2026-06-001`. BS AP = 0.00 in all
27 months; no bills exist to carry discount fields.

**Blocker 2 — no early-payment discount terms exist anywhere for this client.** This is the more
fundamental point, and it would hold even if AP were booked tomorrow:

| Source checked | Result |
|---|---|
| `ctx_12_vendor-classification.md`, all 6 vendor rows (Vetric, Central, Altia, Demand Collective, campaign material vendors, rent) | Payment-terms column reads `Bank/invoice`, `Bank`, or `Amex credit card`. **No discount terms on any row.** |
| `ctx_03_business-rules-policies.md` payment terms — client side | *"Mix of vendor invoices (e.g. Vetric, billed and paid via bank) and Amex credit card charges for campaign materials."* No discount terms. |
| Card spend population (216 vendors, 2026-06) | Card charges settle on the statement cycle and carry no payment terms at all — no discount is available to capture or miss. |

### 4.2 Finding

| ID | Type | Severity | Finding |
|---|---|---|---|
| `APD-2026-06-001` | judgment | Mid | **No early-payment discount terms exist for any Wildcard vendor.** All 6 documented vendors pay by bank or card with no stated discount terms, and card spend carries no terms by nature. The control this Sub-agent tests — whether an available discount was missed — has nothing to test against, independently of the missing AP subledger. |

**Severity is Mid, not Critical.** Unlike the other AP Sub-agents, this one is not merely blocked
by a missing dataset — the economic condition it exists to monitor does not appear to arise at
Wildcard. A zero result here is plausibly the *correct* answer rather than a gap. That is a weaker
finding, and it is graded as such.

### 4.3 Recommendation flagged for the FM, not acted on

`discountCapture` is a candidate to switch **OFF** in `ctx_19` — it is the one enabled AP flag whose
zero result is likely genuine rather than an artefact of missing data. This would reduce noise in
future runs without losing coverage. The FM decides; the flag has been left ON as instructed.

Worth separating from a real adjacent issue this Sub-agent does **not** own: `ctx_12` records Vetric's
quarterly $5,250 prepayment as *"needs amortization — paid quarterly in cash but should be spread
across the period on an accrual basis"*, and `ctx_17` lists prepaid-expense treatment as identified
but not formalised. That is a prepaid-amortisation matter for the accounting close, not a missed
early-payment discount.

---

## Step 6 — Execution completeness scoring

| Component | Result |
|---|---|
| Client Isolation Check, pre-flight gate | ✅ |
| Materiality lookup exhausted, not defaulted | ✅ |
| Dataset absence verified | ✅ |
| Underlying discount terms searched across all documented sources before concluding | ✅ 3 sources, 6 vendors |
| Discount test executed | ❌ nothing to test |
| Every read-path item inspected | ❌ 5 image-only PDFs unreadable |

**execution_completeness = 0.80** — above the 0.70 threshold.

## Escalations

```json
"escalations": [
  {
    "target_agent": "FM",
    "reason": "No early-payment discount terms exist for any of Wildcard's 6 documented vendors, and card spend carries no payment terms. Finding APD-2026-06-001. Compounded by the absent AP subledger (APM-2026-06-001).",
    "severity": "medium",
    "required_action": "Confirm with Brennan Keough whether any vendor offers early-payment terms that are simply undocumented. If none do, consider switching discountCapture OFF in ctx_19 - this is the one enabled AP flag whose zero result is likely genuine rather than a data gap."
  },
  {
    "target_agent": "FM",
    "reason": "Materiality threshold and basis MISSING in ctx_17 - the only permitted source for the missed-discount escalation.",
    "severity": "high",
    "required_action": "Record materiality threshold and basis in ctx_17."
  }
]
```

---

*`ap-discount-capture` v1 — 2026-06 Wildcard — status: escalated*
