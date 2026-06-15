import { prisma } from '@/lib/prisma'
import { downloadDriveFile } from '@/lib/googleDrive'

// Tell Vercel's edge CDN to cache each photo response for 24 hours.
// Keyed by full URL path — each product ID is cached independently.
// First request fetches from Google Drive; all subsequent hits within
// 24 h are served from the edge with zero DB calls and zero Drive API calls.
export const revalidate = 86400

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
    return new Response('Photo service unavailable', { status: 503 })
  }

  try {
    const buffer = await downloadDriveFile(refreshToken, driveFileId)
    setCache(driveFileId, buffer)

    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type':  'image/jpeg',
        // max-age=86400     → browser caches for 24 h
        // s-maxage=86400    → Vercel edge CDN caches for 24 h
        // stale-while-revalidate=3600 → serve stale for up to 1 h while
        //   the edge revalidates in background (no visible delay on expiry)
        'Cache-Control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=3600',
        'X-Cache':       'MISS',
      },
    })
  } catch {
    return new Response('Photo not found', { status: 404 })
  }
}
