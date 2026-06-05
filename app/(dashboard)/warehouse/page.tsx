import { verifySession } from '@/lib/session'
import { prisma }        from '@/lib/prisma'
import Topbar            from '@/components/layout/Topbar'
import { redirect }      from 'next/navigation'
import WarehouseTaskList from '@/components/warehouse/WarehouseTaskList'

export default async function WarehousePage() {
  const session = await verifySession()

  const allowed = ['Admin', 'Manager', 'Warehouse'].includes(session.role)
  if (!allowed) redirect('/')

  const tasks = await prisma.warehouseTask.findMany({
    where:   { status: { not: 'done' } },
    orderBy: { createdAt: 'asc' },
    include: {
      order: {
        include: {
          company: { select: { id: true, name: true } },
          items: {
            include: { product: { select: { name: true, unit: true } } },
          },
        },
      },
    },
  })

  const serialised = tasks.map(t => ({
    taskId:    t.id,
    taskStatus: t.status,
    orderId:   t.orderId,
    orderRef:  t.order.referenceNo,
    company:   t.order.company.name,
    createdAt: t.createdAt.toISOString(),
    items:     t.order.items.map(i => ({
      id:          i.id,
      productName: i.product?.name ?? 'Unknown product',
      unit:        i.product?.unit ?? '',
      qty:         i.qty.toString(),
    })),
  }))

  return (
    <div>
      <Topbar title="Warehouse — Picking Tasks" />
      <div className="p-4 sm:p-8 max-w-2xl space-y-4">
        {serialised.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center">
            <div className="text-5xl mb-3">✅</div>
            <p className="text-gray-500 font-medium">All caught up — no pending tasks</p>
            <p className="text-gray-400 text-sm mt-1">New tasks appear here when Admin approves an order</p>
          </div>
        ) : (
          <WarehouseTaskList tasks={serialised} />
        )}
      </div>
    </div>
  )
}
