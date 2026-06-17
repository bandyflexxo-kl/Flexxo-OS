import { prisma } from '@/lib/prisma'
import { downloadDriveFile } from '@/lib/googleDrive'

// Force dynamic so Vercel never ISR-caches a failed response.
// CDN caching is handled by Cache-Control: s-maxage=86400 on successful responses.
export const dynamic = 'force-dynamic'

// ── Photo buffer cache (LRU-lite, 150 entries × ~100 KB ≈ 15 MB) ──────────
// Hot photos served from memory — no Drive API call per request.
// When GOOGLE_SERVICE_ACCOUNT_KEY is set, there is no per-request DB query
// either: the SA client is stateless and reused via googleapis internals.

const _photoCache = new Map<string, { buf: Buffer; at: number }>()
const CACHE_TTL = 3_600_000
const CACHE_MAX = 150

// OAuth fallback: cache admin refresh token to avoid 1 DB query per photo
// when SA is not configured. Unused when GOOGLE_SERVICE_ACCOUNT_KEY is set.
let _oauthToken: string | null = null
let _oauthTokenAt = 0

async function getOAuthFallbackToken(): Promise<string | null> {
  if (_oauthToken && Date.now() - _oauthTokenAt < CACHE_TTL) return _oauthToken
  const adminUser = await prisma.user.findFirst({
    where: {
      isActive:           true,
      googleRefreshToken: { not: null },
      userRoles: { some: { role: { name: 'Admin' }, revokedAt: null } },
    },
    select: { googleRefreshToken: true },
  })
  _oauthToken   = adminUser?.googleRefreshToken ?? null
  _oauthTokenAt = Date.now()
  return _oauthToken
}

function getCached(driveFileId: string): Buffer | null {
  const e = _photoCache.get(driveFileId)
  if (!e) return null
  if (Date.now() - e.at > CACHE_TTL) { _photoCache.delete(driveFileId); return null }
  return e.buf
}

function setCache(driveFileId: string, buf: Buffer): void {
  if (_photoCache.size >= CACHE_MAX) {
    // Evict the oldest entry (Map preserves insertion order)
    const oldest = _photoCache.keys().next().value
    if (oldest !== undefined) _photoCache.delete(oldest)
  }
  _photoCache.set(driveFileId, { buf, at: Date.now() })
}

// Public endpoint — no session required.
// Photos are served from Google Drive using the admin's stored server-side
// refresh token, so visitor identity is irrelevant.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ productId: string }> },
) {
  const { productId } = await params

  const product = await prisma.product.findUnique({
    where:  { id: productId },
    select: { googleDrivePhotoId: true, isVisibleToCustomers: true },
  })

  if (!product?.googleDrivePhotoId) {
    return new Response('No photo available', { status: 404 })
  }

  const driveFileId = product.googleDrivePhotoId

  // Check in-memory buffer cache first
  const cached = getCached(driveFileId)
  if (cached) {
    return new Response(new Uint8Array(cached), {
      headers: {
        'Content-Type':  'image/jpeg',
        'Cache-Control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=3600',
        'X-Cache':       'HIT',
      },
    })
  }

  // SA-first: when GOOGLE_SERVICE_ACCOUNT_KEY is set, pass null — resolveDriveClient
  // uses the SA and never needs a DB token. Fall back to admin OAuth token when no SA.
  let driveToken: string | null = null
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    driveToken = await getOAuthFallbackToken()
    if (!driveToken) {
      console.error('[photo] No GOOGLE_SERVICE_ACCOUNT_KEY and no admin OAuth token in DB. Set up a Service Account or reconnect Google Drive at /admin/settings.')
      return new Response('Photo service unavailable', { status: 503 })
    }
  }

  try {
    const buffer = await downloadDriveFile(driveToken, driveFileId)
    setCache(driveFileId, buffer)

    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type':  'image/jpeg',
        'Cache-Control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=3600',
        'X-Cache':       'MISS',
      },
    })
  } catch (err) {
    console.error('[photo] Drive download failed for fileId', driveFileId, err)
    return new Response('Photo not found', { status: 404 })
  }
}
