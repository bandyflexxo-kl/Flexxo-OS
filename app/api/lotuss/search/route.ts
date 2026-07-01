/**
 * POST /api/lotuss/search  { query: string, count?: number }
 * Returns the top Lotus's products for one query (name + link + best-effort image).
 * Called once per item (and again on "Find again"). Internal tool — any CMS role.
 */
import { verifySession } from '@/lib/session'
import { searchLotuss } from '@/lib/lotussSearch'
import { z } from 'zod'

export const maxDuration = 60

const Body = z.object({ query: z.string().trim().min(1).max(200), count: z.number().int().min(1).max(5).optional() })

export async function POST(request: Request) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  if (!process.env.SERPER_API_KEY) {
    return Response.json({ error: 'Search is not configured on the server (SERPER_API_KEY missing).' }, { status: 500 })
  }

  const parsed = Body.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return Response.json({ error: 'Invalid request' }, { status: 400 })

  try {
    const results = await searchLotuss(parsed.data.query, parsed.data.count ?? 3)
    return Response.json({ query: parsed.data.query, results })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Search failed' }, { status: 502 })
  }
}
