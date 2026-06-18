import { prisma } from '@/lib/prisma'
async function main() {
  const p = await prisma.product.findFirst({
    where: { googleDrivePhotoId: { not: null } },
    select: { id: true, name: true, googleDrivePhotoId: true }
  })
  console.log('Product ID:', p?.id)
  console.log('Name:', p?.name)
  console.log('Drive file ID:', p?.googleDrivePhotoId)
  console.log('\nTest URL: https://flexxo-os.vercel.app/api/portal/photo/' + p?.id)
}
main().catch(console.error).finally(() => prisma.$disconnect())
