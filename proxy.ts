import { NextRequest, NextResponse } from 'next/server'
import { decrypt } from '@/lib/session'

/**
 * Subdomain routing + auth guard
 *
 * Local dev (two subdomains):
 *   CRM   →  http://localhost:3000
 *   Shop  →  http://shop.localhost:3000
 *
 * Production (two subdomains):
 *   CRM   →  https://crm.flexxo.com.my
 *   Shop  →  https://shop.flexxo.com.my
 *
 * Single-domain mode (Vercel platform subdomain, e.g. flexxo.vercel.app):
 *   Set SHOP_HOST=flexxo.vercel.app  CRM_HOST=flexxo.vercel.app
 *   CRM paths work at /  and shop paths work at /shop/* on same domain.
 *   Subdomain isolation is skipped; path-based separation takes effect.
 *
 * Local dev one-time setup:
 *   Add to C:\Windows\System32\drivers\etc\hosts:
 *   127.0.0.1  shop.localhost
 */

const SHOP_HOST = process.env.SHOP_HOST ?? 'shop.localhost'
const CRM_HOST  = process.env.CRM_HOST  ?? 'localhost'

// When SHOP_HOST === CRM_HOST the app runs on a single domain (e.g. Vercel
// platform subdomain).  Subdomain isolation is skipped; paths handle routing.
const SINGLE_DOMAIN = SHOP_HOST === CRM_HOST

// Shop paths that are PUBLIC — no login required
const SHOP_PUBLIC_PREFIXES = [
  '/shop/products',
  '/shop/login',
]

function isShopPublicPath(pathname: string): boolean {
  return pathname === '/shop' ||
    pathname === '/' ||
    SHOP_PUBLIC_PREFIXES.some(p => pathname.startsWith(p))
}

export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl
  const hostname     = (req.headers.get('host') ?? '').split(':')[0]

  const isShopDomain = hostname === SHOP_HOST
  const isCrmDomain  = hostname === CRM_HOST || hostname === `www.${CRM_HOST}`

  // ── 1. Subdomain routing (only when running on separate subdomains) ────

  if (!SINGLE_DOMAIN) {
    if (isShopDomain) {
      // Root → shop products
      if (pathname === '/') {
        return NextResponse.redirect(new URL('/shop/products', req.url))
      }
      // Block CRM paths on shop domain (except /change-password and /api/*)
      if (
        !pathname.startsWith('/shop') &&
        !pathname.startsWith('/api') &&
        pathname !== '/change-password'
      ) {
        return NextResponse.redirect(new URL('/shop/products', req.url))
      }
    }

    if (isCrmDomain && pathname.startsWith('/shop')) {
      // Redirect shop URLs on CRM domain → shop subdomain (keep path)
      const url    = new URL(req.url)
      url.hostname = SHOP_HOST
      return NextResponse.redirect(url)
    }
  }

  // ── 2. Auth check ─────────────────────────────────────────────────────

  const cookie  = req.cookies.get('session')?.value
  const session = await decrypt(cookie)

  // On single domain, use /shop/login for shop paths, /login for CRM paths
  const isShopPath   = pathname.startsWith('/shop')
  const loginUrl     = (isShopDomain && !SINGLE_DOMAIN) || (SINGLE_DOMAIN && isShopPath)
    ? '/shop/login'
    : '/login'
  const isLoginPage  = pathname.startsWith(loginUrl) || pathname === '/change-password'
  const isPublicShop = isShopPublicPath(pathname)

  // Not logged in → redirect to correct login (but allow public shop paths)
  if (!session?.userId && !isLoginPage && !isPublicShop) {
    return NextResponse.redirect(new URL(loginUrl, req.url))
  }

  // B2B Clients must NEVER access CRM pages
  // Guard: only trigger if they are NOT already on a shop path (prevents loop)
  if (session?.role === 'B2B Client' && !pathname.startsWith('/shop')) {
    if (!SINGLE_DOMAIN && isCrmDomain) {
      // Redirect to shop subdomain
      const url    = new URL(req.url)
      url.hostname = SHOP_HOST
      url.pathname = '/shop/products'
      return NextResponse.redirect(url)
    }
    // Single-domain: redirect within same host
    return NextResponse.redirect(new URL('/shop/products', req.url))
  }

  // Already logged in + on login page → redirect to home
  if (session?.userId && pathname.startsWith(loginUrl)) {
    const homePath = (isShopDomain && !SINGLE_DOMAIN) || (SINGLE_DOMAIN && isShopPath)
      ? '/shop/products'
      : '/'
    return NextResponse.redirect(new URL(homePath, req.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
