/**
 * POST /api/webhooks/drive-price
 * Google Drive push notification handler.
 * Google fires this when any file in the watched folder changes.
 * We store the notification in Redis; Price Scanner page picks it up.
 */
import { prisma } from '@/lib/prisma'
import { getDriveChanges, getDriveChannelState } from '@/lib/driveWatch'
import { getRedis } from '@/lib/redis'

const PRICE_MIMETYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
])

export async function POST(request: Request) {
  const channelId    = request.headers.get('x-goog-channel-id')   ?? ''
  const channelToken = request.headers.get('x-goog-channel-token') ?? ''
  const resourceState = request.headers.get('x-goog-resource-state') ?? ''

  const state = await getDriveChannelState()
  if (!state || state.channelId !== channelId || state.channelToken !== channelToken) {
    return new Response('Invalid channel', { status: 400 })
  }

  // Initial sync ping — just acknowledge
  if (resourceState === 'sync') {
    return new Response('ok', { status: 200 })
  }

  // Find an admin user with Google refresh token to list changes
  const adminUser = await prisma.user.findFirst({
    where: {
      isActive:           true,
      googleRefreshToken: { not: null },
      userRoles: { some: { revokedAt: null, role: { name: { in: ['Admin', 'Director'] } } } },
    },
    select: { googleRefreshToken: true },
  })

  if (!adminUser?.googleRefreshToken) {
    return new Response('ok', { status: 200 })
  }

  const changes = await getDriveChanges(adminUser.googleRefreshToken)
  const priceListChanges = changes.filter(c => !c.removed && PRICE_MIMETYPES.has(c.mimeType))

  if (priceListChanges.length > 0) {
    // Store a Drive notification flag in Redis for 7 days — Price Scanner page reads it
    const redis = getRedis()
    if (redis) {
      const existing = await redis.get<string>('drive:new_files_alert')
      const prev: string[] = existing ? JSON.parse(existing) : []
      const next = [
        ...priceListChanges.map(c => c.fileName),
        ...prev,
      ].slice(0, 20)
      await redis.set('drive:new_files_alert', JSON.stringify(next), { ex: 7 * 24 * 60 * 60 })
    }
  }

  return new Response('ok', { status: 200 })
}
