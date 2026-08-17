---
client: Wildcard
context_layer: Metrics
file: wildcard_ctx_06_metrics.md
last_updated: August 2026
updated_by: FM
status: Active
context_maturity: Baseline
---

# Wildcard — Metrics

> **How to use this file:** Paste into any Claude Project for Wildcard.
> Every skill that needs Wildcard's metric definitions reads this file first.
> Update monthly or when facts change.

| Date | Updated by | Changes |
|---|---|---|
| August 2026 | FM | Initial build |

---

| Metric | Calculation logic | Data source | Update frequency | Historical available? |
|---|---|---|---|---|
| Total Revenue | Subscription Revenue + Transaction Revenue | Puzzle (accrual) ✅ Fuel Finance cabinet, Aug 2026 | Monthly | Yes, from May 2024 |
| COGS | Hosting fees + Software COGS + Processor fees + Cost of Product | Puzzle ✅ Fuel Finance cabinet, Aug 2026 | Monthly | Yes |
| Gross Profit / Gross Margin % | Revenue − COGS | Puzzle ✅ Fuel Finance cabinet, Aug 2026 | Monthly | Yes — has ranged ~54–85% month to month; flagged as needing the headcount COGS/OPEX split cleanup (see Block 8) before it's fully trustworthy |
| Booked Revenue vs. Quota | Sales rep quota tracking ($125K–$175K/mo per rep) | "Wildcard Internal" Google Sheet ✅ Fuel Finance cabinet, Aug 2026 | Monthly | Yes |
| Cost per Campaign | Currently a flat $250 average, not actuals | Brennan's manual Operating Model 🔵 Fireflies — Fuel x Wildcard Deep Dive, 2026-07-01 | Monthly | Flagged by Brennan as inaccurate — real per-campaign COGS lives in the product DB (Phase 2 integration will replace this average) |
| CAC / LTV / Retention / Cohort tracking | Not applicable — confirmed no tracking exists today ✅ FM confirmed, Aug 2026 | — | — | No |
| Weekly cash in/cash out visibility | Currently manual (1–2 hrs/week by Brennan); this is the #1 stated priority for the engagement, not yet an automated metric | Manual bank review 🔵 Fireflies — Fuel & Wildcard, 2026-06-29 | Ad hoc (Brennan wants weekly) | Partial |

---

*Last updated: August 2026 by FM*
