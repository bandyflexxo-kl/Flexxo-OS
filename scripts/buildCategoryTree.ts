/**
 * scripts/buildCategoryTree.ts
 *
 * Restructures the shop into 10 parent categories matching flexxo.com.my/products,
 * each with practical sub-categories. Products are reassigned by keyword matching
 * on product name (no VPN needed — works entirely from local DB).
 *
 * Usage:
 *   npx tsx scripts/buildCategoryTree.ts --dry-run   # preview counts, no DB changes
 *   npx tsx scripts/buildCategoryTree.ts              # apply all changes
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { TREE, classify } from '../lib/productClassifier'

const DRY_RUN = process.argv.includes('--dry-run')

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const { prisma } = await import('@/lib/prisma')

  if (DRY_RUN) console.log('🔍 DRY RUN — no changes will be written\n')
  else        console.log('⚡ APPLYING changes to DB\n')

  // 1. Upsert parent categories ─────────────────────────────────────────────
  console.log('=== Step 1: Upsert parent categories ===')
  const parentIdMap: Record<string, string> = {}

  for (const p of TREE) {
    if (!DRY_RUN) {
      const rec = await prisma.productCategory.upsert({
        where:  { slug: p.slug },
        update: { name: p.name, isActive: true, parentCategoryId: null },
        create: { name: p.name, slug: p.slug, isActive: true },
      })
      parentIdMap[p.slug] = rec.id
    }
  }
  if (!DRY_RUN) console.log(`  Created/updated ${TREE.length} parent categories`)
  else          TREE.forEach(p => console.log(`  ${p.name} (${p.slug})`))

  // 2. Upsert sub-categories ─────────────────────────────────────────────────
  console.log('\n=== Step 2: Upsert sub-categories ===')
  const subIdMap: Record<string, string> = {}

  for (const p of TREE) {
    for (const sub of p.subCats) {
      if (!DRY_RUN) {
        const parentId = parentIdMap[p.slug]!
        const rec = await prisma.productCategory.upsert({
          where:  { slug: sub.slug },
          update: { name: sub.name, isActive: true, parentCategoryId: parentId },
          create: { name: sub.name, slug: sub.slug, isActive: true, parentCategoryId: parentId },
        })
        subIdMap[sub.slug] = rec.id
      }
    }
  }
  const totalSubs = TREE.reduce((n, p) => n + p.subCats.length, 0)
  if (!DRY_RUN) console.log(`  Created/updated ${totalSubs} sub-categories`)
  else          TREE.forEach(p => p.subCats.forEach(s => console.log(`  ${p.name} → ${s.name} (${s.slug})`)))

  // 3. Classify all products ────────────────────────────────────────────────
  console.log('\n=== Step 3: Classify products ===')
  const products = await prisma.product.findMany({
    where:  { isActive: true },
    select: { id: true, name: true, category: { select: { slug: true, name: true } } },
  })

  const tally: Record<string, number> = {}
  const moves: Array<{ id: string; subSlug: string }> = []

  for (const p of products) {
    const { subSlug } = classify(p.name, p.category.slug)
    tally[subSlug] = (tally[subSlug] ?? 0) + 1
    moves.push({ id: p.id, subSlug })
  }

  // Print tree preview
  console.log('\n=== Category tree with product counts ===\n')
  for (const p of TREE) {
    const parentCount = p.subCats.reduce((n, s) => n + (tally[s.slug] ?? 0), 0)
    console.log(`📁 ${p.name}  (${parentCount} products)`)
    for (const sub of p.subCats) {
      const count = tally[sub.slug] ?? 0
      if (count > 0) console.log(`   └─ ${sub.name.padEnd(38)} ${String(count).padStart(5)}`)
    }
  }

  const assigned = Object.values(tally).reduce((a, b) => a + b, 0)
  console.log(`\nTotal classified: ${assigned} / ${products.length}`)

  if (DRY_RUN) {
    console.log('\nRun without --dry-run to apply changes.')
    await prisma.$disconnect()
    return
  }

  // 4. Apply product reassignments ──────────────────────────────────────────
  console.log('\n=== Step 4: Reassigning products ===')
  let updated = 0
  const BATCH = 200
  for (let i = 0; i < moves.length; i += BATCH) {
    const batch = moves.slice(i, i + BATCH)
    await Promise.all(batch.map(m => {
      const newCatId = subIdMap[m.subSlug]
      if (!newCatId) return Promise.resolve()
      return prisma.product.update({ where: { id: m.id }, data: { categoryId: newCatId } })
    }))
    updated += batch.filter(m => subIdMap[m.subSlug]).length
    process.stdout.write(`\r  ${updated} / ${moves.length} products updated...`)
  }
  console.log(`\r  ✅ ${updated} products reassigned                `)

  // 5. Deactivate old flat categories that are now empty ────────────────────
  console.log('\n=== Step 5: Clean up old flat categories ===')
  const oldSlugsAll = TREE.flatMap(p => p.oldSlugs)
  for (const slug of oldSlugsAll) {
    const cat = await prisma.productCategory.findUnique({
      where:  { slug },
      select: { id: true, name: true, _count: { select: { products: true } } },
    })
    if (!cat) continue
    if (cat._count.products === 0) {
      await prisma.productCategory.update({ where: { slug }, data: { isActive: false } })
      console.log(`  Deactivated (empty): ${cat.name}`)
    } else {
      console.log(`  Kept active: ${cat.name} (${cat._count.products} products still point here)`)
    }
  }

  // 6. Invalidate product cache ──────────────────────────────────────────────
  try {
    const { invalidateProductsCache } = await import('@/lib/products-api')
    await invalidateProductsCache()
    console.log('\n✅ Redis product cache invalidated')
  } catch {
    console.log('\n⚠ Could not invalidate Redis cache (OK if Redis not configured locally)')
  }

  await prisma.$disconnect()
  console.log('\n✅ Done! Restart dev server to see the new category tree in the shop.')
}

main().catch(e => { console.error(e); process.exit(1) })
