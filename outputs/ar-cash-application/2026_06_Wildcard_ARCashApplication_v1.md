# AR Cash Application — 2026-06 Wildcard

| Field | Value |
|---|---|
| Agent | `ar-cash-application` (Sub-agent 4 of 4 — `cashApplication` **ON** per `ctx_18`) |
| Workflow | AR Controller Workflow |
| Client | Mems Studio, Inc. DBA Wildcard |
| Period | 2026-06 |
| Generated at | 2026-08-19 |
| Execution ID | ARP-20260819-001 |
| Status | **escalated** |
| execution_completeness | **0.65** |
| Risk level | **high** |

---

## Step 1 — Client Isolation Check [HARD BLOCK] — PASSED

Wildcard / 2026-06 / read `…\context\` + `wildcard-fuel` tab `GL Accu` / write `…\outputs\`.
FM-confirmed 2026-08-19.

## Step 2 — Pre-flight gate — PASSED (Option B override)

`ar-controller-input-agent` v2 at `needs_review`. `cashApplication` confirmed ON in
`ctx_18_ar-controller-config.md`.

## Step 3 — Standing policy-hedge lookups

| Lookup | Result |
|---|---|
| Materiality threshold (`ctx_17` ONLY) | ❌ MISSING — all three tiers exhausted, no number defaulted. The unapplied-payment escalation is therefore not materiality-gated this run; it escalates on structural grounds instead. |
| Payment-application turnaround expectation (`ctx_03`) | ❌ Not documented. Per Section 2 this must be asked of the FM once rather than assumed — raised at Gate 2. No window was invented, so the "past a reasonable window" test could not be applied. |

---

## Step 4 — Analyse

### 4.1 The payments feed

`ctx_18` sets `dataSource = csv-excel` via the `GL Accu` tab. Customer payments appear there as
`receivable_payment_made` events on accounts 12000–12199.

**2026-06 payment activity — 13 payments, $305,900.00 total:**

| Effective date | Amount |
|---|---|
| 2026-06-01 | −4,000.00 |
| 2026-06-01 | −20,000.00 |
| 2026-06-02 | −22,500.00 |
| 2026-06-03 | −60,000.00 |
| 2026-06-05 | −2,000.00 |
| 2026-06-08 | −15,000.00 |
| 2026-06-09 | −45,000.00 |
| 2026-06-15 | −5,000.00 |
| 2026-06-15 | −50,000.00 |
| 2026-06-15 | −15,000.00 |
| 2026-06-23 | −15,000.00 |
| 2026-06-25 | −47,400.00 |
| 2026-06-30 | −5,000.00 |
| **Total** | **−305,900.00** |

Against 16 invoices issued totalling $292,000.00 — so June collected $13,900 more than it billed,
drawing down prior-period AR. Consistent with the closing balance falling 250,900 → 237,000.

### 4.2 Match each payment to the invoices it claims to apply to — **NOT POSSIBLE**

This skill's core test is `ARPayment.appliedInvoiceIds` against the invoices named. **No such field,
and no equivalent, exists in this source.**

| Linkage mechanism tested | Result |
|---|---|
| `Event External ID` shared between a payment and an invoice | ❌ 13 payment IDs vs 16 issue IDs, **0 overlap**. Unique per line across all 335 AR lines. |
| `Event ID` | ❌ populated on only 17 of 29 June AR lines, and never shared across an issue/payment pair |
| `Journal Memo` (free-text reference) | ❌ empty on **all 29** June AR lines |
| `Counterparty Name` on the payment | ❌ empty on all 13 payments |
| `Counterparty Name` recovered via `Journal Entry ID` siblings | ❌ **0 recovered.** 12 of 13 payments *do* share a journal entry with a cash account (so the cash side is properly booked double-entry), but no sibling on any of those entries carries a counterparty either. |

**Consequence:** it is impossible to determine which invoice any of the 13 payments was applied to,
or whether it was applied at all. Both of this skill's two required tests —

- flag a payment with **no applied invoices** past a reasonable window, and
- flag a payment whose **applied amount is less than the payment's own total**

— are unexecutable, because "applied" is not represented anywhere in the data. This is a structural
absence, not a data-quality blemish on individual records.

### 4.3 Findings

| ID | Type | Severity | Finding |
|---|---|---|---|
| `ARP-2026-06-001` | deterministic | Critical | **Cash application is unverifiable.** All 13 of June's customer payments ($305,900.00) lack any link to an invoice: no applied-invoice field, no shared external ID, no memo reference, no counterparty. Whether any payment was correctly applied cannot be established from this source. |
| `ARP-2026-06-002` | deterministic | Critical | **No payment can be attributed to a customer.** `Counterparty Name` is empty on all 13 payments and unrecoverable via journal-entry join (0 of 13), so no payment can be matched to a payer even manually. |
| `ARP-2026-06-003` | judgment | Mid | **The configured feed is the GL, not a payments feed.** `ctx_05` records Stripe and Chase both live with viewer access, and `ctx_03` records that most customers pay by ACH rather than through Stripe. The GL captures the accounting entry for a receipt but carries none of the remittance detail (payer, reference, invoice) that cash application depends on. Flagged as a source-selection issue for the FM to weigh. |

Language states what was found and why it is flagged, not what the correct treatment should be.

### 4.4 What did verify

- **12 of 13 payments (92.3%)** are booked as proper double entries against a cash account
  (10000–11999) within the same `Journal Entry ID`. The accounting mechanics of the receipt are
  sound; it is the *remittance detail* that is absent.
- Payment total ($305,900.00) reconciles exactly into the AR rollforward that ties to the Balance
  Sheet at 0.00 variance (see `ar-aging-metrics` Step 4.7).

The one payment (2026-06-25, −47,400.00) without a cash sibling in the same journal entry is noted
but not itself a finding — it may settle through a clearing account across entries. Not asserted
either way, because the linkage needed to confirm it is the same linkage that is missing.

---

## Step 5 — Consolidated file read-back

No prior `ar-controller-consolidator` shared file for Wildcard. No `ARP-` rows with an `FM Decision`.
First run.

## Step 6 — Execution completeness scoring

| Component | Result |
|---|---|
| Client Isolation Check before any read/write | ✅ |
| Pre-flight gate confirmed | ✅ |
| Materiality + turnaround-window lookups run, not defaulted | ✅ |
| Payments feed located and fully enumerated | ✅ 13 of 13 payments, $305,900.00 |
| Every available linkage mechanism tested before declaring failure | ✅ 5 mechanisms tested |
| Unapplied-payment test executed | ❌ unexecutable — "applied" not represented in source |
| Partial-application test executed | ❌ unexecutable — same cause |
| Turnaround-window test executed | ❌ no documented window; none invented |
| Every read-path item inspected | ❌ 5 image-only PDFs unreadable |

**execution_completeness = 0.65** — **below** `execution_completeness_review_threshold` (0.70,
fixed). Escalated on completeness grounds in addition to the findings above.

## Step 7 — FM approval gate

Non-blocking status write — ran inside the full pipeline. Status handed to
`ar-controller-orchestrator`.

---

## Escalations

```json
"escalations": [
  {
    "target_agent": "FM",
    "reason": "execution_completeness 0.65 is below the 0.70 review threshold. Both of this skill's required tests are unexecutable because the configured source represents no invoice-to-payment application at all.",
    "severity": "critical",
    "required_action": "Either supply a real payments feed carrying remittance detail, or switch cashApplication OFF in ctx_18 until one exists. Running it against the GL cannot produce a valid result."
  },
  {
    "target_agent": "FM",
    "reason": "All 13 of June's payments ($305,900.00) are unverifiable for correct application, and none can be attributed to a customer. Findings ARP-2026-06-001 and -002.",
    "severity": "critical",
    "required_action": "Connect Stripe and/or Chase as the payments feed with payer and reference detail. Note ctx_03: most customers pay by ACH rather than through Stripe, so Stripe alone would miss the majority of receipts - it must be Chase, or Chase plus Stripe."
  },
  {
    "target_agent": "FM",
    "reason": "No payment-application turnaround expectation is documented in ctx_03, so the 'past a reasonable window' test had no threshold. No number was assumed.",
    "severity": "medium",
    "required_action": "State Wildcard's expected turnaround for applying a received payment and record it in ctx_03_business-rules-policies.md."
  },
  {
    "target_agent": "FM",
    "reason": "Materiality threshold and basis are MISSING in ctx_17, so the unapplied-payment materiality gate could not be applied.",
    "severity": "high",
    "required_action": "Record materiality threshold and basis in ctx_17."
  }
]
```

---

*`ar-cash-application` v1 — 2026-06 Wildcard — status: escalated*
