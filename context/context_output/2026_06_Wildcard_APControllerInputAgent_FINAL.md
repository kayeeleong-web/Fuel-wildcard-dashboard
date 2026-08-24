# AP Controller Input Agent — 2026-06 Wildcard — v2

| Field | Value |
|---|---|
| Agent | `ap-controller-input-agent` |
| Client | Mems Studio, Inc. DBA Wildcard | Period | 2026-06 |
| Generated at | 2026-08-19 | Execution ID | AP-IN-20260819-002 |
| Status | **needs_review** (v1 was `escalated`) |
| execution_completeness | **0.85** |
| Risk level | **high** |
| Supersedes | `…_v1.md` — that version's blocking escalation has been resolved |

---

## What changed since v1

v1 escalated at Step 2: `ap_controller_config` did not exist. The FM resolved it:

| v1 blocker | Resolution |
|---|---|
| `ap_controller_config` absent | AP setup interview run 2026-08-19 → `ctx_19_ap-controller-config.md` produced. |
| No AP data in the read path | **Investigated against the new `wildcard-fuel` workbook and confirmed as a genuine absence, not a missing file.** FM set `dataSource = held`. |

## Step 2 — Read `ap_controller_config` — PASSED

`ctx_19_ap-controller-config.md` present. `dataSource = **held**`. Flags: `dpo` **ON**,
`discountCapture` **ON**, `approvalQueue` **ON**, `duplicateDetection` **ON**, `threeWayMatch`
**OFF**. Approval tiers: ⚠️ **provisional, FM-flagged, not client-approved**. `poRequiredThreshold`
deliberately unset.

## Step 3 + Step 4 — Sub-agent declared needs, re-checked against the new source

**The controlling finding, established by direct verification of the workbook:**

| Check | Result |
|---|---|
| BS `Accounts Payable`, all 27 months | **0.00 in every month** |
| AP category range in the workbook's `COA` tab | **none exists** |
| Accounts matching `payable\|vendor\|bill\|supplier\|trade` among 65 GL account names | **1** — the Amex card payable, not trade AP |
| `25100 Accrued Expenses` | 4 lines in 27 months, cumulative 0.00 |
| Current Liabilities 25000–25199, last 12 periods | 0.00 in every period |

| Sub-agent | Need | Status |
|---|---|---|
| — | `ctx_19_ap-controller-config.md` | ✅ **found** (produced this session) |
| `ap-aging-metrics` | AP bill/balance export | ❌ **does not exist** — no bills are booked |
| `ap-aging-metrics` | COGS in period (DPO denominator) | ✅ **found** — GL 50000–59999, 2026-06 = 42,395.75. Caveat: `ctx_08` flags the COGS/OPEX headcount split as inconsistent, so not fully trustworthy. |
| `ap-aging-metrics` | `ctx_08` AP + COGS account mapping | ⚠️ resolved from the workbook's `COA` tab; `ctx_08` itself names no AP account (correctly — none exists) |
| `ap-discount-capture` | `discountTerms` / `discountDeadline` / `discountCaptured` / `discountAmount` | ❌ **do not exist**, and no discount terms are documented for any of `ctx_12`'s 6 vendors |
| `ap-duplicate-detection` | `billNum` / `paymentStatus` | ❌ **do not exist** |
| `ap-approval-controls` | `approvalStatus` / `approvalTier` | ❌ **do not exist** as fields in any Wildcard source; `ctx_05` lists no approval platform |
| `ap-approval-controls` | Real approval tiers | ⚠️ **provisional only** — `ctx_03` records approval logic, expense thresholds, reimbursement rules all MISSING |
| `ap-three-way-match` | — | ⏭ **not required** — flag OFF |
| all | `ctx_17` materiality | ❌ **missing** — threshold and basis both MISSING |
| all | `data_quality_flags` | absent — no prior-period run |

**Version-disambiguation:** not applicable — no AP export candidate exists to choose between.

## Step 5 — Consolidated ask to the FM (asked once)

1. **The root decision: should Wildcard begin booking vendor bills to AP?** Until then the AP Controller
   Workflow cannot produce a valid result in any period.
2. **Real approval logic from Brennan Keough** (`ctx_03` first-working-session item) → then replace the
   provisional tiers in `ctx_19`.
3. **Materiality threshold + basis** → `ctx_17`.
4. **Period-end cut-off handling** for card spend straddling month end, with Gohar Sahakyan — there is
   no AP or accrual register to rely on.
5. **Confirmation that 2026-06 is closed** — `ctx_16`, unresolved as of 2026-08-11.
6. **Optional:** authorise the `21001` card-payable proxy as an explicitly separate analysis. Verified
   viable — 875 of 884 2026-06 lines recover a vendor via `Journal Entry ID` join (99.0%), 216 vendors,
   $81,621.02 gross. Declined by the FM on 2026-08-19; available on request.

## Step 6 — Execution completeness

| Component | Result |
|---|---|
| Client Isolation Check before any read/write | ✅ |
| `ap_controller_config` read and present | ✅ |
| All 5 Sub-agents' declared needs walked | ✅ 5 / 5 |
| Dataset absence verified against the source (5 independent checks) rather than assumed | ✅ |
| Proxy viability tested and quantified so the FM could decide on evidence | ✅ |
| One consolidated ask | ✅ |
| Every read-path item inspected | ❌ 5 image-only PDFs unreadable (−0.15) |

**execution_completeness = 0.85.** Above the 0.70 threshold. The absent AP dataset is a Group A gap —
surfaced, not skipped — and is not a deduction against this agent's own execution.

## Step 7 — FM approval gate [Gate 1 of 2] — **PASSED**

FM accepted the documented gaps on 2026-08-19 and authorised sequencing. The four ON-flag Sub-agents
proceeded (each escalating for absence of dataset); `ap-three-way-match` was skipped.

---

*`ap-controller-input-agent` v2 — 2026-06 Wildcard — status: needs_review — Gate 1 passed*
