/**
 * POST /api/market-scout
 * Streams per-product scout results as Server-Sent Events.
 * Accepts: { products: string[] }   (max 20)
 * Streams:  data: { type: 'result', data: ScoutResult } | { type: 'done', total: number }
 *
 * CRM only (any authenticated non-B2B role).
 */

import { NextResponse }   from 'next/server'
import { verifySession }  from '@/lib/session'
import { scoutProducts }  from '@/lib/marketScout'
import { z }              from 'zod'

const Schema = z.object({
  products: z.array(z.string().min(1).max(200)).min(1).max(20),
})

export async function POST(req: Request) {
  // Auth — CRM users only (not B2B portal clients)
  const session = await verifySession().catch(() => null)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role === 'B2B Client') {
    return NextResponse.json({ error: 'Not available for portal clients' }, { status: 403 })
  }

  const body   = await req.json().catch(() => ({}))
  const parsed = Schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', issues: parsed.error.issues }, { status: 400 })
  }

  const { products } = parsed.data

  // ── Stream results as Server-Sent Events ────────────────────────────────────
  const encoder = new TextEncoder()
  const stream  = new ReadableStream({
    async start(controller) {
      function send(obj: unknown) {
        const line = `data: ${JSON.stringify(obj)}\n\n`
        controller.enqueue(encoder.encode(line))
      }

      try {
        for await (const result of scoutProducts(products)) {
          send({ type: 'result', data: result })
        }
        send({ type: 'done', total: products.length })
      } catch (err) {
        send({ type: 'error', message: err instanceof Error ? err.message : String(err) })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    },
  })
}
