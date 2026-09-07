# Wildcard Revenue & Campaign Cost Projection — FP&A Investigation

Prepared for Kayee Leong, Fuel Finance. Sources: every Fireflies call between Fuel and Wildcard (Brennan Keough, Shane) from the sales process (6/29) through the most recent Revenue Recognition call (8/28); a read-only, structure-only review of Brennan's own operating model (no figures or customer names copied); ASC 606 guidance on variable consideration; and the existing Wildcard Vercel dashboard code.

## 1. How Wildcard actually charges customers

Confirmed directly by Brennan on the 7/21 kickoff call — this is the ground truth, not a guess:

Wildcard sells "super personalized, direct mail, gifting style marketing campaigns" to two segments (early-stage startups, and growth-stage/public companies), B2B only. Contracts are structured one of two ways:

- **Upfront + success fee.** Customer commits to a number of campaigns per month at $1,500/campaign (e.g., 10 campaigns/month = $15,000/month, billed monthly), plus a $4,000 success fee every time a prospect actually attends a booked meeting.
- **Flat fee only.** A single fee, usually $2,000–$2,500, with no success fee component at all. This exists and needs to be flagged per deal — not every contract has a campaign-count driver.

Minimum commitments: **pilots** run 3–4 months, usually 30–40 total campaigns; **standard contracts** run 6–12 months, e.g. 10 campaigns/month × 12 months = 120 campaigns. Brennan was explicit that actual campaign volume doesn't map cleanly to a flat monthly number — a sales director has a revenue quota, and campaign count each month is Brennan's own job to reconcile against booked revenue, not a fixed schedule per contract.

This confirms the approach already built into the sheet: **campaign count should be derived from upfront/contract revenue ÷ $1,500**, not from a meeting-conversion formula (that's backwards — meetings are downstream of campaigns, not the other way around).

## 2. The campaign lifecycle lag — what actually happens between month 1 and the success fee

This is the mechanic behind "10 campaigns, then 8, then 5" and it's described in detail on the 8/28 Revenue Recognition call, by Gohar (Fuel's accountant) recapping Wildcard's process back to Brennan and Shane, who confirmed it:

> "A pilot contract comes to us. They say they want to do 10 per month for three months. What that actually means is we will create 10 campaign concepts in that first month... those will actually send in month two, and in month three, when we send those, it takes an average of 10 to 30 days to find out if it worked or not... 25% of those will work [convert] in month two, month three, and potentially month four, spread across."

So a "10 campaigns/month" commitment doesn't mean 10 physical mailers land in a prospect's hands in month one. It moves through three distinct stages, each roughly a month apart:

1. **Month 1 — concept/creation.** Wildcard's team designs the 10 custom campaigns (e.g., a custom item tied to something personal about the prospect). No physical send yet.
2. **Month 2 — send.** The 10 campaigns from month 1 actually go out.
3. **Month 3 (and sometimes 4) — response.** It takes 10–30 days after the send for a prospect to respond and take the meeting. About 25% of sent campaigns convert to a meeting, spread unevenly across months 3 and 4 — "there's no direct timeline."

**Important honesty check:** I searched every Wildcard Fireflies transcript available (kickoff 7/21, sales calls 6/29 and 7/10, deep dive 7/1, accounting alignment 8/11, weekly syncs 8/26, and the revenue recognition call 8/28) and did not find the literal phrase "10, then 8, then 5" anywhere, from Shane or anyone else. What I did find is the mechanic above, which is almost certainly what's behind that recollection — a declining number across consecutive months is exactly what you'd expect to see on a dashboard or CSM report if you're looking at "campaigns in each active stage" for a single pilot cohort (10 created, then a smaller number actually sent that same reporting month once some have already converted or been pulled, then fewer still awaiting response) — but I can't confirm the exact 10/8/5 sequence traces to a specific statement. If this number came from a Slack message or a CSM report rather than a call, I'd need that source directly to confirm it precisely.

**So to directly answer your original question:** it does *not* mean 10 campaigns physically run in month one. It means 10 campaigns are committed to for that cohort, and they cascade through creation → send → response over roughly 3 months, with only ~25% ever converting to a paid meeting. Thinking of "10 campaigns" as "10 units of committed future work," not "10 things that happened this month," is the correct marketing-industry framing.

## 3. Why Fuel's "no forecasted meetings" rule is the accounting-correct call

On the same 8/28 call, Gohar was explicit: *"I don't want to forecast recognition for meeting... if we have a contract for upfront fees and outcomes and it's three months, and those outcomes land in month four, five, six, seven, I want to recognize the revenue for those outcomes in month 4, 5, 6, 7. I don't want to recognize the revenue ahead of time."* Brennan agreed.

This is also the technically correct answer under ASC 606. A success fee tied to whether a meeting happens is **variable consideration** — its recognition must be constrained to amounts where a significant revenue reversal is "not probable." A 25% conversion rate with no fixed timeline is exactly the kind of estimate that would very likely need to be reversed later if recognized in advance. So the rule you and Gohar landed on — recognize the success fee only in the month the meeting actually occurs (an event, not an estimate) — isn't just operationally simpler, it's the defensible accounting position. This is also exactly why "Expected Meetings (over term)" should not be a forecast input baked into the deal record (per my earlier note): meetings are an outcome you observe and record after the fact, never a number you accrue against in advance.

## 4. What Brennan's own model does differently, and why yours shouldn't copy it directly

I opened Brennan's linked sheet only to understand its structure (per his request not to copy-paste it, no figures or real customer names are reproduced here). Structurally, it's a **top-down, blended run-rate planning tool**, not a bottom-up accrual ledger:

- It defines a blended "Total Value per campaign" = Upfront $/campaign + (Per-Meeting $ × Meeting Conversion %). That single blended number is then multiplied straight through a range of campaign volumes to show what monthly revenue and annualized run-rate would look like at different scale points ("we're around here," "doubling," "tripling," "4x'ing").
- It has a separate "Customers and Revenue" tab that lists real customers and tracks Gross Collected Revenue, Total # of Campaigns, Total # of Meetings, Upfront $ and Meeting $ month by month, with a manual "Delta" reconciliation row against actuals.
- Cost of goods sold is modeled as an average cost per campaign (a real, observed average, not invented) plus software and headcount tied to campaign volume.

Brennan flagged this himself on the 8/28 call: *"This is not a model for everybody... I don't actually want you to copy everything verbatim... a lot of it's not repeatable."* His blended expected-value number is useful for his own internal goal-setting and scale scenarios, but it is exactly the wrong basis for your books, because it bakes the 25%-conversion assumption into revenue recognition before a meeting has happened — the practice Gohar and Brennan explicitly rejected for actual accounting. Use Brennan's structure only as a sanity check for what an at-scale run-rate should roughly look like; keep your own model strictly event-driven (accrual only when the campaign work happens, success fee only when the meeting happens).

## 5. Industry-standard framing (direct mail / ABM agencies generally)

Agencies in this space (account-based marketing, gifting, direct mail) commonly combine a fixed retainer or per-unit production fee with a variable, outcome-based fee (a "matchback" or performance fee tied to meetings booked or pipeline generated) — the same two-part structure Wildcard uses. The standard treatment for the variable piece, once you apply real accounting discipline rather than internal planning shortcuts, is the same ASC 606 logic above: recognize the fixed/production fee as the work is delivered, and recognize the variable/outcome fee only when the triggering event (a meeting, a closed deal) actually occurs, because the conversion rate on any given cohort is inherently uncertain and lagged.

Sources:
- [Marketing Agency Fees Explained: 2026 Pricing Guide](https://clicksgeek.com/marketing-agency-fees-explained/)
- [Direct Mail & Gifting for B2B Leads in 2026 | Launch Leads](https://www.launchleads.com/lead-generation-strategies/direct-mail-gifting/)
- [Variable Consideration Under ASC 606: How to Apply the Constraint](https://billingplatform.com/blog/variable-consideration-asc-606)
- [Variable Consideration ASC 606: A Complete Guide | Hubifi Blog](https://www.hubifi.com/blog/variable-consideration-under-asc-606)

## 6. What this means for the Google Sheet model (recommended next actions)

1. **Column J ("Expected Meetings over term") should become "Expected Campaigns (over term)"**, computed as `Contract/Upfront Value ÷ $1,500` (already proposed; not yet built). For flat-fee-only deals (the $2,000–$2,500 type), this column should read "N/A — flat fee" rather than force a campaign count that doesn't exist.
2. **Keep Success Fee Accrual manual/CSM-driven, never formula-estimated from a conversion rate** — this matches both Gohar's explicit rule and the ASC 606 constraint. The Success Fee Cash fix already applied (shifting Accrual by each deal's own Invoice Lag) is the right mechanic and needs no further change.
3. **Contract Accrual/Cash threshold logic (≥70% = full value, else $0)** you already implemented for pipeline deals is a reasonable internal probability gate for *forecasting*, but keep it clearly labeled as a planning assumption, separate from the accrual-only-on-signed-contracts rule that governs actual booked revenue.
4. **Model the campaign lifecycle lag explicitly if you want a true bottom-up projection**: campaigns committed in month N are created in month N, sent in month N+1, and convert to meetings (at ~25%) unevenly across months N+2 through N+3. If you want a monthly campaign-cost (COGS) forecast, apply it against the month the campaign is *created* (month N), since that's when design/production headcount and campaign goods cost are actually incurred — not the send month.
5. **Confirm the exact "10/8/5" figure with Brennan or Shane directly** (or point me to the Slack thread/CSM report it came from) — I could not verify it landed on a specific call, and I'd rather flag that clearly than guess at numbers that could end up in a client-facing model.

## 7. Open questions worth putting back to Brennan/Shane

- Is the $1,500/campaign and $4,000/meeting rate uniform across all current customers, or has it drifted (Brennan's own scale-scenario tab used $1,250 upfront / $3,000 per meeting as a blended current-book average, not the $1,500/$4,000 headline rate from the kickoff call) — worth a direct reconciliation.
- For flat-fee-only contracts, is there any campaign-count expectation at all, or purely a subscription-style flat fee with no unit driver?
- Where does the "10 then 8 then 5" number actually live (Slack, CSM tool, a specific customer's ramp), so it can be verified rather than inferred?
