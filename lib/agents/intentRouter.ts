/**
 * lib/agents/intentRouter.ts
 *
 * Uses Claude Haiku to classify a staff member's free-text Telegram message
 * into a structured intent. No slash commands needed — staff just type naturally.
 *
 * Intents:
 *   quotation      — "raise a quote for ABC Trading, 10 reams A4..."
 *   delivery_booking — "book delivery for ORD-2026-0042"
 *   delivery_list  — "what orders are ready for delivery?"
 *   approval       — "approve QT-2026-0042" / "reject the ABC Trading quote"
 *   admin_query    — "show pending approvals" / "what's overdue today?"
 *   general        — anything else → falls through to Sales AI Agent
 */

import Anthropic from '@anthropic-ai/sdk'

export type IntentResult =
  | { type: 'quotation';        companyName: string; itemsText: string }
  | { type: 'delivery_booking'; orderRef: string }
  | { type: 'delivery_list' }
  | { type: 'approval';         action: 'approve' | 'reject'; ref: string; reason?: string }
  | { type: 'admin_query' }
  | { type: 'general' }

const CLASSIFY_PROMPT = `You are a router for an internal business Telegram bot used by a Malaysian B2B office supply company.

Classify the user's message into exactly one JSON object. No explanation — only JSON.

Intent options:

1. quotation — user wants to create a sales quotation
   {"type":"quotation","companyName":"<company>","itemsText":"<items as written>"}

2. delivery_booking — user wants to book/arrange delivery for a specific order
   {"type":"delivery_booking","orderRef":"<ORD-YYYY-NNNN or similar ref>"}

3. delivery_list — user asking what orders are ready for delivery or need booking
   {"type":"delivery_list"}

4. approval — user approving or rejecting something (quotation, account request)
   {"type":"approval","action":"approve"|"reject","ref":"<QT-YYYY-NNNN or short ID>","reason":"<if rejecting, optional reason>"}

5. admin_query — ONLY: pending quotation approvals, pending B2B account requests, or "what needs attention today" summaries
   {"type":"admin_query"}

6. general — everything else: my companies/clients, client history, product search, prices, stock, recommendations, follow-ups, sales info — falls to Sales Agent
   {"type":"general"}

Rules:
- If the message is about creating a quote/quotation and names a company, use "quotation"
- If the message references an order number (ORD-...) and delivery/book/send, use "delivery_booking"
- If the message asks about what needs to be delivered or is ready for delivery, use "delivery_list"
- "approve" / "reject" + a reference = "approval"
- ONLY use "admin_query" for: pending approvals list, pending account requests list, "what needs attention today"
- "my companies", "assigned to me", "my clients", "my accounts", client history = "general" (Sales Agent)
- Product search, prices, client history, recommendations = "general"
- When uncertain, use "general"`

export async function classifyIntent(text: string): Promise<IntentResult> {
  if (!process.env.ANTHROPIC_API_KEY) return { type: 'general' }

  // Fast heuristics first (avoid API call for obvious cases)
  const lower = text.toLowerCase().trim()

  // Explicit approve/reject pattern
  const approveMatch = lower.match(/^(approve|reject)\s+([a-z0-9\-]+)/i)
  if (approveMatch) {
    return {
      type:   'approval',
      action: approveMatch[1].toLowerCase() === 'approve' ? 'approve' : 'reject',
      ref:    approveMatch[2],
    }
  }

  // Delivery list keywords
  if (/ready for delivery|need.*delivery|pending.*delivery|what.*deliver/i.test(text)) {
    return { type: 'delivery_list' }
  }

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const resp = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 150,
      messages: [
        { role: 'user', content: `${CLASSIFY_PROMPT}\n\nMessage: "${text}"` },
      ],
    })

    const raw = resp.content[0].type === 'text' ? resp.content[0].text.trim() : ''
    const cleaned = raw.replace(/^```json\n?|\n?```$/g, '').trim()
    const parsed = JSON.parse(cleaned) as IntentResult
    return parsed
  } catch {
    return { type: 'general' }
  }
}
