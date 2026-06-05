import { getOptionalSession } from '@/lib/session'
import { exchangeCodeForRefreshToken } from '@/lib/googleDrive'
import { prisma } from '@/lib/prisma'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code  = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  // Decode returnUrl from state (do this before any early returns so error redirects go to the right place)
  let returnUrl = '/admin/settings'
  if (state) {
    try {
      const decoded = JSON.parse(Buffer.from(state, 'base64url').toString()) as { returnUrl?: string }
      if (decoded.returnUrl) returnUrl = decoded.returnUrl
    } catch {
      // fallback to default
    }
  }

  // User denied access
  if (error) {
    return Response.redirect(new URL(`${returnUrl}?google=denied`, request.url))
  }

  if (!code) {
    return Response.redirect(new URL(`${returnUrl}?google=error`, request.url))
  }

  // Use getOptionalSession (not verifySession) — verifySession calls redirect() internally
  // which throws a Next.js redirect error that .catch() would swallow, returning null
  const session = await getOptionalSession()
  if (!session) {
    return Response.redirect(new URL('/login', request.url))
  }

  try {
    const refreshToken = await exchangeCodeForRefreshToken(code)

    await prisma.user.update({
      where: { id: session.userId },
      data:  { googleRefreshToken: refreshToken },
    })

    return Response.redirect(new URL(`${returnUrl}?google=connected`, request.url))
  } catch (err) {
    const msg = err instanceof Error ? encodeURIComponent(err.message) : 'error'
    return Response.redirect(new URL(`${returnUrl}?google=error&msg=${msg}`, request.url))
  }
}
