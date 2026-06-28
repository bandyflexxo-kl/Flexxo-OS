# QNE Write Integration — Implementation Brief

> **Status:** Spec ready. Researched 27 Jun 2026; aligned 28 Jun 2026 with `docs/qne-data-architecture-brief.md` (the broader DB-first + sync companion). Not yet implemented.
> **Scope:** Add the **write** side to QNE — (A) Stock Code Creation, (B) QT → SO → DO → Invoice chain.
> **Companion file:** [`docs/stock-code-creation-sop.pdf`](stock-code-creation-sop.pdf) — the official Stock Code Creation SOP. Its rules are already transcribed into Part A below, so this brief is self-contained; the PDF is the canonical reference + shows the QNE form screenshot.
> **Before coding:** read `CLAUDE.md` and obey its Core Rules. Radmin VPN (network `Flexxokl`) must be active to reach QNE at `http://26.255.19.220:82/api`.

---

## 0. Current state — what exists vs. what's new

| Component | State |
|-----------|-------|
| `lib/qneClient.ts` | Has `qneLogin`, `qneHeaders`, `qneGet`. **No `qnePost` — must add (shared prerequisite §1).** |
| `lib/qneQuotationSync.ts`, `qneSalesOrderSync.ts`, `qneDeliveryOrderSync.ts`, `qneInvoiceSync.ts` | All **READ-ONLY** (sync FROM QNE → CMS). The write functions in this brief are new and separate. |
| Lalamove delivery (`lib/lalamoveClient.ts`) | Built — physical delivery. Distinct from QNE DeliveryOrder (accounting/stock-out doc). |
| Multi-branch | Not built. **Every new function takes a `branchCode` param** (KL-only data for now; KK/Kuching later — see `project-multi-branch` memory). |

QNE swagger: `http://26.255.19.220:82/doc/v2/swagger.json`.

---

## 1. Shared prerequisite — add `qnePost` to `lib/qneClient.ts`

```ts
export async function qnePost<T>(path: string, body: unknown, token: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${QNE_API_URL}${path}`, {
      method: 'POST',
      headers: { ...qneHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (err) {
    throw new QneUnavailableError(`QNE unreachable: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!res.ok) throw new Error(`QNE POST ${path} returned HTTP ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}
```
(Add a matching `qnePut` for multi-UOM updates — see §2 A4.)

---

## 2. PART A — Stock Code Creation (SOP-aligned)

**QNE endpoint:** `POST /api/Stocks` (model `NewStock`). Only `stockName` is required by QNE, but the **SOP requires much more** (below). `autoCode: 0` = manual stock code.

### A1. Preset-code mapping — the heart of the SOP

| QNE field | SOP meaning | CMS source | Required |
|-----------|-------------|------------|----------|
| `category` | **Main** category | 10 shop parent categories | ✅ |
| `group` | **Sub**-category | 65 shop sub-categories | ✅ |
| `class` | **Brand** | **Brand master** (QNE `StockClasses`) | ✅ **MUST** |

- Brand becomes a managed master: dropdown from `GET /api/StockClasses`; "add new" → `POST /api/StockClasses` (`{ classCode, description }`).
- Categories/groups: `GET/POST /api/StockCategories` (`{ categoryCode, description }`), `GET/POST /api/StockGroups` (`{ groupCode, description }`).
- Same category/group drives **B2C + B2B website display** → must map 1:1 to the shop category tree.
- **Admin MANUALLY selects all three on every product** (Category → Sub-category → Brand, from dropdowns) — no auto-classification. **Brand is mandatory: block submit if empty** (it drives report-by-brand listing).

### A2. Guided stock-NAME builder (assemble, don't free-type)

Enforce SOP order, with a live preview:
```
[Brand] / [Code] / [Description—search keyword] / [Identity] / [Size] / [Color] / [Packing]
e.g.  APLUS / A4-80 / Copier Paper / Premium / A4 210x297mm / White / 5rim/ctn
```
Size hint: `A4/A3/A1` or `L x W x H mm`. Packing hint: `12pcs/pkt, 12pkt/ctn`.

### A3. Stock code rules — follow the **real QNE house format**
`autoCode: 0` (manual — we assign the code; it lands in QNE beside ~7,500 existing codes, so it must match house style). Sampled from the live QNE DB, the real format is: **UPPERCASE**, brand- or product-type-led (often brand+model concatenated), avg ~13 chars (range 3–38). ~Half contain **spaces**; **dashes, dots, slashes, `()`, `&`** also appear because codes **follow the supplier's code**. So: uppercase, unique, follow the supplier code, allow `- / . ( ) &` + spaces; avoid only genuinely confusing junk. Real examples: `HP CE505A`, `APLUSLF65`, `STABILOPEN3480.7BL`, `FD-CFC-A1(4D)`, `M&GAPM21372BL`.

### A4. Prices
| QNE field | SOP meaning | Required |
|-----------|-------------|----------|
| `listPrice` | Sales / selling price | ✅ MUST |
| `purchasePrice` | Standard purchase price (supplier list, not long-term) | ✅ MUST |
| `minPrice` | Lowest allowed selling price | recommended |

### A5. Multi-UOM
`baseUOM` = minimum selling unit (MUST). Additional UOMs in a repeatable table → QNE `UOMDto`:

| Form column | `UOMDto` field | Note |
|-------------|----------------|------|
| UOM code | `uomCode` | e.g. BOX, CTN |
| Conversion | `rate` | base units per this UOM (1 CTN = 60 PCS → 60) |
| Barcode | `barCode` | per UOM |
| Description | `description` | |
| Sales price | `salesPrice` | |
| Purchase price | `purchasePrice` | |
| (defaults) | `salesUOM`, `purchaseUOM` on `StockDto` | default selling / buying UOM |

**Write path:** `POST /api/Stocks` creates the **base UOM only**. Additional UOMs + `salesUOM`/`purchaseUOM` defaults go via a follow-up `PUT /api/Stocks` (`StockDto.uoMs[]`). There is **no** `POST /api/Stocks/{id}/UOMS` (GET only) — verify the PUT accepts new UOM rows during implementation.

### A6. Duplicate check (mandatory gate, before any create)
1. On code entry → `GET /api/Stocks/Find?code=` + check `products` table.
2. On name build → fuzzy match brand + description vs. existing (reuse the token-Jaccard matcher in the codebase).
3. Show matches → human confirms it's new. **Never auto-merge** (CLAUDE.md rule 5).

### A7. Validation (Zod + form) — encodes the SOP "DON'Ts"
- Stock code: auto-**UPPERCASE**; allow `A–Z 0–9`, space, and `- / . ( ) &`; enforce **uniqueness**; *warn* (don't hard-block) if unusually long. Do **not** blanket-reject symbols — real + supplier codes use them.
- Reject names containing `test`/`testing`.
- Require: category, group, class (brand), base UOM, sales price, purchase price.
- Exactly one category per item.
- Optional **"Send for review"** state before QNE push (fits staging→approval).

### A8. Persistence, status, branch-awareness
- DB: `products.qnePushStatus` enum → `synced | pending | failed | local_only`.
- `lib/qneProductCreate.ts` → `createQneStockCode(branchCode, payload)`.
- API: `app/api/admin/products/route.ts` (POST) → Zod-validate → **save to `products` first (`pending`)** → push to QNE → on success `synced` + store QNE id; on failure set `failed` + log reason. Retry button re-pushes `pending` **and** `failed`. Product never lost if QNE rejects.
- UI: guided "New Product" modal on `/admin/products` + "Push pending to QNE" retry button.
- "Further Description" image → link to existing Supabase product-photo pipeline; spec text → `remark1..5`.

### A9. `NewStock` payload (assembled)
```jsonc
{
  "autoCode": 0,
  "stockCode": "A4-80",
  "stockName": "APLUS / A4-80 / Copier Paper / Premium / A4 210x297mm / White / 5rim/ctn",
  "baseUOM": "RIM",
  "category": "ST",        // Main — REAL QNE category code (GET /api/StockCategories), mapped from shop parent
  "group": "PAPER",        // Sub  — REAL QNE group code (GET /api/StockGroups); NOT the shop slug e.g. "os--paper"
  "class": "APLUS",        // Brand (MUST) — REAL QNE class code (GET /api/StockClasses)
  "listPrice": 12.50,      // selling (MUST)
  "purchasePrice": 8.00,   // standard purchase (MUST)
  "minPrice": 10.00,       // lowest selling
  "defaultOutputTaxCode": "SR",
  "barCode": "...",
  "description": "..."
}
```

> **Decision (updated 28 Jun 2026):** **prioritized for go-live** — build it now (previously deferred to KK/Kuching onboarding). Stock codes are foundational — they must exist before you can quote/order them — and the guided CMS form makes the SOP structurally enforceable for KL today. Build order: `docs/qne-data-architecture-brief.md` §9. QNE account: test on `SALES 6`; the `pending`/`failed` + retry model absorbs any write-permission gap until a proper admin account is set.

---

## 3. PART B — QT → SO → DO → Invoice chain

**Concept:** each document has its own POST. Each *line* links to its source line via a **`transferFrom`** object — that's how QNE tracks fulfilment and prevents double-invoicing. **Capture the QNE-returned doc `id` + each detail-line `id` and store them on the CMS rows**, because the next document references them.

```
QT ──transferFrom.quotationDetailId──▶ SO
                                       │
   ┌───────────────────────────────────┘
   ▼
DO ──transferFrom.{quotationDetailId, salesOrderDetailId}──▶ Invoice
                                                              transferFrom.{quotationDetailId,
                                                                            salesOrderDetailId,
                                                                            deliveryOrderDetailId}

SHORTCUT (simple deals, skip SO/DO):
   POST /api/SalesTransfer/QuotationToInvoice?quotationId={uuid}
```

| Step | Endpoint | Required | Line `transferFrom` |
|------|----------|----------|---------------------|
| Quotation | `POST /api/Quotations` | `quotationDate`, `customer` | — |
| Sales Order | `POST /api/SalesOrders` | `customer` | `{ quotationDetailId }` |
| Delivery Order | `POST /api/DeliveryOrders` | `customer` | `{ quotationDetailId, salesOrderDetailId }` |
| Invoice | `POST /api/SalesInvoices` | `customer` | `{ quotationDetailId, salesOrderDetailId, deliveryOrderDetailId }` |
| QT→Invoice shortcut | `POST /api/SalesTransfer/QuotationToInvoice?quotationId={uuid}` | quotationId (query) | auto |
| PDF (any doc) | `GET /api/Reports/{Quotations\|SalesOrders\|DeliveryOrders\|SalesInvoices}/{id}/download` (or `/url`) | — | — |

**Body shape** (Quotation; SO/DO/Invoice near-identical — date field differs: `orderDate`/`doDate`/`invoiceDate`):
```jsonc
{
  "quotationDate": "2026-06-27",
  "customer": "C00123",            // QNE customer code (REQUIRED)
  "customerName": "ACME Sdn Bhd",
  "salesPerson": "JUSTINE",
  "term": "30D", "attention": "...", "phone": "...",
  "address1": "...", "address2": "...", "address3": "...", "address4": "...",
  "isTaxInclusive": false,
  "details": [
    {
      "stock": "A4-80", "description": "Copier Paper A4",
      "qty": 10, "uom": "RIM", "unitPrice": 12.50,
      "discount": "5%", "taxCode": "SR", "pos": 1
      // SO/DO/Invoice add: "transferFrom": { "quotationDetailId": "...", ... }
    }
  ]
}
```

**CMS build:**
- `lib/qneQuotationCreate.ts`, `qneSalesOrderCreate.ts`, `qneDeliveryOrderCreate.ts`, `qneInvoiceCreate.ts` — each `(branchCode, crmDocId)`: map CMS row → payload, POST, store returned `id` + line `id`s back on CMS rows.
- DB: add `qneId` (doc) + `qneDetailId` (line) to `quotations`/`quotation_items`, `orders`/`order_items`, plus DO + invoice refs.
- Email PDF via `/api/Reports/.../download`.
- QNE DeliveryOrder records stock-out; physical delivery stays Lalamove (already built) — both may be needed.

---

## 4. Approval gates — when each QNE write is allowed (CLAUDE.md)

| QNE write | CMS trigger |
|-----------|-------------|
| `POST /api/Quotations` | CMS quotation `approved` → user clicks **Send** |
| `POST /api/SalesOrders` | Order `approved` + **single human approval** (Core Rule 13 — relaxed from double 28 Jun 2026; re-tighten before production scale) |
| `POST /api/DeliveryOrders` | Order `packed`/ready (records stock-out) |
| `POST /api/SalesInvoices` / `QuotationToInvoice` | Order `delivered` / ready to bill |

Never auto-promote staging. All routes Zod-validated, no `any`, credentials from env only, set `app.current_user_id` before DB writes.

---

## 5. Multi-branch readiness
Every create function takes `branchCode`. For now it resolves to KL's QNE creds (current env). Later it reads per-branch creds from the planned `branches` table — no rework. See `project-multi-branch` memory.

---

## Appendix — SOP DO / DON'T (from the PDF)

**DO:** clear unambiguous fields; allow reference image in "Further Description" (esp. unfamiliar items); follow the format strictly; check existing codes first; standardized descriptions; include brand/size/color/model/spec; correct UOM; confirm category & grouping; ask if unsure; keep codes simple & searchable; accurate supplier costing.

**DON'T:** duplicate codes; personal short forms; create without checking; change naming format between branches; special symbols / unnecessary wording; one item under multiple categories; skip specs; blindly copy old codes; create test codes in live system; proceed when unclear.
