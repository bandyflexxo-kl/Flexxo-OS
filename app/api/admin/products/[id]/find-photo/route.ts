import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { listDriveFolderRecursive, normaliseStem } from '@/lib/googleDrive'

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
    prisma.product.findUnique({ where: { id }, select: { id: true, name: true, qneItemCode: true, internalSku: true } }),
    prisma.user.findUnique({ where: { id: session.userId }, select: { googleRefreshToken: true } }),
  ])

  if (!product) return Response.json({ error: 'Product not found' }, { status: 404 })

  const code = (product.qneItemCode ?? product.internalSku ?? '').trim()
  if (!code) return Response.json({ error: 'Product has no QNE item code or SKU to match on.' }, { status: 400 })
  if (!adminUser?.googleRefreshToken) return Response.json({ error: 'Google Drive not connected.' }, { status: 403 })

  // Recursive scan
  const items     = await listDriveFolderRecursive(adminUser.googleRefreshToken, folderId)

  const exactKey  = code.toUpperCase()
  const fuzzyKey  = normaliseStem(code)

  // Try exact match first
  let match = items.find(i => i.name.replace(/\.[^.]+$/, '').trim().toUpperCase() === exactKey)
  let how: 'exact' | 'fuzzy' = 'exact'

  // Fallback: fuzzy (strip non-alphanumeric)
  if (!match) {
    match = items.find(i => normaliseStem(i.name.replace(/\.[^.]+$/, '')) === fuzzyKey)
    how   = 'fuzzy'
  }

  if (!match) {
    return Response.json({
      found:   false,
      message: `No photo found for code "${code}". Searched ${items.length} files (including subfolders).`,
    })
  }

  await prisma.product.update({
    where: { id },
    data:  { googleDrivePhotoId: match.id },
  })

  return Response.json({ found: true, fileId: match.id, fileName: match.name, how })
}
