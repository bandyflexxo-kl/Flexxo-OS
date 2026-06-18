/**
 * Diagnose why the photo route fails in production.
 * Checks: admin token, Google credentials, Drive download.
 */
import { prisma } from '@/lib/prisma'
import { downloadDriveFile } from '@/lib/googleDrive'

async function main() {
  console.log('=== Photo Route Diagnostics ===\n')

  // 1. Check env vars
  console.log('1. Environment vars:')
  console.log('   GOOGLE_CLIENT_ID    :', process.env.GOOGLE_CLIENT_ID ? `SET (${process.env.GOOGLE_CLIENT_ID.substring(0,20)}...)` : 'MISSING ❌')
  console.log('   GOOGLE_CLIENT_SECRET:', process.env.GOOGLE_CLIENT_SECRET ? 'SET ✓' : 'MISSING ❌')
  console.log('   NEXTAUTH_URL        :', process.env.NEXTAUTH_URL || 'MISSING ❌')

  // 2. Check admin user with googleRefreshToken
  console.log('\n2. Admin user with Google refresh token:')
  const admins = await prisma.user.findMany({
    where: {
      isActive: true,
      userRoles: { some: { role: { name: 'Admin' }, revokedAt: null } },
    },
    select: { email: true, googleRefreshToken: true },
  })
  admins.forEach(a => {
    console.log(`   ${a.email}: refreshToken = ${a.googleRefreshToken ? 'SET ✓' : 'MISSING ❌'}`)
  })

  const adminWithToken = admins.find(a => a.googleRefreshToken)
  if (!adminWithToken) {
    console.log('\n❌ No admin has googleRefreshToken — photo route will always 503.')
    console.log('   Fix: Go to /admin → Connect Google Drive (OAuth flow)')
    return
  }

  // 3. Try downloading a test photo from Drive
  console.log('\n3. Testing Google Drive download with admin token...')
  const testProduct = await prisma.product.findFirst({
    where: { googleDrivePhotoId: { not: null } },
    select: { id: true, name: true, googleDrivePhotoId: true },
  })

  if (!testProduct?.googleDrivePhotoId) {
    console.log('   No products have photos in DB.')
    return
  }

  console.log(`   Product: ${testProduct.name}`)
  console.log(`   Drive file ID: ${testProduct.googleDrivePhotoId}`)

  try {
    const buf = await downloadDriveFile(adminWithToken.googleRefreshToken!, testProduct.googleDrivePhotoId)
    console.log(`   ✓ Downloaded ${buf.byteLength} bytes successfully`)
  } catch (err: any) {
    console.log(`   ❌ Drive download FAILED:`, err?.message || err)
    console.log(`   Full error:`, JSON.stringify(err?.response?.data || err, null, 2))
  }
}

main().catch(console.error).finally(() => prisma.$disconnect())
