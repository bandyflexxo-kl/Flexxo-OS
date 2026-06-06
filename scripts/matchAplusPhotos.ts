/**
 * matchAplusPhotos.ts
 *
 * Matches APLUS brand products in the DB to their Google Drive photos using
 * an Excel "bridge" file (APLUS KL.xlsx) that maps APLUS stock codes to stock names.
 *
 * The Excel's Stock # column matches Google Drive photo filenames.
 * The Excel's Stock Name column is matched (via token overlap) to DB product names.
 *
 * Usage:
 *   npx tsx scripts/matchAplusPhotos.ts --dry-run     ← preview only, no DB changes
 *   npx tsx scripts/matchAplusPhotos.ts               ← apply all matches
 *   npx tsx scripts/matchAplusPhotos.ts --force        ← also overwrite products that already have a photo
 *   npx tsx scripts/matchAplusPhotos.ts --file "C:\path\to\file.xlsx"   ← custom Excel path
 */

import { config } from 'dotenv'
import { resolve } from 'path'
import * as XLSX from 'xlsx'
import * as fs from 'fs'

config({ path: resolve(process.cwd(), '.env.local') })

// ── CLI args ─────────────────────────────────────────────────────────────────
const args     = process.argv.slice(2)
const isDryRun = args.includes('--dry-run')
const isForce  = args.includes('--force')
const fileArgIdx = args.indexOf('--file')
const fileArg    = args.find(a => a.startsWith('--file='))?.split('=').slice(1).join('=')
               ?? (fileArgIdx >= 0 ? args[fileArgIdx + 1] : undefined)

const EXCEL_PATH = fileArg
  ?? resolve(process.env.USERPROFILE ?? process.env.HOME ?? '', 'Downloads', 'APLUS KL.xlsx')

// Match threshold — pairs scoring below this are skipped (printed for review)
const SCORE_THRESHOLD  = 0.45
// Minimum number of tokens that must overlap (prevents single-word accidental matches)
const MIN_OVERLAP_TOKENS = 2

// ── Token overlap scoring ─────────────────────────────────────────────────────
function tokenise(s: string): Set<string> {
  return new Set(
    s.toLowerCase()
      .replace(/^aplus\s*/i, '')        // strip "APLUS" prefix — it's noise
      .split(/[^a-z0-9]+/)
      .filter(t => t.length > 1),       // drop single-char tokens
  )
}

function jaccardScore(a: string, b: string): { score: number; overlap: number } {
  const tokA        = tokenise(a)
  const tokB        = tokenise(b)
  const intersection = [...tokA].filter(t => tokB.has(t))
  const union        = new Set([...tokA, ...tokB])
  if (union.size === 0) return { score: 0, overlap: 0 }
  return {
    score:   intersection.length / union.size,
    overlap: intersection.length,
  }
}

// ── Excel parsing ─────────────────────────────────────────────────────────────
type ExcelRow = { stockCode: string; stockName: string }

function parseExcel(filePath: string): ExcelRow[] {
  if (!fs.existsSync(filePath)) {
    console.error(`❌ Excel file not found: ${filePath}`)
    console.error('   Pass a custom path with: --file "C:\\path\\to\\file.xlsx"')
    process.exit(1)
  }
  const buf      = fs.readFileSync(filePath)
  const workbook = XLSX.read(buf, { type: 'buffer' })
  const sheet    = workbook.Sheets[workbook.SheetNames[0]]
  const rows     = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })

  // Auto-detect column names (case-insensitive)
  const sample     = rows[0] ?? {}
  const keys        = Object.keys(sample)
  const codeKey    = keys.find(k => /^stock\s*#/i.test(k) || /^stock.*code/i.test(k) || k === 'Stock #') ?? 'Stock #'
  const nameKey    = keys.find(k => /^stock\s*name/i.test(k) || k === 'Stock Name') ?? 'Stock Name'

  console.log(`📋 Excel columns detected:  code="${codeKey}"  name="${nameKey}"`)
  console.log(`📋 Total Excel rows: ${rows.length}`)

  return rows
    .map(r => ({
      stockCode: String(r[codeKey] ?? '').trim(),
      stockName: String(r[nameKey] ?? '').trim(),
    }))
    .filter(r => r.stockCode && r.stockName)
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const { prisma }                   = await import('../lib/prisma')
  const { listDriveFolderRecursive, normaliseStem } = await import('../lib/googleDrive')

  console.log('\n🔎 matchAplusPhotos.ts')
  console.log(`   Mode: ${isDryRun ? '🔍 DRY RUN (no DB changes)' : '✏️  APPLY'}`)
  console.log(`   Excel: ${EXCEL_PATH}\n`)

  // ── 1. Parse Excel ──────────────────────────────────────────────────────────
  const excelRows = parseExcel(EXCEL_PATH)

  // ── 2. Fetch DB products ────────────────────────────────────────────────────
  console.log('📦 Loading products from DB…')
  const products = await prisma.product.findMany({
    where:  { isActive: true },
    select: { id: true, name: true, brand: true, qneItemCode: true, googleDrivePhotoId: true },
  })
  console.log(`   ${products.length} active products loaded\n`)

  // ── 3. List Drive files ─────────────────────────────────────────────────────
  const folderSetting = await prisma.systemSetting.findUnique({
    where: { key: 'google_drive_photos_folder_id' },
  })
  const folderId = process.env.GOOGLE_DRIVE_PRODUCT_PHOTOS_FOLDER_ID || folderSetting?.value || ''
  if (!folderId) {
    console.error('❌ Google Drive folder ID not set. Go to /admin/settings and configure it first.')
    process.exit(1)
  }

  const adminUser = await prisma.user.findFirst({
    where:   { userRoles: { some: { role: { name: 'Admin' } } } },
    select:  { email: true, googleRefreshToken: true },
  })
  if (!adminUser?.googleRefreshToken) {
    console.error('❌ Admin user has no Google refresh token.')
    console.error('   Go to /admin/settings → Connect Google Drive first.')
    process.exit(1)
  }
  console.log(`🔑 Using Google auth from: ${adminUser.email}`)

  console.log('📁 Scanning Google Drive folder…')
  const driveItems = await listDriveFolderRecursive(adminUser.googleRefreshToken, folderId)
  console.log(`   ${driveItems.length} Drive files found`)
  console.log('\n📂 ALL Drive filenames:')
  driveItems.forEach((f, i) => console.log(`   ${String(i + 1).padStart(3)}.  ${f.name}`))
  console.log()

  // Build drive map: normaliseStem(stem) → { fileId, fileName }
  const driveMap = new Map<string, { fileId: string; fileName: string }>()
  for (const item of driveItems) {
    const stem = item.name.replace(/\.[^.]+$/, '').trim()
    const key  = normaliseStem(stem)
    if (!driveMap.has(key)) driveMap.set(key, { fileId: item.id, fileName: item.name })
  }

  // ── 4. Match ────────────────────────────────────────────────────────────────
  let countMatched    = 0
  let countAlreadySet = 0
  let countNoDrive    = 0
  let countNoProduct  = 0
  let countLowConf    = 0

  const lowConfidenceMatches: { excelName: string; productName: string; score: number; driveFile: string }[] = []
  const unmatchedInDrive:    string[] = []
  const unmatchedInDB:       string[] = []

  for (const row of excelRows) {
    // Step 1: Find Drive file by stock code
    const driveKey   = normaliseStem(row.stockCode)
    const driveEntry = driveMap.get(driveKey)

    if (!driveEntry) {
      countNoDrive++
      unmatchedInDrive.push(row.stockCode)
      continue
    }

    // Step 2: Find best-matching DB product by token overlap on name
    let bestProduct: (typeof products)[number] | null = null
    let bestScore   = 0
    let bestOverlap = 0

    for (const product of products) {
      const { score, overlap } = jaccardScore(row.stockName, product.name)
      if (score > bestScore) {
        bestScore   = score
        bestOverlap = overlap
        bestProduct = product
      }
    }

    if (!bestProduct || bestScore < SCORE_THRESHOLD || bestOverlap < MIN_OVERLAP_TOKENS) {
      countNoProduct++
      unmatchedInDB.push(`${row.stockCode} → "${row.stockName}" (best: ${bestScore.toFixed(2)} "${bestProduct?.name ?? 'none'}")`)
      continue
    }

    // Already set and not forcing
    if (bestProduct.googleDrivePhotoId && !isForce) {
      countAlreadySet++
      continue
    }

    // Borderline confidence — still apply but flag for review
    const isBorderline = bestScore < 0.6
    if (isBorderline) {
      countLowConf++
      lowConfidenceMatches.push({
        excelName:   row.stockName,
        productName: bestProduct.name,
        score:       bestScore,
        driveFile:   driveEntry.fileName,
      })
    }

    if (!isDryRun) {
      await prisma.product.update({
        where: { id: bestProduct.id },
        data:  { googleDrivePhotoId: driveEntry.fileId },
      })
    }

    countMatched++

    const scoreStr  = (bestScore * 100).toFixed(0).padStart(3)
    const status    = isDryRun ? '◎' : '✓'
    const flag      = isBorderline ? ' ⚠️' : ''
    console.log(
      `${status} ${scoreStr}%  ${bestProduct.name.slice(0, 45).padEnd(45)}  ←  ${row.stockName.slice(0, 50)}${flag}`,
    )
  }

  // ── 5. Summary ──────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(70))
  console.log(`\n📊 RESULTS${isDryRun ? ' (dry run — nothing written)' : ''}:\n`)
  console.log(`  ✓  ${countMatched.toString().padStart(4)}  matched & ${isDryRun ? 'would be updated' : 'updated'}`)
  console.log(`  ↺  ${countAlreadySet.toString().padStart(4)}  already had a photo (skipped${isForce ? ' — force mode would overwrite' : ''})`)
  console.log(`  ✕  ${countNoDrive.toString().padStart(4)}  Excel rows: no matching Drive file`)
  console.log(`  ✕  ${countNoProduct.toString().padStart(4)}  Excel rows: no DB product matched (score too low)`)

  if (lowConfidenceMatches.length > 0) {
    console.log(`\n⚠️  ${lowConfidenceMatches.length} low-confidence matches (score 45–60%) — please review:`)
    for (const m of lowConfidenceMatches) {
      console.log(`   ${(m.score * 100).toFixed(0)}%  DB: "${m.productName}"  ←  Excel: "${m.excelName}"  [${m.driveFile}]`)
    }
  }

  if (unmatchedInDrive.length > 0) {
    console.log(`\n📁 Excel codes with no Drive file (first 20):`)
    unmatchedInDrive.slice(0, 20).forEach(c => console.log(`   - ${c}`))
    if (unmatchedInDrive.length > 20) console.log(`   … and ${unmatchedInDrive.length - 20} more`)
  }

  if (unmatchedInDB.length > 0) {
    console.log(`\n🔍 Excel rows with no DB product match (first 20):`)
    unmatchedInDB.slice(0, 20).forEach(c => console.log(`   - ${c}`))
    if (unmatchedInDB.length > 20) console.log(`   … and ${unmatchedInDB.length - 20} more`)
  }

  if (isDryRun && countMatched > 0) {
    console.log(`\n💡 Run without --dry-run to apply ${countMatched} matches:`)
    console.log(`   npx tsx scripts/matchAplusPhotos.ts`)
  }

  console.log()
  await prisma.$disconnect()
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
