# AR Controller Input Agent — 2026-06 Wildcard

| Field | Value |
|---|---|
| Agent | `ar-controller-input-agent` |
| Workflow | AR Controller Workflow |
| Client | Mems Studio, Inc. DBA Wildcard |
| Period | 2026-06 |
| Generated at | 2026-08-19 |
| Execution ID | AR-IN-20260819-001 |
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

## Step 2 — Read `ar_controller_config` — FAILED, ESCALATION TRIGGERED

`ar_controller_config` (`ctx_18_ar-controller-config.md`) **does not exist for this client.**

Read path contains `ctx_01` through `ctx_17` only. No `ctx_18`, no file matching
`*ar*controller*config*`, and no equivalent under the project's `config/` folder
(`client.config.ts` there is the Vercel dashboard's own config, not an AR controller config).

Per Section 2 and Critical Rule 2, this agent **does not run the AR setup interview itself** and
**does not guess** the data source, dimensions, aging buckets, or feature-flag set. This is an
escalation to the FM.

**Consequence:** every downstream Sub-agent is unrunnable, because each one reads
`ar_controller_config` to learn whether its own feature flag is even on:

| Sub-agent | Gating flag | Can it be sequenced? |
|---|---|---|
| `ar-aging-metrics` | always on | No — needs aging buckets + top-N from config |
| `ar-collections-review` | `collectionsWorkflow` | No — flag state unknown |
| `ar-dispute-credit-review` | `disputeCreditHold` | No — flag state unknown |
| `ar-cash-application` | `cashApplication` | No — flag state unknown |

---

## Step 3 + Step 4 — Sub-agent declared needs, checked against the Inputs folder

Every Sub-agent's own Section 5 was walked, then the read path was checked before asking for
anything.

### Blocking config

| Need | Declared by | Status |
|---|---|---|
| `ctx_18_ar-controller-config.md` — dataSource, custom dimensions, aging buckets, 4 feature flags | Input Agent (Step 2) | **missing** |

### `ar-aging-metrics` (always on)

| Need | Status | Note |
|---|---|---|
| Invoice-level AR export — customer, invoice number, invoice date, due date, total, balance | **missing** | No CSV/XLSX/Sheet export in the read path. Required fields, not a required report shape — any export carrying those six fields is acceptable. |
| Credit sales in period (DSO denominator) | **missing** | Not derivable from context. `ctx_06` says revenue lives in Puzzle. |
| Beginning AR / Ending Current AR (CEI) | **missing** | First run for this client — CEI returns `null` in bootstrap mode regardless. |
| `ctx_01` — entity name, fiscal year, currency | **found** | Entity + USD confirmed. **Fiscal year end is ❌ MISSING in `ctx_01`** — flagged, ask Brennan Keough. |
| `ctx_08` — AR account mapping | **found, insufficient** | `ctx_08` status is `Partial`; it names no AR account. GL is in Puzzle and under active review by Gohar Sahakyan. |
| `ctx_17` — materiality threshold | **missing** | `ctx_17` records `Materiality threshold: ❌ MISSING` and `Materiality basis: ❌ MISSING`. Section 2 permits **ctx_17 ONLY** — no fallback to `ar_controller_config` or `kpi_context`. The concentration-risk escalation path is therefore unusable even if data arrived. |

### `ar-collections-review` (`collectionsWorkflow` — flag state unknown)

| Need | Status | Note |
|---|---|---|
| AR export with `nextFollowUpDate`, `promiseToPayDate`, `promiseToPayAmount`, `collectionsOwner` | **missing** | No collections tracking is evidenced anywhere in context. `ctx_11` records no churn tracking and no queryable customer/contract dataset; contract knowledge "lives with Brennan Keough personally". |
| CRM / Slack as alternative location for follow-up dates | **missing** | `ctx_05`: Homegrown CRM is 🔵 **not yet connected**. Slack `#wildcard-fuel` exists but is Fuel↔Wildcard comms, not a collections log. |
| `ctx_17` materiality (broken-promise escalation) | **missing** | As above. |

### `ar-dispute-credit-review` (`disputeCreditHold` — flag state unknown)

| Need | Status | Note |
|---|---|---|
| AR export with `disputeStatus`, `creditHold` | **missing** | — |
| `ctx_03` — dispute-resolution-time expectation | **missing** | Not documented. Section 2 says ask the FM once and record the answer rather than assume a number. |
| Stated credit limits per customer | **missing** | No credit-limit policy documented in `ctx_03` or `ctx_11`. |
| `ctx_17` materiality (credit-limit-breach escalation) | **missing** | As above. |

### `ar-cash-application` (`cashApplication` — off by default, flag state unknown)

| Need | Status | Note |
|---|---|---|
| Payments feed export for 2026-06 | **missing** | Stripe and Chase are ✅ live per `ctx_05`, but no export sits in the read path. |
| Same invoice dataset as `ar-aging-metrics` | **missing** | As above. |
| `ctx_03` — payment-application turnaround expectation | **missing** | Not documented. |

> **Material caveat for this Sub-agent even once wired:** `ctx_03` records that *"Most customers pay
> via ACH direct deposit rather than through Stripe itself, which is why AR reconciliation is
> currently manual."* A Stripe-only payments feed would therefore **not** cover the majority of
> Wildcard's cash receipts. The feed must be Chase (bank) or Chase + Stripe combined.

### Cross-cutting

| Need | Status | Note |
|---|---|---|
| `data_quality_flags` | **absent** | No prior-period AR Controller run exists for this client. Nothing to suppress as already-known. |

---

## Version-disambiguation

Not applicable — **zero** candidate AR export files were found for 2026-06, so there was nothing to
disambiguate. No file was selected by filename convenience.

---

## Read-path items this agent could NOT inspect

Five PDFs sit in the read path. All five are **image-only** — no `/Font` objects, no text layer —
and no OCR tooling (`pdftoppm`/poppler, Python) is available in this environment. They could not be
read, so this agent cannot positively rule out that one contains an AR schedule.

| File | Assessed likelihood of holding AR invoice data |
|---|---|
| `SOW - Wildcard V3.pdf` | Very low — engagement scope document |
| `Wildcard x Fuel Order Form.pdf` | Very low — commercial order form (#FF2607-Q01) |
| `Wildcard x Fuel Proposal.pdf` | Very low — sales proposal |
| `Simplified Controlling Workflow.pdf` | Very low — process documentation |
| `wc.pdf` | **Unknown** — single embedded RGB image, content not determinable |

This is the sole deduction against this agent's own `execution_completeness`.

---

## Step 5 — Consolidated ask to the FM (asked once)

**To unblock `ar_controller_config` — complete Wildcard's one-time AR setup interview:**

1. **Data source kind** — `csv-excel` / `qbo` / `ar-agent-output` / `custom:<name>`.
   Note: `ctx_05` records Puzzle as the bookkeeping system with **no usable API** (confirmed dead
   end), and the QBO migration is still an **open decision** (`ctx_08`). `ar-agent-output` is not a
   viable path — no such skill exists in this repo.
2. **Custom dimensions** — any client-specific slicing beyond customer (e.g. campaign, sales rep).
3. **Aging buckets** — bucket boundaries in days.
4. **Feature flags** — on/off for each: DSO/CEI, `collectionsWorkflow`, `disputeCreditHold`,
   `cashApplication`.

**To unblock the period data — supply for 2026-06:**

5. **AR invoice/balance export** carrying customer, invoice number, invoice date, due date, total,
   balance.
6. **Credit sales in period** figure, if DSO/CEI are switched on.
7. **Payments feed export** (Chase, or Chase + Stripe), only if `cashApplication` is switched on.
8. **Purchase-order/collections-status fields**, only for whichever of
   `collectionsWorkflow` / `disputeCreditHold` are switched on.

**To unblock every Sub-agent's escalation path:**

9. **Materiality threshold + materiality basis** — must be recorded in
   `ctx_17_accounting-policy-framework.md`. This is the only permitted source; no fallback exists.

**Also newly surfaced (not blocking, but recorded):**

10. **Fiscal year end** — ❌ MISSING in `ctx_01`, ask Brennan Keough.

---

## Step 6 — Execution completeness scoring

Scored on how completely **this** agent located and confirmed each declared need — not on how many
items ended up missing. A genuinely absent source that was surfaced rather than silently skipped is
not a deduction.

| Component | Result |
|---|---|
| Client Isolation Check completed before any read/write | ✅ |
| `ar_controller_config` read attempted and absence surfaced, not guessed | ✅ |
| All 4 Sub-agents' Section 5 declared needs walked | ✅ 4 / 4 |
| Read path checked before asking the FM for anything | ✅ |
| One consolidated ask produced, not Sub-agent by Sub-agent | ✅ |
| Version-disambiguation applied | ✅ (vacuous — no candidates) |
| Every read-path item inspected | ❌ 5 image-only PDFs unreadable (−0.15) |

**execution_completeness = 0.85** — above `execution_completeness_review_threshold` (0.70, fixed).
No completeness-driven escalation. The escalation below is triggered by the missing config, not by
this score.

---

## Escalations

```json
"escalations": [
  {
    "target_agent": "FM",
    "reason": "ar_controller_config (ctx_18_ar-controller-config.md) does not exist for Wildcard. Data source, dimensions, aging buckets, and all 4 feature flags are unknown. Every Sub-agent reads this config to determine whether its own flag is on, so none can be sequenced.",
    "severity": "critical",
    "required_action": "Complete Wildcard's one-time AR setup interview and save the result as ctx_18_ar-controller-config.md in the read path. Do not let any Sub-agent run against guessed values."
  },
  {
    "target_agent": "FM",
    "reason": "No AR invoice/balance export for 2026-06 exists in the read path. ar-aging-metrics has no dataset to age, and the other three Sub-agents have no status fields to review.",
    "severity": "critical",
    "required_action": "Supply the 2026-06 AR export with customer, invoice number, invoice date, due date, total, and balance. Any export shape carrying those six fields is acceptable — a pre-bucketed AR Aging Detail report is not required."
  },
  {
    "target_agent": "FM",
    "reason": "Materiality threshold and materiality basis are both recorded as MISSING in ctx_17_accounting-policy-framework.md. ctx_17 is the ONLY permitted source for all four Sub-agents' materiality-based escalation paths — no fallback to ar_controller_config or kpi_context is allowed.",
    "severity": "high",
    "required_action": "Confirm materiality threshold and basis with Wildcard's accounting team and record them in ctx_17. Until then, concentration-risk, broken-promise, credit-limit-breach, and unapplied-payment escalations cannot be evaluated."
  },
  {
    "target_agent": "FM",
    "reason": "ctx_08_chart-of-accounts.md is status Partial and names no AR account. GL lives in Puzzle and is under active review by Gohar Sahakyan; the QBO migration decision is still open.",
    "severity": "medium",
    "required_action": "Confirm the AR account mapping once Puzzle review concludes, or once the QBO migration decision is made."
  },
  {
    "target_agent": "FM",
    "reason": "Five image-only PDFs in the read path could not be inspected — no text layer and no OCR tooling available in this environment. wc.pdf in particular has undetermined content.",
    "severity": "low",
    "required_action": "Confirm none of the five PDFs (especially wc.pdf) contains the 2026-06 AR schedule, or supply that data in a machine-readable format."
  },
  {
    "target_agent": "FM",
    "reason": "Period 2026-06 books were not closed by the prior bookkeeper (Central) as of 2026-08-11, per ctx_16_close-cycle-history.md — an active, unresolved escalation.",
    "severity": "high",
    "required_action": "Confirm whether 2026-06 AR is final before acting on any AR Controller output for this period, or re-run against a closed period."
  }
]
```

---

## Step 7 — FM approval gate [HARD BLOCK — Gate 1 of 2] — **NOT PASSED**

The workflow is held here. No Sub-agent has been invoked. Gate 1 requires the FM to confirm every
input is ready, or to explicitly accept a documented gap. Neither has occurred.

---

*`ar-controller-input-agent` v1 — 2026-06 Wildcard — status: escalated*
