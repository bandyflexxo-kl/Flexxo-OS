/**
 * _scrapePhotos.ts
 *
 * Scrapes product images via Serper.dev (Google Images) and uploads to Supabase Storage.
 * Writes the public CDN URL to products.photo_url so the shop serves it directly.
 *
 * Required env vars (add to .env.local):
 *   SERPER_API_KEY             — serper.dev free signup, 2,500 searches, no credit card
 *   SUPABASE_SERVICE_ROLE_KEY  — Supabase dashboard → Project Settings → API → service_role
 *
 * Usage:
 *   npx tsx scripts/_scrapePhotos.ts --status            ← show coverage, no scraping
 *   npx tsx scripts/_scrapePhotos.ts --limit 100         ← scrape 100 (Kuching-priority)
 *   npx tsx scripts/_scrapePhotos.ts --limit 600         ← scrape 600 (repeat 4× for full run)
 *   npx tsx scripts/_scrapePhotos.ts --dry-run --limit 20 ← preview queries, no uploads
 */

import { config } from 'dotenv'
import { resolve } from 'path'
import { writeFileSync, readFileSync, existsSync } from 'fs'

config({ path: resolve(process.cwd(), '.env.local') })

const SERPER_KEY   = process.env.SERPER_API_KEY ?? ''
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const BUCKET       = 'product-photos'
const DELAY_MS     = 600

function deriveSupabaseUrl(): string {
  if (process.env.SUPABASE_URL) return process.env.SUPABASE_URL
  const match = (process.env.DATABASE_URL ?? '').match(/postgres\.([a-z0-9]+)[:@]/)
  const ref   = match?.[1]
  if (!ref) throw new Error('Set SUPABASE_URL in .env.local — cannot derive from DATABASE_URL.')
  return `https://${ref}.supabase.co`
}
const SUPABASE_URL = deriveSupabaseUrl()

// ── CLI args ───────────────────────────────────────────────────────────────
const args       = process.argv.slice(2)
const SHOW_STATUS = args.includes('--status')
const DRY_RUN    = args.includes('--dry-run')
const limitArg   = args.find(a => a.startsWith('--limit='))?.split('=')[1]
               ?? (args.indexOf('--limit') >= 0 ? args[args.indexOf('--limit') + 1] : undefined)
const LIMIT      = parseInt(limitArg ?? '100', 10)

// ── Load Kuching-priority KL codes from coverage check output ─────────────
function loadKuchingPriorityCodes(): Set<string> {
  const path = 'scripts/_priority_scrape_list.csv'
  if (!existsSync(path)) return new Set()
  const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean)
  const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim())
  const klIdx   = headers.indexOf('kl_code')
  if (klIdx < 0) return new Set()
  const codes = new Set<string>()
  for (const line of lines.slice(1)) {
    const cols = line.split(',')
    const code = (cols[klIdx] ?? '').replace(/"/g, '').trim().toUpperCase()
    if (code) codes.add(code)
  }
  return codes
}

// ── Serper Image Search ────────────────────────────────────────────────────
type SerperImg = { imageUrl: string; title: string; imageWidth: number; imageHeight: number }

async function serperSearch(query: string): Promise<SerperImg[]> {
  const res = await fetch('https://google.serper.dev/images', {
    method:  'POST',
    headers: { 'X-API-KEY': SERPER_KEY, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ q: query, num: 5, gl: 'my', hl: 'en' }),
  })
  if (!res.ok) throw new Error(`Serper ${res.status}: ${await res.text()}`)
  const data = await res.json() as { images?: SerperImg[] }
  return data.images ?? []
}

// ── Download image ─────────────────────────────────────────────────────────
async function downloadImage(url: string): Promise<{ buf: Buffer; contentType: string }> {
  const ctrl  = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 10_000)
  try {
    const res = await fetch(url, {
      signal:  ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Flexxo-Bot/1.0)' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buf         = Buffer.from(await res.arrayBuffer())
    const contentType = (res.headers.get('content-type') ?? 'image/jpeg').split(';')[0].trim()
    return { buf, contentType }
  } finally {
    clearTimeout(timer)
  }
}

// ── Supabase Storage ───────────────────────────────────────────────────────
async function ensureBucket(): Promise<void> {
  const res  = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ id: BUCKET, name: BUCKET, public: true }),
  })
  if (!res.ok) {
    const body = await res.json() as { error?: string; message?: string }
    if (!body.error?.includes('Duplicate') && !body.message?.includes('already exists'))
      throw new Error(`Bucket create failed: ${JSON.stringify(body)}`)
  }
  console.log(`  Supabase bucket "${BUCKET}" ready`)
}

async function uploadToSupabase(productId: string, buf: Buffer, contentType: string): Promise<string> {
  const ext  = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg'
  const file = `${productId}.${ext}`
  const res  = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${file}`, {
    method:  'PUT',
    headers: { 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': contentType, 'x-upsert': 'true' },
    body:    buf,
  })
  if (!res.ok) throw new Error(`Upload failed ${res.status}: ${await res.text()}`)
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${file}`
}

// ── Search query builder ───────────────────────────────────────────────────
function buildQuery(name: string): string {
  return name
    .replace(/\b\d+(MM|CM|ML|L|G|KG|PCS|PK|PKT|BOX|BX|SET|ROLL|PAD)\b/gi, '')
    .replace(/\b[A-Z]{2,4}\d+[A-Z0-9-]*\b/g, '')
    .replace(/\s+/g, ' ').trim().slice(0, 80)
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// ── Status report ─────────────────────────────────────────────────────────
async function showStatus(prisma: Awaited<ReturnType<typeof getPrisma>>) {
  const [total, withDrive, withUrl, noPhoto] = await Promise.all([
    prisma.product.count({ where: { isActive: true, isVisibleToCustomers: true } }),
    prisma.product.count({ where: { isActive: true, isVisibleToCustomers: true, googleDrivePhotoId: { not: null } } }),
    prisma.product.count({ where: { isActive: true, isVisibleToCustomers: true, photoUrl: { not: null } } }),
    prisma.product.count({ where: { isActive: true, isVisibleToCustomers: true, googleDrivePhotoId: null, photoUrl: null } }),
  ])
  const withPhoto  = withDrive + withUrl
  const priority   = loadKuchingPriorityCodes()
  const runsNeeded = Math.ceil(noPhoto / 600)

  console.log('\n' + '='.repeat(55))
  console.log('PHOTO COVERAGE STATUS')
  console.log('='.repeat(55))
  console.log(`  Visible products          : ${total.toLocaleString()}`)
  console.log(`  With photo (Drive)        : ${withDrive.toLocaleString()}  (${Math.round(withDrive/total*100)}%)`)
  console.log(`  With photo (Supabase)     : ${withUrl.toLocaleString()}  (${Math.round(withUrl/total*100)}%)`)
  console.log(`  Total with photo          : ${withPhoto.toLocaleString()}  (${Math.round(withPhoto/total*100)}%)`)
  console.log(`  Still need photo          : ${noPhoto.toLocaleString()}  (${Math.round(noPhoto/total*100)}%)`)
  console.log()
  console.log(`  Kuching-priority targets  : ${priority.size} KL products`)
  console.log(`  At --limit 600 per run    : ${runsNeeded} more runs to cover all remaining`)
  console.log(`  Serper credits needed     : ${noPhoto.toLocaleString()}`)
  console.log('='.repeat(55))
}

async function getPrisma() {
  const { prisma } = await import('../lib/prisma')
  return prisma
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  const prisma = await getPrisma()

  if (SHOW_STATUS) {
    await showStatus(prisma)
    await prisma.$disconnect()
    return
  }

  if (!SERPER_KEY)   { console.error('Missing SERPER_API_KEY in .env.local'); process.exit(1) }
  if (!SUPABASE_KEY) { console.error('Missing SUPABASE_SERVICE_ROLE_KEY in .env.local'); process.exit(1) }

  console.log(`\n_scrapePhotos.ts`)
  console.log(`  Mode      : ${DRY_RUN ? 'DRY RUN (no uploads)' : 'LIVE'}`)
  console.log(`  Limit     : ${LIMIT} Serper credits`)
  console.log(`  Supabase  : ${SUPABASE_URL}`)
  console.log(`  Bucket    : ${BUCKET}`)

  if (!DRY_RUN) await ensureBucket()

  // ── Build ordered product list: Kuching-priority first, then general ──
  const priorityCodes = loadKuchingPriorityCodes()
  console.log(`  Priority  : ${priorityCodes.size} Kuching-matched KL codes loaded\n`)

  // Fetch all no-photo products, more than LIMIT so we can re-order
  const allNoPhoto = await prisma.product.findMany({
    where: {
      isActive:             true,
      isVisibleToCustomers: true,
      googleDrivePhotoId:   null,
      photoUrl:             null,
    },
    select: { id: true, name: true, brand: true, qneItemCode: true, qneInvoiceFreq: true },
    orderBy: { qneInvoiceFreq: 'desc' },
    take: LIMIT * 10,  // fetch a buffer so priority sort has candidates to pull from
  })

  // Priority products first (in Kuching mapping), then general by popularity
  const priority = allNoPhoto.filter(p => priorityCodes.has((p.qneItemCode ?? '').toUpperCase()))
  const general  = allNoPhoto.filter(p => !priorityCodes.has((p.qneItemCode ?? '').toUpperCase()))
  const products = [...priority, ...general].slice(0, LIMIT)

  console.log(`  Queue     : ${priority.length < LIMIT ? priority.length : LIMIT} priority + ${Math.max(0, LIMIT - priority.length)} general`)
  console.log(`  Processing: ${products.length} products\n`)

  type LogRow = {
    id: string; qneItemCode: string; name: string; priority: string
    searchQuery: string; imageUrl: string; sizeKb: string; photoUrl: string; status: string
  }
  const log: LogRow[] = []
  let ok = 0, okPriority = 0, failed = 0, skipped = 0

  for (let i = 0; i < products.length; i++) {
    const p        = products[i]
    const isPrio   = priorityCodes.has((p.qneItemCode ?? '').toUpperCase())
    const query    = buildQuery(p.name)
    const row: LogRow = {
      id: p.id, qneItemCode: p.qneItemCode ?? '', name: p.name,
      priority: isPrio ? 'YES' : 'no',
      searchQuery: query, imageUrl: '', sizeKb: '', photoUrl: '', status: '',
    }

    const tag = isPrio ? '[P]' : '   '
    process.stdout.write(`${tag} [${String(i + 1).padStart(3)}/${products.length}] ${p.name.slice(0, 50).padEnd(50)} `)

    try {
      const results = await serperSearch(query)
      if (!results.length) {
        process.stdout.write('NO RESULTS\n')
        row.status = 'NO_IMAGE_FOUND'; skipped++
        log.push(row); await sleep(DELAY_MS); continue
      }

      let downloaded: { buf: Buffer; contentType: string } | null = null
      let usedUrl = ''
      for (const img of results) {
        try { downloaded = await downloadImage(img.imageUrl); usedUrl = img.imageUrl; break }
        catch { /* try next */ }
      }

      if (!downloaded) {
        process.stdout.write('DOWNLOAD FAILED\n')
        row.status = 'DOWNLOAD_FAILED'; failed++
        log.push(row); await sleep(DELAY_MS); continue
      }

      row.imageUrl = usedUrl
      row.sizeKb   = String(Math.round(downloaded.buf.length / 1024))

      if (DRY_RUN) {
        process.stdout.write(`OK dry-run ${row.sizeKb}KB\n`)
        row.status = 'DRY_RUN_OK'; row.photoUrl = usedUrl; ok++; if (isPrio) okPriority++
        log.push(row); await sleep(DELAY_MS); continue
      }

      const publicUrl  = await uploadToSupabase(p.id, downloaded.buf, downloaded.contentType)
      row.photoUrl     = publicUrl
      await prisma.product.update({ where: { id: p.id }, data: { photoUrl: publicUrl } })

      process.stdout.write(`OK ${row.sizeKb}KB\n`)
      row.status = 'SUCCESS'; ok++; if (isPrio) okPriority++

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      process.stdout.write(`ERROR ${msg.slice(0, 50)}\n`)
      row.status = `ERROR: ${msg.slice(0, 80)}`; failed++
    }

    log.push(row)
    await sleep(DELAY_MS)
  }

  const logPath = 'scripts/_scrape_log.csv'
  const header  = Object.keys(log[0] ?? {}).join(',')
  const body    = log.map(r =>
    Object.values(r).map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
  ).join('\n')
  writeFileSync(logPath, header + '\n' + body, 'utf-8')

  console.log('\n' + '='.repeat(55))
  console.log(`SUCCESS  : ${ok}  (${okPriority} Kuching-priority, ${ok - okPriority} general)`)
  console.log(`FAILED   : ${failed}`)
  console.log(`SKIPPED  : ${skipped}  (no image found)`)
  console.log(`Log      : ${logPath}`)
  console.log()
  console.log('Next run: npx tsx scripts/_scrapePhotos.ts --limit 600')
  console.log('Status  : npx tsx scripts/_scrapePhotos.ts --status')

  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
