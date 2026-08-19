---
client: Wildcard
context_layer: AP Controller Config
file: wildcard_ctx_19_ap-controller-config.md
last_updated: August 2026
updated_by: FM
status: Partial
context_maturity: Baseline
---

# Wildcard — AP Controller Config

> **How to use this file:** move this file into the client's context folder alongside
> `wildcard_ctx_01` … `wildcard_ctx_17`. `ap-controller-input-agent` reads it at runtime as
> `ap_controller_config`. Produced by the AP setup interview with the FM on 2026-08-19.

| Date | Updated by | Changes |
|---|---|---|
| 2026-08-19 | FM (Ka Yee) | Initial build via AP setup interview |

---

## Data source — **HELD**

| Field | Value |
|---|---|
| `dataSource` | **`held` — no AP subledger exists for this client** |
| FM decision | 2026-08-19: record the absence as the finding; do **not** substitute a proxy dataset. |

**Evidence for the hold, verified against the `wildcard-fuel` workbook on 2026-08-19:**

| Check | Result |
|---|---|
| Balance Sheet `Accounts Payable` | **$0.00 in all 27 months** (2024-04 → 2026-06) |
| An AP account in the chart of accounts | **None.** The workbook's `COA` tab has no Accounts Payable category range at all — liabilities run Credit Card Payable (20000–23999), Deferred Revenue (24000–24999), Current Liabilities (25000–25199), Other Current Liabilities, Non Current Liability. |
| Accounts named like AP | Of **65 distinct account names** in `GL Accu`, the only match for `payable\|vendor\|bill\|supplier\|trade` is `21001 American Express -- Delta Reserve Business Card -- 1002 Payable` — a credit-card payable, not trade AP. |
| `25100 Accrued Expenses` | 4 GL lines in the entire 27-month history, cumulative balance **$0.00** |
| Current Liabilities (25000–25199) balance | **$0.00 in every one of the last 12 periods** |

**Why:** per `ctx_03` and `ctx_12`, Wildcard pays by Amex credit card (campaign materials, charged by
individual team members) or by immediate bank payment (Vetric, Altia, Demand Collective, Central,
rent). Nothing is booked as an open payable, so there are no bills to age, no due dates, no payment
terms, and no discount deadlines.

**Rejected alternative, recorded for completeness.** A proxy built on `21001` (balance **$73,358.65**
owed at 2026-06) joined to its expense siblings by `Journal Entry ID` **does** recover vendor
identity on **875 of 884** 2026-06 card lines (99.0%), yielding 216 distinct vendors and $81,621.02
of gross spend. The FM declined this path on 2026-08-19: card charges are not AP bills, and
presenting them as AP output would misrepresent the control being tested. Available to switch on
later as an explicit, separately-labelled analysis.

---

## Dimensions

| Field | Value |
|---|---|
| `dimensions` | `["vendor"]` — not yet exercisable while `dataSource` is held |

---

## Aging buckets

| Bucket | Boundary (days) |
|---|---|
| Current | not yet due |
| 1–30 | past due |
| 31–60 | past due |
| 61–90 | past due |
| 90+ | past due |

Set for symmetry with `ctx_18`. Not exercisable while `dataSource` is held.

---

## Approval tiers — ⚠️ **PROVISIONAL, NOT CLIENT-APPROVED**

| Max amount | Approver |
|---|---|
| ≤ $1,000 | Team member — no approval required |
| $1,001 – $5,000 | Co-founder |
| > $5,000 | Brennan Keough |

> ⚠️ **These tiers were invented for test purposes on 2026-08-19 at the FM's explicit direction.
> They are not Wildcard's real approval policy.** `ctx_03_business-rules-policies.md` records
> `Approval logic (who approves what spend)`, `Expense thresholds`, and `Reimbursement rules` all as
> ❌ MISSING — "ask Brennan Keough in first working session."
>
> **Any `ap-approval-controls` finding produced against these tiers is indicative only and must not
> reach the client, or any client-facing report, as a control conclusion.** Replace with Brennan's
> real policy before this flag produces anything relied upon.

---

## Feature flags

| Flag | State | Basis |
|---|---|---|
| `dpo` | **ON** | FM, 2026-08-19. Denominator is available (GL COGS 2026-06 = $42,395.75) but the numerator (AP balance) is $0.00, so DPO computes as 0.00 days — arithmetically correct, analytically empty. |
| `discountCapture` | **ON** | FM, 2026-08-19. No discount terms documented for any of `ctx_12`'s 6 vendors; card charges carry no terms. Expect zero findings. |
| `approvalQueue` | **ON** | FM, 2026-08-19. Runs against the provisional tiers above — see the warning. |
| `duplicateDetection` | **ON** | FM, 2026-08-19. Highest-value flag for this client — `ctx_12` calls unreconciled campaign-material card spend the "biggest flagged pain point." |
| `threeWayMatch` | **OFF** | FM, 2026-08-19. No PO or receiving system in `ctx_05`'s connected tools; `ctx_12` describes purchasing as individual team members charging Amex directly. A PO→receipt→invoice chain does not exist. Orchestrator skips `ap-three-way-match`. |

| `poRequiredThreshold` | **not set** — `threeWayMatch` is off, so per that Sub-agent's Section 3 no threshold is guessed. |
|---|---|

**Duplicate-detection tolerance / window:** not overridden — Sub-agent defaults apply.

**Concentration top-N:** 5 (default).

---

## ⚠️ Internal tension in this config — flagged, not resolved

`dataSource` is **held** (no AP dataset), while four feature flags are **ON**. These cannot both be
satisfied in the same run: an enabled Sub-agent with no dataset escalates rather than producing
findings.

Read as the FM's intent: the flags record **which checks should run once AP is actually booked**,
while **this period's run is held**. That is how the 2026-06 run was executed — all four enabled
Sub-agents escalated for absence of dataset, none produced findings. To get real numbers this
period instead, switch `dataSource` to the `21001` proxy described above.

---

## Known constraints carried into every run

1. **Materiality threshold unavailable** — `ctx_17` records threshold and basis as ❌ MISSING.
   `ctx_17` is the only permitted source; this config sets no fallback.
2. **COGS reliability** — `ctx_08` flags that headcount is not split between COGS and OPEX
   consistently with Brennan's Operating Model, so COGS account identification is not fully
   trustworthy even though a figure is computable.
3. **Period 2026-06 books were not closed** by Central as of 2026-08-11 per `ctx_16`.

---

*Produced by the AP setup interview, 2026-08-19. Approval tiers are provisional and FM-flagged.*
