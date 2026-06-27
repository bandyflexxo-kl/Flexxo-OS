import 'server-only'
import type { Prisma, PrismaClient } from '@/generated/prisma/client'

type Db = PrismaClient | Prisma.TransactionClient

/**
 * Record a formal tender amendment (the change log distinct from the
 * Postgres audit trail). Use inside the same transaction as the change so
 * the before/after pair is consistent.
 */
export async function recordAmendment(
  db: Db,
  args: {
    tenderId:     string
    field:        string
    before:       string | null
    after:        string | null
    reason?:      string | null
    changedById:  string
    approvedById?: string | null
  },
) {
  await db.tenderAmendment.create({
    data: {
      tenderId:     args.tenderId,
      field:        args.field,
      beforeVal:    args.before,
      afterVal:     args.after,
      reason:       args.reason ?? null,
      changedById:  args.changedById,
      approvedById: args.approvedById ?? null,
    },
  })
}
