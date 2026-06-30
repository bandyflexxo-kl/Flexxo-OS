import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { getRedis } from '@/lib/redis'
import { uploadProductPhoto } from '@/lib/supabaseStorage'
import { scanPhotoUrl } from '@/lib/photoQuality'

// Vercel: Claude/Serper calls exceed the ~10s default → empty response → client JSON error.
export const maxDuration = 60

const ALLOWED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp'])

async function invalidateCache() {
  const redis = getRedis()
  if (redis) {
    await Promise.allSettled([
      redis.del('flexxo:products:v1:retail'),
      redis.del('flexxo:products:v1:b2b'),
    ])
  }
}

// ── POST: upload file (Method A) ────────────────────────────────────────────
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await verifySession().catch(() => null)
    if (!session || !['Admin', 'Director'].includes(session.role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params

    const form = await request.formData()
    const file = form.get('file') as File | null
    if (!file) return Response.json({ error: 'No file provided' }, { status: 400 })

    const mimeType = file.type.split(';')[0].trim()
    if (!ALLOWED_MIME.has(mimeType)) {
      return Response.json({ error: 'Only JPEG, PNG, or WebP allowed' }, { status: 400 })
    }

    const buffer   = Buffer.from(await file.arrayBuffer())
    const photoUrl = await uploadProductPhoto(id, buffer, mimeType)

    await prisma.product.update({
      where: { id },
      data:  { photoUrl, photoQualityFlagged: null, photoQualityNote: null },
    })

    // Best-effort scan — must not undo a successful upload.
    let flagged = false, reason = ''
    try { const s = await scanPhotoUrl(id, photoUrl); flagged = s.flagged; reason = s.reason } catch { /* leave unflagged */ }

    await invalidateCache()
    return Response.json({ photoUrl, flagged, reason })
  } catch (e) {
    console.error('[photo POST] error:', e)
    return Response.json({ error: e instanceof Error ? e.message : 'Upload failed.' }, { status: 500 })
  }
}

// ── PATCH: apply remote URL (Method B / C candidate) ───────────────────────
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // Whole handler wrapped: any failure (remote download, Supabase upload,
  // quality scan) returns a JSON error body — never an empty 500 that makes the
  // client's res.json() throw "Unexpected end of JSON input" (the reported error
  // when selecting a search/re-scrape candidate).
  try {
    const session = await verifySession().catch(() => null)
    if (!session || !['Admin', 'Director'].includes(session.role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id }  = await params
    const body    = await request.json().catch(() => ({})) as { url?: string }
    const url     = body.url?.trim()

    if (!url || !/^https?:\/\//.test(url)) {
      return Response.json({ error: 'Invalid URL' }, { status: 400 })
    }

    // Download the chosen candidate. Competitor/manufacturer sites frequently
    // block hotlinking or time out — that throw must become a clean message,
    // not an unhandled crash.
    let imgRes: Response
    try {
      imgRes = await fetch(url, {
        signal:  AbortSignal.timeout(15_000),
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'image/*' },
      })
    } catch {
      return Response.json({ error: 'Could not download that image — the source site may block hotlinking or be unreachable. Try another result, or upload the file manually.' }, { status: 502 })
    }
    if (!imgRes.ok) return Response.json({ error: `Could not download that image (HTTP ${imgRes.status}). Try another result.` }, { status: 502 })

    const rawMime  = imgRes.headers.get('content-type') ?? 'image/jpeg'
    const mimeType = rawMime.split(';')[0].trim()
    if (!ALLOWED_MIME.has(mimeType)) {
      return Response.json({ error: `That link isn't a supported image (got "${mimeType || 'unknown'}"). It must be a direct JPEG, PNG, or WebP. Try another result.` }, { status: 400 })
    }

    const buffer   = Buffer.from(await imgRes.arrayBuffer())
    const photoUrl = await uploadProductPhoto(id, buffer, mimeType)

    await prisma.product.update({
      where: { id },
      data:  { photoUrl, photoQualityFlagged: null, photoQualityNote: null },
    })

    // Quality scan is best-effort — a Claude/scan failure must NOT undo a save
    // that already succeeded above (else the photo applies but the user sees an error).
    let flagged = false, reason = ''
    try { const s = await scanPhotoUrl(id, photoUrl); flagged = s.flagged; reason = s.reason } catch { /* leave unflagged */ }

    await invalidateCache()
    return Response.json({ photoUrl, flagged, reason })
  } catch (e) {
    console.error('[photo PATCH] error:', e)
    return Response.json({ error: e instanceof Error ? e.message : 'Could not apply the selected photo.' }, { status: 500 })
  }
}

// ── DELETE: remove photo ────────────────────────────────────────────────────
export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await verifySession().catch(() => null)
  if (!session || !['Admin', 'Director'].includes(session.role)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id }    = await params
  const product   = await prisma.product.findUnique({ where: { id }, select: { photoUrl: true } })
  if (!product?.photoUrl) return Response.json({ error: 'No photo to delete' }, { status: 400 })

  const urlObj   = new URL(product.photoUrl)
  const parts    = urlObj.pathname.split('/storage/v1/object/public/product-photos/')
  const filename = parts[1]

  if (filename) {
    const delRes = await fetch(
      `${urlObj.protocol}//${urlObj.host}/storage/v1/object/product-photos/${filename}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` } }
    )
    if (!delRes.ok) console.warn(`Supabase delete ${filename}: ${delRes.status}`)
  }

  await prisma.product.update({
    where: { id },
    data:  { photoUrl: null, photoQualityFlagged: null, photoQualityNote: null },
  })

  await invalidateCache()
  return Response.json({ deleted: true })
}
