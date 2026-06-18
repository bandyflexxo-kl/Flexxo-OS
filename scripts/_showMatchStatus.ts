import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

async function main() {
  const { prisma } = await import('@/lib/prisma')

  const company = await prisma.company.findFirst({ where: { name: 'Production testing' } })
  if (!company) { console.log('Company not found'); return }

  const orders = await prisma.order.findMany({
    where:   { companyId: company.id },
    orderBy: { referenceNo: 'asc' },
    include: {
      items: {
        include: {
          product:       { select: { name: true, qneItemCode: true } },
          quotationItem: { select: { description: true } },
        },
      },
    },
  })

  let totalMatched = 0
  let totalUnmatched = 0

  for (const o of orders) {
    const matched   = o.items.filter(i => i.productId !== null)
    const unmatched = o.items.filter(i => i.productId === null)
    totalMatched   += matched.length
    totalUnmatched += unmatched.length

    console.log(`\n=== ${o.referenceNo}  (${o.items.length} items — ${matched.length} matched, ${unmatched.length} unmatched) ===`)

    if (unmatched.length > 0) {
      console.log('  UNMATCHED:')
      for (const i of unmatched) {
        console.log(`    ✗  "${i.quotationItem?.description ?? '(no desc)'}"`)
      }
    }

    console.log('  MATCHED — invoice name  →  DB product name:')
    for (const i of matched) {
      const inv = (i.quotationItem?.description ?? '').padEnd(55)
      const db  = i.product?.name ?? ''
      const same = inv.trim() === db.trim()
      console.log(`    ✓  ${inv} →  ${db}${same ? '  [identical]' : ''}`)
    }
  }

  console.log(`\n${'─'.repeat(70)}`)
  console.log(`TOTAL  matched: ${totalMatched}   unmatched: ${totalUnmatched}   out of ${totalMatched + totalUnmatched}`)
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error(e.message); process.exit(1) })
