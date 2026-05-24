import { NextRequest, NextResponse } from 'next/server'
import { decrypt } from '@/lib/session'

const publicRoutes = ['/login']

export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl
  const isPublicRoute = publicRoutes.some((r) => pathname.startsWith(r))

  const cookie = req.cookies.get('session')?.value
  const session = await decrypt(cookie)

  if (!isPublicRoute && !session?.userId) {
    return NextResponse.redirect(new URL('/login', req.nextUrl))
  }

  if (isPublicRoute && session?.userId) {
    return NextResponse.redirect(new URL('/', req.nextUrl))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
