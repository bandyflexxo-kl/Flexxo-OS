/**
 * lib/agents/operationAgentCore.ts
 * Operation AI Agent — handles delivery coordination, order tracking, Lalamove booking.
 * Used by the web chat UI (SSE) and Telegram webhook.
 */
import Anthropic from '@anthropic-ai/sdk'
import {
  listOrdersReadyForDelivery,
  getDeliveryQuote,
  bookDelivery,
  getDeliveryStatus,
  getOrderDetails,
  type ToolResult,
} from './operationAgentTools'

// ── System prompt ─────────────────────────────────────────────────────────────

const OPS_SYSTEM_PROMPT = `You are the Flexxo Operation AI Agent — the logistics coordinator for Flexxo (KL) Sdn Bhd, a B2B office supply company in Kuala Lumpur, Malaysia.

## Your role
Help operations staff and management:
1. Check which orders are packed and ready for delivery
2. Get Lalamove delivery quotes (Motorcycle / MPV / VAN) with smart pickup times
3. Book deliveries and confirm tracking links
4. Check delivery status and driver details
5. Look up full order details

## How to answer
- ALWAYS call tools to get live data — never guess order status or prices
- When showing delivery quotes, present all available service types with prices and flag surge pricing clearly (⚠️)
- Smart booking time avoids: lunch 12–2 PM, after 5 PM, and weekends — tell the user the scheduled time
- Surge = price >40% above baseline (Motorcycle: RM15, MPV: RM45, VAN: RM65)
- After booking, always share the Lalamove tracking link
- Currency is MYR

## Response style
- Concise and action-oriented
- Lead with the most important info (e.g. which orders need attention now)
- Use tables or bullet lists for multiple orders/quotes
- Always confirm before booking (don't auto-book without showing the quote first)`

// ── Tool definitions ──────────────────────────────────────────────────────────

const OPS_TOOL_DEFS: Anthropic.Tool[] = [
  {
    name:        'list_orders_ready_for_delivery',
    description: 'List all orders with status Packed that have no delivery booking yet.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name:        'get_delivery_quote',
    description: 'Get Lalamove delivery quotes (all service types) for a specific order. Returns prices, surge warning, and smart pickup time.',
    input_schema: {
      type:       'object',
      properties: {
        order_ref: { type: 'string', description: 'Order reference number (e.g. ORD-2026-0042) or order ID' },
      },
      required: ['order_ref'],
    },
  },
  {
    name:        'book_delivery',
    description: 'Book a Lalamove delivery for an order. Only call this after the user has confirmed the service type and price.',
    input_schema: {
      type:       'object',
      properties: {
        order_id:     { type: 'string', description: 'Order ID (UUID)' },
        service_type: { type: 'string', enum: ['MOTORCYCLE', 'MPV', 'VAN'], description: 'Lalamove service type' },
      },
      required: ['order_id', 'service_type'],
    },
  },
  {
    name:        'get_delivery_status',
    description: 'Get the current delivery booking status for an order, including driver name, phone, and plate number.',
    input_schema: {
      type:       'object',
      properties: {
        order_ref: { type: 'string', description: 'Order reference number or ID' },
      },
      required: ['order_ref'],
    },
  },
  {
    name:        'get_order_details',
    description: 'Get full details for an order: company, contact, delivery address, items, and delivery booking.',
    input_schema: {
      type:       'object',
      properties: {
        order_ref: { type: 'string', description: 'Order reference number or ID' },
      },
      required: ['order_ref'],
    },
  },
]

const OPS_TOOL_DESCRIPTIONS: Record<string, string> = {
  list_orders_ready_for_delivery: 'Checking orders ready for delivery',
  get_delivery_quote:             'Getting Lalamove quote',
  book_delivery:                  'Booking delivery',
  get_delivery_status:            'Checking delivery status',
  get_order_details:              'Loading order details',
}

// ── Tool executor ─────────────────────────────────────────────────────────────

async function executeOpsTool(name: string, input: Record<string, unknown>): Promise<ToolResult> {
  switch (name) {
    case 'list_orders_ready_for_delivery':
      return listOrdersReadyForDelivery()
    case 'get_delivery_quote':
      return getDeliveryQuote(String(input.order_ref ?? ''))
    case 'book_delivery':
      return bookDelivery(String(input.order_id ?? ''), String(input.service_type ?? ''))
    case 'get_delivery_status':
      return getDeliveryStatus(String(input.order_ref ?? ''))
    case 'get_order_details':
      return getOrderDetails(String(input.order_ref ?? ''))
    default:
      return { error: `Unknown tool: ${name}` }
  }
}

// ── Agentic loop ─────────────────────────────────────────────────────────────

export type ChatMessage = { role: 'user' | 'assistant'; content: string }

export async function runOperationAgent(
  history:     ChatMessage[],
  newMessage:  string,
  onToolCall?: (name: string, description: string) => void,
): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not configured')
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const messages: Anthropic.MessageParam[] = [
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: newMessage },
  ]

  let continueLoop = true
  let finalText    = ''

  while (continueLoop) {
    const response = await anthropic.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 2048,
      system:     OPS_SYSTEM_PROMPT,
      tools:      OPS_TOOL_DEFS,
      messages,
    })

    messages.push({ role: 'assistant', content: response.content })

    if (response.stop_reason === 'tool_use') {
      const toolResults: Anthropic.ToolResultBlockParam[] = []

      for (const block of response.content) {
        if (block.type !== 'tool_use') continue
        onToolCall?.(block.name, OPS_TOOL_DESCRIPTIONS[block.name] ?? block.name)
        const result = await executeOpsTool(block.name, block.input as Record<string, unknown>)
        toolResults.push({
          type:        'tool_result',
          tool_use_id: block.id,
          content:     JSON.stringify(result),
        })
      }

      messages.push({ role: 'user', content: toolResults })
    } else {
      const textBlock = response.content.find(b => b.type === 'text')
      finalText    = textBlock?.type === 'text' ? textBlock.text : ''
      continueLoop = false
    }
  }

  return finalText
}

export { OPS_TOOL_DESCRIPTIONS }
