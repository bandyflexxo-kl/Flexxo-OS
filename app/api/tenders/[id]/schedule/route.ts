/**
 * GET /api/tenders/[id]/schedule
 * Downloads the tender item schedule as an .xlsx (the sheet attached to RFQs).
 * Access: any tender role who can see the tender (route-prefix guarded by middleware).
 */
import * as XLSX from 'xlsx'
import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { isPrivilegedRole } from '@/lib/authorization'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const tender = await prisma.tender.findUnique({
    where: { id },
    include: { items: { orderBy: { pos: 'asc' } } },
  })
  if (!tender) return Response.json({ error: 'Not found' }, { status: 404 })

  // Sales Exec may only export their own tenders; privileged/Purchaser/Warehouse any.
  const allowed =
    isPrivilegedRole(session.role) ||
    session.role === 'Purchaser' ||
    session.role === 'Warehouse' ||
    tender.createdById === session.userId
  if (!allowed) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const rows = tender.items.map(it => ({
    'No':           it.pos,
    'Item':         it.name,
    'Unit':         it.unit ?? '',
    'Qty':          Number(it.qty),
    'Target Price': it.targetPrice != null ? Number(it.targetPrice) : '',
    'Unit Price':   '',   // supplier fills this in
    'Amount':       '',
  }))

  const ws = XLSX.utils.json_to_sheet(rows)
  ws['!cols'] = [{ wch: 5 }, { wch: 48 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 14 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Item Schedule')
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer

  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${tender.refNo}-schedule.xlsx"`,
    },
  })
}
