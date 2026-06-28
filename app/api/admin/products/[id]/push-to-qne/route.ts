/**
 * Gated QNE write — pushes a CRM-created stock code to QNE (POST /api/Stocks).
 * This is the ONE step that writes to the accounting system: the admin clicking
 * "Push to QNE" is the human approval (CLAUDE.md). Used for first push AND retry.
 *
 * Flow: load product → mark `pending` → createQneStockCode → on success `synced`
 * (+ adopt QNE's returned stock code); on failure `failed` (+ reason). The product
 * row is never deleted, so a rejected push can always be retried.
 */

import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { createQneStockCode, type NewStockInput } from '@/lib/qneProductCreate'
import { QneUnavailableError } from '@/lib/qneClient'

const BRANCH_CODE = 'KL'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Admin', 'Director'].includes(session.role))
    return Response.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params

  const product = await prisma.product.findUnique({
    where:  { id },
    select: { id: true, qnePushStatus: true, qnePushPayload: true, qneItemCode: true },
  })
  if (!product) return Response.json({ error: 'Product not found' }, { status: 404 })
  if (product.qnePushStatus === 'synced')
    return Response.json({ error: 'This product is already in QNE.' }, { status: 409 })
  if (!product.qnePushPayload)
    return Response.json({ error: 'No QNE payload stored for this product — recreate it via the form.' }, { status: 422 })

  const payload = product.qnePushPayload as unknown as NewStockInput

  await prisma.$executeRaw`SELECT set_config('app.current_user_id', ${session.userId}, false)`
  await prisma.product.update({ where: { id }, data: { qnePushStatus: 'pending', qnePushError: null } })

  try {
    const created = await createQneStockCode(BRANCH_CODE, payload)
    await prisma.product.update({
      where: { id },
      data:  {
        qnePushStatus: 'synced',
        qnePushedAt:   new Date(),
        qnePushError:  null,
        qneItemCode:   created.stockCode || product.qneItemCode,
      },
    })
    return Response.json({ ok: true, qneStockCode: created.stockCode, qneStockId: created.id })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'QNE push failed'
    const unreachable = err instanceof QneUnavailableError
    await prisma.product.update({
      where: { id },
      // VPN down → keep as pending (transient); a real QNE rejection → failed.
      data:  { qnePushStatus: unreachable ? 'pending' : 'failed', qnePushError: message },
    })
    return Response.json(
      { error: unreachable ? 'QNE unreachable — connect the Radmin VPN and retry.' : message },
      { status: unreachable ? 503 : 502 },
    )
  }
}
