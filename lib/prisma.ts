import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

function createPrismaClient() {
  // Always use DATABASE_URL for the runtime adapter.
  // DIRECT_URL is only used by prisma.config.ts for CLI migrations — not here.
  const connectionString = process.env.DATABASE_URL
  // max:1 — each serverless worker holds at most 1 connection.
  // Supabase's PgBouncer pooler handles multiplexing across workers.
  const adapter = new PrismaPg({ connectionString, max: 1 })
  return new PrismaClient({ adapter, log: ['error'] })
}

// Cache the singleton on globalThis so the same worker process reuses it
// across requests instead of opening a new pool on every invocation.
// NOTE: must apply in production too — the previous guard was the root cause
// of EMAXCONN errors on Vercel (every invocation opened a fresh pool).
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

globalForPrisma.prisma = prisma
