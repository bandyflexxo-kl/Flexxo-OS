# QNE Sync Worker — Architecture Proposal

> **Status:** Proposal / plan only. No code. Authored 27 Jun 2026.
> **Supersedes:** the "flexxo-qne-gateway" push-gateway idea (declined).
> **Relates to:** [`docs/qne-write-integration-brief.md`](qne-write-integration-brief.md) (the QT→SO→DO→Invoice + stock-creation contracts this worker executes), Part A (stock-code creation), the Tender module (PO/GRN writes), and the future B2C payment flow (`QuotationToInvoice`).
> **Decision needed before build:** worker host (office PC vs dedicated mini-PC), poll interval, and whether a separate DEV database is introduced for in-progress branches.

---

## 1. Problem

The live site runs on **Vercel** (serverless cloud). **QNE Optimum** runs **on-premise**, reachable only via the **Radmin VPN** (`http://26.255.19.220:82`, a LAN address). Vercel has no VPN, so **the live site can never reach QNE directly** — not with SALES 6, not with FLEXXOAI, not with any account. That is physics, not configuration.

Yet the product needs QNE **reads** (prices, stock, customers, invoices — already synced today) **and writes** (stock-code creation, QT→SO→DO→Invoice, tender PO/GRN). The write side is what this document solves.

---

## 2. Principle

> **The live site never talks to QNE. It only talks to its own database (Supabase). A VPN-connected worker is the only thing that touches QNE, in both directions.**

```
[Vercel live site]
      │  (1) a user action needs a QNE write
      │      → INSERT a job row into Supabase  (status: pending)
      ▼
[Supabase]   qne_jobs  ◄───────────────────────────┐
      ▲                                              │ (2) poll every ~30–60s
      │  (4) worker writes status + QNE refs back    │     (OUTBOUND only)
      │                                              │
[QNE Sync Worker]  ──  always-on machine ON the Radmin VPN
      │  (3) claim pending job → execute against QNE
      ▼
[QNE Optimum]   (LAN — reachable because the worker is on the VPN)
```

The live UI shows a status (`pending → processing → synced / failed`) that flips when the worker writes back. The user is never blocked on QNE or the VPN.

---

## 3. Why **pull**, not push (the professional choice)

| Concern | Push gateway (declined) | **Pull worker (this proposal)** |
|---|---|---|
| Network exposure | Office must accept **inbound** calls (Cloudflare Tunnel / open path) | **Outbound only** — office connects out to Supabase it already uses. No tunnel, no open ports, no firewall changes |
| "Internal API" | Exposes an API surface | **No exposed API at all** — directly satisfies the "no Internal API" decision |
| Resilience | Request fails if office is down | Jobs **queue + retry**; office can reboot; live UX unaffected |
| Coupling | Live UX waits on QNE/VPN | Fully **async**; QNE writes aren't real-time-critical |
| Familiarity | New pattern | Same shape as today's reads + existing `lib/syncJobStore.ts` / `/api/admin/sync-jobs` |

This is the standard hybrid cloud↔on-prem ERP integration pattern (cf. Azure Hybrid Connections, AWS outbound agents, webhook-relay workers).

---

## 4. Data model — `qne_jobs`

A single queue table in Supabase. Conceptual shape (final Prisma field names decided by the schema owner):

| Field | Type | Purpose |
|---|---|---|
| `id` | uuid PK | job id |
| `type` | string | job type — see §7 catalog (e.g. `stock.create`) |
| `status` | string | `pending` → `processing` → `done` / `failed` / `blocked` |
| `payload` | json | input the worker sends to QNE (already validated at enqueue time) |
| `result` | json? | QNE response refs written back (e.g. `{ qneCode, qneId, detailIds }`) |
| `idempotency_key` | string unique | dedupe key, e.g. `stock.create:<productId>` — prevents duplicate QNE docs |
| `depends_on_id` | uuid? | this job runs only after the referenced job is `done` (chain ordering) |
| `branch_code` | string | `KL` today; routes to the right QNE creds/worker later (multi-branch) |
| `source_table` | string | CRM row this job mirrors (`products`, `supplier_pos`, …) for reconciliation |
| `source_id` | string | CRM row id |
| `attempts` | int | retry counter |
| `max_attempts` | int | default 3 |
| `last_error` | text? | QNE business message on failure |
| `priority` | int | lower = sooner (default 100) |
| `available_at` | timestamptz | not eligible to run before this (backoff scheduling) |
| `claimed_by` | string? | worker instance id holding the lock |
| `claimed_at` | timestamptz? | lock timestamp (stale-lock reclaim) |
| `requested_by` | uuid? | user who triggered it (audit) |
| `approved_by` | uuid? | second approver where double-approval is required |
| `created_at` / `updated_at` / `completed_at` | timestamptz | lifecycle |

**Indexes:** `(status, available_at, priority)` for the claim query; unique on `idempotency_key`; `(source_table, source_id)` for reconciliation.

**Status lifecycle**
```
pending ──claim──▶ processing ──success──▶ done
   ▲                   │
   │              failure (retryable) ──▶ pending (available_at = now + backoff, attempts++)
   │                   │
   └───────────  failure (permanent / attempts exhausted) ──▶ failed
blocked  ◀── dependency failed, or QNE returned a business rejection needing a human
```

---

## 5. The **enqueue** contract (Vercel side)

Vercel API routes **never call QNE**. They validate, then enqueue.

**`enqueueQneJob(input)`** — a shared helper (lives in `lib/qne/queue` on the platform layer). Responsibilities:

1. **Validate** the payload with the existing Zod schema for that job type (e.g. Part A's `newStockSchema`).
2. **Authorize / gate** — confirm the action's approval rules are met (CLAUDE.md): quotations need approve→send; SalesOrders need *double* approval; etc. The gate is enforced *here*, before the job exists.
3. **Compute `idempotency_key`** from the CRM row + action. If a `done` job with that key exists, return its cached `result` instead of creating a duplicate.
4. **Set `depends_on_id`** when the job is part of a chain (SO depends on the QT job; DO on the SO job; Invoice on the DO job).
5. **Insert** the row (`status: pending`) and return `{ jobId, status }`.

The route returns immediately; the UI polls job status (or subscribes). **The CRM database remains the system of record** — the job only mirrors an already-saved CRM intent to QNE.

**Contract summary**

| Step | Guarantee |
|---|---|
| Enqueue | Idempotent (same key ⇒ same job), pre-validated, pre-authorized |
| Return | `{ jobId, status: 'pending' \| 'done' (cached) }` — never blocks on QNE |
| Ordering | Expressed via `depends_on_id`, not timing |

---

## 6. The **worker** contract (office side)

A single long-running Node process (`scripts/qneWorker.ts`) on a VPN-connected machine. It **reuses the existing libs** — `lib/qneClient.ts` (`qneLogin`/`qneGet`/`qnePost`), `lib/qneProductCreate.ts`, `lib/qneStockMasters.ts`, and the create-helpers from the write brief. Loop:

```
every POLL_INTERVAL seconds:
  1. CLAIM one job:
       UPDATE qne_jobs SET status='processing', claimed_by=:worker, claimed_at=now()
       WHERE id = (
         SELECT id FROM qne_jobs
         WHERE status='pending' AND available_at <= now()
           AND (depends_on_id IS NULL OR depends_on_id IN (SELECT id FROM qne_jobs WHERE status='done'))
         ORDER BY priority, available_at
         FOR UPDATE SKIP LOCKED   -- atomic claim, safe for >1 worker
         LIMIT 1)
       RETURNING *;
  2. If a dependency is required, read its result (QNE detail ids) and merge into the payload.
  3. EXECUTE against QNE via the matching handler (§7). One QNE call (or the documented chain step).
  4. On success → status='done', result=<QNE refs>, completed_at=now(); write refs back to the source row.
  5. On retryable failure (VPN down / 5xx / timeout) → status='pending', attempts++, available_at=now()+backoff.
  6. On permanent failure (QNE business rejection, e.g. credit block, duplicate code) → status='failed' (or 'blocked'),
     last_error=<QNE message>; alert.
```

**Worker guarantees**

| Property | How |
|---|---|
| Exactly-once *effect* | `idempotency_key` + claim lock + write-back before marking `done` |
| Safe concurrency | `FOR UPDATE SKIP LOCKED` — multiple worker instances never double-claim |
| Crash safety | Stale `processing` locks (claimed_at older than N min) are reclaimed to `pending` |
| Ordered chains | A job stays unclaimable until `depends_on_id` is `done` |
| Token handling | Worker owns the QNE login + token refresh; the token never leaves the office |
| Backoff | attempt 1 immediate, 2 → +2 min, 3 → +10 min, then `failed` + alert |

---

## 7. Job-type catalog (the heart — how everything plugs in)

Each `type` maps to one handler that builds the QNE payload and calls the right endpoint. Payloads are the same shapes already proven against live QNE.

| `type` | Triggered by | QNE call | Result written back | Depends on |
|---|---|---|---|---|
| `master.brand.create` | Part A "add new brand" | `POST /StockClasses` | brand code | — |
| `master.category.create` | Part A "add new category" | `POST /StockCategories` | category code | — |
| `master.group.create` | Part A "add new group" | `POST /StockGroups` | group code | — |
| `stock.create` | **Part A** push-to-QNE | `POST /Stocks` (+ `PUT /Stocks` for extra UOMs) | `qneStockCode`, `qneStockId` → `products` | optional master.* |
| `quotation.create` | Quotation approved → send | `POST /Quotations` | `qneId`, `qneCode`, line `detailIds` → `quotations` | — |
| `salesorder.create` | Order confirmed (double-approved) | `POST /SalesOrders` (transferFrom QT detail ids) | `qneSoId`, `qneSoCode`, detail ids | `quotation.create` |
| `deliveryorder.create` | Order packed | `POST /DeliveryOrders` (transferFrom SO detail ids) | `qneDoId`, `qneDoCode`, detail ids | `salesorder.create` |
| `invoice.create` | Order delivered / billed | `POST /SalesInvoices` (transferFrom DO detail ids) | `qneInvoiceId`, `qneInvoiceCode` | `deliveryorder.create` |
| `quotation.to_invoice` | **B2C** payment success | `POST /SalesTransfer/QuotationToInvoice?quotationId=` | invoice code (via follow-up GET) | `quotation.create` |
| `tender.supplier_po.create` | **Tender** Supplier PO issued | `POST /PurchaseOrders` (or agreed PO endpoint) | `qnePoCode` → `supplier_pos` | — |
| `tender.grn.create` | **Tender** goods received | `POST /GRNs` | `qneGrnCode` → `goods_receipts` | `tender.supplier_po.create` |
| `tender.client_po.sales_order` | **Tender** client PO recorded | `POST /SalesOrders` | `qneSalesOrderCode` → `client_pos` | — |

New QNE writes anywhere in the system become **a new row in this table, not a new exposed endpoint.**

---

## 8. How **Part A** (stock-code creation) plugs in

Today (worktree) Part A pushes synchronously via `POST /api/admin/products/[id]/push-to-qne`. Under this design that route changes from *"call QNE now"* to *"enqueue `stock.create`"*:

1. Admin saves a product → `products` row, `qnePushStatus: 'local_only'` (unchanged).
2. Admin clicks **Push to QNE** → route calls `enqueueQneJob({ type: 'stock.create', idempotency_key: 'stock.create:'+productId, payload: <NewStockInput from products.qnePushPayload>, source: products/<id> })`. Set `products.qnePushStatus = 'pending'`.
3. If the product uses a brand/category/group not yet in QNE, the modal's "add new" enqueues `master.*.create` jobs first and sets the `stock.create` job's `depends_on_id`.
4. Worker runs `stock.create` → `createQneStockCode(...)` → writes `qneItemCode` + `qnePushStatus = 'synced'` (or `failed` + `qnePushError`).
5. The existing **`SyncJobsIndicator`** surfaces queue depth / failures; the product row shows live status.

**Net change to Part A:** swap the one direct call for an enqueue. Everything else (Zod, duplicate gate, frozen `qnePushPayload`, the `qne_push_*` columns already in prod) stays exactly as built and verified.

---

## 9. How **Tender** plugs in

The tender models already carry QNE mirror fields — `ClientPO.qneSalesOrderCode`, `SupplierPO.qnePoCode`, `GoodsReceipt.qneGrnCode`, `TenderItem.qneStockCode` — which is exactly what the worker writes back:

- **Supplier PO issued** (after Gate approval) → enqueue `tender.supplier_po.create` → worker writes `qnePoCode`.
- **GRN recorded** → enqueue `tender.grn.create` (depends on the PO job) → worker writes `qneGrnCode`.
- **Client PO → QNE Sales Order** → enqueue `tender.client_po.sales_order` → worker writes `qneSalesOrderCode`.
- A tender item with no QNE stock code yet reuses **Part A's `stock.create`** job first (shared handler), then the PO job depends on it.

The tender feature flag `tender.qne_writes_enabled` becomes a **gate at enqueue time**: when off, the UI still records everything in the CRM but no jobs are created. Flip it on to start mirroring to QNE — no code change, just enqueueing begins.

---

## 10. Idempotency, ordering & the no-duplicate guarantee

- **No duplicate QNE documents:** every enqueue carries an `idempotency_key` derived from the CRM row + action. Re-clicks, retries, and double-submits all collapse to the same job; a `done` job returns its cached `result`.
- **Chain ordering without timing games:** `depends_on_id` makes SO wait for QT, DO for SO, Invoice for DO. The worker injects the upstream QNE detail ids into the downstream payload's `transferFrom`.
- **Human-in-the-loop on business rejections:** a QNE credit block or validation rejection sets `blocked` (not silent `failed`), surfaced to an admin who can amend and re-queue.

---

## 11. Security

- **Outbound-only office connectivity** — the worker dials Supabase and QNE; nothing dials *in*. No tunnel, no port-forward, no inbound firewall rule.
- **QNE credentials (FLEXXOAI) live only on the worker host** — never in Vercel, never in the browser, never in `result`.
- **Queue access** — the table is written by Vercel (service role) and the worker only; consider Postgres RLS so the anon/client key can never read or write `qne_jobs`.
- **Audit** — `requested_by` / `approved_by` / `last_error` / timestamps give a full trail of who asked for which QNE write and what QNE said.
- **No secrets in the doc/repo** — the worker reads `QNE_USERNAME` / `QNE_PASSWORD` (FLEXXOAI) from its own `.env.local`; the hardcoded `'SALES 6'` fallback in `lib/qneClient.ts` should be removed as part of this work.

---

## 12. Worker host & operations

| Topic | Recommendation |
|---|---|
| Host | Any always-on machine **on the Radmin VPN**. Office PC works; a dedicated **mini-PC** is cleanest (no accidental shutdown). |
| Process mgr | **pm2** + `pm2-windows-startup` (or a Windows Service) → auto-restart on crash, auto-start on boot. |
| Heartbeat | Worker upserts a `worker_heartbeat` row each loop; the admin health widget shows "worker online / last beat". |
| Alerts (reuse Telegram) | worker down > N min; queue depth > threshold; any job → `failed`/`blocked`; QNE auth failure. |
| Restarts | Safe — in-flight `processing` jobs are reclaimed after a stale-lock timeout; pending jobs simply wait. |
| Migration to device change | Stateless worker — move `.env.local` + restart pm2 on the new host; the queue lives in Supabase. |

---

## 13. Observability (mostly already exists)

- **`SyncJobsIndicator`** + `/api/admin/sync-jobs` extend to show `qne_jobs` queue depth, processing, failed/blocked counts.
- Per-record status on the source row (`products.qnePushStatus`, `supplier_pos.qnePoCode`, …) gives users inline feedback.
- A simple **/admin/qne-jobs** list (filter by status/type, retry/cancel buttons) for operators.

---

## 14. Failure modes

| Failure | Behaviour |
|---|---|
| VPN down / QNE unreachable | jobs stay `pending`, retry with backoff; alert if sustained; live UX unaffected |
| Office PC off / rebooting | jobs wait; worker resumes on boot (pm2) and drains the queue |
| QNE business rejection (credit, duplicate, bad code) | job → `blocked` with QNE's message; admin amends + re-queues |
| Two workers running | safe — `FOR UPDATE SKIP LOCKED` prevents double-claim |
| Poison job (always fails) | capped at `max_attempts` → `failed`; never blocks the queue |
| Schema/DB drift | the worker and Vercel share one Supabase; **only the schema owner runs `db push`** (see multi-session rules) |

---

## 15. Multi-branch readiness

`branch_code` on every job. Today everything is `KL` and one worker. Later: either one worker that selects per-branch QNE creds by `branch_code`, or one worker per branch each claiming only its `branch_code` rows. No redesign needed.

---

## 16. Phased rollout

| Phase | Scope | Exit criteria |
|---|---|---|
| **0** | `qne_jobs` table + `enqueueQneJob` helper + worker skeleton (claim/heartbeat/backoff), one no-op job type | worker drains a test job end-to-end on the VPN host |
| **1** | `stock.create` (+ `master.*`) — wire **Part A** to enqueue | a real stock code created in QNE via a queued job, status reflected in UI |
| **2** | `quotation.create` → `salesorder.create` → `deliveryorder.create` → `invoice.create` chain (the write brief) | full QT→SO→DO→Invoice mirrored from one approval flow |
| **3** | **Tender** `supplier_po.create`, `grn.create`, `client_po.sales_order` behind `tender.qne_writes_enabled` | tender POs/GRNs appear in QNE |
| **4** | **B2C** `quotation.to_invoice` + payment gateway | one-click B2C checkout issues a QNE invoice |
| **5** | Ops hardening — `/admin/qne-jobs`, alerts, RLS, remove `SALES 6` fallback | runbook complete |

---

## 17. Open decisions

1. **Worker host** — office PC now, or buy a mini-PC before go-live?
2. **Poll interval** — 30s (snappier) vs 60s (lighter). Writes aren't real-time; 30–60s is fine.
3. **DEV database** — introduce a separate dev DB so in-progress branches stop sharing the prod queue/schema (strongly recommended alongside the 4-session plan).
4. **QNE PO/GRN endpoints** — confirm the exact endpoints + payloads for tender (`PurchaseOrders`, `GRNs`) the same way Part B confirmed QT→SO→DO→Invoice.
5. **Ownership** — this queue + worker is **platform/foundation** territory; feature sessions only *enqueue*.

---

## 18. One-line summary

> Live stays fast and offline-safe; a single hidden, outbound-only worker on the VPN is the one place that ever writes to QNE — every stock code, quotation, order, invoice, tender PO and GRN flows through one auditable queue, with no exposed endpoint and no duplicate documents.
