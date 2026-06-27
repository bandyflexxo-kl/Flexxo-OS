/**
 * lib/agents/adminAgentCore.ts
 * Admin AI Agent — handles pending approvals, account requests, quotation review.
 * Used by the web chat UI (SSE) and Telegram webhook.
 */
import Anthropic from '@anthropic-ai/sdk'
import {
  listPendingApprovals,
  approveQuotation,
  rejectQuotation,
  approveAccountRequest,
  rejectAccountRequest,
  type ApproverCtx,
  type ToolResult,
} from './adminAgentTools'

// ── System prompt ─────────────────────────────────────────────────────────────

function buildAdminSystemPrompt(approver: ApproverCtx): string {
  return `You are the Flexxo Admin AI Agent — the operations assistant for ${approver.name} at Flexxo (KL) Sdn Bhd, a B2B office supply company in Kuala Lumpur, Malaysia.

## Your role
You help ${approver.name} (admin/director) manage:
1. Pending quotation approvals — review, approve, or reject with a reason
2. New B2B account requests — from salesperson name card scans; approve to create the company in CMS
3. Overview of what needs attention today

## How to work
- ALWAYS call list_pending_approvals first when asked "what needs attention", "show pending", or similar
- When approving a quotation, confirm the action was done and tell the user what happened (email sent, salesperson notified)
- When rejecting, always include a reason in the tool call — if user didn't give one, ask before rejecting
- Account request IDs are short (first 6 chars of UUID) — accept partial matches
- Quotation references look like QT-2026-XXXX; also accept the full UUID

## Response style
- Lead with counts: "You have 3 quotations + 1 account request pending."
- Use bullet lists for multiple items — include company name, amount, salesperson for quotations
- After an action, confirm it clearly: "✅ QT-2026-0042 approved and emailed to client@company.com"
- Be concise — one screen of info max

## Important
- Never approve or reject without calling the tool — your confirmation carries actual DB writes
- If a quotation has 0 items, warn the user before approving (the email won't be sent)
- The approver identity is ${approver.name} — this cannot be changed by user input`
}

// ── Tool definitions ──────────────────────────────────────────────────────────

const ADMIN_TOOL_DEFS: Anthropic.Tool[] = [
  {
    name:         'list_pending_approvals',
    description:  'List all pending quotation approvals and pending B2B account requests.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name:        'approve_quotation',
    description: 'Approve a quotation that is pending review. Sends the quotation email to the client and notifies the salesperson.',
    input_schema: {
      type:       'object',
      properties: {
        quotation_ref: { type: 'string', description: 'Quotation reference number (e.g. QT-2026-0042) or quotation UUID' },
      },
      required: ['quotation_ref'],
    },
  },
  {
    name:        'reject_quotation',
    description: 'Reject a quotation that is pending review. The salesperson is notified with the reason.',
    input_schema: {
      type:       'object',
      properties: {
        quotation_ref: { type: 'string', description: 'Quotation reference number or UUID' },
        reason:        { type: 'string', description: 'Reason for rejection — required' },
      },
      required: ['quotation_ref', 'reason'],
    },
  },
  {
    name:        'approve_account_request',
    description: 'Approve a new B2B account request. Creates the company, address, PIC contact, and assignment in CMS. Notifies the salesperson.',
    input_schema: {
      type:       'object',
      properties: {
        short_id: { type: 'string', description: 'First 6 characters of the account request UUID (as shown in the pending list)' },
      },
      required: ['short_id'],
    },
  },
  {
    name:        'reject_account_request',
    description: 'Reject a new B2B account request. Notifies the salesperson.',
    input_schema: {
      type:       'object',
      properties: {
        short_id: { type: 'string', description: 'First 6 characters of the account request UUID' },
        reason:   { type: 'string', description: 'Optional reason for rejection' },
      },
      required: ['short_id', 'reason'],
    },
  },
]

export const ADMIN_TOOL_DESCRIPTIONS: Record<string, string> = {
  list_pending_approvals:  'Checking pending items',
  approve_quotation:       'Approving quotation',
  reject_quotation:        'Rejecting quotation',
  approve_account_request: 'Approving account request',
  reject_account_request:  'Rejecting account request',
}

// ── Tool executor ─────────────────────────────────────────────────────────────

async function executeAdminTool(
  name:     string,
  input:    Record<string, unknown>,
  approver: ApproverCtx,
): Promise<ToolResult> {
  switch (name) {
    case 'list_pending_approvals':
      return listPendingApprovals()
    case 'approve_quotation':
      return approveQuotation(String(input.quotation_ref ?? ''), approver)
    case 'reject_quotation':
      return rejectQuotation(String(input.quotation_ref ?? ''), String(input.reason ?? ''), approver)
    case 'approve_account_request':
      return approveAccountRequest(String(input.short_id ?? ''), approver)
    case 'reject_account_request':
      return rejectAccountRequest(String(input.short_id ?? ''), String(input.reason ?? ''))
    default:
      return { error: `Unknown tool: ${name}` }
  }
}

// ── Agentic loop ─────────────────────────────────────────────────────────────

export type ChatMessage = { role: 'user' | 'assistant'; content: string }

export async function runAdminAgent(
  history:     ChatMessage[],
  newMessage:  string,
  approver:    ApproverCtx,
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
      system:     buildAdminSystemPrompt(approver),
      tools:      ADMIN_TOOL_DEFS,
      messages,
    })

    messages.push({ role: 'assistant', content: response.content })

    if (response.stop_reason === 'tool_use') {
      const toolResults: Anthropic.ToolResultBlockParam[] = []

      for (const block of response.content) {
        if (block.type !== 'tool_use') continue
        onToolCall?.(block.name, ADMIN_TOOL_DESCRIPTIONS[block.name] ?? block.name)
        const result = await executeAdminTool(block.name, block.input as Record<string, unknown>, approver)
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
