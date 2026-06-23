import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

const companyId = 'c38befd8-0b23-476f-8e83-05bcbe18793f'

async function main() {
  // Dynamic import AFTER dotenv so DATABASE_URL is set when PrismaClient initialises
  const { prisma } = await import('@/lib/prisma')

  await prisma.companyAddress.updateMany({
    where: { companyId },
    data:  { isActive: false },
  })

  const addr = await prisma.companyAddress.create({
    data: {
      companyId,
      label:     'Test Office',
      line1:     '10 Jalan Test, Taman Test',
      city:      'Kuala Lumpur',
      state:     'WP Kuala Lumpur',
      postcode:  '50000',
      country:   'Malaysia',
      lat:       '3.1390',
      lng:       '101.6869',
      addressType: 'Delivery',
      isDefault:   true,
      isActive:    true,
    },
  })

  console.log('Created address:', addr.id, '| lat:', addr.lat, '| lng:', addr.lng)
  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
