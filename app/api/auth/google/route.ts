import { getOptionalSession } from '@/lib/session'
import { getGoogleAuthUrl } from '@/lib/googleDrive'

export async function GET(request: Request) {
  const session = await getOptionalSession()
  if (!session) return Response.redirect(new URL('/login', request.url))
  if (session.role !== 'Admin') return Response.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const returnUrl = searchParams.get('returnUrl') ?? '/admin/settings'

  // Encode BOTH returnUrl AND userId in state — the callback cannot reliably read
  // the session cookie (Google redirect is an external navigation), so we pass the
  // userId through state instead of relying on the cookie in the callback.
  const state = Buffer.from(JSON.stringify({ returnUrl, userId: session.userId })).toString('base64url')
  const authUrl = getGoogleAuthUrl(state)

  return Response.redirect(authUrl)
}
