# AR Controller Input Agent — 2026-06 Wildcard — v2

| Field | Value |
|---|---|
| Agent | `ar-controller-input-agent` |
| Client | Mems Studio, Inc. DBA Wildcard | Period | 2026-06 |
| Generated at | 2026-08-19 | Execution ID | AR-IN-20260819-002 |
| Status | **needs_review** (v1 was `escalated`) |
| execution_completeness | **0.85** |
| Risk level | **high** |
| Supersedes | `…_v1.md` — that version's blocking escalation has been resolved |

---

## What changed since v1

v1 escalated at Step 2: `ar_controller_config` did not exist for Wildcard, and this agent is not
responsible for running the setup interview itself. The FM resolved it:

| v1 blocker | Resolution |
|---|---|
| `ar_controller_config` absent | AR setup interview run 2026-08-19 → `ctx_18_ar-controller-config.md` produced. Data source, dimensions, aging buckets and all 4 feature flags FM-confirmed, none inferred. |
| No AR data anywhere in the read path | **FM supplied a new source**: Google Sheet `wildcard-fuel` (ID `1GCoZnkreQsD3pAmzNoyzNo_zIrZsAWTx55Zgkp83CmM`), tab **`GL Accu`**. Located, read and validated — 19,039 GL rows, posting periods 2024-04 → 2026-06. |

## Step 2 — Read `ar_controller_config` — PASSED

`ctx_18_ar-controller-config.md` present. `dataSource = csv-excel` via Google Sheet, tab `GL Accu`.
Flags: `dsoCei` **ON**, `cashApplication` **ON**, `collectionsWorkflow` **OFF**,
`disputeCreditHold` **OFF**. Buckets: Current / 1–30 / 31–60 / 61–90 / 90+. Dimensions: `["customer"]`.

## Step 3 + Step 4 — Sub-agent declared needs, re-checked against the new source

| Sub-agent | Need | Status |
|---|---|---|
| — | `ctx_18_ar-controller-config.md` | ✅ **found** (produced this session) |
| `ar-aging-metrics` | AR data, invoice grain | ⚠️ **partial** — 335 AR GL lines found on accounts 12000–12199, but at **GL-line grain, not invoice grain** |
| `ar-aging-metrics` | Customer name | ❌ **missing** — 0 of 335 lines |
| `ar-aging-metrics` | Invoice number | ❌ **missing** — field does not exist |
| `ar-aging-metrics` | Due date | ❌ **missing** — field does not exist |
| `ar-aging-metrics` | Invoice-level balance | ❌ **missing** — `Event External ID` unique per line, so issues and payments share no key |
| `ar-aging-metrics` | Credit sales in period (DSO) | ⚠️ **proxy available** — GL revenue 2026-06 = 364,000.00; credit sales not separately identifiable |
| `ar-aging-metrics` | Beginning AR (CEI) | ✅ **found** — 250,900.00 at 2026-05 close |
| `ar-aging-metrics` | `ctx_01` entity / currency | ✅ found (fiscal year end still ❌ MISSING) |
| `ar-aging-metrics` | `ctx_08` AR account mapping | ⚠️ `ctx_08` is `Partial` and names no AR account — but the workbook's own `COA` tab supplies the range (12000–12199 = Accounts Receivable), which resolves it |
| `ar-aging-metrics` | `ctx_17` materiality | ❌ **missing** — threshold and basis both MISSING; `ctx_17` is the only permitted source |
| `ar-cash-application` | Payments feed | ⚠️ **partial** — 13 `receivable_payment_made` events found for 2026-06, $305,900.00, but with no remittance detail |
| `ar-cash-application` | Applied-invoice linkage | ❌ **missing** — not represented in the source at all |
| `ar-cash-application` | `ctx_03` turnaround expectation | ❌ **missing** — not documented |
| `ar-collections-review` | — | ⏭ **not required** — flag OFF |
| `ar-dispute-credit-review` | — | ⏭ **not required** — flag OFF |
| all | `data_quality_flags` | absent — no prior-period run |

**Version-disambiguation:** exactly one candidate workbook was named by the FM, and one tab within it.
`GL Cash` was considered and rejected on a documented basis — `ctx_17` confirms accrual method, so the
accrual view is correct for AR. No file was resolved by filename convenience.

## Step 5 — Consolidated ask to the FM (asked once)

1. **AR data at invoice grain** — invoice number, invoice date, **due date**, total, balance,
   **customer**. The `GL Accu` tab is the right source for the AR *control total* and the wrong grain
   for AR *detail*. Stripe is ✅ live with viewer access (`ctx_05`) and holds the invoices.
2. **Materiality threshold + basis** → `ctx_17`.
3. **Credit-sales figure** for 2026-06, or confirmation of what share of the 364,000.00 was sold on
   credit.
4. **A payments feed with remittance detail** (Chase, or Chase + Stripe — `ctx_03` records most
   customers pay by ACH, so Stripe alone is insufficient), or switch `cashApplication` OFF.
5. **Payment-application turnaround expectation** → `ctx_03`.
6. **Fiscal year end** → `ctx_01`.
7. **Confirmation that 2026-06 is closed** — `ctx_16` records June books as not closed by Central as of
   2026-08-11, unresolved.

## Step 6 — Execution completeness

| Component | Result |
|---|---|
| Client Isolation Check before any read/write | ✅ |
| `ar_controller_config` read and present | ✅ |
| All 4 Sub-agents' declared needs walked | ✅ 4 / 4 |
| New source located, parsed and field-validated before asking the FM | ✅ 19,039 rows |
| Version-disambiguation applied with a documented basis | ✅ |
| One consolidated ask | ✅ |
| Every read-path item inspected | ❌ 5 image-only PDFs unreadable (−0.15) |

**execution_completeness = 0.85.** Above the 0.70 threshold. Genuinely-absent fields are Group A gaps
— surfaced, not silently skipped — and are not deductions against this agent's own execution.

## Step 7 — FM approval gate [Gate 1 of 2] — **PASSED**

FM accepted the documented gaps on 2026-08-19 and authorised Sub-agent sequencing. `ar-aging-metrics`
and `ar-cash-application` proceeded; the two OFF-flag Sub-agents were skipped.

---

*`ar-controller-input-agent` v2 — 2026-06 Wildcard — status: needs_review — Gate 1 passed*
