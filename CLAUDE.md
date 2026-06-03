# Flexxo Sales OS — Project Memory
Last updated: 2 June 2026

## What this project is
Internal B2B Sales CRM + future e-commerce ordering system for Flexxo (KL) Sdn Bhd,
an office supply company in Malaysia (B2B, serving corporate clients).

## Business context
- Flexxo sells: stationery, pantry, hygiene, furniture, printer consumables, batteries, thermal rolls, corporate gifts
- Clients are companies (B2B), not individuals
- Sales team uses WhatsApp heavily — system should eventually reduce WhatsApp dependency
- QNE Optimum is the accounting system of record — CRM supports sales, QNE handles invoicing
- Future goal: full B2B e-commerce portal + automated ordering

---

## Tech stack
- Next.js 16.2.6 (App Router), TypeScript strict mode
- PostgreSQL + Prisma ORM
- Tailwind CSS
- NextAuth.js (credentials provider)
- Nodemailer (Gmail SMTP)
- Zod (validation on all API routes and forms)
- Node.js, npm
- tsx for running scripts (use `npx tsx`, NOT `npx ts-node` — tsx handles @/ path aliases correctly)

## Environment
- OS: Windows
- Project path: C:\Users\thund\Desktop\Claude project\Flexxo OS\flexxo-sales-os
- Database: PostgreSQL local, database name: flexxo_sales_os
- Dev server: http://localhost:3000
- Admin login: admin@flexxo.com.my

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

### QNE Agent record fields — CONFIRMED by syncAgentEmails.ts
id, staffCode, name, idNo, dateJoined, dateLeft, mobileNo, email, salary, socso, epf, taxFile, remarks, gender, isActive, isManager, defaultTeam, isDefault, commissionType

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
- GET /api/SalesInvoices — invoice history (Phase 2)
- GET /api/SalesInvoices/{id} — invoice detail
- GET /api/SalesInvoices/Find — search invoices
- GET /api/DeliveryOrders — delivery status (Phase 3)
- GET /api/Stocks — product catalogue
- GET /api/Stocks/available — live stock check
- POST /api/Stocks/GetSellingPrice — price per customer tier (Phase 2)
- POST /api/Stocks/GetSellingPriceList — price list for multiple items
- POST /api/CreditControls/CheckNewQT — credit check before quoting (Phase 2)
- GET /api/Terms — payment terms
- GET /api/TaxCodes/OutputTaxCodes — SST codes
- GET /api/Branches/ByCompany — client branch addresses
- POST /api/Users/CustomerLogin — B2B client portal login (Phase 3)
- GET /api/CustomerStatement — client statement (Phase 3)
- GET /api/ARReports/CustomerLedgerDetail — AR ledger
- GET /api/Suppliers — supplier master list
- GET /api/PurchaseInvoices — purchase history from suppliers
- GET /api/GLReports/PnL — P&L for owner dashboard (Phase 5)
- POST /api/Quotations — create quotation in QNE (Phase 2, human approval required)
- POST /api/SalesOrders — create SO in QNE (Phase 4, double approval required)
- POST /api/SalesTransfer/QuotationToInvoice — convert QT to invoice (Phase 4)

---

## Database schema
- 30 tables across 10 domains
- All PKs are UUIDs
- Key principle: staging tables first, human approval, then master tables
- Audit log written by PostgreSQL triggers (not application code)
- See prisma/schema.prisma for full schema

## Seeded master data
- Roles: Admin, Manager, Salesperson, Viewer
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
- 369 customers in staging (mix of pending_review and promoted)
- Agent auto-assignment working:
  - 9 CRM users created from QNE agents
  - 333 company assignments backfilled
  - 36 companies unassigned (no salesPerson in QNE)
- Known junk records to reject: "customer testing" (700-C001), "Quotation" (700-Q001)

### Phase 1D — User Management & Salesperson Onboarding ✅ COMPLETE
- [x] /admin/users page — set passwords, edit name/email/mobile, change role, activate/deactivate
- [x] Forced password change on first login for @flexxo.internal accounts
- [x] Role-based access control — salespeople see only their assigned companies
- [x] syncAgentEmails.ts — synced JAVENN + TIMOTHY emails from QNE; mobileNo linked
- [x] Edit User modal — admin can manually update name/email/mobile for any user
- [ ] Set real passwords for 7 remaining salespeople (BANDY, JUSTINE, LAI, VOON, CHAN KUN SHEN, ANGEL, HU YUN CHIN)
- [ ] Update their emails via /admin/users → Edit
- [ ] Reject junk QNE staging records (customer testing 700-C001, Quotation 700-Q001)

---

## Scripts in /scripts folder
Run all scripts with: `npx tsx scripts/[scriptname].ts`

| Script | Purpose | Status |
|--------|---------|--------|
| testQneConnection.ts | Basic QNE API connection test | ✅ Working |
| runSync.ts | Pull QNE customers into staging | ✅ Working |
| inspectQneFields.ts | Print full raw QNE response to find field names | ✅ Run — confirmed salesPerson field |
| fixAgentAssignment.ts | Create users from QNE agents + backfill assignments | ✅ Complete — 9 users, 333 assignments |
| syncAgentEmails.ts | Pull agent email + mobileNo from QNE → update CRM users | ✅ Run — 2 emails updated, mobileNo synced |

---

## Roles and what each sees
| Role | Access level |
|------|-------------|
| Admin (Bandy/owner) | Full system — all data, all approvals, system settings |
| Manager | All salespeople's pipelines, quotation approval queue, team stats |
| Salesperson | Own accounts only, own pipeline, own activities, quote builder |
| Logistics/Ops | Order fulfilment board, delivery status, stock alerts (Phase 3+) |
| B2B Client | Own orders, invoices, delivery tracking, reorder (Phase 3) |

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

## What NOT to automate (v1 rules)
- Do not auto-promote QNE staging records
- Do not auto-merge duplicates
- Do not auto-update quotation costs when supplier prices change
- Do not let AI write is_current:true on supplier_price_versions
- Do not send quotations without human clicking send
- Do not create Sales Orders in QNE without double human approval

---

## .env.local variables
```
DATABASE_URL="postgresql://postgres:Flexxo%408820@localhost:5432/flexxo_sales_os"
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
```

---

## Phases ahead
| Phase | What | Status |
|-------|------|--------|
| 1A | CRM Foundation | ✅ Complete |
| 1B | QNE Customer Import | ✅ Complete |
| 1C | Supplier price database (Google Drive PDF + Claude AI extraction) | ✅ Complete |
| 1D | User management + salesperson onboarding + RBAC | ✅ Complete |
| 2 | Quotation automation (draft, approve, send, push to QNE) | 🔴 Next |
| 3 | B2B client self-service portal (login, reorder, RFQ, delivery tracking) | Not started |
| 4 | Automated order processing (SO creation in QNE, reorder forecasting) | Not started |
| 5 | AI sales intelligence (health scores, forecasting, cross-sell, P&L dashboard) | Not started |

## Future features discussed
- Phone number + PIN login for salespeople (easier than email for field team)
- WhatsApp OTP login for B2B client portal (Phase 3)
- Mailchimp sync for missing client emails (low priority side quest)
- Salesperson leaderboard and coaching dashboard (Phase 5)
- Multi-branch delivery address support via QNE Branches API
- Customer health scoring: Growing / Stable / At Risk / Churning
- Price increase impact analysis (when supplier raises cost, show affected clients)
- Cross-sell engine (clients who buy X but not Y)
- Weekly auto-generated sales report PDF emailed to owner
- Delivery route optimisation by area for logistics team
