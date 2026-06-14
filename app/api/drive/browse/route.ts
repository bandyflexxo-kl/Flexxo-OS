import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { listDriveFolder } from '@/lib/googleDrive'

export async function GET(request: Request) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Admin','Director'].includes(session.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const folderId = searchParams.get('folderId') ?? process.env.GOOGLE_DRIVE_FOLDER_ID

  if (!folderId) {
    return Response.json({ error: 'No folder ID provided and GOOGLE_DRIVE_FOLDER_ID is not set.' }, { status: 400 })
  }

  // Get the admin user's Google refresh token
  const user = await prisma.user.findUnique({
    where:  { id: session.userId },
    select: { googleRefreshToken: true },
  })

  if (!user?.googleRefreshToken) {
    return Response.json({ error: 'Google Drive not connected. Please connect your Google account first.' }, { status: 403 })
  }

  try {
    const items = await listDriveFolder(user.googleRefreshToken, folderId)
    return Response.json({ items, folderId })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to list Drive folder'
    return Response.json({ error: msg }, { status: 500 })
  }
}
