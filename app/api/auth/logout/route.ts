import { deleteSession, deleteShopSession } from '@/lib/session'
import { headers } from 'next/headers'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  // Detect which context triggered logout (shop or CRM) via Referer header
  const hdrs = await headers()
  const referer = hdrs.get('referer') ?? ''
  const isShopLogout = referer.includes('/shop')

  // Delete both cookies — belt-and-suspenders so neither session lingers.
  await deleteSession()       // CRM cookie (crm_session)
  await deleteShopSession()   // Shop cookie (shop_session)

  const dest = isShopLogout ? '/shop/login' : '/login'
  const url  = new URL(dest, request.url)
  // 303 See Other → the browser follows with GET. Without it, redirect() defaults
  // to 307 which PRESERVES the POST method, re-POSTing to the login page → 405.
  return NextResponse.redirect(url, 303)
}

// Handle direct browser navigation to /api/auth/logout (GET)
export async function GET(request: Request) {
  await deleteSession()
  await deleteShopSession()
  return NextResponse.redirect(new URL('/login', request.url), 303)
}
