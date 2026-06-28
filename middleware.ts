import { NextRequest, NextResponse } from 'next/server'
import { decrypt, encrypt, sessionDurationMs, CRM_COOKIE, SHOP_COOKIE } from '@/lib/session'
import { canAccessPath, homeFor } from '@/lib/access'

/**
 * Subdomain routing + auth guard
 *
 * Local dev (two subdomains):
 *   CRM   →  http://localhost:3000
 *   Shop  →  http://shop.localhost:3000
 *
 * Production (two subdomains):
 *   CRM   →  https://cms.flexxo.com.my
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
 *
 * Cookie isolation:
 *   crm_session  — Admin / Manager / Salesperson / Warehouse (CRM)
 *   shop_session — B2B Client (portal)
 *   Both can coexist in the same browser without conflicts.
 */

const SHOP_HOST = process.env.SHOP_HOST ?? 'shop.localhost'
const CRM_HOST  = process.env.CRM_HOST  ?? 'localhost'

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

  // Single-domain mode: either explicitly configured (SHOP_HOST === CRM_HOST)
  // OR detected at runtime — the request hostname is not one of the configured
  // subdomains.  This handles: Vercel platform URLs (flexxo-os.vercel.app),
  // custom production domains not yet added to env vars, and localhost dev
  // without the shop.localhost hosts-file entry.
  // In single-domain mode all routing is path-based (/shop/* = shop portal).
  const SINGLE_DOMAIN = SHOP_HOST === CRM_HOST || (!isShopDomain && !isCrmDomain)

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
  //
  // Shop paths read shop_session; CRM paths read crm_session.
  // This allows admin + B2B client to be logged in simultaneously
  // in the same browser without either session overwriting the other.

  const isShopPath = (isShopDomain && !SINGLE_DOMAIN) || (SINGLE_DOMAIN && pathname.startsWith('/shop'))
  const cookieName = isShopPath ? SHOP_COOKIE : CRM_COOKIE

  const cookie  = req.cookies.get(cookieName)?.value
  const session = await decrypt(cookie)

  // On single domain, use /shop/login for shop paths, /login for CRM paths
  const loginUrl     = isShopPath ? '/shop/login' : '/login'
  const isLoginPage  = pathname.startsWith(loginUrl) || pathname === '/change-password'
  const isPublicShop = isShopPublicPath(pathname)

  // Not logged in → redirect to correct login (but allow public shop paths)
  if (!session?.userId && !isLoginPage && !isPublicShop) {
    return NextResponse.redirect(new URL(loginUrl, req.url))
  }

  // B2B Clients must NEVER hold a crm_session / access CMS pages. A B2B-role
  // crm_session on the CMS domain is invalid (e.g. a B2B account was entered on
  // the CMS login) — clear it so it self-heals, rather than bouncing to the shop
  // (which trapped the user: every CMS path, incl. /login, redirected away).
  if (session?.role === 'B2B Client' && !pathname.startsWith('/shop')) {
    if (!SINGLE_DOMAIN && isCrmDomain) {
      // Already on the login page → clear the bad cookie and render it (one hop,
      // no extra redirect). Anywhere else → clear and send to the CMS login.
      const resp = isLoginPage
        ? NextResponse.next()
        : NextResponse.redirect(new URL('/login', req.url))
      resp.cookies.delete(CRM_COOKIE)
      return resp
    }
    // Single-domain (local dev / *.vercel.app): shop + CMS share a host.
    return NextResponse.redirect(new URL('/shop/products', req.url))
  }

  // Already logged in + on login page → redirect to home
  if (session?.userId && pathname.startsWith(loginUrl)) {
    // B2B clients go to their dashboard; CRM staff go to their role's home
    const homePath = isShopPath
      ? (session.role === 'B2B Client' ? '/shop/dashboard' : '/shop/products')
      : homeFor(session.role)
    return NextResponse.redirect(new URL(homePath, req.url))
  }

  // ── Role-based access control for CRM pages ─────────────────────────────
  // Enforced here (server edge) so denied pages never render — this is the
  // hard guard; the sidebar merely hides links. /change-password is always
  // allowed for any logged-in role.
  if (
    session?.userId &&
    session.role !== 'B2B Client' &&
    !isShopPath &&
    pathname !== '/change-password' &&
    !canAccessPath(session.role, pathname)
  ) {
    return NextResponse.redirect(new URL(homeFor(session.role), req.url))
  }

  // ── Sliding window session renewal ─────────────────────────────────────
  // If a session has less than 33% of its original lifetime remaining and
  // the user is actively browsing, silently renew the cookie so they are
  // never interrupted mid-work.
  if (session?.userId && session.role) {
    const now         = Date.now()
    const expiresAt   = new Date(session.expiresAt).getTime()
    const totalMs     = sessionDurationMs(session.role)
    const remaining   = expiresAt - now

    if (remaining > 0 && remaining < totalMs * 0.33) {
      const newExpiresAt = new Date(now + totalMs)
      try {
        const newToken = await encrypt({ ...session, expiresAt: newExpiresAt })
        const response = NextResponse.next()
        response.cookies.set(cookieName, newToken, {
          httpOnly: true,
          secure:   process.env.NODE_ENV === 'production',
          expires:  newExpiresAt,
          sameSite: 'lax',
          path:     '/',
        })
        return response
      } catch {
        // Renewal failure is non-fatal — proceed with existing session
      }
    }
  }

  return NextResponse.next()
}

export const config = {
  // Exclude: API routes, Next.js internals, favicon, and ALL static asset file extensions
  matcher: ['/((?!api|_next/static|_next/image|favicon\\.ico|.*\\.png|.*\\.jpg|.*\\.jpeg|.*\\.svg|.*\\.ico|.*\\.webp|.*\\.gif|.*\\.js|.*\\.css|.*\\.woff|.*\\.woff2|.*\\.ttf|.*\\.map).*)'],
}
