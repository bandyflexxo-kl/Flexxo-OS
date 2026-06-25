/**
 * _scanTab2Photos.ts
 *
 * DRY RUN ONLY — no DB changes, no Drive changes.
 *
 * Scans Google Drive for Kuching stock code photos that can be reused
 * for Tab 2 high-confidence KL substitute products.
 *
 * Usage:
 *   npx tsx scripts/_scanTab2Photos.ts
 */

import { config } from 'dotenv'
import { resolve } from 'path'
import { writeFileSync, readFileSync } from 'fs'

config({ path: resolve(process.cwd(), '.env.local') })

// ── Parse Tab 2 high-confidence from mismatch CSV ─────────────────────────
function parseCsv(path: string): Record<string, string>[] {
  const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean)
  const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim())
  return lines.slice(1).map(line => {
    const vals = line.match(/(".*?"|[^,]+|(?<=,)(?=,)|^(?=,)|(?<=,)$)/g) ?? line.split(',')
    const clean = vals.map(v => v.replace(/^"|"$/g, '').trim())
    return Object.fromEntries(headers.map((h, i) => [h, clean[i] ?? '']))
  })
}

async function main() {
  const { prisma } = await import('../lib/prisma')
  const { listDriveFolderRecursive, normaliseStem } = await import('../lib/googleDrive')

  const rows = parseCsv('scripts/_mismatch_results.csv')
  const tab2 = rows.filter(r => r.verdict === 'DIFF_BRAND_SAME_FORMAT')
  console.log(`Tab 2 high-confidence items: ${tab2.length}`)

  // ── Get admin Google token ──────────────────────────────────────────────
  const adminUser = await prisma.user.findFirst({
    where:  { userRoles: { some: { role: { name: 'Admin' } } } },
    select: { email: true, googleRefreshToken: true },
  })
  if (!adminUser?.googleRefreshToken) {
    console.error('No Google refresh token on admin. Connect Google Drive at /admin/settings first.')
    process.exit(1)
  }

  const folderSetting = await prisma.systemSetting.findUnique({
    where: { key: 'google_drive_photos_folder_id' },
  })
  const folderId = process.env.GOOGLE_DRIVE_PRODUCT_PHOTOS_FOLDER_ID || folderSetting?.value || ''
  if (!folderId) {
    console.error('Google Drive folder ID not configured. Go to /admin/settings.')
    process.exit(1)
  }

  // ── Scan Drive folder ──────────────────────────────────────────────────
  console.log('Scanning Google Drive folder...')
  const driveFiles = await listDriveFolderRecursive(adminUser.googleRefreshToken, folderId)
  console.log(`  ${driveFiles.length} files found in Drive\n`)

  // Build Drive map: normalisedStem → { fileId, fileName }
  const driveMap = new Map<string, { fileId: string; fileName: string }>()
  for (const f of driveFiles) {
    const stem = f.name.replace(/\.[^.]+$/, '').trim()
    const key  = normaliseStem(stem)
    if (!driveMap.has(key)) driveMap.set(key, { fileId: f.id, fileName: f.name })
  }

  // ── Load current KL product photo status ───────────────────────────────
  const klProducts = await prisma.product.findMany({
    where:  { qneItemCode: { in: tab2.map(r => r.kl_code).filter(Boolean) } },
    select: { qneItemCode: true, name: true, googleDrivePhotoId: true },
  })
  const klMap = new Map(klProducts.map(p => [p.qneItemCode ?? '', p]))

  // ── Match ──────────────────────────────────────────────────────────────
  type Result = {
    kl_code: string; kl_name: string; kl_has_photo: boolean
    kuching_code: string; kuching_name: string; kuching_brand: string
    drive_file_id: string; drive_file_name: string
    status: string
  }
  const results: Result[] = []

  let found       = 0
  let alreadyHas  = 0
  let notInDrive  = 0
  let klNotInDb   = 0

  for (const row of tab2) {
    const kuchingKey = normaliseStem(row.excel_code)
    const driveEntry = driveMap.get(kuchingKey)
    const klProduct  = klMap.get(row.kl_code)

    if (!klProduct) {
      klNotInDb++
      results.push({ kl_code: row.kl_code, kl_name: row.kl_name, kl_has_photo: false,
        kuching_code: row.excel_code, kuching_name: row.excel_name, kuching_brand: row.excel_brand,
        drive_file_id: '', drive_file_name: '', status: 'KL_NOT_IN_DB' })
      continue
    }

    if (klProduct.googleDrivePhotoId) {
      alreadyHas++
      results.push({ kl_code: row.kl_code, kl_name: klProduct.name, kl_has_photo: true,
        kuching_code: row.excel_code, kuching_name: row.excel_name, kuching_brand: row.excel_brand,
        drive_file_id: klProduct.googleDrivePhotoId, drive_file_name: '(existing)',
        status: 'KL_ALREADY_HAS_PHOTO' })
      continue
    }

    if (!driveEntry) {
      notInDrive++
      results.push({ kl_code: row.kl_code, kl_name: klProduct.name, kl_has_photo: false,
        kuching_code: row.excel_code, kuching_name: row.excel_name, kuching_brand: row.excel_brand,
        drive_file_id: '', drive_file_name: '', status: 'KUCHING_PHOTO_NOT_IN_DRIVE' })
      continue
    }

    found++
    results.push({ kl_code: row.kl_code, kl_name: klProduct.name, kl_has_photo: false,
      kuching_code: row.excel_code, kuching_name: row.excel_name, kuching_brand: row.excel_brand,
      drive_file_id: driveEntry.fileId, drive_file_name: driveEntry.fileName,
      status: 'READY_TO_LINK' })
  }

  // ── Print summary ──────────────────────────────────────────────────────
  console.log('='.repeat(60))
  console.log('SCAN RESULTS (dry run — nothing written)')
  console.log('='.repeat(60))
  console.log(`  READY_TO_LINK          : ${found}  — Kuching photo found in Drive, KL product has no photo yet`)
  console.log(`  KL_ALREADY_HAS_PHOTO   : ${alreadyHas}  — KL product already has a photo, skip`)
  console.log(`  KUCHING_PHOTO_NOT_IN_DRIVE: ${notInDrive}  — Kuching code not found in Drive`)
  console.log(`  KL_NOT_IN_DB           : ${klNotInDb}  — KL code not found in products table`)
  console.log()
  console.log(`  → ${found} products can get a photo immediately by linking Kuching Drive file`)
  console.log(`  → ${notInDrive} still need scraping`)

  // ── Sample READY_TO_LINK ───────────────────────────────────────────────
  const ready = results.filter(r => r.status === 'READY_TO_LINK').slice(0, 15)
  if (ready.length) {
    console.log('\n--- Sample READY_TO_LINK items ---')
    for (const r of ready) {
      console.log(`  KL  [${r.kl_code.slice(0,20).padEnd(20)}]  ${r.kl_name.slice(0,45)}`)
      console.log(`  KCH [${r.kuching_code.slice(0,20).padEnd(20)}]  ${r.kuching_name.slice(0,45)}`)
      console.log(`  Drive file: ${r.drive_file_name}`)
      console.log()
    }
  }

  // ── Sample NOT IN DRIVE ────────────────────────────────────────────────
  const missing = results.filter(r => r.status === 'KUCHING_PHOTO_NOT_IN_DRIVE').slice(0, 10)
  if (missing.length) {
    console.log('--- Kuching codes NOT found in Drive (need scraping) ---')
    for (const r of missing) {
      console.log(`  [${r.kuching_brand.slice(0,10).padEnd(10)}] ${r.kuching_code.slice(0,22).padEnd(22)}  ${r.kuching_name.slice(0,50)}`)
    }
  }

  // ── Save full results CSV ──────────────────────────────────────────────
  const csvPath = 'scripts/_tab2_scan_results.csv'
  const header  = Object.keys(results[0] ?? {}).join(',')
  const csvBody = results.map(r =>
    Object.values(r).map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
  ).join('\n')
  writeFileSync(csvPath, header + '\n' + csvBody, 'utf-8')
  console.log(`\nFull results saved to ${csvPath}`)

  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
