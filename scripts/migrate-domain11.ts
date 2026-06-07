/**
 * scripts/migrate-domain11.ts
 * Creates missing Domain 11 tables (invoice, delivery_booking, warehouse_task)
 * + QnePendingAction (QNE simulation layer)
 * + lat/lng on company_addresses
 * + push_subscriptions table
 * + Warehouse role
 *
 * Run: npx tsx scripts/migrate-domain11.ts
 * Safe to run multiple times (all CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)
 */
import * as dotenv from 'dotenv'
import { Client } from 'pg'
import path from 'path'

dotenv.config({ path: path.join(process.cwd(), '.env.local') })

const LOCAL_DB = 'postgresql://postgres:Flexxo%408820@localhost:5432/flexxo_sales_os'

async function main() {
  const client = new Client({ connectionString: LOCAL_DB })
  await client.connect()
  console.log('✅ Connected to local PostgreSQL')

  const steps: { name: string; sql: string }[] = [
    {
      name: 'Add lat/lng to company_addresses',
      sql: `
        ALTER TABLE company_addresses
          ADD COLUMN IF NOT EXISTS lat VARCHAR(50),
          ADD COLUMN IF NOT EXISTS lng VARCHAR(50);
      `,
    },
    {
      name: 'Create push_subscriptions',
      sql: `
        CREATE TABLE IF NOT EXISTS push_subscriptions (
          id           VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
          user_id      VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          endpoint     TEXT        NOT NULL,
          p256dh       TEXT        NOT NULL,
          auth         TEXT        NOT NULL,
          created_at   TIMESTAMP   NOT NULL DEFAULT now(),
          UNIQUE (user_id, endpoint)
        );
      `,
    },
    {
      name: 'Create invoices',
      sql: `
        CREATE TABLE IF NOT EXISTS invoices (
          id              VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
          order_id        VARCHAR(36) NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
          company_id      VARCHAR(36) NOT NULL REFERENCES companies(id),
          invoice_no      VARCHAR(50) NOT NULL UNIQUE,
          qne_ref         VARCHAR(100),
          qne_push_status VARCHAR(20) NOT NULL DEFAULT 'pending',
          qne_pushed_at   TIMESTAMP,
          currency        VARCHAR(10) NOT NULL DEFAULT 'MYR',
          total_amount    NUMERIC(14,4) NOT NULL,
          issued_at       TIMESTAMP   NOT NULL DEFAULT now(),
          issued_by       VARCHAR(36) NOT NULL REFERENCES users(id),
          notes           TEXT
        );
      `,
    },
    {
      name: 'Create delivery_bookings',
      sql: `
        CREATE TABLE IF NOT EXISTS delivery_bookings (
          id                   VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
          order_id             VARCHAR(36) NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
          lalamove_order_ref   VARCHAR(100),
          service_type         VARCHAR(20),
          quoted_price_myr     NUMERIC(10,2),
          share_link           TEXT,
          driver_name          VARCHAR(200),
          driver_phone         VARCHAR(50),
          plate_number         VARCHAR(20),
          booking_status       VARCHAR(30) NOT NULL DEFAULT 'pending',
          booked_at            TIMESTAMP,
          driver_assigned_at   TIMESTAMP,
          retry_count          INTEGER     NOT NULL DEFAULT 0,
          next_retry_at        TIMESTAMP,
          created_at           TIMESTAMP   NOT NULL DEFAULT now(),
          updated_at           TIMESTAMP   NOT NULL DEFAULT now()
        );
      `,
    },
    {
      name: 'Create warehouse_tasks',
      sql: `
        CREATE TABLE IF NOT EXISTS warehouse_tasks (
          id             VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
          order_id       VARCHAR(36) NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
          status         VARCHAR(30) NOT NULL DEFAULT 'pending',
          notes          TEXT,
          completed_at   TIMESTAMP,
          completed_by   VARCHAR(36) REFERENCES users(id),
          created_at     TIMESTAMP  NOT NULL DEFAULT now()
        );
      `,
    },
    {
      name: 'Create qne_pending_actions (QNE simulation layer)',
      sql: `
        CREATE TABLE IF NOT EXISTS qne_pending_actions (
          id            VARCHAR(36)  PRIMARY KEY DEFAULT gen_random_uuid()::text,
          action_type   VARCHAR(50)  NOT NULL,
          reference_no  VARCHAR(100) NOT NULL,
          original_date TIMESTAMP    NOT NULL,
          payload       JSONB        NOT NULL DEFAULT '{}',
          status        VARCHAR(30)  NOT NULL DEFAULT 'pending',
          notes         TEXT,
          approved_by   VARCHAR(36)  REFERENCES users(id),
          approved_at   TIMESTAMP,
          created_at    TIMESTAMP    NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_qne_pending_status ON qne_pending_actions(status, created_at);
      `,
    },
    {
      name: 'Insert Warehouse role',
      sql: `
        INSERT INTO roles (id, name, description)
        VALUES (gen_random_uuid()::text, 'Warehouse', 'Warehouse pickers — can view and complete picking tasks')
        ON CONFLICT (name) DO NOTHING;
      `,
    },
  ]

  let passed = 0
  let failed = 0

  for (const step of steps) {
    try {
      await client.query(step.sql)
      console.log(`  ✅ ${step.name}`)
      passed++
    } catch (err) {
      console.error(`  ❌ ${step.name}: ${(err as Error).message}`)
      failed++
    }
  }

  await client.end()

  console.log(`\nMigration complete: ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main().catch(err => { console.error(err); process.exit(1) })
