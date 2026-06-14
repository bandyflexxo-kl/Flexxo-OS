# Flexxo Sales OS — Project Memory
Last updated: 15 June 2026 (session 6)

## What this project is
Internal B2B Sales CRM + B2B e-commerce portal for Flexxo (KL) Sdn Bhd,
an office supply company in Malaysia (B2B, serving corporate clients).

## Business context
- Flexxo sells: stationery, pantry, hygiene, furniture, printer consumables, batteries, thermal rolls, corporate gifts
- Clients are companies (B2B), not individuals
- Sales team uses WhatsApp heavily — system should eventually reduce WhatsApp dependency
- QNE Optimum is the accounting system of record — CRM supports sales, QNE handles invoicing
- Future goal: full B2B e-commerce portal + automated ordering

---

## Tech stack
- Next.js 15 (App Router), TypeScript strict mode
- PostgreSQL + Prisma ORM v7 (custom client output: `app/generated/prisma`)
- Tailwind CSS v4
- NextAuth.js (credentials provider)
- Nodemailer (Gmail SMTP)
- Zod (validation on all API routes and forms)
- Node.js, npm
- tsx for running scripts (use `npx tsx`, NOT `npx ts-node` — tsx handles @/ path aliases correctly)
- **Upstash Redis** (`@upstash/redis`) — HTTP-based Redis for serverless; used for product catalogue 24h cache

## Prisma v7 notes
- Schema has NO `url` in datasource — this is correct for Prisma v7
- URL is provided by `prisma.config.ts` which reads `process.env.DATABASE_URL`
- After any schema change: run `npx prisma db push` then `npx prisma generate`
- Vercel uses `vercel-build` script: `prisma generate && next build` (no migrate deploy)

## Environment
- OS: Windows
- Project path: C:\Users\thund\Desktop\Claude project\Flexxo OS\flexxo-sales-os
- Database: PostgreSQL local, database name: flexxo_sales_os
- Dev server: http://localhost:3000
- Admin login: admin@flexxo.com.my
- Live URL: https://flexxo-os.vercel.app (project: bandyflexxo-kls-projects/flexxo-os)

## How to start dev server
```
cd "C:\Users\thund\Desktop\Claude project\Flexxo OS\flexxo-sales-os"
npm run dev
```

## How to start Claude Code (always use this)
```
cd "C:\Users\thund\Desktop\Claude project\Flexxo OS\flexxo-sales-os"
claude --dangerously-skip-permissions
```

## How to run scripts
```
npx tsx scripts/[scriptname].ts
```
Note: Always use `npx tsx`, NOT `npx ts-node` — tsx correctly resolves @/ path aliases used in lib/ files.

## How to open Prisma Studio (visual DB editor)
```
npx prisma studio
```

---

## QNE Integration — CONFIRMED DETAILS

- QNE Optimum API V2, Build 2024.1.0.8
- Swagger docs: http://26.255.19.220:82/doc/index.html
- Base URL: http://26.255.19.220:82
- Network: Only accessible via Radmin VPN (network name: Flexxokl)
- VPN must be active before any QNE API call
- Auth endpoint: POST /api/Users/Login
- Auth body: { dbCode, userName, password }
- Auth headers on all calls: DbCode + Authorization: Bearer [token]
- DbCode: FKLSB
- Current API user: SALES 6 / 12345 (test only — needs admin account)

## QNE field mappings — CONFIRMED by inspectQneFields.ts

### Customer → Salesperson link
- Field on customer record: `salesPerson` (full name e.g. "JUSTINE YONG")
- Matching field on agent record: `name` (first name e.g. "JUSTINE")
- Match logic: customer.salesPerson === agent.staffCode (exact match) → store agent.name as rawSalesPerson → on promote, lookup user.name === rawSalesPerson (case-insensitive)

### Agent list — 10 agents in QNE
JAVENN, BANDY, JUSTINE, TIMOTHY, LAI, VOON, CHAN KUN SHEN, ANGEL, HU YUN CHIN, LING
(LING exists in QNE but has no CRM account yet — may be new hire)

### Agent email sync results (run 2 June 2026)
- JAVENN: updated to sales1@kl.flexxo.com.my
- TIMOTHY: updated to tim@flexxo.com.my
- Remaining 7 agents: no email in QNE → update manually via /admin/users
- mobileNo field exists on QNE agents — synced to users.mobile_no in CRM

### Customer data
- 369 total customers in QNE
- 333 have salesPerson assigned
- 36 have no salesPerson (unassigned)

## QNE read-only rule
We NEVER write to QNE except these approved endpoints (with double human approval):
- POST /api/Quotations (Phase 2)
- POST /api/SalesOrders (Phase 4)
- POST /api/SalesTransfer/QuotationToInvoice (Phase 4)

## Key QNE endpoints
- POST /api/Users/Login — authentication
- GET /api/Customers — full customer list (has salesPerson field)
- GET /api/Customers/{id} — customer detail
- GET /api/Customers/AgingSummary — outstanding balance per client
- GET /api/Customers/Find — search customers
- GET /api/Agents — salesperson list (name, code)
- GET /api/Agents/{id} — agent detail
- GET /api/Agents/{code}/OrderSummary — sales per agent
- GET /api/Agents/InvoiceSummary — invoice summary per agent
- GET /api/AgentMonthTotal/* — monthly totals per agent
- GET /api/SalesInvoices — invoice history
- GET /api/SalesInvoices/{id} — invoice detail
- GET /api/SalesInvoices/Find — search invoices
- GET /api/DeliveryOrders — delivery status
- GET /api/Stocks — product catalogue
- GET /api/Stocks/available — live stock check
- POST /api/Stocks/GetSellingPrice — price per customer tier
- POST /api/Stocks/GetSellingPriceList — price list for multiple items
- POST /api/CreditControls/CheckNewQT — credit check before quoting
- GET /api/Terms — payment terms
- GET /api/TaxCodes/OutputTaxCodes — SST codes
- GET /api/Branches/ByCompany — client branch addresses
- POST /api/Users/CustomerLogin — B2B client portal login
- GET /api/CustomerStatement — client statement
- GET /api/ARReports/CustomerLedgerDetail — AR ledger
- GET /api/Suppliers — supplier master list
- GET /api/PurchaseInvoices — purchase history from suppliers
- GET /api/GLReports/PnL — P&L for owner dashboard (Phase 5)
- POST /api/Quotations — create quotation in QNE (Phase 2, human approval required)
- POST /api/SalesOrders — create SO in QNE (Phase 4, double approval required)
- POST /api/SalesTransfer/QuotationToInvoice — convert QT to invoice (Phase 4)

---

## Database schema
- All PKs are UUIDs
- Key principle: staging tables first, human approval, then master tables
- Audit log written by PostgreSQL triggers (not application code)
- See prisma/schema.prisma for full schema

## Seeded master data
- Roles: Admin, Manager, Salesperson, Viewer, B2B Client, Warehouse
- Pipeline stages: 14 stages (New Lead → Key Account + vendor registration flow)
- Product categories: 12 categories (Battery, Stationery, Pantry etc)
- Admin user: admin@flexxo.com.my

---

## Current system users
| Name | Email | Role | Source |
|------|-------|------|--------|
| System Admin | admin@flexxo.com.my | Admin | Seeded |
| JAVENN | sales1@kl.flexxo.com.my | Salesperson | QNE import (email synced from QNE) |
| BANDY | sales.6@flexxo.internal | Salesperson | QNE import (update email manually) |
| JUSTINE | justine.yong@flexxo.internal | Salesperson | QNE import (update email manually) |
| TIMOTHY | tim@flexxo.com.my | Salesperson | QNE import (email synced from QNE) |
| LAI | sales.5@flexxo.internal | Salesperson | QNE import (update email manually) |
| VOON | sales.4@flexxo.internal | Salesperson | QNE import (update email manually) |
| CHAN KUN SHEN | sales.7@flexxo.internal | Salesperson | QNE import (update email manually) |
| ANGEL | sales.8@flexxo.internal | Salesperson | QNE import (update email manually) |
| HU YUN CHIN | sales.3@flexxo.internal | Salesperson | QNE import (update email manually) |

Passwords: use /admin/users → Set Password for each salesperson before they log in.
Emails: /admin/users → Edit button to update name/email/mobile for each user.

**Pending actions:**
- [ ] Set real passwords for 7 remaining salespeople (BANDY, JUSTINE, LAI, VOON, CHAN KUN SHEN, ANGEL, HU YUN CHIN)
- [ ] Update their emails via /admin/users → Edit
- [ ] Reject junk QNE staging records (customer testing 700-C001, Quotation 700-Q001)

---

## What is already built

### Phase 1A — CRM Foundation ✅ COMPLETE
- Login and authentication (NextAuth, email + password)
- Dashboard with stats, follow-ups due, no-activity warnings
- Companies list (searchable, filterable, sortable)
- Company detail page (tabs: Overview, Contacts, Addresses, Pipeline, Activities, Quotations)
- New company form with auto-send intro email on save
- Duplicate detection on company name (normalised comparison)
- Contacts list and detail
- Pipeline kanban board (drag and drop between stages)
- Activities log with follow-up reminders
- Sidebar navigation: Dashboard, Companies, Contacts, Pipeline, Activities, Quotations, Admin

### Phase 1B — QNE Customer Import ✅ COMPLETE
- QNE API connection working via Radmin VPN
- runSync.ts — pulls 369 customers from QNE into staging table
- Staging review screen at /admin/qne-review
- Agent auto-assignment: 9 CRM users created, 333 company assignments backfilled
- Known junk records to reject: "customer testing" (700-C001), "Quotation" (700-Q001)

### Phase 1C — Supplier Price Database ✅ COMPLETE
- Google Drive PDF upload + Claude AI price extraction
- Supplier price versioning (immutable after approval)
- Admin review + approval workflow at /admin/suppliers

### Phase 1D — User Management & Salesperson Onboarding ✅ COMPLETE
- /admin/users page — set passwords, edit name/email/mobile, change role, activate/deactivate
- Forced password change on first login for @flexxo.internal accounts
- Role-based access control — salespeople see only their assigned companies
- Edit User modal — admin can manually update name/email/mobile for any user

### Phase 2 — Quotation System ✅ COMPLETE
- Full quotation builder (salesperson creates draft, manager approves)
- Quotation items freeze unit_cost at draft time
- Quotation email to client on send
- WABA WhatsApp auto-alert when quotation sent (via `lib/wabaClient.ts`)
- Baileys bridge integration: salesperson personal WhatsApp sessions at /admin/whatsapp

### Phase 3 — B2B Client Portal ✅ COMPLETE
- /shop/products — full product catalogue (3,700+ items), QNE last-sale-price × 1.20 for ALL visitors
- /shop/products/[id] — product detail with spec table, add to cart
- /shop/cart — shopping cart (B2B: API-backed; guest: localStorage)
- /shop/login — B2B login + "Request Business Account" form
- /shop/account — profile page, change password, sign out
- /shop/orders — order history with status stepper
- /shop/quotations — customer-facing quotation list
- /shop/dashboard — B2B client dashboard (greeting, spend metrics, partner tier, smart reorder, QNE aging breakdown, account manager card, quick actions)
- Guest users: browse + see prices freely, no login required
- B2B clients: login required for cart/checkout; redirected to /shop/dashboard on login
- Account request flow: pending → contacted → converted/rejected
- Admin review: /admin/account-requests (notification bell + push notification)
- Admin creates portal accounts: /admin/customer-accounts (with prefill from requests)
- Portal welcome email sent on account creation (lib/portalWelcomeEmail.ts)
- WABA order status alerts (Shipped/Delivered) via lib/wabaMessages.ts

### Additional CRM Features ✅ COMPLETE
- **Smart Order** (`/quotations/[id]` → ✨ Smart Add tab): paste text, upload photo, OR upload PDF → AI extracts items → fuzzy-matches to catalogue → bulk-add to quotation. Uses Claude Vision for photos, Claude PDF document block for PDFs, token-Jaccard for text.
- **Market Price Scout** (`/market-scout`): AI searches for cheapest supplier for any product. Uses Claude + web search.
- **Reports** (`/reports`): Team Portfolio Intelligence — client count, outstanding balance, top items per salesperson. Admin/Manager only.
- **QNE Price Sync**: Admin triggers sync at /admin → "↻ Sync Prices" (requires Radmin VPN). Pulls last invoiced price from QNE per item, stores in `products.qneLastSalePrice`. Display price = last sale price × 1.20.
- **QNE Stock Sync**: Admin triggers sync at /admin → "↻ Sync Stock" (requires Radmin VPN). Pulls available qty from QNE per item, stores in `products.qneAvailableQty` + `products.qneStockSyncedAt`. Shop hides items with synced qty = 0 (null = never synced = visible).
- **Google Drive Photo Matching**: Scan Drive folder → match product photos by stock code / name → 5-tier matching (exact code, fuzzy code, exact name, fuzzy name, brand+name).
- **Warehouse Portal** (`/warehouse`): Picking task board for warehouse workers.
- **Order Fulfillment Pipeline**: Confirmed → Approved → Picking → Packed → Delivering → Delivered. Invoice, WarehouseTask, DeliveryBooking models.
- **Lalamove Integration** ✅ LIVE (session 6, 15 Jun 2026): Full end-to-end delivery booking. Quote preview (price + pickup time + surge warning) before confirming. Smart time window avoids 12–2 PM lunch and after 5 PM. Surge detection flags >40% above baseline. Webhook auto-marks order Delivered. See Lalamove section below.
- **Notification System**: Notification bell (top of CRM sidebar) + browser push notifications. Covers: overdue follow-ups, pending quotation approvals, pending account requests.
- **Daily Digest**: Cron job emails Admin/Manager a daily summary of overdue follow-ups.
- **Admin Stock Gaps page** (`/admin/stock-gaps`): Lists sub-categories with products that all show 0 stock after a sync — admin decides what to keep stocking.

### Session 5 fixes (14–15 Jun 2026)
- All 7,533 products now visible in shop (isVisibleToCustomers = true bulk update + Redis cache busted)
- HSTS header (`Strict-Transport-Security`) now production-only in `next.config.ts` — was breaking `http://localhost` in Chrome dev
- Smart Order: Aplus-first boost (×1.3) for APLUS brand in Office Stationery parent category
- Smart Order: drops synced-zero-stock options, shows `· stock N` counts in alternatives
- Smart Order: new PDF tab (`app/api/smart-order/scan-pdf/route.ts`) using Claude PDF document block
- `QneSandboxClient.tsx`: fixed missing React `key` on Fragment in row list (was console error)
- `useMounted()` hook: required pattern for any client component reading `sessionStorage`/`window`

### Performance & Security Upgrades ✅ COMPLETE (Session 2 — 10 June 2026)
- **B2B Client Dashboard** (`/shop/dashboard`): post-login landing page with time-aware greeting, spend metrics, partner tier loyalty bar, QNE aging breakdown + credit limit bar, account manager card, smart reorder predictions, category spend, quick actions. QNE data cached 4h via `unstable_cache`.
- **Login redirect**: B2B clients now land on `/shop/dashboard` (was `/shop/products`) after login.
- **Security headers** (7 headers via `next.config.ts` `headers()`): `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, `X-XSS-Protection`, `Strict-Transport-Security` (2-year HSTS), `X-DNS-Prefetch-Control: off`.
- **Role-based session expiry** (`lib/session.ts`): B2B Client = 7 days, all internal roles = 24 hours.
- **Sliding window session renewal** (`middleware.ts`): session cookie renewed automatically if < 33% of lifetime remaining — no forced re-login on active users.
- **SSR product catalogue + Upstash Redis 24h cache**: products fetched server-side and embedded in HTML — "Loading catalogue…" spinner eliminated permanently. Two-layer cache: Redis (24h, persists across restarts) → `unstable_cache` fallback. Cache invalidated automatically after QNE price sync. Live TTFB: **128ms**.
- **Browser cache headers**: `Cache-Control: private, max-age=86400` (B2B) / `public, max-age=86400` (guest) on product API routes.
- **Hydration fix** (`ProductsClientPage.tsx`): eliminated React hydration warning caused by `animate-fade-in-up` class mismatch between SSR and client. Root cause: `sessionStorage` read during render + animation guard not gated on `mounted`. Fixed with `useMounted()` hook; `sessionStorage` reads/writes moved to `useEffect`.

---

## Lalamove Integration — CONFIRMED DETAILS (session 6, 15 Jun 2026)

- API: Lalamove v3 REST API, production keys live
- Pickup: Lot 2772F, Jalan Industri 12, Kampung Baru Sungai Buloh, 47000 Shah Alam, Selangor
- Pickup contact: Flexxo Warehouse (Pack2 Go Sdn Bhd), +601111954266
- Webhook URL (set in Lalamove partner portal): `https://flexxo-os.vercel.app/api/webhooks/lalamove`
- Webhook secret: in `.env.local` as `LALAMOVE_WEBHOOK_SECRET`

### Key files
- `lib/lalamoveClient.ts` — HMAC auth, quotation (with scheduleAt), place order, cancel, status poll
- `lib/lalamoveBooking.ts` — `getSmartBookingTime()` (avoids lunch 12–2 PM + after 5 PM + weekends), `checkSurge()` (flags >40% above baseline)
- `lib/fulfillment.ts` — `bookLalamoveDelivery(orderId, preQuote?)` — uses pre-fetched quoteId or fetches fresh with smart time
- `app/api/orders/[id]/delivery-quote/route.ts` — GET: returns quote + time label + surge flag (preview before commit)
- `app/api/orders/[id]/book-delivery/route.ts` — POST: accepts `{ quoteId, serviceType, priceMyr }` from UI
- `app/api/webhooks/lalamove/route.ts` — POST: verifies HMAC signature, maps COMPLETED→Delivered, REJECTED→resets to Packed

### Smart booking time rules (KL = UTC+8, no DST)
- 11:45–14:00 KL → schedule for today 14:15
- ≥ 17:00 KL Mon–Thu → schedule tomorrow 09:00
- ≥ 17:00 KL Fri → schedule Monday 09:00
- Weekend → schedule Monday 09:00
- Otherwise → immediate (now + 15 min)

### Surge baselines (MYR, flag if >40% above)
- MOTORCYCLE: RM 15
- MPV: RM 45
- VAN: RM 65

### Webhook status map
- ASSIGNING_DRIVER → booked
- ON_GOING → driver_assigned
- PICKED_UP → in_transit
- COMPLETED → completed (Order → Delivered, fires Google Review request)
- REJECTED / EXPIRED / CANCELED → failed (Order reset to Packed for retry)

### IMPORTANT: Vercel env vars needed for production
Add these in Vercel dashboard → Settings → Environment Variables:
```
LALAMOVE_API_KEY=pk_prod_dab1736500369a294e02aef40be81439
LALAMOVE_API_SECRET=sk_prod_Lj/JIFho/b9fwCgXEPZE8Y4m6LHDE24QnEepGjWRQGaU+tbNNgVy2oCSVcBx3B6u
LALAMOVE_BASE_URL=https://rest.lalamove.com
LALAMOVE_PICKUP_LAT=3.1871631880914224
LALAMOVE_PICKUP_LNG=101.57014340141357
LALAMOVE_PICKUP_ADDRESS=Lot 2772F, Jalan Industri 12, Kampung Baru Sungai Buloh, 47000 Shah Alam, Selangor
LALAMOVE_PICKUP_CONTACT_NAME=Flexxo Warehouse (Pack2 Go Sdn Bhd)
LALAMOVE_PICKUP_CONTACT_PHONE=+601111954266
LALAMOVE_WEBHOOK_SECRET=flexxo-lalamove-wh-2026
```
Note: Webhook only fires on production (Lalamove can't reach localhost). Test locally by checking order status manually.

---

## Scripts in /scripts folder
Run all scripts with: `npx tsx scripts/[scriptname].ts`

| Script | Purpose | Status |
|--------|---------|--------|
| testQneConnection.ts | Basic QNE API connection test | ✅ Working |
| runSync.ts | Pull QNE customers into staging | ✅ Working |
| inspectQneFields.ts | Print full raw QNE response to find field names | ✅ Run |
| fixAgentAssignment.ts | Create users from QNE agents + backfill assignments | ✅ Done — 9 users, 333 assignments |
| syncAgentEmails.ts | Pull agent email + mobileNo from QNE → update CRM users | ✅ Run — 2 emails updated |
| syncQneProducts.ts | Sync QNE stock items → products table | ✅ Working |
| syncQneStock.ts | Sync QNE available qty → products.qneAvailableQty (VPN required) | ✅ Working |
| setupDemoAccount.ts | Create demo B2B client account for testing | ✅ Working |
| uploadLog.ts | Upload improvement log to Google Drive | ✅ Working |
| matchAplusPhotos.ts | Match APLUS Excel stock codes → Drive photos | ✅ Working |
| testSmartOrder.ts | Test Smart Order text parsing + matching | ✅ Working |
| _catSummary.ts | Print full category tree with product counts per sub-category | ✅ Working |
| _verify2.ts | Verify all products are in sub-categories (0 in parents) | ✅ Working |

---

## Roles and what each sees
| Role | Access level |
|------|-------------|
| Director (Timothy, Bandy, Javenn) | Everything: all data, reports, margins, team performance, all approvals + personal salesperson todos (own follow-ups, stale drafts, quiet accounts). Goes out and does sales. |
| Admin | Operations: all data, all approvals, orders, products, users. No Reports/Activities/market-scout (those are strategic) |
| Manager | Same page access as Director (legacy role, currently unused) |
| Salesperson | Own accounts only, own pipeline, own activities, quote builder |
| Warehouse | Warehouse picking tasks only (/warehouse) |
| B2B Client | Own cart, orders, quotations, invoices, delivery tracking |

### 10-category shop tree: what was done (session 4, 14 Jun 2026)
- `scripts/buildCategoryTree.ts` — keyword-based classifier that creates 10 parent + 65 sub-categories matching flexxo.com.my/products, reassigns all 7,533 products, deactivates old flat categories
- `scripts/_fixCategories.ts` was run once to reactivate `office-stationery` (incorrectly deactivated by buildCategoryTree step 5) and deactivate 789 empty QNE-generated categories that accumulated from previous syncs
- **DB state**: 75 active categories (10 parents + 65 subs), all 7,533 products reassigned to leaf sub-categories
- `components/shop/ProductsClientPage.tsx` — already had 2-level tree UI; updated `CAT_EMOJI` map to use new 10 category names
- `app/shop/products/page.tsx` — SSRs only categories (75 rows, fast). Products fetched client-side via `/api/portal/products-public`. SSR of products was removed to avoid Supabase PgBouncer pool contention during Turbopack compilation.
- `components/admin/ProductCatalogTable.tsx` — already had `<optgroup>` grouping by parent
- `components/admin/PriceFileStagingTable.tsx` — already had `<optgroup>` grouping by parent
- **Category naming**: parent names match flexxo.com.my exactly (Office Stationery, Office Furniture, Printer Supplies, Computer Hardware & Software, Office Security, Office Machine, Office Equipment, Breakroom, Janitorial, Safety Kits)
- **Sub-category slugs**: prefix pattern (`os--`, `of--`, `ps--`, `ch--`, `sec--`, `om--`, `oe--`, `br--`, `jan--`, `sk--`) to avoid collisions with QNE-generated category slugs

### Director-as-salesperson: what was added (session 3, 13 Jun 2026)
- `lib/access.ts` — Director has all CRM routes including `/activities`, `/reports`, `/market-scout`
- `lib/authorization.ts` — Director in `PRIVILEGED_ROLES` (sees all companies, no scope filter)
- `login/actions.ts` — `ROLE_PRIORITY` array ensures Director session wins over legacy Salesperson role
- `TodoSection.tsx` — Director gets BOTH executive block (approvals) AND personal block (own follow-ups, stale drafts, quiet accounts)
- `companies/new` assignee dropdown — includes `['Salesperson', 'Director', 'Admin']`
- `api/reports/team` — includes Directors in team portfolio query
- Shop WhatsApp button — uses assigned user's `mobileNo` regardless of role (Director's number shows for their clients)

---

## Core rules — NEVER break these
1. AI writes to staging tables only — never directly to master tables
2. All QNE imports: staging → human review → promote (never auto-promote)
3. All supplier prices: staging → admin approval → supplier_price_versions
4. Quotations: draft → pending_approval → approved → sent (cannot skip steps)
5. Never auto-merge duplicate records — only suggest, human confirms
6. Always set app.current_user_id PostgreSQL session var before any write
7. Always log sent emails as Activity records (type: Email, direction: Outbound)
8. Always create PipelineStageHistory on every stage change
9. Always set exitedAt on previous stage history row when moving stages
10. Never use `any` in TypeScript
11. Never skip Zod validation on API routes
12. Never hardcode credentials — always use .env.local
13. Never write to QNE SalesOrders without double human approval
14. Quotation items freeze unit_cost at draft time — never auto-recalculate after approval
15. DO NOT PUSH to Vercel without user cross-check (unless user explicitly asks to deploy)

---

## Architecture decisions made
- UUIDs for all PKs (not auto-increment integers)
- Separate pipeline_stage_definitions table (not hardcoded strings)
- pipeline_stage_history logs entered_at AND exited_at (enables time-in-stage analytics)
- company_assignments table (not single assigned_user_id) — supports multiple salespeople per account and handoff history
- supplier_price_versions are immutable after approval — new price = new version
- quotation_items freeze unit_cost at draft time — never recalculated after approval
- orders.quotation_id is nullable — direct verbal orders are allowed
- Generic approval_requests table handles all approval types (prices, quotations, QNE promotions)
- audit_log written by PostgreSQL triggers not application code
- Customer → agent link: customer.salesPerson (full name) matched to agent.name (first name)
- Product pricing for shop: QNE last-sale-price × 1.20 (for all visitors), fallback to cost × margin when no QNE price synced
- ~~Module-level product cache in ProductsClientPage (5-min TTL)~~ — replaced by Upstash Redis 24h cache + SSR
- Notification system: computed from DB on each bell poll — no separate notifications table
- constants/zIndex.ts (Z export) — single source of truth for all z-index values
- Prisma v7: datasource URL in prisma.config.ts only (not schema.prisma)
- Product catalogue caching: `lib/products-api.ts` — Redis-first (24h), `unstable_cache` fallback; shared by both API routes (NOT the page server component — page SSRs categories only, products are client-fetched)
- `lib/redis.ts` — Upstash Redis singleton; returns `null` gracefully when env vars not set (safe for local dev without Redis)
- `lib/qneFinancial.ts` — QNE financial data (aging, outstanding, credit limit) cached 4h via `unstable_cache` per customer code; cache tag `qne-financial-{code}`
- Session durations: `sessionDurationMs(role)` in `lib/session.ts` — B2B Client 7d, others 24h; sliding window renewal in `middleware.ts` at < 33% remaining
- `useMounted()` hook pattern: any client component that reads browser-only APIs (sessionStorage, window, etc.) must gate on `mounted` to avoid SSR hydration mismatches
- HSTS header only sent in production (`NODE_ENV === 'production'`) — never in dev to avoid Chrome pinning localhost to HTTPS
- Stock gate in `lib/products-api.ts`: `OR: [{ qneAvailableQty: null }, { qneAvailableQty: { gt: 0 } }]` — null = never synced = visible; 0 = confirmed out of stock = hidden
- Lalamove booking: always quote-preview first (`GET /api/orders/[id]/delivery-quote`), then confirm (`POST /api/orders/[id]/book-delivery` with quoteId). Smart time + surge in `lib/lalamoveBooking.ts`.
- `lib/lalamoveClient.ts`: `scheduleAt?: string` (ISO 8601 UTC) in quotation params — used by smart booking time

## What NOT to automate (v1 rules)
- Do not auto-promote QNE staging records
- Do not auto-merge duplicates
- Do not auto-update quotation costs when supplier prices change
- Do not let AI write is_current:true on supplier_price_versions
- Do not send quotations without human clicking send
- Do not create Sales Orders in QNE without double human approval
- Do not auto-sync QNE prices — admin must trigger manually (VPN required)

---

## .env.local variables
```
DATABASE_URL="postgresql://postgres.ibkyigjvbvilekdlduho:Flexxo%408820@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true"
# NOTE: DATABASE_URL points to Supabase (production DB), NOT local PostgreSQL.
# All scripts and dev server use Supabase by default.
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="XFLs9hTCO3GGvs6pMR9oWQtsXGS6sxcz9O6CjRoAmYQ="
GMAIL_USER="bandy.flexxo@gmail.com"
GMAIL_APP_PASSWORD="wmxflizictumaetz"
EMAIL_FROM_NAME="Flexxo Sales"
ADMIN_EMAIL="admin@flexxo.com.my"
ADMIN_SEED_PASSWORD="ChangeMe123!"
QNE_API_BASE_URL="http://26.255.19.220:82"
QNE_DB_CODE="FKLSB"
QNE_API_USERNAME="SALES 6"
QNE_API_PASSWORD="12345"
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
GOOGLE_DRIVE_FOLDER_ID=""
ANTHROPIC_API_KEY=""
VAPID_PUBLIC_KEY=""
VAPID_PRIVATE_KEY=""
WHATSAPP_BRIDGE_URL=""
BRIDGE_SECRET=""
WABA_PHONE_NUMBER_ID=""
WABA_ACCESS_TOKEN=""
LALAMOVE_API_KEY=""
LALAMOVE_API_SECRET=""
LALAMOVE_PICKUP_LAT=""
LALAMOVE_PICKUP_LNG=""
LALAMOVE_PICKUP_ADDRESS=""
LALAMOVE_PICKUP_CONTACT_NAME=""
LALAMOVE_PICKUP_CONTACT_PHONE=""
LALAMOVE_WEBHOOK_SECRET=""
GOOGLE_REVIEW_URL=""
CRON_SECRET=""
UPSTASH_REDIS_REST_URL=""
UPSTASH_REDIS_REST_TOKEN=""
```

---

## Phases ahead
| Phase | What | Status |
|-------|------|--------|
| 1A | CRM Foundation | ✅ Complete |
| 1B | QNE Customer Import | ✅ Complete |
| 1C | Supplier price database | ✅ Complete |
| 1D | User management + salesperson onboarding + RBAC | ✅ Complete |
| 2 | Quotation system (draft, approve, send, WABA, Baileys) | ✅ Complete |
| 3 | B2B client portal (browse, cart, orders, account, account requests) | ✅ Complete |
| 3+ | Smart Order (AI paste/photo → quote items) | ✅ Complete |
| 3+ | Market Price Scout (AI cheapest source finder) | ✅ Complete |
| 3+ | Reports + Team Portfolio Intelligence | ✅ Complete |
| 3+ | B2B Client Dashboard + Performance & Security upgrades | ✅ Complete |
| 4 | Order fulfillment pipeline (Approve → Pick → Pack → Deliver via Lalamove) | ✅ Complete — Lalamove live, webhook wired, smart time + surge guard |
| 5 | AI sales intelligence (health scores, forecasting, cross-sell, P&L dashboard) | 🔴 Not started |

## Next priorities
- **Vercel env vars**: Add all 9 LALAMOVE_* vars to Vercel dashboard → Settings → Environment Variables (see Lalamove section above)
- **QNE stock sync**: Run with Radmin VPN active at /admin → "↻ Sync Stock" to populate qneAvailableQty for all products. Only then will the shop hide out-of-stock items.
- **QNE price sync**: Run with Radmin VPN active at /admin → "↻ Sync Prices" to populate display prices for all 3,700+ products
- **Salesperson onboarding**: Set passwords + update emails for BANDY, JUSTINE, LAI, VOON, CHAN KUN SHEN, ANGEL, HU YUN CHIN
- **WABA templates**: Submit `quotation_ready` + `order_update` templates to Meta for approval
- **Anthropic API credits**: Monitor balance at console.anthropic.com — PDF scan + photo scan + supplier price extraction all require credits

## Future features discussed
- Phone number + PIN login for salespeople (easier than email for field team)
- WhatsApp OTP login for B2B client portal
- Mailchimp sync for missing client emails (low priority)
- Salesperson leaderboard and coaching dashboard
- Multi-branch delivery address support via QNE Branches API
- Customer health scoring: Growing / Stable / At Risk / Churning
- Price increase impact analysis (when supplier raises cost, show affected clients)
- Cross-sell engine (clients who buy X but not Y)
- Weekly auto-generated sales report PDF emailed to owner
- Delivery route optimisation by area for logistics team
- Automated supplier PO drafts after each confirmed sale
