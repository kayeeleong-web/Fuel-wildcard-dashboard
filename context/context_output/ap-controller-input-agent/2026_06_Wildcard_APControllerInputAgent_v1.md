# AP Controller Input Agent — 2026-06 Wildcard

| Field | Value |
|---|---|
| Agent | `ap-controller-input-agent` |
| Workflow | AP Controller Workflow |
| Client | Mems Studio, Inc. DBA Wildcard |
| Period | 2026-06 |
| Generated at | 2026-08-19 |
| Execution ID | AP-IN-20260819-001 |
| Status | **escalated** |
| execution_completeness | **0.85** |
| Risk level | **critical** |

---

## Step 1 — Client Isolation Check [HARD BLOCK] — PASSED

| Item | Confirmed value |
|---|---|
| Client | Mems Studio, Inc. DBA Wildcard (single legal entity, USD only) |
| Period | 2026-06 |
| Read path | `C:\Users\kayee\OneDrive\Desktop\Wildcard Vercel Project\context\` |
| Write path | `C:\Users\kayee\OneDrive\Desktop\Wildcard Vercel Project\context\context_output\` |
| Confirmed by | FM (Ka Yee), 2026-08-19, explicit selection — not inferred |

---

## Step 2 — Read `ap_controller_config` — FAILED, ESCALATION TRIGGERED

`ap_controller_config` (`ctx_19_ap-controller-config.md`) **does not exist for this client.**

Read path contains `ctx_01` through `ctx_17` only. No `ctx_19`, and nothing matching
`*ap*controller*config*` anywhere in the project.

Per Section 2, this agent **does not run the AP setup interview itself** — data source, dimensions,
aging buckets, **approval tiers**, and the 5 feature flags are all unknown, and none may be guessed.

**Consequence:** all five Sub-agents are unrunnable:

| Sub-agent | Gating flag | Can it be sequenced? |
|---|---|---|
| `ap-aging-metrics` | DPO / concentration | No — needs aging buckets + top-N from config |
| `ap-discount-capture` | `discountCapture` | No — flag state unknown |
| `ap-duplicate-detection` | `duplicateDetection` | No — flag state unknown; tolerance/window override unknown |
| `ap-approval-controls` | `approvalQueue` | No — **and the approval tiers themselves live only in config** |
| `ap-three-way-match` | `threeWayMatch` | No — **and `poRequiredThreshold` lives only in config** |

---

## Step 3 + Step 4 — Sub-agent declared needs, checked against the Inputs folder

### Blocking config

| Need | Status |
|---|---|
| `ctx_19_ap-controller-config.md` — dataSource, dimensions, aging buckets, real approval tiers, 5 feature flags | **missing** |

### `ap-aging-metrics`

| Need | Status | Note |
|---|---|---|
| Bill-level AP export — vendor name, bill number, bill date, due date, total, balance | **missing** | No CSV/XLSX/Sheet export in the read path. Required fields, not a required report shape. |
| COGS-in-period figure (DPO denominator) | **missing** | `ctx_06` puts COGS in Puzzle; `ctx_05` records Puzzle has **no usable API** — a confirmed dead end. Per Section 3, DPO returns `—`, never an estimate and never a WADO proxy. |
| `ctx_01` — entity, fiscal year, currency | **found** | Entity + USD confirmed. Fiscal year end ❌ MISSING in `ctx_01`. |
| `ctx_08` — AP account mapping + COGS account identification | **found, insufficient** | `ctx_08` status `Partial`; names no AP account. It *does* flag a live problem: **headcount is not split between COGS and OPEX** the way Brennan's Operating Model splits it, driving inconsistent gross margin. COGS account identification is therefore not reliable today. |
| `ctx_17` — materiality threshold + basis | **missing** | Both ❌ MISSING in `ctx_17`. Section 3 marks this **the only source** for the concentration-risk escalation. |
| `data_quality_flags` | **absent** | No prior-period run. |

### `ap-discount-capture`

| Need | Status | Note |
|---|---|---|
| AP export with `discountTerms`, `discountDeadline`, `discountCaptured`, `discountAmount` | **missing** | No early-payment discount terms are documented for **any** vendor in `ctx_12_vendor-classification.md`. Six vendor rows, zero discount terms. |
| `ctx_17` materiality | **missing** | As above. |

> Even once wired, this Sub-agent may legitimately return zero findings — Wildcard's vendor base
> (Amex card charges to Amazon/Etsy/custom makers, plus a handful of recurring bank-paid vendors)
> shows no evidence of negotiated early-payment discount terms.

### `ap-duplicate-detection`

| Need | Status | Note |
|---|---|---|
| AP export with `vendorName`, `total`, `balance`, `billDate`, `billNum`, `status.paymentStatus` | **missing** | — |
| Client override of default tolerance/window | **unknown** | Lives in `ap_controller_config`. |
| `ctx_17` materiality | **missing** | Note: the *definitively-unpaid* duplicate path always escalates regardless of materiality; only the general path needs the threshold. |

> **Highest-value Sub-agent for this client once data arrives.** `ctx_12` records 150–300
> surfboard-type campaign purchases per month, charged to Amex **by individual team members**, with
> **no reconciliation to campaign-level actuals** — described as the *"biggest flagged pain point"*.
> That is precisely the profile in which duplicate payments hide.

### `ap-approval-controls`

| Need | Status | Note |
|---|---|---|
| AP export with `total`, `status.approvalStatus`, `status.approvalTier` | **missing** | — |
| This client's real approval tiers (max amount → approver) | **missing** | Lives in `ap_controller_config`, which does not exist. |
| `ctx_03` — documented approval-policy nuance | **missing** | `ctx_03` records `Approval logic (who approves what spend): ❌ MISSING — ask Brennan Keough in first working session`. `Expense thresholds: ❌ MISSING`. `Reimbursement rules: ❌ MISSING`. |

> **This Sub-agent has no policy to test against from either of its two sources.** Both
> `ap_controller_config` and `ctx_03` are empty on approval logic. It cannot run even with a perfect
> AP export.

### `ap-three-way-match`

| Need | Status | Note |
|---|---|---|
| `PurchaseOrderRecord` set for 2026-06 | **missing** | — |
| PO/receiving system access | **not available** | No PO or receiving system appears anywhere in `ctx_05`'s connected-tools table. `ctx_12` describes purchasing as individual team members charging Amex directly — a workflow with no PO step. |
| `poRequiredThreshold` | **missing** | Section 3 is explicit: genuinely client-specific, must come from `ap_controller_config`, **escalate rather than guessing a number**. |
| Which vendor categories are expected to carry a PO | **missing** | Lives in config. |
| `ctx_17` materiality | **missing** | As above. |

> **Recommend this flag be set OFF for Wildcard.** Three-way match presupposes a PO→receipt→invoice
> chain. Wildcard has no PO system and its dominant spend pattern is ad-hoc card purchases. Turning
> this flag on would produce a wall of "missing PO" findings that reflect the absence of a process,
> not exceptions within one. This is an FM decision, recorded here as a flag, not acted on.

---

## Version-disambiguation

Not applicable — **zero** candidate AP export files were found for 2026-06.

---

## Read-path items this agent could NOT inspect

Same five image-only PDFs as the AR run — no text layer, no OCR tooling available. `wc.pdf`
(single embedded RGB image) has undetermined content. Sole deduction against this agent's own
`execution_completeness`.

---

## Step 5 — Consolidated ask to the FM (asked once)

**To unblock `ap_controller_config` — complete Wildcard's one-time AP setup interview:**

1. **Data source kind** — `csv-excel` / `qbo` / `ap-agent-output` / `ap-controls-agent-output` /
   `custom:<name>`. Note: Puzzle has no usable API; the QBO migration is an open decision; neither
   `ap-agent` nor `ap-controls-agent` exists in this repo, so those two paths are not viable today.
2. **Custom dimensions** — any slicing beyond vendor (e.g. campaign, cost centre).
3. **Aging buckets** — bucket boundaries in days.
4. **Approval tiers** — the real max-amount → approver ladder. Requires the answer to `ctx_03`'s
   open question for Brennan Keough.
5. **`poRequiredThreshold`** — only if `threeWayMatch` is switched on.
6. **Feature flags** — on/off for each: DPO, `discountCapture`, `approvalQueue`,
   `duplicateDetection`, `threeWayMatch`. See the `ap-three-way-match` recommendation above.

**To unblock the period data — supply for 2026-06:**

7. **AP bill/balance export** carrying vendor name, bill number, bill date, due date, total,
   balance — plus the status fields for whichever flags are switched on.
8. **COGS-in-period figure**, if DPO is switched on. Blocked upstream by the Puzzle API dead end and
   by the unresolved headcount COGS/OPEX split.
9. **Purchase-order records**, only if `threeWayMatch` is switched on.

**To unblock every Sub-agent's escalation path:**

10. **Materiality threshold + materiality basis** in `ctx_17_accounting-policy-framework.md`.

---

## Step 6 — Execution completeness scoring

| Component | Result |
|---|---|
| Client Isolation Check completed before any read/write | ✅ |
| `ap_controller_config` read attempted and absence surfaced, not guessed | ✅ |
| All 5 Sub-agents' Section 5 declared needs walked | ✅ 5 / 5 |
| Read path checked before asking the FM for anything | ✅ |
| One consolidated ask produced | ✅ |
| Version-disambiguation applied | ✅ (vacuous — no candidates) |
| Every read-path item inspected | ❌ 5 image-only PDFs unreadable (−0.15) |

**execution_completeness = 0.85** — above `execution_completeness_review_threshold` (0.70, fixed).

---

## Escalations

```json
"escalations": [
  {
    "target_agent": "FM",
    "reason": "ap_controller_config (ctx_19_ap-controller-config.md) does not exist for Wildcard. Data source, dimensions, aging buckets, approval tiers, poRequiredThreshold, and all 5 feature flags are unknown. No Sub-agent can be sequenced.",
    "severity": "critical",
    "required_action": "Complete Wildcard's one-time AP setup interview and save the result as ctx_19_ap-controller-config.md in the read path."
  },
  {
    "target_agent": "FM",
    "reason": "No AP bill/balance export for 2026-06 exists in the read path. All five Sub-agents have no dataset.",
    "severity": "critical",
    "required_action": "Supply the 2026-06 AP export with vendor name, bill number, bill date, due date, total, and balance, plus the status fields required by whichever feature flags are enabled."
  },
  {
    "target_agent": "FM",
    "reason": "ap-approval-controls has no approval policy available from either of its two declared sources. ap_controller_config does not exist, and ctx_03_business-rules-policies.md records approval logic, expense thresholds, and reimbursement rules all as MISSING.",
    "severity": "critical",
    "required_action": "Get Wildcard's approval logic from Brennan Keough — already flagged in ctx_03 as a first-working-session item — then encode it as approval tiers in ap_controller_config. Until then ap-approval-controls cannot run even with a complete AP export."
  },
  {
    "target_agent": "FM",
    "reason": "ap-three-way-match requires a PO/receiving system. No such system appears in ctx_05's connected tools, and ctx_12 describes purchasing as individual team members charging Amex directly with no PO step. poRequiredThreshold is also unset.",
    "severity": "high",
    "required_action": "Decide whether threeWayMatch should be OFF for Wildcard. Recommendation flagged (not decided) in this report: OFF, because the absence of a PO process would generate findings that describe a missing process rather than exceptions within one."
  },
  {
    "target_agent": "FM",
    "reason": "DPO denominator (COGS in period) is unreachable. ctx_06 places COGS in Puzzle; ctx_05 records Puzzle has no usable API, confirmed dead end. ctx_08 additionally flags that headcount is not split between COGS and OPEX consistently, so COGS account identification is not reliable today.",
    "severity": "high",
    "required_action": "Supply the 2026-06 COGS figure manually, or resolve the QBO migration decision. Per ap-aging-metrics Section 3, DPO returns a dash rather than an estimate until then."
  },
  {
    "target_agent": "FM",
    "reason": "Materiality threshold and basis are both MISSING in ctx_17. This is the only permitted source for the concentration-risk, missed-discount, duplicate-general-path, and three-way-match-mismatch escalations.",
    "severity": "high",
    "required_action": "Confirm materiality threshold and basis with Wildcard's accounting team and record them in ctx_17."
  },
  {
    "target_agent": "FM",
    "reason": "Period 2026-06 books were not closed by the prior bookkeeper (Central) as of 2026-08-11 per ctx_16 — active, unresolved.",
    "severity": "high",
    "required_action": "Confirm whether 2026-06 AP is final before acting on any AP Controller output for this period."
  },
  {
    "target_agent": "FM",
    "reason": "Five image-only PDFs in the read path could not be inspected — no text layer, no OCR tooling available.",
    "severity": "low",
    "required_action": "Confirm none of the five PDFs contains the 2026-06 AP schedule."
  }
]
```

---

## Step 7 — FM approval gate [HARD BLOCK — Gate 1 of 2] — **NOT PASSED**

The workflow is held here. No Sub-agent has been invoked.

---

*`ap-controller-input-agent` v1 — 2026-06 Wildcard — status: escalated*
