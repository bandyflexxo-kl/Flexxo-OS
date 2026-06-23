import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { listDriveFolderRecursive, normaliseStem, DriveItem } from '@/lib/googleDrive'

type MatchHow = 'exact' | 'fuzzy' | 'name_exact' | 'name_fuzzy' | 'brand_name' | 'token_jaccard'

// ── Jaccard token matching ────────────────────────────────────────────────────
function tokenise(s: string): string[] {
  return s.toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(t => t.length >= 2)
}

function jaccardScore(a: string, b: string): { score: number; overlap: number } {
  const setA = new Set(tokenise(a))
  const setB = new Set(tokenise(b))
  if (setA.size === 0 || setB.size === 0) return { score: 0, overlap: 0 }
  const intersection = [...setA].filter(t => setB.has(t)).length
  const union        = new Set([...setA, ...setB]).size
  return { score: intersection / union, overlap: intersection }
}

const JACCARD_THRESHOLD  = 0.50
const JACCARD_MIN_TOKENS = 2

function normalizeDriveStem(stem: string): string {
  let s = stem
  // Strip only a SINGLE-DIGIT category prefix — not multi-digit item codes.
  s = s.replace(/^\d(?=[A-Za-z])/, '')
  s = s.replace(/([A-Za-z])(\d{3,})/g, '$1 $2')
  s = s.replace(/(\d{3,})([A-Za-z])/g, '$1 $2')
  return s
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Admin','Director'].includes(session.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params

  const folderSetting = await prisma.systemSetting.findUnique({ where: { key: 'google_drive_photos_folder_id' } })
  const folderId = process.env.GOOGLE_DRIVE_PRODUCT_PHOTOS_FOLDER_ID || folderSetting?.value || ''
  if (!folderId) {
    return Response.json({ error: 'Product photos folder ID not configured. Set it at /admin/settings.' }, { status: 500 })
  }

  const hasSA = !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  const [product, adminUser] = await Promise.all([
    prisma.product.findUnique({
      where:  { id },
      select: { id: true, name: true, brand: true, qneItemCode: true, internalSku: true },
    }),
    hasSA ? Promise.resolve(null) : prisma.user.findUnique({
      where:  { id: session.userId },
      select: { googleRefreshToken: true },
    }),
  ])

  if (!product) return Response.json({ error: 'Product not found' }, { status: 404 })
  if (!hasSA && !adminUser?.googleRefreshToken) {
    return Response.json({ error: 'Google Drive not connected.' }, { status: 403 })
  }

  const driveToken = hasSA ? null : adminUser!.googleRefreshToken!
  const items      = await listDriveFolderRecursive(driveToken, folderId)

  const code = (product.qneItemCode ?? product.internalSku ?? '').trim()

  let match: DriveItem | undefined
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

  // Tier 5: fuzzy brand + name combined
  if (!match && product.brand && product.name) {
    const bnk = normaliseStem(product.brand + ' ' + product.name)
    match = items.find(i => normaliseStem(i.name.replace(/\.[^.]+$/, '')) === bnk)
    if (match) how = 'brand_name'
  }

  // Tier 6: Jaccard token overlap on product name vs Drive filename stem
  if (!match && product.name) {
    let bestScore   = 0
    let bestOverlap = 0
    let bestItem: DriveItem | undefined

    for (const item of items) {
      const stem = item.name.replace(/\.[^.]+$/, '').trim()
      const { score, overlap } = jaccardScore(product.name, normalizeDriveStem(stem))
      if (score > bestScore) {
        bestScore   = score
        bestOverlap = overlap
        bestItem    = item
      }
    }

    if (bestItem && bestScore >= JACCARD_THRESHOLD && bestOverlap >= JACCARD_MIN_TOKENS) {
      match = bestItem
      how   = 'token_jaccard'
    }
  }

  if (!match) {
    return Response.json({
      found:   false,
      message: `No photo found for "${product.name}"${code ? ` (code: ${code})` : ''}. Searched ${items.length} files across all tiers including token matching.`,
    })
  }

  await prisma.product.update({
    where: { id },
    data:  { googleDrivePhotoId: match.id },
  })

  return Response.json({ found: true, fileId: match.id, fileName: match.name, how })
}
