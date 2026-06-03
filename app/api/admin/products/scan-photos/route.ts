import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { listDriveFolder } from '@/lib/googleDrive'

export async function POST() {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'Admin') return Response.json({ error: 'Forbidden' }, { status: 403 })

  // Folder ID: env var takes priority, fallback to SystemSetting saved via /admin/settings
  const folderSetting = await prisma.systemSetting.findUnique({ where: { key: 'google_drive_photos_folder_id' } })
  const folderId = process.env.GOOGLE_DRIVE_PRODUCT_PHOTOS_FOLDER_ID || folderSetting?.value || ''
  if (!folderId) {
    return Response.json({ error: 'Product photos folder ID not configured. Set it at /admin/settings.' }, { status: 500 })
  }

  // Get admin user's Google refresh token
  const adminUser = await prisma.user.findUnique({
    where:  { id: session.userId },
    select: { googleRefreshToken: true },
  })
  if (!adminUser?.googleRefreshToken) {
    return Response.json({ error: 'Google Drive not connected. Connect at /admin/suppliers first.' }, { status: 403 })
  }

  // List all files in the product photos folder
  const items = await listDriveFolder(adminUser.googleRefreshToken, folderId)

  // Build a map: stem (filename without extension) → Drive file ID
  const photoMap = new Map<string, string>()
  for (const item of items) {
    if (!item.isFolder) {
      const stem = item.name.replace(/\.[^.]+$/, '').trim().toUpperCase()
      if (stem) photoMap.set(stem, item.id)
    }
  }

  // Fetch all products with a QNE item code
  const products = await prisma.product.findMany({
    where:  { qneItemCode: { not: null }, isActive: true },
    select: { id: true, qneItemCode: true, googleDrivePhotoId: true },
  })

  let matched     = 0
  let alreadySet  = 0
  let notFound    = 0

  for (const product of products) {
    const stem    = (product.qneItemCode ?? '').trim().toUpperCase()
    const fileId  = photoMap.get(stem)

    if (!fileId) {
      notFound++
      continue
    }

    if (product.googleDrivePhotoId === fileId) {
      alreadySet++
      continue
    }

    await prisma.product.update({
      where: { id: product.id },
      data:  { googleDrivePhotoId: fileId },
    })
    matched++
  }

  return Response.json({
    matched,
    alreadySet,
    notFound,
    total:       products.length,
    driveFiles:  items.filter(i => !i.isFolder).length,
  })
}
