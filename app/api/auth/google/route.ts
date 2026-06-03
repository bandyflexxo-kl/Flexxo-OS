import { verifySession } from '@/lib/session'
import { getGoogleAuthUrl } from '@/lib/googleDrive'

export async function GET(request: Request) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.redirect(new URL('/login', request.url))
  if (session.role !== 'Admin') return Response.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const returnUrl = searchParams.get('returnUrl') ?? '/admin/suppliers'

  // Encode returnUrl in state for the callback to use
  const state = Buffer.from(JSON.stringify({ returnUrl })).toString('base64url')
  const authUrl = getGoogleAuthUrl(state)

  return Response.redirect(authUrl)
}
