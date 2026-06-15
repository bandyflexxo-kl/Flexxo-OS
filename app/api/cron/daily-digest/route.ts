import { prisma } from '@/lib/prisma'
import { buildAndSendDigest } from '@/lib/dailyDigest'
import { renewDriveWatchIfNeeded } from '@/lib/driveWatch'

export async function GET(request: Request) {
  // Authenticate: Vercel sends Authorization header, or use CRON_SECRET for manual testing
  const auth = request.headers.get('authorization') ?? ''
  const expected = `Bearer ${process.env.CRON_SECRET ?? ''}`
  if (!process.env.CRON_SECRET || auth !== expected) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Renew Drive push-notification channel if it expires within 24h
  const adminWithDrive = await prisma.user.findFirst({
    where: {
      isActive:           true,
      googleRefreshToken: { not: null },
      userRoles: { some: { revokedAt: null, role: { name: { in: ['Admin', 'Director'] } } } },
    },
    select: { googleRefreshToken: true },
  })
  if (adminWithDrive?.googleRefreshToken) {
    await renewDriveWatchIfNeeded(adminWithDrive.googleRefreshToken).catch(() => null)
  }

  // Fetch all active internal users with real emails
  const users = await prisma.user.findMany({
    where: {
      isActive:  true,
      userRoles: {
        some: {
          revokedAt: null,
          role: { name: { notIn: ['B2B Client'] } },
        },
      },
    },
    select: { id: true, name: true, email: true, userRoles: { select: { role: { select: { name: true } } } } },
  })

  let sent    = 0
  let skipped = 0

  for (const user of users) {
    const role = user.userRoles[0]?.role?.name ?? 'Salesperson'
    const didSend = await buildAndSendDigest({ id: user.id, name: user.name, email: user.email, role })
    if (didSend) sent++
    else skipped++
  }

  console.log(`Daily digest: ${sent} sent, ${skipped} skipped (no actions or placeholder email)`)
  return Response.json({ ok: true, sent, skipped })
}
