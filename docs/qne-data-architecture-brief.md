# Flexxo OS — QNE Data Architecture + Write-Integration Build Brief

> **Status:** Planning handoff, 28 Jun 2026. Read alongside `CLAUDE.md` (Core Rules) and
> `docs/qne-write-integration-brief.md` (the canonical *write* spec — this brief references it,
> doesn't replace it).
> **Interim dashboard fix referenced in §4 lives on branch `worktree-partB`.**

---

## 1. The core principle (the "why" behind everything)

QNE lives behind **Radmin VPN** at `26.255.19.220` — **Vercel/production CANNOT reach it.** Therefore:

- **Every view-time read must come from the Supabase DB mirror, never live QNE.** Production already
  depends 100% on what's been synced into the DB (that's why the B2B dashboard's "Outstanding" shows
  "cached" and "Total Spent" was showing a misleading "0").
- A **sync layer** is the only bridge between QNE and the DB, and it must run from a **VPN-connected
  machine** (the always-on PC), writing to Supabase. Vercel only ever *reads* Supabase.

---

## 2. The sync layer — 3 trigger modes, 2 directions

- **Inbound (QNE → DB)** = read mirrors (invoices, stock, prices, balances, documents):
  - **Scheduled / auto** — timed jobs from the VPN PC (nightly/hourly).
  - **On-request / ad-hoc** — an admin "Refresh from QNE now" button (live pull on demand, on VPN).
- **Outbound (DB → QNE)** = the write flow (QT/SO/DO/Inv + Stock Code creation). Always
  **human/approval-gated**, fired at the moment of action.

> "Pull *almost* all from DB" = all normal browsing reads from DB; "almost" because a few things are
> legitimately live: the on-request refresh, and the outbound writes at the moment they happen.

---

## 3. Current state audit

- ✅ **Already DB-backed:** shop catalogue (price/stock), company Quotations tab, Sales Agent, Reports.
- 🔴 **Still hitting QNE live every view (must fix → §5):** (1) **B2B dashboard** financials,
  (2) **CMS company "QNE" tab**. Both fail on production because Vercel can't reach QNE.
- **Mirror tables that already exist:** `qne_invoices`(+items), `qne_sales_orders`, `qne_quotations`,
  `qne_delivery_orders`, `qne_top_items`; `companies.outstanding_balance/credit_limit/overdue_amount`;
  `products.qne_available_qty/qne_last_sale_price/qne_invoice_freq`.
- **Syncs are almost all MANUAL today** — only `daily-digest` is a scheduled cron (and it's not QNE).

---

## 4. Interim dashboard fix — and where each piece lives after DB-first

**The mental model — a water tank.** The dashboard is someone *drinking water*; QNE is a *well*.
- **Today** the dashboard drinks straight from the well (live QNE). If the well is muddy that moment
  (VPN down/slow), the cup is empty or muddy.
- **After DB-first** the dashboard drinks from a **tank** (the DB). A **pump** (the sync) fills the tank
  from the well on a schedule. The dashboard never touches the well again.

**The interim fix** (branch `worktree-partB`, 3 files) was a *cup-level* patch so production stops showing
a misleading "MYR 0" *before* the tank is built:
- `lib/qneClient.ts` — request **timeouts** (no more infinite hang).
- `lib/qneFinancial.ts` — **don't cache partial/failed QNE results** (was poisoning the 4h cache with "0").
- dashboard `page.tsx` — honest **"Temporarily unavailable"** instead of fake "MYR 0".

**Where each piece goes once §5 (DB-first) is built:**

| Interim change | Fate after DB-first | Why |
|---|---|---|
| Dashboard **"Temporarily unavailable"** UI | **Drop it** (cup-level) | The DB always answers; the page never hits the failing live path. A plain "—" for genuinely-empty data is enough. |
| **Timeouts** (`qneClient`) | **Keep — now universal** | Every QNE call still needs them: the nightly sync, the "refresh now" button, AND the new write calls (`qnePost`). A 2am sync that hangs is worse than a page hang. |
| **Don't-save-a-partial-result** | **Keep, but RE-HOME onto the sync** | The danger doesn't disappear — it moves upstream. |

**The critical rule this leaves us with — the filter on the pump:**
> The sync that fills the DB must **never overwrite good values with a partial/failed fetch.** If a 2am
> sync gets a half-broken response from QNE and writes "0" into `qne_invoices` / `outstanding_balance`,
> the DB-first dashboard will faithfully show that "0" — and now it's *stored*, stuck until the next good
> sync. So the sync aborts the write and **keeps the last good data** when the fetch is incomplete.
> (This is the same guard added to `fetchQneFinancialData` on partB, applied to the inbound sync.)

---

## 5. Part A — Wire the 2 live readers to DB-first *(needed for go-live reliability)*

- B2B dashboard + CMS QNE tab: compute Total Spent / invoice count / monthly chart / recent invoices from
  `qne_invoices`; Outstanding from `companies.outstanding_balance`.
- **Add aging buckets to the DB** (one JSON column or 5 fields on `companies`) so the aging chart also
  works from DB (today it's only fetched live).
- Keep a manual **"Refresh from QNE"** button (the live path, with timeouts + the partial-result guard)
  for staff on VPN.

---

## 6. Part B — Sync schedule *(run from the always-on VPN PC, NOT Vercel)*

| Frequency | Syncs |
|---|---|
| Every 2–3 h (business hrs) | Stock |
| Twice daily (7am + 1pm) | Outstanding balance + aging |
| Nightly (~2am) | Invoices, Prices, Sales Orders, Quotations, Delivery Orders |
| Weekly (Sun) | Top items, customer master, product master |

- **Mechanism:** Windows Task Scheduler runs the `npx tsx scripts/sync*.ts`. PC must never sleep; Radmin
  auto-connect; tasks "run whether logged on or not".
- **Keep scheduler in sync:** `git pull` + `npx prisma generate` after every schema change (wrap into the task).
- ⚠️ **Do NOT enable the schedule until after go-live.** During development keep syncs **manual** — otherwise
  (a) your QNE test documents get pulled into the production mirror tables, and (b) overnight syncs break
  whenever you `prisma db push` a schema change. Manual syncs during dev = zero surprises, and they do **not**
  block any development.

---

## 7. DEV PLAN — Stock Code Creation *(outbound write; canonical: write-brief Part A)*

- **Endpoint:** `POST /api/Stocks` (`NewStock`, `autoCode:0` = manual code). Prereq: add **`qnePost` + `qnePut`**
  to `lib/qneClient.ts` (give them the same timeouts as `qneGet`).
- **Preset mapping (the heart of the SOP):** `category` = main category, `group` = sub-category,
  `class` = **BRAND (must)**. Brand becomes a managed master (`GET/POST /api/StockClasses`); categories/groups
  via `StockCategories`/`StockGroups` — **map 1:1 to the shop's 10 parent / 65 sub-category tree** (drives
  B2B + B2C display).
- **Guided name builder (assemble, don't free-type):** `Brand / Code / Description / Identity / Size / Color / Packing`
  with live preview.
- **Prices:** `listPrice` (sell, must), `purchasePrice` (must), `minPrice` (lowest allowed).
- **Multi-UOM:** `baseUOM` (must); extra UOMs via follow-up `PUT /api/Stocks` (`uoMs[]`).
- **Duplicate gate (mandatory before create):** `GET /api/Stocks/Find?code=` + `products` table + fuzzy name
  match → human confirms → never auto-merge (Core Rule 5).
- **Persistence (staging → push):** save to `products` first with `qnePushStatus: pending` → push to QNE →
  `synced` (+store QNE id) or `failed` (keep, with reason). Product is never lost if QNE rejects. Add a
  "Push pending to QNE" retry button.
- **UI:** guided "New Product" modal on `/admin/products`.
- *Note:* **prioritized for go-live** — the write-brief + memory are now updated to match (no longer "deferred").
  SOP-aligned design is ready to build. **Branch-aware:** `createQneStockCode(branchCode, payload)` resolves to KL
  creds for now (multi-branch-ready). **QNE account:** test on the `SALES 6` account — if it lacks stock-write
  permission the product stays `pending`/`failed` and the retry button re-pushes once a proper admin account is set.

---

## 8. DEV PLAN — QT → SO → DO → Invoice chain + automation roadmap *(outbound write; canonical: write-brief Part B)*

### 8a. The chain mechanics
- **Each document is its own POST:** `/api/Quotations` → `/api/SalesOrders` → `/api/DeliveryOrders` → `/api/SalesInvoices`.
- **Lines link via `transferFrom`** (QT detail id → SO; + SO detail id → DO; + DO detail id → Invoice) — this is
  how QNE prevents double-invoicing.
- **CRITICAL:** capture the QNE-returned **doc `id` + each line `id`** and store them on the CRM rows (the next
  document references them). Add `qneId` (doc) + `qneDetailId` (line) to `quotations`/`quotation_items`,
  `orders`/`order_items`, + DO/invoice refs.
- **Shortcut for simple deals:** `POST /api/SalesTransfer/QuotationToInvoice?quotationId=…` (skips SO/DO).
- **New libs:** `qneQuotationCreate.ts`, `qneSalesOrderCreate.ts`, `qneDeliveryOrderCreate.ts`, `qneInvoiceCreate.ts`
  — each `(branchCode, crmDocId)`: map CRM row → payload → POST → store ids back.
- PDF of any doc: `GET /api/Reports/{Doc}/{id}/download`. QNE DeliveryOrder = accounting stock-out doc; physical
  delivery stays **Lalamove** (already built) — both may be needed.
- Every create fn takes `branchCode` (multi-branch ready; resolves to KL creds for now).

### 8b. Approval gates (updated — Core Rule 13 relaxed to **single** approval 28 Jun 2026)
| QNE write | Trigger |
|---|---|
| `POST /api/Quotations` | CRM quotation `approved` → user clicks **Send** |
| `POST /api/SalesOrders` | Order `approved` + **single human click** (was double — relaxed for real-flow testing) |
| `POST /api/DeliveryOrders` | Order `packed` (records stock-out) |
| `POST /api/SalesInvoices` / `QuotationToInvoice` | Order `delivered` / ready to bill |

Never auto-promote staging. All routes Zod-validated, no `any`, credentials from `.env.local` only, set
`app.current_user_id` before DB writes.

### 8c. How much to automate — the Level 1→2→3 ladder
Automation and approval are **not** opposites: automate the *work*, keep a human only where money/risk demands it.

- **Level 1 — automate the drafting (do now, zero added risk).** The system auto-assembles every QT/SO/DO/Invoice
  payload from CRM data (customer code, prices, terms, stock codes, `transferFrom` links). The human stops filling
  forms and just **reviews + clicks**. Removes ~90% of manual effort.
- **Level 2 — auto-chain downstream docs on status events.** Once a human approves the order/SO, the rest fires on
  triggers you already have: order **packed** → auto-create QNE **DO**; Lalamove **"Delivered" webhook** (already
  wired) → auto-create QNE **Invoice**. ~1 real decision instead of 4 clicks.
- **Level 3 — rules-based auto-approval ("approve by exception").** Use `POST /api/CreditControls/CheckNewQT` to
  define a safe lane: *existing customer + within credit limit + all items matched + under RM X → auto-approve, no
  click.* Humans then touch only exceptions (new customer, over limit, unmatched item, high value).

**Two guardrails:**
1. **Automate in order of reversibility.** Quotation = harmless (safe to fully auto). DO = moves stock.
   **Invoice = an accounting record** (cancelling = a credit note). So: auto QT → assisted SO → event-triggered DO →
   carefully-gated Invoice. Don't make the riskiest one hands-off until the rest is proven.
2. **Roll out gradually:** build manual first (catches mapping bugs, builds trust) → add Level 2 chaining → turn on
   Level 3 rules for the safe lane. End state: humans approve *exceptions only* — about as automated as accounting-grade
   writes should get.

---

## 9. Recommended build order

1. **Shared prereq:** `qnePost` + `qnePut` in `lib/qneClient.ts` (with timeouts).
2. **Stock Code Creation** (foundation — codes must exist before you can quote/order them). Staging → approve → push.
3. **QT → SO → DO → Invoice** chain (start with the `QuotationToInvoice` shortcut for simple deals, then the full chain).
   Build Level 1 (auto-draft) from the start; add Level 2 (event-chaining) once stable.
4. **Part A (DB-first reads)** + re-home the partial-result guard onto the inbound sync — in parallel; needed for
   production reliability at go-live.
5. **After go-live:** stand up the new PC + enable the Part B sync schedule; layer Level 3 auto-approval.

---

## 10. Non-negotiable rules (CLAUDE.md)

Staging → human approval → master (never auto-promote). SalesOrder push now needs **single** human approval (Rule 13,
relaxed 28 Jun 2026). Zod-validate every route, no `any`, credentials from `.env.local` only, set `app.current_user_id`
before DB writes, freeze quotation `unit_cost` at draft.
