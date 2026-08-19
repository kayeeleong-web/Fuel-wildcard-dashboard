# Fuel Finance — Client Dashboard Repo

This repo is a per-client copy of the Fuel Finance Vercel dashboard template. Read this
file before doing any work in here — it points at the standards every client build
follows, so a dashboard looks and behaves the same whether it was built in January or
in July, for client A or client B.

## Architecture — one repo, not a portal + separate apps

This single Next.js app IS the client's whole product: `app/page.js` fetches all data
once and renders `<DashboardApp>`, which holds the Clerk-gated shell (Topbar + TabNav)
and all 4 tabs (KPI Report / Dashboard / Reports / Custom) as sibling panels — KPI
Report is the default landing view, acting as the "portal." There is deliberately no
separate Portal repo/deployment for the standard case.

If a client later needs a genuinely separate product (a bespoke Forecasting tool, an
Investors Report app, etc. — different tech/logic, not just another tab), that becomes
its own new Vercel project built from scratch, with Fuel's design system applied via a
Claude Skill at the start of that build (not by pre-forking this template speculatively
into a shape nobody's confirmed yet). Only at that point does linking two separately
deployed apps under one login become relevant — see Clerk's satellite-domain docs if
that day comes; it requires a dedicated domain per app and is not set up by default here.

## Before touching any UI

1. Read `/docs/design-rules.md` — what everything must look like: color tokens, type
   scale, page shell, per-tab layout rules, chart conventions. Colors and fonts come
   from the tokens already defined in `app/globals.css` — never hardcode a hex value or
   pick a font inline.
2. Read `/docs/functionality-spec.md` — what every clickable/hoverable thing is supposed
   to *do*, and whether it's already real, a demo stand-in, or not built yet. **Never
   ship a control that visibly does nothing when clicked** — either wire it to a real
   handler or remove it. This is a hard rule, not a suggestion.
3. When in doubt about a pattern (a table, a card, a popover), open
   `/docs/reference-build.html` in a browser and copy the working markup/CSS from there
   rather than inventing a new pattern. It's a static reference — never edit it, never
   deploy it.

## Data

- All data access goes through `getDataSource()` from `lib/data/index.ts`. Never import
  `GoogleSheetsDataSource` (or any other source implementation) directly in a page or
  component — that defeats the point of the abstraction (swapping a client's backend
  later becomes a one-line change instead of a rewrite).
- The data contract (fixed Google Sheet tab names, fixed header rows per tab) is
  documented at the top of `lib/data/sources/googleSheets.ts` and in `lib/data/README.md`.
  Don't rename tabs/columns per client — the parser depends on them.
- Reads are cached for 5 minutes (`DEFAULT_REVALIDATE_SECONDS` in `lib/data/source.ts`).
  Don't add ad hoc caching elsewhere; change that one constant if a client genuinely
  needs a different freshness window.
- A missing tab, renamed column, or auth failure must surface as a visible "data source
  misconfigured" state in the UI — never as silently wrong or zeroed-out numbers. This is
  financial data; a wrong number that looks fine is worse than a visible error.
- New report types the client-facing UI doesn't have a fixed shape for yet go through
  `Custom_Reports_Index` (see `lib/data/README.md`), not a bespoke one-off tab format.
  If a "custom" report type turns out to be needed across multiple clients, it should be
  promoted into the fixed set (`KPI_Report`/`PL`/`CF`/`BS`) centrally — raise it, don't
  fork the schema per client.

## Auth

- Each client gets its own dedicated Clerk application and its own dedicated Google
  Service Account — never share either across clients. This is a security boundary, not
  a convenience shortcut: a compromised client project must only expose that one
  client's data, never every client Fuel has ever onboarded.
- Service account keys live only in this repo's env vars (`GOOGLE_SERVICE_ACCOUNT_EMAIL`,
  `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` base64-encoded, `GOOGLE_SHEET_ID`). Never commit a
  key file.
- `middleware.js` already wires `clerkMiddleware` + `auth.protect()` across every route —
  this is live and working. Login stays on Clerk (2026-08-19 decision, Kayee): a sibling
  client (Hampton) uses a Supabase magic-link email allow-list instead of Clerk, but that
  predates Clerk becoming the company standard — it's not the pattern to copy forward.
  Don't replace or touch this middleware to add Supabase; see "Planning data storage"
  below for what Supabase is actually for on this project.

## Planning data storage (Supabase)

- 2026-08-19 decision (Kayee, per Olek/Christy): a dedicated Supabase project (under the
  Fuelfinance org, one project per client — same isolation principle as the Clerk app and
  Google Service Account above) is being added to persist the planning/what-if data that
  today only lives in each visitor's own browser localStorage — Payroll (roster, bonus,
  hiring plan), Assumptions (revenue rates, cost items), and the Customer tab (driver
  counts/prices, manual & planned customer rows). None of this is GL/actuals data — the
  Google Sheet via `getDataSource()` stays the only source for that, untouched.
- Scope is explicitly storage only, NOT auth — do not wire Supabase Auth, a login page,
  or an email allow-list into this repo; that would duplicate/conflict with the working
  Clerk gate above.
- Supabase project/env vars aren't wired into this repo yet as of 2026-08-19 — once the
  project exists and its keys are added to this Vercel project's env vars (via the
  official Supabase-Vercel integration), the plan is a small abstraction (parallel to
  `lib/data/index.ts`'s `getDataSource()`) that each existing localStorage hook
  (`useCustomerDrivers`, `usePlannedCustomers`, `usePayrollState`, `useAssumptionsState`,
  etc.) reads/writes through instead of `window.localStorage` directly — not a rewrite of
  those hooks' shape, just swapping their storage backend.

## Deployment & domain

- Every client dashboard lives on a `{slug}.fuelfinance.me` subdomain — never leave a
  client on the default `*.vercel.app` domain. `{slug}` is the same value as
  `clientConfig.slug` in `config/client.config.ts` (e.g. `acme` → `acme.fuelfinance.me`),
  so the repo slug, the Vercel project name, and the subdomain always match.
- To set it up: in the client's Vercel project → **Settings → Domains**, add
  `{slug}.fuelfinance.me`. Vercel shows the DNS record it needs (usually a CNAME to
  `cname.vercel-dns.com`) — add that record wherever fuelfinance.me's DNS is managed.
  Vercel verifies automatically once the record propagates (minutes to a few hours).
- A subdomain belongs to exactly one client at a time — don't reuse one across clients,
  and if a client churns, remove their domain from that project before it's ever
  reassigned to a new client.

## What NOT to do

- Don't switch the shell to dark mode — the black chrome (topbar, nav, table headers,
  total rows) is structural, not a theme toggle.
- Don't add a second global period picker — each tab owns its own period control.
- Don't title a chart with just a metric name, and don't leave a trend chart without its
  one dashed reference line (see design-rules.md §4).
- Don't hand-roll Google Sheets auth/fetching in a component — it already exists in
  `lib/data`.
