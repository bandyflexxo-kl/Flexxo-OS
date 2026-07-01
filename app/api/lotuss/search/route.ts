/**
 * POST /api/lotuss/search  { query: string, page?: number, exclude?: string[] }
 * Returns one ranked page of Lotus's products for a query (name + link + image).
 * page 1 = initial search / "Find again"; page ≥2 with `exclude` = "Show 3 more"
 * once the client has exhausted the current page's pool. Internal tool — any CMS role.
 */
import { verifySession } from '@/lib/session'
import { searchLotuss } from '@/lib/lotussSearch'
import { z } from 'zod'

export const maxDuration = 60

const Body = z.object({
  query:   z.string().trim().min(1).max(200),
  page:    z.number().int().min(1).max(5).optional(),
  exclude: z.array(z.string().max(20)).max(50).optional(),
})

export async function POST(request: Request) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  if (!process.env.SERPER_API_KEY) {
    return Response.json({ error: 'Search is not configured on the server (SERPER_API_KEY missing).' }, { status: 500 })
  }

  const parsed = Body.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return Response.json({ error: 'Invalid request' }, { status: 400 })

  const { query, page = 1, exclude } = parsed.data
  try {
    const results = await searchLotuss(query, { page, exclude })
    return Response.json({ query, page, results })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Search failed' }, { status: 502 })
  }
}
