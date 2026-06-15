/**
 * lib/driveWatch.ts
 * Google Drive push notification channel management.
 * Channel state is persisted in Upstash Redis so it survives restarts.
 */
import { google } from 'googleapis'
import { createOAuth2Client } from '@/lib/googleDrive'
import { getRedis } from '@/lib/redis'
import crypto from 'crypto'

const PRICE_FOLDER_ID = '1K23_RJRHCZhB4Kq6ZI3slHSdgoCa87AF'
// Channel lasts 7 days max; we renew at 6 days to give 24h buffer
const CHANNEL_TTL_MS = 7 * 24 * 60 * 60 * 1000
const RENEW_BEFORE_MS = 24 * 60 * 60 * 1000

const REDIS_CHANNEL_ID      = 'drive:channel:id'
const REDIS_CHANNEL_EXPIRE  = 'drive:channel:expire'
const REDIS_CHANNEL_TOKEN   = 'drive:channel:token'
const REDIS_PAGE_TOKEN      = 'drive:pageToken'

export type DriveChannelState = {
  channelId:   string
  expireAt:    number   // Unix ms
  channelToken: string
  pageToken:   string | null
}

export async function getDriveChannelState(): Promise<DriveChannelState | null> {
  const redis = getRedis()
  if (!redis) return null

  const [channelId, expireAt, channelToken, pageToken] = await Promise.all([
    redis.get<string>(REDIS_CHANNEL_ID),
    redis.get<string>(REDIS_CHANNEL_EXPIRE),
    redis.get<string>(REDIS_CHANNEL_TOKEN),
    redis.get<string>(REDIS_PAGE_TOKEN),
  ])

  if (!channelId || !expireAt || !channelToken) return null

  return {
    channelId,
    expireAt:    parseInt(expireAt, 10),
    channelToken,
    pageToken:   pageToken ?? null,
  }
}

export async function registerDriveWatch(refreshToken: string): Promise<DriveChannelState> {
  const redis = getRedis()
  if (!redis) throw new Error('Redis not configured — set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN')

  const auth = createOAuth2Client()
  auth.setCredentials({ refresh_token: refreshToken })
  const drive = google.drive({ version: 'v3', auth })

  // Get a fresh pageToken so we only get changes AFTER this point
  const startPageRes = await drive.changes.getStartPageToken({})
  const pageToken = startPageRes.data.startPageToken ?? ''

  const channelId    = crypto.randomUUID()
  const channelToken = crypto.randomBytes(16).toString('hex')
  const expireAt     = Date.now() + CHANNEL_TTL_MS
  const webhookUrl   = `${process.env.NEXTAUTH_URL}/api/webhooks/drive-price`

  await drive.files.watch({
    fileId:     PRICE_FOLDER_ID,
    requestBody: {
      id:         channelId,
      type:       'web_hook',
      address:    webhookUrl,
      token:      channelToken,
      expiration: String(expireAt),
    },
  })

  // Persist state in Redis (90 day TTL — well beyond the channel TTL)
  const ttlSeconds = 90 * 24 * 60 * 60
  await Promise.all([
    redis.set(REDIS_CHANNEL_ID,     channelId,    { ex: ttlSeconds }),
    redis.set(REDIS_CHANNEL_EXPIRE, String(expireAt), { ex: ttlSeconds }),
    redis.set(REDIS_CHANNEL_TOKEN,  channelToken, { ex: ttlSeconds }),
    redis.set(REDIS_PAGE_TOKEN,     pageToken,    { ex: ttlSeconds }),
  ])

  return { channelId, expireAt, channelToken, pageToken }
}

export async function renewDriveWatchIfNeeded(refreshToken: string): Promise<boolean> {
  const state = await getDriveChannelState()
  if (!state) {
    await registerDriveWatch(refreshToken)
    return true
  }
  if (Date.now() + RENEW_BEFORE_MS < state.expireAt) return false   // still fresh
  await registerDriveWatch(refreshToken)
  return true
}

export type DriveChangeFile = {
  fileId:       string
  fileName:     string
  mimeType:     string
  parentId:     string | null
  modifiedTime: string | null
  removed:      boolean
}

export async function getDriveChanges(refreshToken: string): Promise<DriveChangeFile[]> {
  const redis = getRedis()
  if (!redis) return []

  const pageToken = await redis.get<string>(REDIS_PAGE_TOKEN)
  if (!pageToken) return []

  const auth = createOAuth2Client()
  auth.setCredentials({ refresh_token: refreshToken })
  const drive = google.drive({ version: 'v3', auth })

  const changes: DriveChangeFile[] = []
  let cursor: string = pageToken

  // eslint-disable-next-line no-constant-condition
  while (true) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = await drive.changes.list({
      pageToken:        cursor,
      fields:           'changes(fileId,removed,file(name,mimeType,parents,modifiedTime)),nextPageToken,newStartPageToken',
      includeItemsFromAllDrives: false,
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const batch = (res.data.changes ?? []) as any[]
    for (const change of batch) {
      changes.push({
        fileId:       change.fileId ?? '',
        fileName:     change.file?.name ?? '',
        mimeType:     change.file?.mimeType ?? '',
        parentId:     change.file?.parents?.[0] ?? null,
        modifiedTime: change.file?.modifiedTime ?? null,
        removed:      change.removed === true,
      })
    }

    if (res.data.nextPageToken) {
      cursor = res.data.nextPageToken
    } else {
      // Save the new start page token for next poll
      const newToken = res.data.newStartPageToken ?? cursor
      await redis.set(REDIS_PAGE_TOKEN, newToken, { ex: 90 * 24 * 60 * 60 })
      break
    }
  }

  return changes
}

export async function isPriceListFolder(fileId: string, refreshToken: string): Promise<boolean> {
  const auth = createOAuth2Client()
  auth.setCredentials({ refresh_token: refreshToken })
  const drive = google.drive({ version: 'v3', auth })

  // Walk up the parent chain up to 5 levels to see if PRICE_FOLDER_ID is an ancestor
  let current = fileId
  for (let i = 0; i < 5; i++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = await drive.files.get({
      fileId: current,
      fields: 'parents',
    })
    const parents: string[] = res.data.parents ?? []
    if (parents.includes(PRICE_FOLDER_ID)) return true
    if (parents.length === 0) break
    current = parents[0]
  }
  return false
}
