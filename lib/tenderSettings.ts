import 'server-only'
import { prisma } from '@/lib/prisma'

/** SystemSetting keys for the tender module. */
export const TENDER_KEYS = {
  varianceThreshold: 'tender.variance_threshold',  // percent, e.g. "5"
  minQuotesDefault:  'tender.min_quotes_default',  // integer, e.g. "3"
  qneWritesEnabled:  'tender.qne_writes_enabled',  // "true" | "false"
} as const

export type TenderSettings = {
  varianceThreshold: number
  minQuotesDefault:  number | null
  qneWritesEnabled:  boolean
}

const DEFAULTS: TenderSettings = {
  varianceThreshold: 5,
  minQuotesDefault:  null,
  qneWritesEnabled:  false,   // off until a procurement QNE account is provisioned
}

export async function getTenderSettings(): Promise<TenderSettings> {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: Object.values(TENDER_KEYS) } },
  })
  const map = new Map(rows.map(r => [r.key, r.value]))

  const vt = map.get(TENDER_KEYS.varianceThreshold)
  const mq = map.get(TENDER_KEYS.minQuotesDefault)
  const qw = map.get(TENDER_KEYS.qneWritesEnabled)

  return {
    varianceThreshold: vt != null && vt !== '' ? Number(vt) : DEFAULTS.varianceThreshold,
    minQuotesDefault:  mq != null && mq !== '' ? Number(mq) : DEFAULTS.minQuotesDefault,
    qneWritesEnabled:  qw != null ? qw === 'true' : DEFAULTS.qneWritesEnabled,
  }
}

export async function setTenderSetting(key: string, value: string): Promise<void> {
  await prisma.systemSetting.upsert({
    where:  { key },
    update: { value },
    create: { key, value },
  })
}
