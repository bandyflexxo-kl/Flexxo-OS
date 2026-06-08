import { google } from 'googleapis'

const REDIRECT_URI = `${process.env.NEXTAUTH_URL}/api/auth/google/callback`

export function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    REDIRECT_URI,
  )
}

// ── Auth ────────────────────────────────────────────────────────────────────

export function getGoogleAuthUrl(state: string): string {
  const client = createOAuth2Client()
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt:      'consent',  // always get refresh token
    scope: [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/drive.file',   // needed to create log files
    ],
    state,
  })
}

export async function exchangeCodeForRefreshToken(code: string): Promise<string> {
  const client = createOAuth2Client()
  const { tokens } = await client.getToken(code)
  if (!tokens.refresh_token) {
    throw new Error('No refresh token returned. Please revoke app access at myaccount.google.com and try again.')
  }
  return tokens.refresh_token
}

// ── Drive helpers ────────────────────────────────────────────────────────────

function getDriveClient(refreshToken: string) {
  const client = createOAuth2Client()
  client.setCredentials({ refresh_token: refreshToken })
  return google.drive({ version: 'v3', auth: client })
}

export type DriveItem = {
  id:           string
  name:         string
  mimeType:     string
  modifiedTime: string | null
  size:         string | null
  isFolder:     boolean
  isPdf:        boolean
}

export async function listDriveFolder(
  refreshToken: string,
  folderId:     string,
): Promise<DriveItem[]> {
  const drive     = getDriveClient(refreshToken)
  const allItems: DriveItem[] = []
  let pageToken: string | undefined = undefined

  do {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = await drive.files.list({
      q:        `'${folderId}' in parents and trashed = false`,
      fields:   'files(id,name,mimeType,modifiedTime,size),nextPageToken',
      orderBy:  'folder,name',
      pageSize: 200,
      pageToken,
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = (res.data.files ?? []).map((f: any) => ({
      id:           f.id           ?? '',
      name:         f.name         ?? '',
      mimeType:     f.mimeType     ?? '',
      modifiedTime: f.modifiedTime ?? null,
      size:         f.size         ?? null,
      isFolder:     f.mimeType === 'application/vnd.google-apps.folder',
      isPdf:        f.mimeType === 'application/pdf',
    }))

    allItems.push(...items)
    pageToken = res.data.nextPageToken ?? undefined
  } while (pageToken)

  return allItems
}

// Recursively list ALL files in a folder and its subfolders (up to maxDepth levels)
export async function listDriveFolderRecursive(
  refreshToken: string,
  folderId:     string,
  maxDepth      = 3,
): Promise<DriveItem[]> {
  const items = await listDriveFolder(refreshToken, folderId)
  const files: DriveItem[] = []

  for (const item of items) {
    if (item.isFolder && maxDepth > 1) {
      const children = await listDriveFolderRecursive(refreshToken, item.id, maxDepth - 1)
      files.push(...children)
    } else if (!item.isFolder) {
      files.push(item)
    }
  }

  return files
}

// Normalise a string for fuzzy matching: uppercase, remove non-alphanumeric
export function normaliseStem(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export async function downloadDriveFile(
  refreshToken: string,
  fileId:       string,
): Promise<Buffer> {
  const drive = getDriveClient(refreshToken)

  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' },
  )

  return Buffer.from(res.data as ArrayBuffer)
}
