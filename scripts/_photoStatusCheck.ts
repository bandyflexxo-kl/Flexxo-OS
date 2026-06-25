import { config } from 'dotenv'
import { resolve } from 'path'
import { readFileSync } from 'fs'

config({ path: resolve(process.cwd(), '.env.local') })

async function main() {
  const { prisma } = await import('../lib/prisma')

  const lines = readFileSync('scripts/_mismatch_results.csv', 'utf-8').split('\n').filter(Boolean)
  const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim())
  const rows = lines.slice(1).map(line => {
    const cols = line.split(',')
    return Object.fromEntries(headers.map((h, i) => [h, (cols[i] ?? '').replace(/^"|"$/g, '').trim()]))
  })

  const low = rows.filter(r => parseFloat(r.score) < 0.8 && r.verdict !== 'TRULY_MISSING')
  const klCodes = [...new Set(low.map(r => r.kl_code).filter(Boolean))]

  const products = await prisma.product.findMany({
    where:  { qneItemCode: { in: klCodes } },
    select: { qneItemCode: true, googleDrivePhotoId: true, photoUrl: true },
  })
  const photoMap = new Map(products.map(p => [p.qneItemCode ?? '', !!p.googleDrivePhotoId || !!p.photoUrl]))

  const byVerdict: Record<string, { has: number; no: number }> = {}
  let hasPhoto = 0, noPhoto = 0

  for (const r of low) {
    const v = r.verdict
    if (!byVerdict[v]) byVerdict[v] = { has: 0, no: 0 }
    const has = photoMap.get(r.kl_code) ?? false
    if (has) { hasPhoto++; byVerdict[v].has++ } else { noPhoto++; byVerdict[v].no++ }
  }

  console.log(`\nTotal low-score items (excl TRULY_MISSING): ${low.length}`)
  console.log(`Has photo (Drive or Supabase)             : ${hasPhoto}`)
  console.log(`No photo at all                           : ${noPhoto}`)
  console.log('\nBreakdown by verdict:')
  for (const [v, c] of Object.entries(byVerdict)) {
    console.log(`  ${v.padEnd(26)}  has=${c.has}  no=${c.no}`)
  }

  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
