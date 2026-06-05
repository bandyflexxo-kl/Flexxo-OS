import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { listDriveFolderRecursive, normaliseStem } from '@/lib/googleDrive'

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
    return Response.json({ error: 'Google Drive not connected. Connect at /admin/settings first.' }, { status: 403 })
  }

  // Recursively list ALL files in the product photos folder (and subfolders)
  const items = await listDriveFolderRecursive(adminUser.googleRefreshToken, folderId)

  // Build two maps for matching:
  //   exactMap: exact stem (uppercase, with punctuation) → Drive file ID
  //   fuzzyMap: normalised stem (alphanumeric only) → Drive file ID
  const exactMap = new Map<string, string>()
  const fuzzyMap = new Map<string, string>()

  for (const item of items) {
    const stem      = item.name.replace(/\.[^.]+$/, '').trim()
    const exactKey  = stem.toUpperCase()
    const fuzzyKey  = normaliseStem(stem)
    if (!exactMap.has(exactKey)) exactMap.set(exactKey, item.id)
    if (!fuzzyMap.has(fuzzyKey)) fuzzyMap.set(fuzzyKey, item.id)
  }

  // Fetch all products with a QNE item code or internal SKU
  const products = await prisma.product.findMany({
    where:  { isActive: true, OR: [{ qneItemCode: { not: null } }, { internalSku: { not: null } }] },
    select: { id: true, qneItemCode: true, internalSku: true, googleDrivePhotoId: true },
  })

  let matched    = 0
  let alreadySet = 0
  let notFound   = 0
  const matchedProducts: { name?: string; code: string; fileId: string; how: 'exact' | 'fuzzy' }[] = []
  const unmatchedCodes:  string[] = []

  for (const product of products) {
    const code = (product.qneItemCode ?? product.internalSku ?? '').trim()
    if (!code) { notFound++; continue }

    const exactKey = code.toUpperCase()
    const fuzzyKey = normaliseStem(code)

    // Try exact match first, then fuzzy
    const fileId = exactMap.get(exactKey) ?? fuzzyMap.get(fuzzyKey) ?? null
    const how    = exactMap.has(exactKey) ? 'exact' : 'fuzzy'

    if (!fileId) {
      notFound++
      unmatchedCodes.push(code)
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
    matchedProducts.push({ code, fileId, how })
  }

  return Response.json({
    matched,
    alreadySet,
    notFound,
    total:          products.length,
    driveFiles:     items.length,
    unmatchedCodes: unmatchedCodes.slice(0, 30),   // first 30 unmatched for display
    matchedProducts: matchedProducts.slice(0, 30), // first 30 new matches for display
  })
}
