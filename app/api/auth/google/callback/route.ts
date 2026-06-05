import { exchangeCodeForRefreshToken } from '@/lib/googleDrive'
import { prisma } from '@/lib/prisma'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code  = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  // Decode state — contains returnUrl AND userId (passed from the initiating route so we
  // don't have to rely on session cookies being available during an external OAuth redirect)
  let returnUrl = '/admin/settings'
  let userId: string | null = null

  if (state) {
    try {
      const decoded = JSON.parse(Buffer.from(state, 'base64url').toString()) as {
        returnUrl?: string
        userId?:    string
      }
      if (decoded.returnUrl) returnUrl = decoded.returnUrl
      if (decoded.userId)    userId    = decoded.userId
    } catch {
      // fallback to defaults
    }
  }

  if (error) {
    return Response.redirect(new URL(`${returnUrl}?google=denied`, request.url))
  }

  if (!code) {
    return Response.redirect(new URL(`${returnUrl}?google=error`, request.url))
  }

  // If userId wasn't in state (e.g. old bookmark), we can't proceed
  if (!userId) {
    return Response.redirect(new URL(`${returnUrl}?google=error&msg=session_lost`, request.url))
  }

  try {
    const refreshToken = await exchangeCodeForRefreshToken(code)

    await prisma.user.update({
      where: { id: userId },
      data:  { googleRefreshToken: refreshToken },
    })

    return Response.redirect(new URL(`${returnUrl}?google=connected`, request.url))
  } catch (err) {
    const msg = err instanceof Error ? encodeURIComponent(err.message) : 'error'
    return Response.redirect(new URL(`${returnUrl}?google=error&msg=${msg}`, request.url))
  }
}
