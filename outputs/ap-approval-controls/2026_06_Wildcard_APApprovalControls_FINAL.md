# AP Approval Controls — 2026-06 Wildcard

| Field | Value |
|---|---|
| Agent | `ap-approval-controls` (`approvalQueue` **ON** per `ctx_19`) |
| Client | Mems Studio, Inc. DBA Wildcard | Period | 2026-06 |
| Generated at | 2026-08-19 | Execution ID | APA-20260819-001 |
| Status | **escalated** |
| execution_completeness | **0.70** |
| Risk level | **high** |

---

## Step 1 — Client Isolation Check [HARD BLOCK] — PASSED
## Step 2 — Pre-flight gate — PASSED. `ctx_19` has `dataSource = held`.

## Step 3 — Policy lookup across both declared sources

This Sub-agent reads its policy from two places. Both were checked.

| Source | Declared use | Result |
|---|---|---|
| `ap_controller_config` (`ctx_19`) | This client's real approval tiers (max amount → approver) | ⚠️ **Provisional tiers only** — invented 2026-08-19 at FM direction for test purposes, explicitly not client-approved |
| `ctx_03_business-rules-policies.md` | Documented approval-policy nuance beyond a flat dollar tier | ❌ `Approval logic (who approves what spend): MISSING — ask Brennan Keough in first working session`. Also `Expense thresholds: MISSING`, `Reimbursement rules: MISSING` |

**Provisional tiers in force this run — NOT Wildcard's real policy:**

| Max amount | Approver |
|---|---|
| ≤ $1,000 | Team member — no approval required |
| $1,001 – $5,000 | Co-founder |
| > $5,000 | Brennan Keough |

## Step 4 — Analyse

### 4.1 Required input — **NO DATASET**

Needs `total`, `status.approvalStatus`, `status.approvalTier` at bill grain. Wildcard books no AP
(`APM-2026-06-001`). Beyond that, **`approvalStatus` and `approvalTier` do not exist as fields in any
Wildcard source** — the `GL Accu` tab has 22 columns and none of them records an approval state. No
approval workflow is captured anywhere in the client's systems.

`ctx_05`'s connected-tools table lists no approval or spend-management platform.

### 4.2 The control cannot be evaluated — and would be invalid if it were

Two independent disqualifiers:

1. **No dataset.** No bills, no approval status per bill.
2. **No valid policy.** The only tier ladder available is the provisional one, which the FM flagged as
   invented. Testing real spend against invented tiers would produce findings that look like control
   exceptions but measure nothing.

Per `ctx_19`'s own warning, any finding produced against the provisional tiers **is indicative only
and must not reach the client as a control conclusion.** No such finding is produced here — the
dataset is absent, so the question does not arise. Recorded so it is unambiguous that the zero-finding
result is *not* an assurance that approvals are working.

### 4.3 Findings

| ID | Type | Severity | Finding |
|---|---|---|---|
| `APA-2026-06-001` | deterministic | Critical | **No approval workflow is captured in any Wildcard system.** `approvalStatus`/`approvalTier` do not exist as fields; `ctx_05` lists no approval or spend-management platform. Whether spend was approved by anyone cannot be evidenced. |
| `APA-2026-06-002` | deterministic | Critical | **No approval policy exists to test against.** Both declared policy sources are empty of real policy — `ctx_03` records approval logic, expense thresholds and reimbursement rules all as MISSING, and `ctx_19` carries only FM-flagged provisional tiers. |
| `APA-2026-06-003` | judgment | Mid | **Spend authority is distributed with no recorded control.** `ctx_12` records campaign-material purchases — 150–300 per month — as *"charged by individual team members"* on the Amex card. On 2026-06 that is 884 card lines across 216 vendors totalling $81,621.02 gross, none of it carrying evidence of approval. Flagged as a control-design gap for the FM; this Sub-agent does not judge whether it is acceptable. |

`APA-2026-06-003` rests on card-spend figures that were computed during the setup interview. It is
raised as a **judgment** finding about control design — not as a test of individual transactions
against a tier ladder, which would require the dataset and policy that do not exist.

---

## Step 6 — Execution completeness scoring

| Component | Result |
|---|---|
| Client Isolation Check, pre-flight gate | ✅ |
| **Both** declared policy sources checked before concluding | ✅ |
| Dataset absence verified independently | ✅ |
| Provisional tiers correctly quarantined from producing client-facing conclusions | ✅ |
| Approval test executed | ❌ no dataset and no valid policy |
| Every read-path item inspected | ❌ 5 image-only PDFs unreadable |

**execution_completeness = 0.70** — exactly at the review threshold. `escalated` on findings.

## Escalations

```json
"escalations": [
  {
    "target_agent": "FM",
    "reason": "ap-approval-controls has neither a dataset nor a valid policy. approvalStatus/approvalTier do not exist in any Wildcard source, ctx_03 records approval logic as MISSING, and ctx_19 carries only FM-flagged provisional tiers. Findings APA-2026-06-001 and -002.",
    "severity": "critical",
    "required_action": "Get Wildcard's real approval logic from Brennan Keough - already flagged in ctx_03 as a first-working-session item - and replace the provisional tiers in ctx_19. Until then this Sub-agent cannot produce a valid result and its zero-finding output must not be read as approval assurance."
  },
  {
    "target_agent": "FM",
    "reason": "884 card lines across 216 vendors totalling $81,621.02 gross in 2026-06 were charged by individual team members with no recorded approval evidence. Finding APA-2026-06-003 - a control-design gap.",
    "severity": "high",
    "required_action": "Raise distributed card-spend authority with Brennan Keough alongside the approval-logic question. Decide whether an approval or spend-management control is warranted at Wildcard's current scale."
  },
  {
    "target_agent": "FM",
    "reason": "Provisional approval tiers are in force in ctx_19 at FM direction for test purposes. They are not Wildcard's policy.",
    "severity": "medium",
    "required_action": "Remove or replace the provisional tiers in ctx_19 before any run of this Sub-agent is relied upon, so no future run mistakes them for approved policy."
  }
]
```

---

*`ap-approval-controls` v1 — 2026-06 Wildcard — status: escalated*
