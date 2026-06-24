/**
 * photoMatchReport.ts
 *
 * For every product that has NO googleDrivePhotoId, find its best candidate Drive
 * filename using the same 6-tier cascade as the admin scan-photos API.
 *
 * Output: photo-match-report-YYYY-MM-DD.xlsx  (in project root)
 *   Sheet 1  "Near-miss Candidates"  — best score ≥ 20%  (review + confirm)
 *   Sheet 2  "No Drive Photo Found"  — score < 20%       (need to source photos)
 *   Sheet 3  "Summary"
 *
 * Usage:
 *   npx tsx scripts/photoMatchReport.ts
 */

import { config } from 'dotenv'
import { resolve }  from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import pg   from 'pg'
import * as XLSX from 'xlsx'

// ── Text matching helpers (mirrors scan-photos/route.ts) ──────────────────────

function tokenise(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(t => t.length >= 2)
}

function normalizeDriveStem(stem: string): string {
  return stem
    .replace(/^\d(?=[A-Za-z])/, '')          // strip single-digit category prefix
    .replace(/([A-Za-z])(\d{3,})/g, '$1 $2') // HAMPER1288 → HAMPER 1288
    .replace(/(\d{3,})([A-Za-z])/g, '$1 $2') // 2415100UKM → 2415100 UKM
}

function normaliseStem(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function jaccard(a: string, b: string): number {
  const setA = new Set(tokenise(a))
  const setB = new Set(tokenise(b))
  if (setA.size === 0 || setB.size === 0) return 0
  const inter = [...setA].filter(t => setB.has(t)).length
  const union  = new Set([...setA, ...setB]).size
  return inter / union
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Dynamic import AFTER dotenv so lib modules see DATABASE_URL
  const { listDriveFolderRecursive } = await import('../lib/googleDrive')

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

  // ── 1. Get admin Google token ─────────────────────────────────────────────
  const { rows: adminRows } = await pool.query<{ google_refresh_token: string | null }>(`
    SELECT u.google_refresh_token
    FROM   users u
    JOIN   user_roles ur ON ur.user_id = u.id AND ur.revoked_at IS NULL
    JOIN   roles r       ON r.id = ur.role_id AND r.name = 'Admin'
    WHERE  u.google_refresh_token IS NOT NULL
    LIMIT  1
  `)

  // Accept Service Account key as fallback (no token needed from DB)
  const hasSA      = !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  const driveToken = hasSA ? null : adminRows[0]?.google_refresh_token ?? null

  if (!hasSA && !driveToken) {
    console.error('❌ No Google Drive credentials found.')
    console.error('   Either set GOOGLE_SERVICE_ACCOUNT_KEY in .env.local,')
    console.error('   or connect your Google account at /admin/settings.')
    process.exit(1)
  }

  // ── 2. Get Drive folder ID ────────────────────────────────────────────────
  const { rows: settingRows } = await pool.query<{ value: string }>(`
    SELECT value FROM system_settings WHERE key = 'google_drive_photos_folder_id' LIMIT 1
  `)
  const folderId = process.env.GOOGLE_DRIVE_PRODUCT_PHOTOS_FOLDER_ID || settingRows[0]?.value
  if (!folderId) {
    console.error('❌ Google Drive folder ID not configured. Set it at /admin/settings.')
    process.exit(1)
  }

  // ── 3. List Drive files ───────────────────────────────────────────────────
  console.log('📁 Scanning Google Drive folder…')
  const driveItems = await listDriveFolderRecursive(driveToken, folderId)
  console.log(`   ${driveItems.length} files found\n`)

  // Build matching indexes
  const exactMap = new Map<string, string>()  // UPPER stem → fileId
  const fuzzyMap = new Map<string, string>()  // normaliseStem → fileId

  type DriveEntry = { fileId: string; fileName: string; normalizedStem: string }
  const driveEntries: DriveEntry[] = []

  for (const item of driveItems) {
    const stem     = item.name.replace(/\.[^.]+$/, '').trim()
    const normStem = normalizeDriveStem(stem)
    if (!exactMap.has(stem.toUpperCase())) exactMap.set(stem.toUpperCase(), item.id)
    if (!fuzzyMap.has(normaliseStem(stem))) fuzzyMap.set(normaliseStem(stem), item.id)
    driveEntries.push({ fileId: item.id, fileName: item.name, normalizedStem: normStem })
  }

  const fileIdToName = new Map(driveItems.map(i => [i.id, i.name]))

  // ── 4. Get unmatched products from DB ─────────────────────────────────────
  console.log('📦 Loading unmatched products from DB…')
  const { rows: products } = await pool.query<{
    id: string
    qne_item_code: string | null
    internal_sku:  string | null
    name:          string
    brand:         string | null
    category:      string
    parent_cat:    string | null
  }>(`
    SELECT
      p.id,
      p.qne_item_code,
      p.internal_sku,
      p.name,
      p.brand,
      c.name          AS category,
      pc.name         AS parent_cat
    FROM   products p
    JOIN   product_categories c  ON c.id = p.category_id
    LEFT JOIN product_categories pc ON pc.id = c.parent_category_id
    WHERE  p.is_active = true
      AND  p.google_drive_photo_id IS NULL
    ORDER BY p.brand NULLS LAST, p.name
  `)
  console.log(`   ${products.length} unmatched products\n`)

  // ── 5. Match each product ─────────────────────────────────────────────────
  type Row = {
    parent_cat:    string
    category:      string
    brand:         string
    qne_code:      string
    product_name:  string
    best_score:    number
    best_file:     string
    confidence:    string
  }

  const nearMissRows:    Row[] = []
  const noCandidateRows: Row[] = []

  let done = 0
  for (const p of products) {
    const code = (p.qne_item_code ?? p.internal_sku ?? '').trim()

    // Tiers 1–5: deterministic exact/fuzzy key matches
    let hitFileId: string | null = null

    if (!hitFileId && code)                    hitFileId = exactMap.get(code.toUpperCase()) ?? null
    if (!hitFileId && code)                    hitFileId = fuzzyMap.get(normaliseStem(code)) ?? null
    if (!hitFileId && p.name)                  hitFileId = exactMap.get(p.name.toUpperCase()) ?? null
    if (!hitFileId && p.name)                  hitFileId = fuzzyMap.get(normaliseStem(p.name)) ?? null
    if (!hitFileId && p.brand && p.name)       hitFileId = fuzzyMap.get(normaliseStem(p.brand + ' ' + p.name)) ?? null

    if (hitFileId) {
      // Tiers 1–5 would have matched — the DB scan hasn't been run yet or this is a new product
      nearMissRows.push({
        parent_cat:   p.parent_cat   ?? '',
        category:     p.category     ?? '',
        brand:        p.brand        ?? '',
        qne_code:     code,
        product_name: p.name,
        best_score:   100,
        best_file:    fileIdToName.get(hitFileId) ?? hitFileId,
        confidence:   'Exact — run Scan All Photos to apply',
      })
      done++
      continue
    }

    // Tier 6: Jaccard — find best candidate (no threshold floor)
    let bestScore  = 0
    let bestFile   = ''

    for (const entry of driveEntries) {
      let s = 0
      if (p.name) s = Math.max(s, jaccard(p.name, entry.normalizedStem))
      if (code)   s = Math.max(s, jaccard(code,   entry.normalizedStem))
      if (s > bestScore) { bestScore = s; bestFile = entry.fileName }
    }

    const pct = Math.round(bestScore * 100)

    const confidence =
      pct >= 50 ? 'High — likely correct' :
      pct >= 35 ? 'Medium — review photo' :
      pct >= 20 ? 'Low — check carefully' :
                  'No candidate found'

    const row: Row = {
      parent_cat:   p.parent_cat   ?? '',
      category:     p.category     ?? '',
      brand:        p.brand        ?? '',
      qne_code:     code,
      product_name: p.name,
      best_score:   pct,
      best_file:    bestFile || '—',
      confidence,
    }

    if (bestScore >= 0.20) nearMissRows.push(row)
    else                   noCandidateRows.push(row)

    done++
    if (done % 500 === 0) process.stdout.write(`   ${done}/${products.length}…\r`)
  }
  console.log(`   Done matching ${products.length} products.          `)

  // Sort near-misses: score desc
  nearMissRows.sort((a, b) => b.best_score - a.best_score)

  // ── 6. Build Excel workbook ───────────────────────────────────────────────
  const wb = XLSX.utils.book_new()

  const HEADERS = [
    'Parent Category', 'Sub Category', 'Brand', 'QNE Code',
    'Product Name', 'Best Score %', 'Best Candidate Drive File', 'Confidence',
  ]
  const COL_WIDTHS = [16, 20, 14, 18, 50, 10, 40, 26]

  function makeSheet(rows: Row[]): XLSX.WorkSheet {
    const data = [
      HEADERS,
      ...rows.map(r => [
        r.parent_cat, r.category, r.brand, r.qne_code,
        r.product_name, r.best_score, r.best_file, r.confidence,
      ]),
    ]
    const ws = XLSX.utils.aoa_to_sheet(data)
    ws['!cols'] = COL_WIDTHS.map(w => ({ wch: w }))
    return ws
  }

  XLSX.utils.book_append_sheet(wb, makeSheet(nearMissRows),    'Near-miss Candidates')
  XLSX.utils.book_append_sheet(wb, makeSheet(noCandidateRows), 'No Drive Photo Found')

  // Summary sheet
  const high   = nearMissRows.filter(r => r.best_score >= 50).length
  const medium = nearMissRows.filter(r => r.best_score >= 35 && r.best_score < 50).length
  const low    = nearMissRows.filter(r => r.best_score >= 20 && r.best_score < 35).length
  const exact  = nearMissRows.filter(r => r.best_score === 100).length

  const summaryData = [
    ['Photo Match Gap Report', new Date().toLocaleString('en-MY')],
    [],
    ['Unmatched products scanned',              products.length],
    [],
    ['NEAR-MISS CANDIDATES (score ≥ 20%)',      nearMissRows.length],
    ['  Exact match (run Scan to apply)',        exact],
    ['  High confidence (≥ 50%)',               high],
    ['  Medium confidence (35–49%)',             medium],
    ['  Low confidence (20–34%)',               low],
    [],
    ['NO DRIVE PHOTO FOUND (score < 20%)',      noCandidateRows.length],
    [],
    ['Drive folder file count',                  driveItems.length],
    [],
    ['How to use this report:'],
    ['1. "Near-miss" sheet: sort by Score desc, open each Drive file, confirm if it matches the product.'],
    ['2. "No Drive Photo Found" sheet: these products have no photo in Drive at all — upload or source externally.'],
    ['3. After uploading/renaming photos in Drive, run Admin → Product Catalog → Scan All Photos.'],
  ]
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryData)
  wsSummary['!cols'] = [{ wch: 40 }, { wch: 20 }]
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary')

  // ── 7. Write file ─────────────────────────────────────────────────────────
  const date    = new Date().toISOString().split('T')[0]
  const outPath = resolve(process.cwd(), `photo-match-report-${date}.xlsx`)
  XLSX.writeFile(wb, outPath)

  console.log('\n✅  Report saved:', outPath)
  console.log(`    Near-miss candidates : ${nearMissRows.length}  (Sheet 1 — review these)`)
  console.log(`    No Drive photo found : ${noCandidateRows.length}  (Sheet 2 — need to source)`)
  console.log(`    Drive files scanned  : ${driveItems.length}`)

  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
