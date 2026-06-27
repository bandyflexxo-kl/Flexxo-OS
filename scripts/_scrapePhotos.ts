/**
 * _scrapePhotos.ts
 *
 * Scrapes product images via Serper.dev (Google Images) and uploads to Supabase Storage.
 * Photos are sourced ONLY from the brand's official website (site: operator).
 *
 * 3-stage fallback per product (all restricted to official site):
 *   Stage 1 — Direct name query      : site:brand.com {clean product name}
 *   Stage 2 — Refined name (no junk) : site:brand.com {name with promo words stripped}
 *   Stage 3 — Claude AI keywords     : site:brand.com {Claude-generated 8-word query}
 *                                      (only runs if ANTHROPIC_API_KEY is set)
 *
 * Products with no brand mapping are skipped by default (add to lib/brandSites.ts to enable).
 *
 * Required env vars (.env.local):
 *   SERPER_API_KEY             — serper.dev (2,500 free searches)
 *   SUPABASE_SERVICE_ROLE_KEY  — Supabase dashboard → Project Settings → API → service_role
 *   ANTHROPIC_API_KEY          — optional; enables Stage 3 AI keyword generation
 *
 * Usage:
 *   npx tsx scripts/_scrapePhotos.ts --status                   ← coverage + brand mapping report
 *   npx tsx scripts/_scrapePhotos.ts --limit 100                ← scrape 100 mapped-brand products
 *   npx tsx scripts/_scrapePhotos.ts --limit 200 --brand APLUS  ← one brand at a time
 *   npx tsx scripts/_scrapePhotos.ts --dry-run --limit 20       ← preview queries, no uploads
 *   npx tsx scripts/_scrapePhotos.ts --limit 600 --include-unmapped  ← also scrape unmapped brands
 */

import { config } from 'dotenv'
import { resolve } from 'path'
import { writeFileSync, readFileSync, existsSync } from 'fs'

config({ path: resolve(process.cwd(), '.env.local') })

const SERPER_KEY     = process.env.SERPER_API_KEY ?? ''
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const ANTHROPIC_KEY  = process.env.ANTHROPIC_API_KEY ?? ''
const BUCKET         = 'product-photos'
const DELAY_MS       = 600

function deriveSupabaseUrl(): string {
  if (process.env.SUPABASE_URL) return process.env.SUPABASE_URL
  const match = (process.env.DATABASE_URL ?? '').match(/postgres\.([a-z0-9]+)[:@]/)
  const ref   = match?.[1]
  if (!ref) throw new Error('Set SUPABASE_URL in .env.local — cannot derive from DATABASE_URL.')
  return `https://${ref}.supabase.co`
}
const SUPABASE_URL = deriveSupabaseUrl()

// ── CLI args ───────────────────────────────────────────────────────────────
const args             = process.argv.slice(2)
const SHOW_STATUS      = args.includes('--status')
const DRY_RUN          = args.includes('--dry-run')
const INCLUDE_UNMAPPED = args.includes('--include-unmapped')

const limitArg = args.find(a => a.startsWith('--limit='))?.split('=')[1]
             ?? (args.indexOf('--limit') >= 0 ? args[args.indexOf('--limit') + 1] : undefined)
const LIMIT    = parseInt(limitArg ?? '100', 10)

const brandArg    = args.find(a => a.startsWith('--brand='))?.split('=')[1]
               ?? (args.indexOf('--brand') >= 0 ? args[args.indexOf('--brand') + 1] : undefined)
const BRAND_FILTER = brandArg?.toUpperCase()

// ── Promo-word junk stripper (Stage 2 refinement) ─────────────────────────
const JUNK_RE = /\b(with\s+printing|customize|customise|customization|customisation|printing|order\s+form|delivery\s+order|running\s+number|paper\s+colour|paper\s+color|colour|authorized|signature|2ply|3ply|4ply|bks|digits|2up|3up)\b/gi

// ── Brand site mapping ─────────────────────────────────────────────────────
async function getBrandSiteModule() {
  const { getBrandSite, BRAND_OFFICIAL_SITES } = await import('../lib/brandSites')
  return { getBrandSite, BRAND_OFFICIAL_SITES }
}

// ── Load Kuching-priority KL codes ─────────────────────────────────────────
function loadKuchingPriorityCodes(): Set<string> {
  const path = 'scripts/_priority_scrape_list.csv'
  if (!existsSync(path)) return new Set()
  const lines   = readFileSync(path, 'utf-8').split('\n').filter(Boolean)
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

// ── Serper image search ────────────────────────────────────────────────────
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

// ── Claude AI keyword generation (Stage 3) ────────────────────────────────
async function claudeKeywords(name: string, brand: string | null): Promise<string> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY })
  const msg = await anthropic.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 60,
    messages:   [{
      role:    'user',
      content: `Generate a Google Images search query (max 8 words, NO "site:" prefix) to find a CLEAN product photo on the brand's official website.
Product: ${name}
Brand: ${brand ?? 'N/A'}
Return ONLY the search keywords — no quotes, no explanation.`,
    }],
  })
  return (msg.content[0] as { type: 'text'; text: string }).text
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/^site:\S+\s*/i, '')
    .slice(0, 100)
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
  const res = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
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
    headers: { Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': contentType, 'x-upsert': 'true' },
    body:    buf,
  })
  if (!res.ok) throw new Error(`Upload failed ${res.status}: ${await res.text()}`)
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${file}`
}

// ── Query builder helpers ──────────────────────────────────────────────────
function cleanProductName(name: string): string {
  return name
    .replace(/\b\d+(MM|CM|ML|L|G|KG|PCS|PK|PKT|BOX|BX|SET|ROLL|PAD)\b/gi, '')
    .replace(/\b[A-Z]{2,4}\d+[A-Z0-9-]*\b/g, '')
    .replace(/\s+/g, ' ').trim().slice(0, 80)
}

function refinedProductName(name: string): string {
  return name.replace(JUNK_RE, '').replace(/\s{2,}/g, ' ').trim().slice(0, 80)
}

// ── 3-stage photo finder (all within official brand site) ─────────────────
type FindResult = { imageUrl: string; query: string; stage: 'S1-direct' | 'S2-refined' | 'S3-ai' }

async function findOfficialPhoto(
  name:      string,
  brand:     string | null,
  brandSite: string,
): Promise<FindResult | null> {
  const clean   = cleanProductName(name)
  const refined = refinedProductName(name)

  // Stage 1: site:brand.com + clean name (fastest, 1 credit)
  const q1 = `site:${brandSite} ${clean}`
  const r1  = await serperSearch(q1)
  if (r1.length) return { imageUrl: r1[0].imageUrl, query: q1, stage: 'S1-direct' }

  // Stage 2: site:brand.com + junk-stripped name (1 credit, only if name differs)
  if (refined.toLowerCase() !== clean.toLowerCase()) {
    await sleep(300)
    const q2 = `site:${brandSite} ${refined}`
    const r2  = await serperSearch(q2)
    if (r2.length) return { imageUrl: r2[0].imageUrl, query: q2, stage: 'S2-refined' }
  }

  // Stage 3: site:brand.com + Claude AI keywords (1 credit + 1 AI call, only if key set)
  if (ANTHROPIC_KEY) {
    await sleep(300)
    try {
      const keywords = await claudeKeywords(name, brand)
      const q3 = `site:${brandSite} ${keywords}`
      const r3  = await serperSearch(q3)
      if (r3.length) return { imageUrl: r3[0].imageUrl, query: q3, stage: 'S3-ai' }
    } catch { /* AI step failed, continue */ }
  }

  return null
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function getPrisma() {
  const { prisma } = await import('../lib/prisma')
  return prisma
}

// ── Status report ─────────────────────────────────────────────────────────
async function showStatus(prisma: Awaited<ReturnType<typeof getPrisma>>) {
  const { getBrandSite } = await getBrandSiteModule()

  const [total, withDrive, withUrl, noPhoto] = await Promise.all([
    prisma.product.count({ where: { isActive: true, isVisibleToCustomers: true } }),
    prisma.product.count({ where: { isActive: true, isVisibleToCustomers: true, googleDrivePhotoId: { not: null } } }),
    prisma.product.count({ where: { isActive: true, isVisibleToCustomers: true, photoUrl: { not: null } } }),
    prisma.product.count({ where: { isActive: true, isVisibleToCustomers: true, googleDrivePhotoId: null, photoUrl: null } }),
  ])

  const withPhoto  = withDrive + withUrl
  const priority   = loadKuchingPriorityCodes()

  console.log('\n' + '='.repeat(62))
  console.log('PHOTO COVERAGE STATUS')
  console.log('='.repeat(62))
  console.log(`  Visible products          : ${total.toLocaleString()}`)
  console.log(`  With photo (Drive)        : ${withDrive.toLocaleString()}  (${Math.round(withDrive / total * 100)}%)`)
  console.log(`  With photo (Supabase CDN) : ${withUrl.toLocaleString()}  (${Math.round(withUrl / total * 100)}%)`)
  console.log(`  Total with photo          : ${withPhoto.toLocaleString()}  (${Math.round(withPhoto / total * 100)}%)`)
  console.log(`  Still need photo          : ${noPhoto.toLocaleString()}  (${Math.round(noPhoto / total * 100)}%)`)
  console.log()
  console.log(`  Kuching-priority targets  : ${priority.size} KL products`)
  console.log(`  Claude Stage 3            : ${ANTHROPIC_KEY ? 'enabled (ANTHROPIC_API_KEY set)' : 'disabled (no ANTHROPIC_API_KEY)'}`)
  console.log('='.repeat(62))

  // Brand mapping breakdown
  const brandGroups = await prisma.product.groupBy({
    by:      ['brand'],
    where:   { isActive: true, isVisibleToCustomers: true, googleDrivePhotoId: null, photoUrl: null },
    _count:  { id: true },
    orderBy: { _count: { id: 'desc' } },
    take:    40,
  })

  let mappedItems = 0, unmappedItems = 0

  console.log('\nBRAND MAPPING (top 40 brands needing photos):')
  console.log(`  ${'Brand'.padEnd(26)} ${'Items'.padEnd(7)} Official site`)
  console.log('  ' + '-'.repeat(68))
  for (const b of brandGroups) {
    const site  = getBrandSite(b.brand)
    const count = b._count.id
    const label = (b.brand ?? '(no brand)').slice(0, 25).padEnd(26)
    const flag  = site ? `✓  ${site}` : '✗  — add to lib/brandSites.ts'
    console.log(`  ${label} ${String(count).padEnd(7)} ${flag}`)
    if (site) mappedItems += count; else unmappedItems += count
  }

  const pct = (mappedItems + unmappedItems) > 0
    ? Math.round(mappedItems / (mappedItems + unmappedItems) * 100)
    : 0
  console.log()
  console.log(`  Mapped brands   : ${mappedItems.toLocaleString()} items (${pct}% of those shown)`)
  console.log(`  Unmapped brands : ${unmappedItems.toLocaleString()} items — skipped without --include-unmapped`)
  console.log()
  console.log('Tips:')
  console.log('  npx tsx scripts/_scrapePhotos.ts --limit 200 --brand APLUS')
  console.log('  npx tsx scripts/_scrapePhotos.ts --limit 600')
  console.log('='.repeat(62))
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  const prisma           = await getPrisma()
  const { getBrandSite } = await getBrandSiteModule()

  if (SHOW_STATUS) {
    await showStatus(prisma)
    await prisma.$disconnect()
    return
  }

  if (!SERPER_KEY)   { console.error('Missing SERPER_API_KEY in .env.local'); process.exit(1) }
  if (!SUPABASE_KEY) { console.error('Missing SUPABASE_SERVICE_ROLE_KEY in .env.local'); process.exit(1) }

  console.log(`\n_scrapePhotos.ts`)
  console.log(`  Mode             : ${DRY_RUN ? 'DRY RUN (no uploads)' : 'LIVE'}`)
  console.log(`  Limit            : ${LIMIT}`)
  console.log(`  Brand filter     : ${BRAND_FILTER ?? 'all mapped brands'}`)
  console.log(`  Include unmapped : ${INCLUDE_UNMAPPED ? 'YES (general search fallback)' : 'NO (official sites only)'}`)
  console.log(`  Stage 3 (AI)     : ${ANTHROPIC_KEY ? 'enabled' : 'disabled (set ANTHROPIC_API_KEY to enable)'}`)
  console.log(`  Supabase         : ${SUPABASE_URL}`)

  if (!DRY_RUN) await ensureBucket()

  const priorityCodes = loadKuchingPriorityCodes()
  console.log(`  Priority codes   : ${priorityCodes.size} Kuching-matched\n`)

  // Fetch candidates (10× LIMIT buffer for priority sort)
  const allNoPhoto = await prisma.product.findMany({
    where: {
      isActive:             true,
      isVisibleToCustomers: true,
      googleDrivePhotoId:   null,
      photoUrl:             null,
      ...(BRAND_FILTER
        ? { brand: { equals: BRAND_FILTER, mode: 'insensitive' as const } }
        : undefined),
    },
    select:  { id: true, name: true, brand: true, qneItemCode: true, qneInvoiceFreq: true },
    orderBy: { qneInvoiceFreq: 'desc' },
    take:    LIMIT * 10,
  })

  // Filter to mapped brands only (unless --include-unmapped)
  const eligible = INCLUDE_UNMAPPED
    ? allNoPhoto
    : allNoPhoto.filter(p => getBrandSite(p.brand) !== null)

  if (eligible.length === 0) {
    console.log('No eligible products found.')
    if (!INCLUDE_UNMAPPED)
      console.log('Tip: run --status to see unmapped brands, or use --include-unmapped.')
    await prisma.$disconnect()
    return
  }

  // Kuching-priority first, then by invoice frequency
  const priority = eligible.filter(p => priorityCodes.has((p.qneItemCode ?? '').toUpperCase()))
  const general  = eligible.filter(p => !priorityCodes.has((p.qneItemCode ?? '').toUpperCase()))
  const products = [...priority, ...general].slice(0, LIMIT)

  const skippedUnmapped = allNoPhoto.length - eligible.length
  console.log(`  Queue    : ${products.length} products (${priority.length} priority + ${products.length - priority.length} general)`)
  if (skippedUnmapped > 0)
    console.log(`  Skipping : ${skippedUnmapped} unmapped-brand products\n`)
  else
    console.log()

  type LogRow = {
    id: string; qneItemCode: string; name: string; brand: string
    priority: string; brandSite: string; stage: string
    searchQuery: string; imageUrl: string; sizeKb: string; photoUrl: string; status: string
  }

  const log: LogRow[] = []
  let ok = 0, okPriority = 0, failed = 0, noResult = 0
  const stageCounts = { 'S1-direct': 0, 'S2-refined': 0, 'S3-ai': 0 }

  for (let i = 0; i < products.length; i++) {
    const p      = products[i]
    const isPrio = priorityCodes.has((p.qneItemCode ?? '').toUpperCase())
    const site   = getBrandSite(p.brand)

    const row: LogRow = {
      id: p.id, qneItemCode: p.qneItemCode ?? '', name: p.name,
      brand: p.brand ?? '', priority: isPrio ? 'YES' : 'no',
      brandSite: site ?? '(none)', stage: '',
      searchQuery: '', imageUrl: '', sizeKb: '', photoUrl: '', status: '',
    }

    const tag   = isPrio ? '[P]' : '   '
    const label = `${p.name.slice(0, 38).padEnd(38)} [${(site ?? 'no-site').slice(0, 20)}]`
    process.stdout.write(`${tag} [${String(i + 1).padStart(3)}/${products.length}] ${label.padEnd(62)} `)

    try {
      let found: FindResult | null = null

      if (site) {
        found = await findOfficialPhoto(p.name, p.brand, site)
      } else if (INCLUDE_UNMAPPED) {
        // Fallback for unmapped brands: general search (may return competitor logos)
        const q = `${cleanProductName(p.name)} product photo white background`
        const r = await serperSearch(q)
        if (r.length) found = { imageUrl: r[0].imageUrl, query: q, stage: 'S1-direct' }
      }

      if (!found) {
        process.stdout.write('NO RESULTS\n')
        row.status = site ? 'NO_RESULTS_ON_SITE' : 'NO_BRAND_SITE'; noResult++
        log.push(row); await sleep(DELAY_MS); continue
      }

      row.searchQuery = found.query
      row.stage       = found.stage
      row.imageUrl    = found.imageUrl
      if (found.stage in stageCounts) stageCounts[found.stage as keyof typeof stageCounts]++

      // Download
      let downloaded: { buf: Buffer; contentType: string } | null = null
      for (const img of [found, ...(await (async () => { try { return await serperSearch(found.query) } catch { return [] } })())]) {
        try { downloaded = await downloadImage(img.imageUrl); break }
        catch { /* try next */ }
      }

      if (!downloaded) {
        process.stdout.write('DOWNLOAD FAILED\n')
        row.status = 'DOWNLOAD_FAILED'; failed++
        log.push(row); await sleep(DELAY_MS); continue
      }

      row.sizeKb = String(Math.round(downloaded.buf.length / 1024))

      if (DRY_RUN) {
        process.stdout.write(`OK dry-run ${found.stage} ${row.sizeKb}KB\n`)
        row.status = 'DRY_RUN_OK'; row.photoUrl = found.imageUrl; ok++; if (isPrio) okPriority++
        log.push(row); await sleep(DELAY_MS); continue
      }

      const publicUrl = await uploadToSupabase(p.id, downloaded.buf, downloaded.contentType)
      row.photoUrl    = publicUrl
      await prisma.product.update({ where: { id: p.id }, data: { photoUrl: publicUrl } })

      process.stdout.write(`OK ${found.stage} ${row.sizeKb}KB\n`)
      row.status = 'SUCCESS'; ok++; if (isPrio) okPriority++

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      process.stdout.write(`ERROR ${msg.slice(0, 50)}\n`)
      row.status = `ERROR: ${msg.slice(0, 80)}`; failed++
    }

    log.push(row)
    await sleep(DELAY_MS)
  }

  // Write log
  const logPath = 'scripts/_scrape_log.csv'
  const header  = Object.keys(log[0] ?? {}).join(',')
  const body    = log.map(r =>
    Object.values(r).map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
  ).join('\n')
  writeFileSync(logPath, header + '\n' + body, 'utf-8')

  console.log('\n' + '='.repeat(62))
  console.log(`SUCCESS        : ${ok}  (${okPriority} priority, ${ok - okPriority} general)`)
  console.log(`  Stage 1 (direct)   : ${stageCounts['S1-direct']}`)
  console.log(`  Stage 2 (refined)  : ${stageCounts['S2-refined']}`)
  console.log(`  Stage 3 (AI)       : ${stageCounts['S3-ai']}`)
  console.log(`NO RESULTS     : ${noResult}`)
  console.log(`FAILED         : ${failed}`)
  if (skippedUnmapped > 0)
    console.log(`SKIPPED (no site mapping) : ${skippedUnmapped}`)
  console.log(`Log            : ${logPath}`)
  console.log()
  console.log('Next run : npx tsx scripts/_scrapePhotos.ts --limit 600')
  console.log('Status   : npx tsx scripts/_scrapePhotos.ts --status')

  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
