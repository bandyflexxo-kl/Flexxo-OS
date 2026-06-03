import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { listDriveFolder } from '@/lib/googleDrive'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'Admin') return Response.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params

  // Folder ID: env var takes priority, fallback to SystemSetting
  const folderSetting = await prisma.systemSetting.findUnique({ where: { key: 'google_drive_photos_folder_id' } })
  const folderId = process.env.GOOGLE_DRIVE_PRODUCT_PHOTOS_FOLDER_ID || folderSetting?.value || ''
  if (!folderId) {
    return Response.json({ error: 'Product photos folder ID not configured. Set it at /admin/settings.' }, { status: 500 })
  }

  const [product, adminUser] = await Promise.all([
    prisma.product.findUnique({ where: { id }, select: { id: true, qneItemCode: true } }),
    prisma.user.findUnique({ where: { id: session.userId }, select: { googleRefreshToken: true } }),
  ])

  if (!product) return Response.json({ error: 'Product not found' }, { status: 404 })
  if (!product.qneItemCode) return Response.json({ error: 'Product has no QNE item code to match on.' }, { status: 400 })
  if (!adminUser?.googleRefreshToken) return Response.json({ error: 'Google Drive not connected.' }, { status: 403 })

  const items    = await listDriveFolder(adminUser.googleRefreshToken, folderId)
  const stem     = product.qneItemCode.trim().toUpperCase()
  const match    = items.find(i => !i.isFolder && i.name.replace(/\.[^.]+$/, '').trim().toUpperCase() === stem)

  if (!match) {
    return Response.json({ found: false, message: `No photo found for code "${product.qneItemCode}"` })
  }

  await prisma.product.update({
    where: { id },
    data:  { googleDrivePhotoId: match.id },
  })

  return Response.json({ found: true, fileId: match.id, fileName: match.name })
}
