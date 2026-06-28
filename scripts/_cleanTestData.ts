import { config } from 'dotenv'; import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
async function main(){
  const { prisma } = await import('../lib/prisma')
  // 1. delete test tenders (cascade removes items/vendors/quotes/POs/GRNs/amendments)
  const testTenders = await prisma.tender.findMany({
    where: { OR: [ { name: { startsWith: 'TEST' } }, { name: { startsWith: 'dbg' } }, { refNo: { startsWith: 'DBG' } } ] },
    select: { id: true, refNo: true, name: true, gate1ApprovalId: true, gate2ApprovalId: true, gate3ApprovalId: true },
  })
  console.log('test tenders found:', testTenders.length, testTenders.map(t=>`${t.refNo}:${t.name}`))
  for (const t of testTenders) {
    await prisma.tender.delete({ where: { id: t.id } })
    await prisma.approvalRequest.deleteMany({ where: { entityType: 'tender', entityId: t.id } })
  }
  // 2. now delete QA suppliers (no longer referenced)
  const junk = await prisma.supplier.findMany({ where: { name: { startsWith: 'QA Supplier' }, qneSupplierCode: null }, select: { id: true } })
  let delSup = 0
  for (const s of junk) {
    const refs = await prisma.tenderVendor.count({where:{supplierId:s.id}}) + await prisma.supplierPO.count({where:{supplierId:s.id}}) + await prisma.tenderItem.count({where:{awardedSupplierId:s.id}}) + await prisma.tenderVendorQuote.count({where:{supplierId:s.id}})
    if (refs===0){ await prisma.supplierContact.deleteMany({where:{supplierId:s.id}}); await prisma.supplier.delete({where:{id:s.id}}); delSup++ }
  }
  // 3. orphan approvals for deleted tenders (any leftover tender-type with no tender)
  const allTenderIds = new Set((await prisma.tender.findMany({select:{id:true}})).map(t=>t.id))
  const orphanAppr = await prisma.approvalRequest.findMany({ where:{ entityType:'tender' }, select:{id:true,entityId:true} })
  let delAppr=0
  for (const a of orphanAppr) if (!allTenderIds.has(a.entityId)) { await prisma.approvalRequest.delete({where:{id:a.id}}); delAppr++ }

  console.log(`deleted ${testTenders.length} test tenders, ${delSup} QA suppliers, ${delAppr} orphan approvals`)
  console.log(`remaining: tenders=${await prisma.tender.count()}, suppliers=${await prisma.supplier.count()}`)
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)})
