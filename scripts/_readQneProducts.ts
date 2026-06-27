import { config } from 'dotenv';
import { resolve } from 'path';
import { writeFileSync } from 'fs';
config({ path: resolve(process.cwd(), '.env.local') });

async function main() {
  const { prisma } = await import('../lib/prisma');

  const products = await prisma.product.findMany({
    select: { internalSku: true, name: true, qneItemCode: true, googleDrivePhotoId: true, brand: true, barcode: true },
    orderBy: { name: 'asc' },
  });

  writeFileSync('scripts/_qne_products_dump.json', JSON.stringify(products));
  console.log(`Wrote ${products.length} products to scripts/_qne_products_dump.json`);
}

main().catch(console.error);
