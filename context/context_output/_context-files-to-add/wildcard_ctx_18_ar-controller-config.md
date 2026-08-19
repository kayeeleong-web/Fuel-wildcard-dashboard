---
client: Wildcard
context_layer: AR Controller Config
file: wildcard_ctx_18_ar-controller-config.md
last_updated: August 2026
updated_by: FM
status: Active
context_maturity: Baseline
---

# Wildcard — AR Controller Config

> **How to use this file:** move this file into the client's context folder alongside
> `wildcard_ctx_01` … `wildcard_ctx_17`. `ar-controller-input-agent` reads it at runtime as
> `ar_controller_config`. It was produced by the AR setup interview with the FM on 2026-08-19 —
> nothing in it is inferred.

| Date | Updated by | Changes |
|---|---|---|
| 2026-08-19 | FM (Ka Yee) | Initial build via AR setup interview |

---

## Data source

| Field | Value |
|---|---|
| `dataSource` | `csv-excel` — via Google Sheet |
| Workbook | `wildcard-fuel` (Google Sheet, owner kayeeleong@fuelfinance.me) |
| Sheet ID | `1GCoZnkreQsD3pAmzNoyzNo_zIrZsAWTx55Zgkp83CmM` |
| Tab | **`GL Accu`** — accrual-view general ledger, 19,039 data rows, posting periods 2024-04 → 2026-06 |
| Alternate tab | `GL Cash` — cash-view GL, 17,474 rows. Not used for AR: the accrual view is the correct basis (`ctx_17` confirms accrual method). |
| AR accounts | `12000` Accounts Receivable. Category range per the workbook's `COA` tab: 12000–12199 = Accounts Receivable. |
| Related | `12200` Processor Receivable: Stripe and `12480` Processor Receivables: Clearing sit in the separate 12200–12999 "Processor Receivables" category and are **not** AR for this workflow's purposes. |
| Confirmed by | FM, 2026-08-19 |

**Field availability in this source — recorded because it constrains what the Sub-agents can do:**

| Field the workflow needs | Present in `GL Accu`? |
|---|---|
| Amount | ✅ 100% |
| Account ID / Account Name | ✅ 100% |
| Posting period / effective date | ✅ 100% |
| Event type (`invoice_issued`, `receivable_payment_made`, …) | ✅ 100% |
| **Customer / counterparty name** | ❌ **0 of 335 AR lines, all periods** |
| **Invoice number** | ❌ absent |
| **Due date** | ❌ absent |
| **Invoice-level balance** | ❌ absent — `Event External ID` is unique per GL line (335 IDs / 335 lines), so invoices and payments carry no shared key |

---

## Dimensions

| Field | Value |
|---|---|
| `dimensions` | `["customer"]` — customer only |
| FM note | Campaign and sales-rep dimensions deliberately **not** enabled. Campaign data lives in the Wildcard internal Postgres DB, "not yet connected — Phase 2, Month 4+" per `ctx_05`. Sales-rep data exists in the "Wildcard Internal" Google Sheet but is not on the AR record. |
| ⚠️ Standing gap | The chosen dimension is **customer**, and the chosen source carries **no customer field**. Until customer identity reaches the AR record, this dimension cannot be populated. See the escalation in `ar-aging-metrics`. |

---

## Aging buckets

| Bucket | Boundary (days) |
|---|---|
| Current | not yet due |
| 1–30 | past due |
| 31–60 | past due |
| 61–90 | past due |
| 90+ | past due |

Oldest configured boundary = **90 days** — this is the boundary
`ar-collections-review` would use for its ownership-gap check, if that flag were on.

---

## Feature flags

| Flag | State | Basis |
|---|---|---|
| `dsoCei` (DSO / CEI / concentration) | **ON** | FM, 2026-08-19 |
| `collectionsWorkflow` | **OFF** | No follow-up dates, promises-to-pay, or collections owner tracked anywhere. Homegrown CRM not connected (`ctx_05`); no collections log found. Orchestrator skips `ar-collections-review`. |
| `disputeCreditHold` | **OFF** | No dispute status, no credit limits, no credit-hold policy documented in `ctx_03` or `ctx_11`. Orchestrator skips `ar-dispute-credit-review`. |
| `cashApplication` | **ON** | FM, 2026-08-19. Payment events are present in `GL Accu` as `receivable_payment_made`. |

**Concentration top-N:** 5 (default — not overridden by the FM).

---

## Known constraints carried into every run

1. **Materiality threshold is unavailable.** `ctx_17_accounting-policy-framework.md` records both
   `Materiality threshold` and `Materiality basis` as ❌ MISSING. Per every Sub-agent's Section 2,
   `ctx_17` is the **only** permitted source — this config must **not** be used as a fallback, and
   no threshold is set here. Every materiality-gated escalation stays unevaluable until `ctx_17` is
   filled in.
2. **Fiscal year end is unavailable** (`ctx_01`, ❌ MISSING — ask Brennan Keough).
3. **Period 2026-06 books were not closed** by the prior bookkeeper (Central) as of 2026-08-11 per
   `ctx_16` — active, unresolved.

---

*Produced by the AR setup interview, 2026-08-19. Confirmed by FM (Ka Yee) — no field inferred.*
