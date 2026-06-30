/**
 * POST /api/agents/operation/chat
 * Streaming SSE endpoint for the Operation AI Agent (web chat UI).
 */
import { z }                   from 'zod'
import { verifySession }       from '@/lib/session'
import { runOperationAgent, OPS_TOOL_DESCRIPTIONS, type ChatMessage } from '@/lib/agents/operationAgentCore'

// Vercel: allow long Claude calls. Default (~10s) kills the function mid-call,
// returning an empty body → client res.json() throws "Unexpected end of JSON input".
export const maxDuration = 60

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
  if (session.role === 'B2B Client') {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: 'Operation Agent is not configured (ANTHROPIC_API_KEY missing).' },
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
        const text = await runOperationAgent(
          messages as ChatMessage[],
          newMessage,
          (name, description) => {
            send({ type: 'thinking', tool: name, description: OPS_TOOL_DESCRIPTIONS[name] ?? description })
          },
        )
        send({ type: 'text', text })
        send({ type: 'done' })
      } catch (err) {
        console.error('[operation-agent/chat]', err)
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
