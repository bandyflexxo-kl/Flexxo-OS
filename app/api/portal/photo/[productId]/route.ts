import { prisma } from '@/lib/prisma'
import { downloadDriveFile } from '@/lib/googleDrive'

// Force dynamic so Vercel never ISR-caches a failed response.
// CDN caching is handled by Cache-Control: s-maxage=86400 on successful responses.
export const dynamic = 'force-dynamic'

// ── Module-level caches (survive across requests within a Node.js process) ──
//
// _adminToken: avoids 1 DB round-trip per photo request by caching the admin
//   Google refresh token for 1 hour. On Vercel, this is per-instance; on
//   localhost, it's shared across all requests in the same dev server process.
//
// _photoCache: caches downloaded Drive buffers for 1 hour with a 150-entry
//   LRU-lite cap (~15 MB max). Hot photos (top of category) are served from
//   memory — no Drive API call, no auth overhead.

let _adminToken: string | null = null
let _adminTokenAt = 0

const _photoCache = new Map<string, { buf: Buffer; at: number }>()
const CACHE_TTL = 3_600_000   // 1 hour in ms
const CACHE_MAX = 150         // max entries (~100 KB avg × 150 ≈ 15 MB)

async function getAdminToken(): Promise<string | null> {
  if (_adminToken && Date.now() - _adminTokenAt < CACHE_TTL) return _adminToken

  const adminUser = await prisma.user.findFirst({
    where: {
      isActive:           true,
      googleRefreshToken: { not: null },
      userRoles: { some: { role: { name: 'Admin' }, revokedAt: null } },
    },
    select: { googleRefreshToken: true },
  })

  _adminToken    = adminUser?.googleRefreshToken ?? null
  _adminTokenAt  = Date.now()
  return _adminToken
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

  const refreshToken = await getAdminToken()
  if (!refreshToken) {
    console.error('[photo] No admin with googleRefreshToken found in DB. Has an admin connected Google Drive?')
    return new Response('Photo service unavailable', { status: 503 })
  }

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    console.error('[photo] GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET env var is missing — cannot refresh Drive token')
    return new Response('Photo service misconfigured', { status: 503 })
  }

  try {
    const buffer = await downloadDriveFile(refreshToken, driveFileId)
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
