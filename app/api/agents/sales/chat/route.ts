/**
 * POST /api/agents/sales/chat
 * Streaming SSE endpoint for the Sales AI Agent (web chat UI).
 *
 * Emits SSE events:
 *   { type: 'thinking', tool: string, description: string }
 *   { type: 'text',     text: string }
 *   { type: 'done' }
 *   { type: 'error',    message: string }
 */
import { z } from 'zod'
import { verifySession } from '@/lib/session'
import { runSalesAgent, TOOL_DESCRIPTIONS, type ChatMessage } from '@/lib/agents/salesAgentCore'

const MessageSchema = z.object({
  role:    z.enum(['user', 'assistant']),
  content: z.string(),
})

const BodySchema = z.object({
  messages:   z.array(MessageSchema).max(40),
  newMessage: z.string().min(1).max(4000),
})

function sseEvent(data: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`)
}

export async function POST(request: Request) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role === 'B2B Client' || session.role === 'Warehouse') {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: 'Sales Agent is not configured (ANTHROPIC_API_KEY missing).' },
      { status: 503 },
    )
  }

  const body: unknown = await request.json().catch(() => null)
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 })
  }

  const { messages, newMessage } = parsed.data

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => controller.enqueue(sseEvent(data))

      try {
        const text = await runSalesAgent(
          messages as ChatMessage[],
          newMessage,
          (name, description) => {
            send({ type: 'thinking', tool: name, description: TOOL_DESCRIPTIONS[name] ?? description })
          },
        )
        send({ type: 'text', text })
        send({ type: 'done' })
      } catch (err) {
        console.error('[sales-agent/chat]', err)
        send({ type: 'error', message: err instanceof Error ? err.message : 'Unexpected error.' })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection:      'keep-alive',
    },
  })
}
