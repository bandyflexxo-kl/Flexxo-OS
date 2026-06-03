import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'Admin') return Response.json({ error: 'Forbidden' }, { status: 403 })

  const hasClientId = !!process.env.GOOGLE_CLIENT_ID

  const adminUser = await prisma.user.findUnique({
    where:  { id: session.userId },
    select: { name: true, googleRefreshToken: true },
  })

  const folderSetting = await prisma.systemSetting.findUnique({
    where: { key: 'google_drive_photos_folder_id' },
  })

  return Response.json({
    hasClientId,
    isConnected:   !!adminUser?.googleRefreshToken,
    connectedName: adminUser?.name ?? null,
    folderId:      process.env.GOOGLE_DRIVE_PRODUCT_PHOTOS_FOLDER_ID || folderSetting?.value || '',
  })
}

export async function DELETE() {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'Admin') return Response.json({ error: 'Forbidden' }, { status: 403 })

  await prisma.user.update({
    where: { id: session.userId },
    data:  { googleRefreshToken: null },
  })

  return Response.json({ ok: true })
}
