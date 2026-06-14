import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { listDriveFolderRecursive, normaliseStem } from '@/lib/googleDrive'

type MatchHow = 'exact' | 'fuzzy' | 'name_exact' | 'name_fuzzy' | 'brand_name'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Admin','Director'].includes(session.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params

  // Folder ID: env var takes priority, fallback to SystemSetting
  const folderSetting = await prisma.systemSetting.findUnique({ where: { key: 'google_drive_photos_folder_id' } })
  const folderId = process.env.GOOGLE_DRIVE_PRODUCT_PHOTOS_FOLDER_ID || folderSetting?.value || ''
  if (!folderId) {
    return Response.json({ error: 'Product photos folder ID not configured. Set it at /admin/settings.' }, { status: 500 })
  }

  const [product, adminUser] = await Promise.all([
    prisma.product.findUnique({
      where:  { id },
      select: { id: true, name: true, brand: true, qneItemCode: true, internalSku: true },
    }),
    prisma.user.findUnique({ where: { id: session.userId }, select: { googleRefreshToken: true } }),
  ])

  if (!product) return Response.json({ error: 'Product not found' }, { status: 404 })
  if (!adminUser?.googleRefreshToken) return Response.json({ error: 'Google Drive not connected.' }, { status: 403 })

  // Recursive scan
  const items = await listDriveFolderRecursive(adminUser.googleRefreshToken, folderId)

  const code = (product.qneItemCode ?? product.internalSku ?? '').trim()

  let match: (typeof items)[number] | undefined
  let how: MatchHow = 'exact'

  // Tier 1: exact stock code
  if (code) {
    match = items.find(i => i.name.replace(/\.[^.]+$/, '').trim().toUpperCase() === code.toUpperCase())
    if (match) how = 'exact'
  }

  // Tier 2: fuzzy stock code
  if (!match && code) {
    const fk = normaliseStem(code)
    match = items.find(i => normaliseStem(i.name.replace(/\.[^.]+$/, '')) === fk)
    if (match) how = 'fuzzy'
  }

  // Tier 3: exact product name
  if (!match && product.name) {
    match = items.find(i => i.name.replace(/\.[^.]+$/, '').trim().toUpperCase() === product.name.toUpperCase())
    if (match) how = 'name_exact'
  }

  // Tier 4: fuzzy product name
  if (!match && product.name) {
    const nk = normaliseStem(product.name)
    match = items.find(i => normaliseStem(i.name.replace(/\.[^.]+$/, '')) === nk)
    if (match) how = 'name_fuzzy'
  }

  // Tier 5: fuzzy brand + name
  if (!match && product.brand && product.name) {
    const bnk = normaliseStem(product.brand + ' ' + product.name)
    match = items.find(i => normaliseStem(i.name.replace(/\.[^.]+$/, '')) === bnk)
    if (match) how = 'brand_name'
  }

  if (!match) {
    return Response.json({
      found:   false,
      message: `No photo found for "${product.name}"${code ? ` (code: ${code})` : ''}. Searched ${items.length} files (including subfolders).`,
    })
  }

  await prisma.product.update({
    where: { id },
    data:  { googleDrivePhotoId: match.id },
  })

  return Response.json({ found: true, fileId: match.id, fileName: match.name, how })
}
