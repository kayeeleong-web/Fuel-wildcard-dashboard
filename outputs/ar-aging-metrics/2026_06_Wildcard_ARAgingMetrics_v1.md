# AR Aging & Metrics — 2026-06 Wildcard

| Field | Value |
|---|---|
| Agent | `ar-aging-metrics` (Sub-agent 1 of 4, always on) |
| Workflow | AR Controller Workflow |
| Client | Mems Studio, Inc. DBA Wildcard |
| Period | 2026-06 |
| Generated at | 2026-08-19 |
| Execution ID | ARM-20260819-001 |
| Status | **needs_review** |
| execution_completeness | **0.70** |
| Risk level | **high** |

---

## Step 1 — Client Isolation Check [HARD BLOCK] — PASSED

Client Wildcard / period 2026-06 / read `…\Wildcard Vercel Project\context\` + Google Sheet
`wildcard-fuel` tab `GL Accu` / write `…\Wildcard Vercel Project\outputs\`. FM-confirmed
2026-08-19, not inferred.

## Step 2 — Pre-flight gate — PASSED (Option B override)

`ar-controller-input-agent` v2 reached `needs_review` for this period after
`ctx_18_ar-controller-config.md` was produced by the AR setup interview. Data source located and
FM-confirmed. Proceeding with the documented gaps recorded below.

## Step 3 — Standing policy-hedge lookup: materiality threshold — **NOT FOUND**

| Lookup order (per Section 6, Step 3) | Result |
|---|---|
| 1. `ctx_17_accounting-policy-framework.md` | ❌ `Materiality threshold: MISSING`, `Materiality basis: MISSING` |
| 2. Every document already in the Inputs folder | ❌ Not stated in any of `ctx_01`–`ctx_17`. The 5 PDFs are image-only with no text layer and could not be inspected. The `wildcard-fuel` workbook states no materiality threshold on any of its 12 tabs. |
| 3. Ask the FM directly | ⏳ Raised at Gate 2. **Not defaulted to a number** — `ar_controller_config` and `kpi_context` are explicitly forbidden as fallbacks. |

**Effect this run:** the concentration finding (Step 4.5) is materiality-gated and therefore cannot
fire. This is moot in 2026-06 regardless, because concentration itself is not computable — see
Step 4.4.

---

## Step 4 — Validate → Analyse → Flag

### 4.1 Validate the AR export — **FAILED**

Source: `GL Accu` tab, filtered to accounts 12000–12199. **335 AR GL lines** across 2024-04 → 2026-06;
**29 lines** in 2026-06.

| Validation | Required | Actual | Verdict |
|---|---|---|---|
| Every invoice has a customer name | 100% | **0 of 335** (0 of 29 in 2026-06) | ❌ FAIL |
| Every invoice has a balance | 100% | Amount present on 100% — but **no invoice-level balance** exists | ❌ FAIL |
| Every invoice has a due date | needed for aging | **0 of 335** — no due-date field exists in the source at all | ❌ FAIL |
| Every invoice has an invoice number | needed for identity | **0 of 335** — no invoice-number field exists | ❌ FAIL |
| Currency consistent | USD | USD, 100% | ✅ PASS |

**Root cause of the balance failure.** `Event External ID` is **unique per GL line** — 335 distinct
IDs across 335 lines, with **zero** IDs appearing more than once. Invoices (`invoice_issued`) and
payments (`receivable_payment_made`) therefore share **no key**. In 2026-06 the overlap between the
16 issue-side IDs and the 13 payment-side IDs is **0**. There is no way to determine which invoices
remain open, so no invoice-level balance can be derived.

### 4.2 Aging buckets — **NOT COMPUTABLE**

Per Section 6, Step 4.2 this skill must compute `daysAging` from **each invoice's own due date**
against the as-of date. No due date exists on any line, and no per-invoice open balance can be
derived (4.1). The source also supplies no bucket labels of its own, so the cross-check rule has
nothing to compare against.

**A reconstruction was attempted and is reported as failed, not published.** Treating each GL line
as its own open item and aging by *invoice date* (the only date available) as of 2026-06-30 produced:

| Bucket | n | Balance |
|---|---|---|
| Current | 6 | 27,500.00 |
| 1–30 | 23 | **−41,400.00** |
| 31–60 | 22 | 131,900.00 |
| 61–90 | 25 | **−26,500.00** |
| 90+ | 259 | 145,500.00 |

**Two buckets carry negative balances.** That is arithmetic proof the reconstruction is invalid —
it is classifying payment lines as though they were negative-balance invoices. Publishing this as an
aging would be wrong, so it is not published. **No aging is reported for 2026-06.**

A secondary obstacle even if due dates arrived: all 16 of June's invoices are dated 2026-06-01 (10),
2026-06-03 (1), or 2026-06-30 (5). Invoice dates cluster on month boundaries — consistent with
`ctx_03`'s "invoiced monthly via Stripe" — so invoice-date aging would be coarse in any case.

### 4.3 DSO and CEI

**DSO — computed, with one flagged substitution.**

```
formula  DSO = (Total AR Outstanding / Total Credit Sales in period) x Days in period
inputs   Total AR Outstanding  = 237,000.00   (GL accounts 12000-12199, cumulative to 2026-06)
         Total Credit Sales    = 364,000.00   (GL accounts 40000-49999, posting period 2026-06)
         Days in period        = 30           (June)
calculate  (237,000.00 / 364,000.00) x 30
result   DSO = 19.53 days
```

> ⚠️ **Substitution flagged.** `Total Credit Sales` is not separately identifiable in this source.
> **Total GL revenue for the period was used as a proxy.** Per `ctx_03`, "most customers pay via ACH
> direct deposit rather than through Stripe itself" — but some revenue is collected at point of sale
> and is not a credit sale. To the extent any 2026-06 revenue was not sold on credit, the
> denominator is overstated and **true DSO is higher than 19.53 days**. Treat 19.53 as a floor, not
> a measurement. This is a documented gap, not a guess: the figure used is a real GL total, and the
> substitution is disclosed rather than silently absorbed.

**CEI — `null`, returned rather than guessed.**

```
formula  CEI = [(Beginning AR + Credit Sales - Ending Total AR) /
                (Beginning AR + Credit Sales - Ending Current AR)] x 100
inputs   Beginning AR      = 250,900.00   AVAILABLE (GL cumulative to 2026-05, ties to BS)
         Credit Sales      = 364,000.00   AVAILABLE (proxy, as flagged above)
         Ending Total AR   = 237,000.00   AVAILABLE
         Ending Current AR =        ---   NOT AVAILABLE - requires a valid aging (4.2)
result   CEI = null
```

Note this is **not** the bootstrap-mode `null` the skill anticipates: a prior-period Beginning AR
*does* exist (250,900.00). CEI is null for a different reason — `Ending Current AR` depends on the
aging that could not be computed.

### 4.4 Top-N customer concentration — **NOT COMPUTABLE**

`ar_controller_config.dimensions = ["customer"]`, top-N = 5. **Counterparty Name is populated on 0 of
335 AR lines** across all 27 periods. Customer identity is entirely absent from the AR record, so no
concentration can be calculated at any N.

The field is not globally empty — it is populated on **7,751 of 19,039** GL lines overall (40.7%),
concentrated on expense accounts (`54000` Cost of Product 2,176 lines; `66200` Software 1,799;
`68300` Supplies 1,176; `68400` Shipping 739). It is the **receivable** side that carries none.
Recovery via `Journal Entry ID` join — which works at 99.0% on the card-payable side — yields **0
counterparties** for AR: 12 of June's 13 payments do share a journal entry with a cash account, but
none of those siblings carries a counterparty either.

### 4.5 Concentration finding — cannot fire

Materiality unavailable (Step 3) **and** concentration not computable (4.4). No judgment finding is
produced. Per Section 6, Step 4.5, a finding is never produced for concentration below materiality —
and here it is not measurable at all.

### 4.6 Data-integrity findings — **deterministic, Critical**

| ID | Type | Severity | Finding |
|---|---|---|---|
| `ARM-2026-06-001` | deterministic | Critical | **No due date on any AR record.** 335 of 335 AR GL lines (2024-04 → 2026-06) carry no due-date field. Section 6, Step 4.6 classifies a missing due date as a mechanical fact, always Critical. Consequence: aging cannot be computed for any period, not only 2026-06. |
| `ARM-2026-06-002` | deterministic | Critical | **No customer name on any AR record.** 335 of 335 AR GL lines carry an empty `Counterparty Name`, while the same column is populated on 40.7% of the wider GL. Consequence: customer concentration, the configured `customer` dimension, and any per-customer view are all unavailable. |
| `ARM-2026-06-003` | deterministic | Critical | **No invoice↔payment linkage.** `Event External ID` is unique per GL line (335 IDs / 335 lines; 0 overlap between June's 16 issues and 13 payments), and `Journal Memo` is empty on all 29 June AR lines. Consequence: no invoice-level open balance can be derived, so open items cannot be identified. |
| `ARM-2026-06-004` | deterministic | Critical | **No invoice number on any AR record.** 335 of 335 lines. Consequence: individual invoices cannot be identified, referenced in a collections conversation, or traced to a contract. |

Language above states what was found and why it is flagged. It does not prescribe the correct
treatment — that is the FM's call.

### 4.7 What **did** verify — reported because it is genuine assurance

**AR rollforward, 2026-06 — ties exactly.**

```
  opening balance (GL cumulative to 2026-05)     250,900.00
  + invoices issued        (16 lines)           +292,000.00
  - payments received      (13 lines)           -305,900.00
  + other events            (0 lines)                  0.00
  = closing balance                              237,000.00
  independent recomputation of closing            237,000.00   -> TIES (0.00 variance)
```

**GL ↔ Balance Sheet tie-out — passes in both periods.**

| Period | GL accounts 12000–12199 | BS `Accounts Receivable` | Variance |
|---|---|---|---|
| 2026-05 | 250,900.00 | 250,900.00 | **0.00** ✅ |
| 2026-06 | 237,000.00 | 237,000.00 | **0.00** ✅ |

The Balance Sheet itself also balances at 2026-06: Total Assets 519,363.38 = Total Liabilities
116,358.64 + Total Equity 403,004.74. And Deferred Revenue ties GL to BS at 39,999.99.

So the AR **control total is trustworthy**. What is missing is the **detail beneath it** — who owes
it, since when, and against which invoice.

---

## Step 5 — Consolidated file read-back

No prior `ar-controller-consolidator` shared file exists for Wildcard. No `ARM-` rows with an
`FM Decision` to reconcile. First run.

## Step 6 — Execution completeness scoring

| Component | Weight | Result |
|---|---|---|
| Client Isolation Check before any read/write | — | ✅ |
| Pre-flight gate confirmed | — | ✅ |
| Materiality lookup ran all 3 tiers before giving up | — | ✅ (not defaulted) |
| Source located, read, and validated | — | ✅ 19,039 GL rows parsed, 335 AR lines isolated |
| Aging computed | high | ❌ not computable — source lacks due dates + invoice-level balance |
| DSO computed | med | ⚠️ computed with a disclosed proxy denominator |
| CEI computed | med | ❌ `null` — dependent on the failed aging |
| Concentration computed | high | ❌ not computable — no customer on any AR line |
| Data-integrity findings raised rather than absorbed | — | ✅ 4 deterministic Critical findings |
| GL↔BS tie-out + rollforward independently verified | — | ✅ both tie to 0.00 |
| Every read-path item inspected | low | ❌ 5 image-only PDFs unreadable |

**execution_completeness = 0.70** — exactly at `execution_completeness_review_threshold` (0.70,
fixed). Status is `needs_review`, not `escalated`, on completeness grounds; the Critical findings
below drive their own escalations independently.

## Step 7 — FM approval gate

Non-blocking status write — this ran inside the full pipeline. Status handed to
`ar-controller-orchestrator`.

---

## Escalations

```json
"escalations": [
  {
    "target_agent": "FM",
    "reason": "AR aging is not computable for any period. The configured source (wildcard-fuel / GL Accu) carries no due date, no invoice number, and no invoice-level balance; Event External ID is unique per GL line so invoices and payments share no key. Findings ARM-2026-06-001, -003 and -004.",
    "severity": "critical",
    "required_action": "Supply an AR source at invoice grain carrying invoice number, invoice date, due date, total and balance. Stripe holds the invoices and is already live with viewer access per ctx_05 - that is the most likely source. The GL is the correct source for the AR control total but cannot support aging."
  },
  {
    "target_agent": "FM",
    "reason": "Customer identity is absent from every AR record (0 of 335 lines), so top-N concentration, the configured customer dimension, and any per-customer AR view are all unavailable. Counterparty Name is populated on 40.7% of the wider GL but on none of the receivable side. Finding ARM-2026-06-002.",
    "severity": "critical",
    "required_action": "Get customer name onto the AR record. Confirm with Gohar Sahakyan whether Puzzle can emit counterparty on receivable postings, or take customer identity from Stripe alongside the invoice detail."
  },
  {
    "target_agent": "FM",
    "reason": "Materiality threshold and basis are both MISSING in ctx_17. All three permitted lookup tiers were exhausted without a value. No number was defaulted.",
    "severity": "high",
    "required_action": "Confirm materiality threshold and basis with Wildcard's accounting team and record them in ctx_17_accounting-policy-framework.md. Until then no materiality-gated finding in this workflow can fire."
  },
  {
    "target_agent": "FM",
    "reason": "DSO of 19.53 days was computed using total GL revenue (364,000.00) as a proxy for credit sales, because credit sales are not separately identifiable in this source. Any 2026-06 revenue not sold on credit overstates the denominator, so true DSO is higher.",
    "severity": "medium",
    "required_action": "Confirm what share of 2026-06 revenue was sold on credit, or supply a credit-sales figure. Treat 19.53 days as a floor until then."
  },
  {
    "target_agent": "FM",
    "reason": "Period 2026-06 books were not closed by the prior bookkeeper (Central) as of 2026-08-11 per ctx_16 - an active, unresolved escalation. Every figure in this report is drawn from a period whose books may not be final.",
    "severity": "high",
    "required_action": "Confirm 2026-06 is final before relying on the 237,000.00 AR balance or the 19.53-day DSO, or re-run once the period closes."
  }
]
```

---

## Output summary

| Deliverable | Result |
|---|---|
| Aging buckets | ❌ not computable |
| DSO | ⚠️ **19.53 days** (proxy denominator, treat as floor) |
| CEI | ❌ `null` |
| Top-5 customer concentration | ❌ not computable |
| AR control total 2026-06 | ✅ **$237,000.00**, ties to BS at 0.00 variance |
| AR rollforward 2026-06 | ✅ ties at 0.00 variance |
| Findings | 4 deterministic, all Critical |

---

*`ar-aging-metrics` v1 — 2026-06 Wildcard — status: needs_review*
