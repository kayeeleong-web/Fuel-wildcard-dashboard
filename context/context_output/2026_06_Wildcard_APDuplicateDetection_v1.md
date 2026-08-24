# AP Duplicate Detection — 2026-06 Wildcard

| Field | Value |
|---|---|
| Agent | `ap-duplicate-detection` (`duplicateDetection` **ON** per `ctx_19`) |
| Client | Mems Studio, Inc. DBA Wildcard | Period | 2026-06 |
| Generated at | 2026-08-19 | Execution ID | APX-20260819-001 |
| Status | **escalated** |
| execution_completeness | **0.75** |
| Risk level | **high** |

---

## Step 1 — Client Isolation Check [HARD BLOCK] — PASSED

## Step 2 — Pre-flight gate — PASSED. `ctx_19` has `dataSource = held`.

## Step 3 — Materiality lookup — **NOT FOUND** in `ctx_17` (threshold and basis both MISSING);
all tiers exhausted, no number defaulted. Note the definitively-unpaid duplicate path always
escalates regardless of materiality, so that path would remain live if a dataset existed.

## Step 4 — Analyse

### 4.1 Required input — **NO DATASET**

This skill needs `vendorName`, `total`, `balance`, `billDate`, `billNum`, `status.paymentStatus` at
bill grain. Wildcard books no AP (see `ap-aging-metrics` finding `APM-2026-06-001`): BS AP = 0.00 in
all 27 months, no AP account in the chart of accounts. **`billNum` and `paymentStatus` do not exist
in any Wildcard source** — there are no bills to be duplicates of.

`ctx_19` tolerance/window: not overridden, so Sub-agent defaults would apply — moot with no dataset.

### 4.2 Finding

| ID | Type | Severity | Finding |
|---|---|---|---|
| `APX-2026-06-001` | deterministic | Critical | **Duplicate-bill detection has no dataset.** No AP subledger exists, so there are no bills, no bill numbers and no payment statuses to compare. The control this Sub-agent tests cannot be evaluated. |

### 4.3 Diagnostic scan on the declined proxy — **not a finding set**

The FM declined the card-payable proxy as an AP source on 2026-08-19. A scan was nonetheless run
during the setup interview to inform that decision, and its result is recorded here as diagnostic
context only. **These are not duplicate-payment findings and must not be reported as such.**

On 2026-06 Amex spend with vendor recovered via `Journal Entry ID` (875 of 884 lines, 216 vendors,
$81,621.02):

| Test | Count |
|---|---|
| Same vendor + same amount within a 10-day window | **1,239 pairs** |
| Same vendor + same amount + **same day** + different journal entries | **87 pairs** |

Highest-value examples from the same-day set: `Equinox` $355.00 (2026-06-23) · `Dsj Printing Inc`
$110.75 ×3 (2026-06-06) · `Godspeed Courier` $95.00 (2026-06-11) · `Amazon` $75.30 (2026-06-10) ·
`Vercel Inc.` $20.88 many times across 2026-06-11 → 06-24.

**Why this is diagnostic and not a finding.** Three reasons, each disqualifying on its own:

1. **These are card charges, not bills.** A repeated charge to the same merchant for the same amount
   is normal on a card — per-seat SaaS billing (`Vercel Inc.` at $20.88), repeat micro-purchases
   (`Amazon`, `Etsy`), and per-shipment courier fees all legitimately recur. The skill's duplicate
   logic assumes a bills register where a repeat is anomalous.
2. **No `paymentStatus` field exists**, so the definitively-unpaid path — the one that always
   escalates — cannot be distinguished from the general path.
3. **No configured tolerance or window**, and no materiality threshold, so there is no basis for
   separating signal from the 1,239-pair noise floor.

A 1,239-pair result on 884 lines is itself evidence the test is mis-applied: it is matching the
normal texture of card spend, not exceptions.

### 4.4 Why this remains the highest-value flag once AP exists

`ctx_12` names unreconciled campaign-material card spend — 150–300 purchases/month charged to Amex by
individual team members, with "no reconciliation to campaign-level actuals" — as Wildcard's *"biggest
flagged pain point."* That is precisely the profile in which duplicate payments hide. The control is
worth having; it needs a dataset that can support it.

---

## Step 6 — Execution completeness scoring

| Component | Result |
|---|---|
| Client Isolation Check, pre-flight gate | ✅ |
| Materiality lookup exhausted, not defaulted | ✅ |
| Dataset absence verified independently | ✅ |
| Duplicate test executed against declared input | ❌ no dataset |
| Proxy scan run and correctly withheld from findings | ✅ |
| Every read-path item inspected | ❌ 5 image-only PDFs unreadable |

**execution_completeness = 0.75** — above the 0.70 threshold. `escalated` on finding
`APX-2026-06-001`.

## Escalations

```json
"escalations": [
  {
    "target_agent": "FM",
    "reason": "No AP dataset exists, so duplicate-bill detection cannot run. Finding APX-2026-06-001.",
    "severity": "critical",
    "required_action": "Keep deferred until Wildcard books vendor bills to AP, or explicitly commission a separate card-spend duplicate review with its own tolerance, window and materiality - not as ap-duplicate-detection output."
  },
  {
    "target_agent": "FM",
    "reason": "A diagnostic scan on 2026-06 card spend returned 1,239 same-vendor/same-amount pairs within 10 days and 87 same-day pairs across different journal entries. Not valid duplicate findings (card charges, no paymentStatus, no configured tolerance) but the volume indicates the card-spend population is genuinely unreviewed - consistent with ctx_12 naming this the biggest flagged pain point.",
    "severity": "high",
    "required_action": "Decide whether to commission a scoped card-spend duplicate review. If yes, set a tolerance and window in ctx_19 and a materiality threshold in ctx_17 first, and label the output as a card-spend review rather than AP duplicate detection."
  },
  {
    "target_agent": "FM",
    "reason": "Materiality threshold and basis MISSING in ctx_17.",
    "severity": "high",
    "required_action": "Record materiality threshold and basis in ctx_17."
  }
]
```

---

*`ap-duplicate-detection` v1 — 2026-06 Wildcard — status: escalated*
