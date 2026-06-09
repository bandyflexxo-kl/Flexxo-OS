/**
 * lib/qne.ts — QNE ERP integration facade (READ ONLY).
 *
 * This file is the single authorised entry point for QNE API calls.
 *
 * SAFETY RULE: No POST, PUT, PATCH, or DELETE to business data endpoints
 * is allowed anywhere in this codebase without explicit double human
 * approval from BANDY (see CLAUDE.md § QNE read-only rule).
 *
 * The only POST here is /Users/Login (authentication) — it creates a
 * session token, not business data.
 *
 * All exports in this file:
 *   getCustomerSummary   — customer master data from QNE
 *   getCreditSummary     — customer aging / outstanding balance
 *   getAgentSummary      — salesperson order summary
 *   getInvoiceSummary    — invoice list per agent
 *
 * Verify read-only compliance:
 *   grep -n "method.*POST\|method.*PUT\|method.*PATCH\|method.*DELETE" lib/qne.ts
 *   → should return 0 lines (Login POST is via imported qneLogin(), not inline)
 */

import { qneLogin, qneGet } from './qneClient'

// ── Customer ──────────────────────────────────────────────────────────────────

export interface QneCustomer {
  id:          string
  code:        string
  name:        string
  salesPerson: string | null
  creditLimit: number | null
  phone:       string | null
  email:       string | null
}

/**
 * Fetch a single customer's master data from QNE.
 * GET /api/Customers/{id}
 */
export async function getCustomerSummary(customerId: string): Promise<QneCustomer> {
  const token = await qneLogin()
  return qneGet<QneCustomer>(token, `Customers/${customerId}`)
}

// ── Credit / Aging ────────────────────────────────────────────────────────────

export interface QneCreditSummary {
  customerId:       string
  customerName:     string
  currentBalance:   number
  overdue30:        number
  overdue60:        number
  overdue90:        number
  overdueAbove90:   number
  totalOutstanding: number
  creditLimit:      number
}

/**
 * Fetch a customer's aging / outstanding balance from QNE.
 * GET /api/Customers/AgingSummary
 */
export async function getCreditSummary(customerId: string): Promise<QneCreditSummary | null> {
  const token = await qneLogin()
  const list  = await qneGet<QneCreditSummary[]>(token, 'Customers/AgingSummary')
  return list.find((r) => r.customerId === customerId) ?? null
}

// ── Agent / Salesperson ───────────────────────────────────────────────────────

export interface QneAgentOrderSummary {
  agentCode:    string
  agentName:    string
  totalAmount:  number
  orderCount:   number
  period:       string
}

/**
 * Fetch order summary for a specific salesperson.
 * GET /api/Agents/{code}/OrderSummary
 */
export async function getAgentSummary(agentCode: string): Promise<QneAgentOrderSummary> {
  const token = await qneLogin()
  return qneGet<QneAgentOrderSummary>(token, `Agents/${agentCode}/OrderSummary`)
}

// ── Invoice ───────────────────────────────────────────────────────────────────

export interface QneInvoiceSummary {
  agentCode:   string
  invoiceNo:   string
  customerId:  string
  totalAmount: number
  date:        string
}

/**
 * Fetch invoice summary list per agent.
 * GET /api/Agents/InvoiceSummary
 */
export async function getInvoiceSummary(): Promise<QneInvoiceSummary[]> {
  const token = await qneLogin()
  return qneGet<QneInvoiceSummary[]>(token, 'Agents/InvoiceSummary')
}
