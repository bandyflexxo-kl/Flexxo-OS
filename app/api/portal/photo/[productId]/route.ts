import { getOptionalSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { downloadDriveFile } from '@/lib/googleDrive'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ productId: string }> },
) {
  const session = await getOptionalSession()
  if (!session) return new Response('Unauthorized', { status: 401 })

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
        'Cache-Control': 'public, max-age=86400',
      },
    })
  } catch {
    return new Response('Photo not found', { status: 404 })
  }
}
