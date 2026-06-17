import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { listDriveFolder, normaliseStem } from '@/lib/googleDrive'
import { getRedis } from '@/lib/redis'

const PRICE_FOLDER_ID = '1K23_RJRHCZhB4Kq6ZI3slHSdgoCa87AF'

const SUPPORTED_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
])

function fileCategory(mimeType: string): 'pdf' | 'image' | 'xlsx' | 'unsupported' {
  if (mimeType === 'application/pdf') return 'pdf'
  if (mimeType.startsWith('image/'))  return 'image'
  if (mimeType.includes('sheet') || mimeType.includes('excel') || mimeType.includes('csv')) return 'xlsx'
  return 'unsupported'
}

type FileWithHint = {
  id:           string
  name:         string
  mimeType:     string
  size:         string | null
  modifiedTime: string | null
  folderHint:   string | null
}

// Single recursive walk — builds file list + folder hints in one pass
// Parallel recursive walk — sibling folders are fetched concurrently
async function listFilesWithHints(
  refreshToken: string | null,
  folderId:     string,
  parentName:   string | null,
  depth:        number,
  maxDepth:     number,
): Promise<FileWithHint[]> {
  if (depth > maxDepth) return []
  const items = await listDriveFolder(refreshToken, folderId)
  const files: FileWithHint[] = []
  const folderPromises: Promise<FileWithHint[]>[] = []

  for (const item of items) {
    if (item.isFolder) {
      folderPromises.push(
        listFilesWithHints(refreshToken, item.id, item.name, depth + 1, maxDepth),
      )
    } else {
      files.push({
        id:           item.id,
        name:         item.name,
        mimeType:     item.mimeType,
        size:         item.size,
        modifiedTime: item.modifiedTime,
        folderHint:   parentName,
      })
    }
  }

  const nested = await Promise.all(folderPromises)
  for (const batch of nested) files.push(...batch)
  return files
}

export type ScannedFile = {
  fileId:        string
  fileName:      string
  mimeType:      string
  fileCategory:  'pdf' | 'image' | 'xlsx' | 'unsupported'
  sizeBytes:     number | null
  modifiedTime:  string | null
  folderHint:    string | null
  status:        'new' | 'processed' | 'failed' | 'processing'
  processedFileId?: string
  supplierId:    string | null
  supplierName:  string | null
}

export async function GET() {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Admin', 'Director'].includes(session.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const hasSA = !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  const user  = hasSA ? null : await prisma.user.findUnique({
    where:  { id: session.userId },
    select: { googleRefreshToken: true },
  })
  if (!hasSA && !user?.googleRefreshToken) {
    return Response.json({ error: 'Connect Google Drive first.' }, { status: 403 })
  }

  const driveToken = hasSA ? null : user!.googleRefreshToken!

  // Single-pass Drive tree walk (max 4 levels deep)
  let driveFiles: FileWithHint[]
  try {
    driveFiles = await listFilesWithHints(driveToken, PRICE_FOLDER_ID, null, 0, 4)
  } catch (err) {
    return Response.json({ error: `Drive scan failed: ${err instanceof Error ? err.message : err}` }, { status: 502 })
  }

  const supportedFiles = driveFiles.filter(f => SUPPORTED_TYPES.has(f.mimeType))

  // Cross-reference against already-processed SupplierPriceFiles
  const fileIds = supportedFiles.map(f => f.id)
  const processed = await prisma.supplierPriceFile.findMany({
    where:  { googleDriveFileId: { in: fileIds } },
    select: {
      id:                true,
      googleDriveFileId: true,
      importStatus:      true,
      supplierId:        true,
      supplier:          { select: { id: true, name: true } },
    },
  })
  const processedMap = new Map(processed.map(p => [p.googleDriveFileId ?? '', p]))

  // Load all active suppliers for fuzzy folder-name matching
  const suppliers = await prisma.supplier.findMany({
    where:  { isActive: true },
    select: { id: true, name: true, nameNormalized: true },
  })

  // Check for Drive push-notification alert in Redis
  const redis = getRedis()
  let newFilesAlert: string[] = []
  if (redis) {
    const raw = await redis.get<string>('drive:new_files_alert')
    newFilesAlert = raw ? JSON.parse(raw) : []
    if (newFilesAlert.length > 0) {
      await redis.del('drive:new_files_alert').catch(() => null)
    }
  }

  const scanned: ScannedFile[] = supportedFiles.map(f => {
    const proc         = processedMap.get(f.id)
    const supplierMatch = f.folderHint ? bestSupplierMatch(f.folderHint, suppliers) : null

    return {
      fileId:         f.id,
      fileName:       f.name,
      mimeType:       f.mimeType,
      fileCategory:   fileCategory(f.mimeType),
      sizeBytes:      f.size ? parseInt(f.size, 10) : null,
      modifiedTime:   f.modifiedTime,
      folderHint:     f.folderHint,
      status: proc
        ? (proc.importStatus === 'completed' ? 'processed'
          : proc.importStatus === 'failed'    ? 'failed'
          : 'processing')
        : 'new',
      processedFileId: proc?.id,
      supplierId:     proc?.supplier?.id ?? supplierMatch?.id ?? null,
      supplierName:   proc?.supplier?.name ?? supplierMatch?.name ?? null,
    }
  })

  return Response.json({ files: scanned, newFilesAlert })
}

function bestSupplierMatch(
  folderName: string,
  suppliers:  { id: string; name: string; nameNormalized: string }[],
): { id: string; name: string } | null {
  const needle = normaliseStem(folderName)
  let best: { id: string; name: string } | null = null
  let bestScore = 0

  for (const s of suppliers) {
    const hay = normaliseStem(s.name)
    if (hay === needle) return { id: s.id, name: s.name }
    const shorter = needle.length < hay.length ? needle : hay
    const longer  = needle.length < hay.length ? hay : needle
    if (longer.includes(shorter) && shorter.length / longer.length > bestScore) {
      bestScore = shorter.length / longer.length
      best = { id: s.id, name: s.name }
    }
  }

  return bestScore >= 0.6 ? best : null
}
