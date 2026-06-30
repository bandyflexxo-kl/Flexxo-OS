const SUPABASE_BASE = 'https://ibkyigjvbvilekdlduho.supabase.co'
const BUCKET        = 'product-photos'

export async function uploadProductPhoto(
  productId: string,
  buffer:    Buffer,
  mimeType:  string,
): Promise<string> {
  // Strip any non-ASCII (BOM / zero-width / whitespace) that can slip into an env
  // var when pasted into the Vercel dashboard. Header values must be ByteString
  // (chars ≤ 255); a stray U+FEFF makes `Authorization: Bearer <key>` throw
  // "Cannot convert argument to a ByteString …". Keys are pure ASCII, so this is safe.
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').replace(/[^\x20-\x7E]/g, '')
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY not set')

  const ext      = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg'
  const filename = `${productId}.${ext}`

  const res = await fetch(`${SUPABASE_BASE}/storage/v1/object/${BUCKET}/${filename}`, {
    method:  'PUT',
    headers: {
      Authorization:  `Bearer ${serviceKey}`,
      'Content-Type': mimeType,
      'x-upsert':     'true',
    },
    body: buffer as unknown as BodyInit,
  })

  if (!res.ok) {
    const msg = await res.text()
    throw new Error(`Supabase upload failed ${res.status}: ${msg}`)
  }

  return `${SUPABASE_BASE}/storage/v1/object/public/${BUCKET}/${filename}`
}
