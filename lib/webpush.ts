import webpush from 'web-push'
import { prisma } from '@/lib/prisma'

webpush.setVapidDetails(
  `mailto:${process.env.VAPID_EMAIL ?? 'admin@flexxo.com.my'}`,
  process.env.VAPID_PUBLIC_KEY  ?? '',
  process.env.VAPID_PRIVATE_KEY ?? '',
)

export type PushPayload = {
  title: string
  body:  string
  url:   string
}

/**
 * Send a push notification to all subscribed browsers for a user.
 * Fire-and-forget — never throws, never blocks the calling request.
 * Automatically removes stale/expired subscriptions.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  try {
    const subs = await prisma.pushSubscription.findMany({
      where:  { userId },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    })
    if (subs.length === 0) return

    const message = JSON.stringify(payload)

    await Promise.allSettled(
      subs.map(async sub => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            message,
          )
        } catch (err) {
          // 410 Gone = subscription expired/unsubscribed — remove it
          if (err instanceof Error && 'statusCode' in err && (err as { statusCode: number }).statusCode === 410) {
            await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => null)
          }
        }
      }),
    )
  } catch {
    // Never let push errors surface to the caller
  }
}

/**
 * Send push notifications to all active Managers and Admins.
 */
export async function sendPushToManagers(payload: PushPayload): Promise<void> {
  try {
    const managers = await prisma.user.findMany({
      where: {
        isActive:  true,
        userRoles: { some: { role: { name: { in: ['Admin', 'Manager'] } }, revokedAt: null } },
      },
      select: { id: true },
    })
    await Promise.allSettled(managers.map(m => sendPushToUser(m.id, payload)))
  } catch {
    // Never throw
  }
}
