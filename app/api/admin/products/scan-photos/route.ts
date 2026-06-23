import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { listDriveFolderRecursive, normaliseStem } from '@/lib/googleDrive'

type MatchHow = 'exact' | 'fuzzy' | 'name_exact' | 'name_fuzzy' | 'brand_name' | 'token_jaccard'

// ── Jaccard token matching ────────────────────────────────────────────────────
function tokenise(s: string): string[] {
  return s.toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(t => t.length >= 2)
}

/**
 * Normalize a Drive filename stem so it tokenises closer to how product names read.
 * Drive photos often have a numeric category prefix ("1ALUMINIUM BASE", "2SHEET…")
 * and omit spaces between words and embedded numbers ("HAMPER1288" vs "HAMPER 1288").
 */
function normalizeDriveStem(stem: string): string {
  let s = stem
  // Strip a SINGLE-DIGIT category prefix when immediately followed by a letter.
  // "1ALUMINIUM BASE" → "ALUMINIUM BASE" — strips the Drive folder category code.
  // Do NOT strip multi-digit sequences — they are item codes ("2415100UKM" stays intact
  // so the 3-digit rule below can split it into "2415100 UKM" instead of losing the number).
  s = s.replace(/^\d(?=[A-Za-z])/, '')
  // Insert a space before a run of 3+ digits that immediately follows a letter.
  // "HAMPER1288" → "HAMPER 1288"  /  "A4" and "LR44" stay (< 3 digits)
  s = s.replace(/([A-Za-z])(\d{3,})/g, '$1 $2')
  // Insert a space after a run of 3+ digits before a letter.
  // "2415100UKM" → "2415100 UKM"  /  "1288CNY" → "1288 CNY"
  s = s.replace(/(\d{3,})([A-Za-z])/g, '$1 $2')
  return s
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

export async function POST(request: Request) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Admin','Director'].includes(session.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const url    = new URL(request.url)
  const dryRun = url.searchParams.get('dryRun') === 'true'

  const folderSetting = await prisma.systemSetting.findUnique({ where: { key: 'google_drive_photos_folder_id' } })
  const folderId = process.env.GOOGLE_DRIVE_PRODUCT_PHOTOS_FOLDER_ID || folderSetting?.value || ''
  if (!folderId) {
    return Response.json({ error: 'Product photos folder ID not configured. Set it at /admin/settings.' }, { status: 500 })
  }

  const hasSA     = !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  const adminUser = hasSA ? null : await prisma.user.findUnique({
    where:  { id: session.userId },
    select: { googleRefreshToken: true },
  })
  if (!hasSA && !adminUser?.googleRefreshToken) {
    return Response.json({ error: 'Google Drive not connected. Connect at /admin/settings first.' }, { status: 403 })
  }

  const driveToken = hasSA ? null : adminUser!.googleRefreshToken!

  const items = await listDriveFolderRecursive(driveToken, folderId)

  // ── Build matching maps ───────────────────────────────────────────────────
  const exactMap = new Map<string, string>()
  const fuzzyMap = new Map<string, string>()

  // For Jaccard tier: pre-build token list per Drive file (normalizedStem computed once)
  type DriveEntry = { fileId: string; fileName: string; stem: string; normalizedStem: string }
  const driveEntries: DriveEntry[] = []

  for (const item of items) {
    const stem           = item.name.replace(/\.[^.]+$/, '').trim()
    const normalizedStem = normalizeDriveStem(stem)
    const exactKey       = stem.toUpperCase()
    const fuzzyKey       = normaliseStem(stem)
    if (!exactMap.has(exactKey)) exactMap.set(exactKey, item.id)
    if (!fuzzyMap.has(fuzzyKey)) fuzzyMap.set(fuzzyKey, item.id)
    driveEntries.push({ fileId: item.id, fileName: item.name, stem, normalizedStem })
  }

  // Track which Drive file IDs got matched (for unmatched-drive-files report)
  const matchedDriveIds = new Set<string>()

  const products = await prisma.product.findMany({
    where:  { isActive: true },
    select: { id: true, qneItemCode: true, internalSku: true, name: true, brand: true, googleDrivePhotoId: true },
  })

  let matched    = 0
  let alreadySet = 0
  let notFound   = 0

  const byTier: Record<MatchHow, number> = {
    exact: 0, fuzzy: 0, name_exact: 0, name_fuzzy: 0, brand_name: 0, token_jaccard: 0,
  }

  const matchedProducts: { code: string; name: string; fileId: string; how: MatchHow }[] = []
  const unmatchedCodes:  string[] = []
  const nearMisses: { code: string; name: string; bestScore: number; bestFile: string }[] = []

  for (const product of products) {
    const code = (product.qneItemCode ?? product.internalSku ?? '').trim()

    let fileId: string | null = null
    let how: MatchHow = 'exact'

    // Tier 1: exact stock code
    if (code) {
      const ek = code.toUpperCase()
      if (exactMap.has(ek)) { fileId = exactMap.get(ek)!; how = 'exact' }
    }

    // Tier 2: fuzzy stock code
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

    // Tier 5: fuzzy brand + name combined
    if (!fileId && product.brand && product.name) {
      const bnk = normaliseStem(product.brand + ' ' + product.name)
      if (fuzzyMap.has(bnk)) { fileId = fuzzyMap.get(bnk)!; how = 'brand_name' }
    }

    // Tier 6: Jaccard token overlap — score both product name AND QNE code vs normalizedStem,
    // take whichever is higher. QNE codes like "NIJI DBL TAPE 18" often score better than
    // verbose product names against concise Drive filenames.
    if (!fileId) {
      let bestScore   = 0
      let bestOverlap = 0
      let bestEntry: DriveEntry | null = null

      for (const entry of driveEntries) {
        // Score against product name
        if (product.name) {
          const { score, overlap } = jaccardScore(product.name, entry.normalizedStem)
          if (score > bestScore) { bestScore = score; bestOverlap = overlap; bestEntry = entry }
        }
        // Score against QNE code (short codes often map more directly to Drive filenames)
        if (code) {
          const { score, overlap } = jaccardScore(code, entry.normalizedStem)
          if (score > bestScore) { bestScore = score; bestOverlap = overlap; bestEntry = entry }
        }
      }

      if (bestEntry && bestScore >= JACCARD_THRESHOLD && bestOverlap >= JACCARD_MIN_TOKENS) {
        fileId = bestEntry.fileId
        how    = 'token_jaccard'
      }

      // Track near-misses for debug (scored 0.30–0.49 — below threshold but close)
      if (!fileId && bestEntry && bestScore >= 0.30 && bestOverlap >= 2) {
        nearMisses.push({
          code: code || product.name,
          name: product.name,
          bestScore: Math.round(bestScore * 100) / 100,
          bestFile: bestEntry.fileName,
        })
      }
    }

    if (!fileId) {
      notFound++
      if (code) unmatchedCodes.push(code)
      continue
    }

    matchedDriveIds.add(fileId)

    if (product.googleDrivePhotoId === fileId) {
      alreadySet++
      continue
    }

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

  // Drive files that weren't matched to any product
  const unmatchedDriveFiles = items
    .filter(i => !matchedDriveIds.has(i.id))
    .map(i => ({ id: i.id, name: i.name }))

  return Response.json({
    dryRun,
    matched,
    alreadySet,
    notFound,
    total:               products.length,
    driveFiles:          items.length,
    byTier,
    unmatchedCodes:      unmatchedCodes.slice(0, 30),
    matchedProducts:     matchedProducts.slice(0, 50),
    sampleDriveFiles:    items.slice(0, 30).map(i => i.name),
    unmatchedDriveFiles: unmatchedDriveFiles.slice(0, 50),
    nearMisses:          nearMisses.sort((a, b) => b.bestScore - a.bestScore).slice(0, 30),
  })
}
