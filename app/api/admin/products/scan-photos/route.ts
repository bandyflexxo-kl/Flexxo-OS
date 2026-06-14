import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { listDriveFolderRecursive, normaliseStem } from '@/lib/googleDrive'

type MatchHow = 'exact' | 'fuzzy' | 'name_exact' | 'name_fuzzy' | 'brand_name'

export async function POST(request: Request) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Admin','Director'].includes(session.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const url    = new URL(request.url)
  const dryRun = url.searchParams.get('dryRun') === 'true'

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
  //   exactMap: exact stem (uppercase) → Drive file ID
  //   fuzzyMap: normalised stem (alphanumeric only, uppercase) → Drive file ID
  const exactMap = new Map<string, string>()
  const fuzzyMap = new Map<string, string>()

  for (const item of items) {
    const stem     = item.name.replace(/\.[^.]+$/, '').trim()
    const exactKey = stem.toUpperCase()
    const fuzzyKey = normaliseStem(stem)
    if (!exactMap.has(exactKey)) exactMap.set(exactKey, item.id)
    if (!fuzzyMap.has(fuzzyKey)) fuzzyMap.set(fuzzyKey, item.id)
  }

  // Fetch ALL active products — include name + brand for name-based matching
  const products = await prisma.product.findMany({
    where:  { isActive: true },
    select: { id: true, qneItemCode: true, internalSku: true, name: true, brand: true, googleDrivePhotoId: true },
  })

  let matched    = 0
  let alreadySet = 0
  let notFound   = 0

  const byTier: Record<MatchHow, number> = {
    exact: 0, fuzzy: 0, name_exact: 0, name_fuzzy: 0, brand_name: 0,
  }

  const matchedProducts: { code: string; name: string; fileId: string; how: MatchHow }[] = []
  const unmatchedCodes:  string[] = []

  for (const product of products) {
    const code = (product.qneItemCode ?? product.internalSku ?? '').trim()

    let fileId: string | null = null
    let how: MatchHow = 'exact'

    // Tier 1: exact stock code
    if (code) {
      const ek = code.toUpperCase()
      if (exactMap.has(ek)) { fileId = exactMap.get(ek)!; how = 'exact' }
    }

    // Tier 2: fuzzy stock code (strip punctuation/spaces)
    if (!fileId && code) {
      const fk = normaliseStem(code)
      if (fuzzyMap.has(fk)) { fileId = fuzzyMap.get(fk)!; how = 'fuzzy' }
    }

    // Tier 3: exact product name
    if (!fileId && product.name) {
      const nk = product.name.toUpperCase()
      if (exactMap.has(nk)) { fileId = exactMap.get(nk)!; how = 'name_exact' }
    }

    // Tier 4: fuzzy product name
    if (!fileId && product.name) {
      const nk = normaliseStem(product.name)
      if (fuzzyMap.has(nk)) { fileId = fuzzyMap.get(nk)!; how = 'name_fuzzy' }
    }

    // Tier 5: fuzzy brand + name combined (e.g. "PILOT" + "G2 Pen" → "PILOTG2PEN.jpg")
    if (!fileId && product.brand && product.name) {
      const bnk = normaliseStem(product.brand + ' ' + product.name)
      if (fuzzyMap.has(bnk)) { fileId = fuzzyMap.get(bnk)!; how = 'brand_name' }
    }

    if (!fileId) {
      notFound++
      if (code) unmatchedCodes.push(code)
      continue
    }

    if (product.googleDrivePhotoId === fileId) {
      alreadySet++
      continue
    }

    // In dryRun mode: count only, skip DB writes
    if (!dryRun) {
      await prisma.product.update({
        where: { id: product.id },
        data:  { googleDrivePhotoId: fileId },
      })
    }

    matched++
    byTier[how]++
    matchedProducts.push({ code: code || product.name, name: product.name, fileId, how })
  }

  return Response.json({
    dryRun,
    matched,
    alreadySet,
    notFound,
    total:           products.length,
    driveFiles:      items.length,
    byTier,
    unmatchedCodes:  unmatchedCodes.slice(0, 30),
    matchedProducts: matchedProducts.slice(0, 50),
    // Diagnostic: show sample Drive filenames so admin can see naming convention
    sampleDriveFiles: items.slice(0, 30).map(i => i.name),
  })
}
