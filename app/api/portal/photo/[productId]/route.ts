import { prisma } from '@/lib/prisma'
import { downloadDriveFile } from '@/lib/googleDrive'

// Tell Vercel's edge CDN to cache each photo response for 24 hours.
// Keyed by full URL path — each product ID is cached independently.
// First request fetches from Google Drive; all subsequent hits within
// 24 h are served from the edge with zero DB calls and zero Drive API calls.
export const revalidate = 86400

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

  // Get any admin user's Google refresh token to serve the photo
  const adminUser = await prisma.user.findFirst({
    where: {
      isActive:          true,
      googleRefreshToken: { not: null },
      userRoles: { some: { role: { name: 'Admin' }, revokedAt: null } },
    },
    select: { googleRefreshToken: true },
  })

  if (!adminUser?.googleRefreshToken) {
    return new Response('Photo service unavailable', { status: 503 })
  }

  try {
    const buffer = await downloadDriveFile(adminUser.googleRefreshToken, product.googleDrivePhotoId)

    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type':  'image/jpeg',
        // max-age=86400     → browser caches for 24 h
        // s-maxage=86400    → Vercel edge CDN caches for 24 h
        // stale-while-revalidate=3600 → serve stale for up to 1 h while
        //   the edge revalidates in background (no visible delay on expiry)
        'Cache-Control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=3600',
      },
    })
  } catch {
    return new Response('Photo not found', { status: 404 })
  }
}
