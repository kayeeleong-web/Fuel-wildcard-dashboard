---
client: Wildcard
context_layer: Sources & Access
file: wildcard_ctx_05_sources-access.md
last_updated: August 2026
updated_by: FM
status: Active
context_maturity: Baseline
---

# Wildcard — Sources & Access

> **How to use this file:** Paste into any Claude Project for Wildcard.
> Every skill that needs to know where Wildcard's data lives reads this file first.
> Update monthly or when facts change.

| Date | Updated by | Changes |
|---|---|---|
| August 2026 | FM | Initial build |

---

**Connected tools**

| Tool | What lives there | Status | Client owner |
|---|---|---|---|
| Stripe | Invoicing, revenue, campaign & meeting fees | ✅ Live, viewer access granted | Brennan Keough |
| Chase | Bank feed (checking & savings) | ✅ Live, viewer access granted | Brennan Keough |
| Amex | Credit card / campaign COGS spend | ✅ Live, viewer access granted | Brennan Keough |
| Puzzle | Bookkeeping (GL, P&L, BS) since mid-2025 | ✅ Live, but no usable API — QBO migration under consideration | Fuel accounting team (Gohar Sahakyan) |
| Central | Payroll processing only (bookkeeping add-on discontinued Jul 2026) | ✅ Live | Brennan Keough |
| Wildcard internal DB (Postgres) | Campaign-level COGS (~90–95% accurate internal tracking) | 🔵 Not yet connected — Phase 2, Month 4+ | Shane (co-founder) |
| Homegrown CRM | Customer/contract data, call transcripts (built on Recall AI) | 🔵 Not yet connected | Shane (co-founder) |
| Google Drive | Signed customer contracts | Manual reference only, not systematized | Brennan Keough |

**Fuel MCP / Cabinet:** Connected ✅ — Wildcard folder in Fuel Finance's Google Drive cabinet contains the Operating Model and historical P&L exports.

**Slack channels**

| Channel | Purpose |
|---|---|
| #wildcard-fuel | All communication between Wildcard and the Fuel team |

**Master source per data type:** Stripe = invoicing/revenue; Chase = cash; Amex = CC spend; Puzzle = books (pending QBO decision)

**Blocked / pending sources:** Puzzle has no usable API (confirmed dead end after direct outreach to Puzzle); migrating to QuickBooks Online would require an estimated ~60 hours of manual historical data transfer 🔵 Fireflies — Wildcard <> FuelFinance: Accounting Alignment + Sync, 2026-08-11

**Bookkeeping:** Previously outsourced to Central — Brennan rates this as mediocre; books incomplete through May/June as of Aug 11, 2026. Now transitioning to Fuel's in-house bookkeeping team (Gohar Sahakyan, Mariia Esaulova) ✅ FM confirmed, Aug 2026

---

*Last updated: August 2026 by FM*
