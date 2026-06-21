/**
 * GET  /api/admin/brand-preferences  — list all brand preference rules
 * POST /api/admin/brand-preferences  — create new rule
 * POST /api/admin/brand-preferences  body: { loadDefaults: true } — seed Flexxo defaults
 */
import { z } from 'zod'
import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { invalidateCatalogueCache } from '@/lib/smartOrder'

const ALLOWED_ROLES = new Set(['Admin', 'Manager', 'Director'])

const CreateSchema = z.object({
  label:           z.string().min(1).max(120),
  keywords:        z.string().min(1).max(500),
  brands:          z.string().min(1).max(500),
  boostMultiplier: z.number().min(1.0).max(5.0).default(1.6),
  isActive:        z.boolean().default(true),
})

const FLEXXO_DEFAULTS = [
  { label: 'Eraser → Faber Castell',     keywords: 'eraser',        brands: 'Faber Castell,Faber-Castell',  boostMultiplier: 1.6 },
  { label: '2B Pencil → Niki',           keywords: 'pencil,2b',     brands: 'Niki',                         boostMultiplier: 1.6 },
  { label: 'Sticky Note → 3M',           keywords: 'sticky,note',   brands: '3M,Post-it',                   boostMultiplier: 1.6 },
  { label: 'Arch File → Elefen',         keywords: 'arch,file',     brands: 'Elefen',                       boostMultiplier: 1.6 },
  { label: 'Glue Stick → UHU / Chunbe',  keywords: 'glue,stick',    brands: 'UHU,Chunbe',                   boostMultiplier: 1.6 },
  { label: 'Whiteboard → Writebest',     keywords: 'whiteboard',    brands: 'Writebest',                    boostMultiplier: 1.6 },
  { label: 'Correction → BIC / Pentel',  keywords: 'correction',    brands: 'BIC,Pentel',                   boostMultiplier: 1.4 },
  { label: 'Ball Pen → Pilot / Uni',     keywords: 'ball,pen',      brands: 'Pilot,Uni,Uniball',            boostMultiplier: 1.4 },
]

async function requirePrivileged() {
  const session = await verifySession().catch(() => null)
  if (!session) return null
  if (!ALLOWED_ROLES.has(session.role)) return null
  return session
}

export async function GET() {
  const session = await requirePrivileged()
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const prefs = await prisma.productBrandPreference.findMany({
    orderBy: { createdAt: 'asc' },
  })
  return Response.json({ prefs })
}

export async function POST(request: Request) {
  const session = await requirePrivileged()
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body: unknown = await request.json().catch(() => null)

  // Seed defaults shortcut
  if (body && typeof body === 'object' && 'loadDefaults' in body) {
    const existing = await prisma.productBrandPreference.count()
    if (existing > 0) {
      return Response.json({ error: 'Brand preferences already exist. Delete all first to reload defaults.' }, { status: 409 })
    }
    const created = await prisma.productBrandPreference.createMany({
      data: FLEXXO_DEFAULTS.map(d => ({ ...d, isActive: true })),
    })
    invalidateCatalogueCache()
    return Response.json({ created: created.count })
  }

  const parsed = CreateSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 })
  }

  const pref = await prisma.productBrandPreference.create({ data: parsed.data })
  invalidateCatalogueCache()
  return Response.json({ pref }, { status: 201 })
}
