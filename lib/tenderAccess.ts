/**
 * lib/tenderAccess.ts — stage-level gating for the tender module.
 *
 * The route-prefix matrix in lib/access.ts decides who can open `/tenders`.
 * THIS file decides, once inside, who may ACT on a given stage and who may
 * perform privileged tender operations (gates, price-lock override, settings).
 *
 * Must stay client-safe (no 'server-only', no prisma) — imported by both
 * server route handlers and client components.
 *
 * Role keys are the stored CRM roles; tender-org labels live in lib/access.ts
 * (roleLabel): Salesperson = "Sales Executive", Manager = "Sales Manager".
 */

export const TENDER_STAGES = [
  'creation',
  'rfq',
  'evaluation',
  'client_po',
  'supplier_po',
  'receiving',
  'closed',
] as const
export type TenderStage = (typeof TENDER_STAGES)[number]

export const STAGE_LABELS: Record<TenderStage, string> = {
  creation:    'Tender Creation',
  rfq:         'RFQ to Suppliers',
  evaluation:  'Price Evaluation',
  client_po:   'Client PO Tracking',
  supplier_po: 'Supplier PO Issuance',
  receiving:   'Delivery / GRN',
  closed:      'Closed',
}

/** Who may take action on each stage (create/edit within that stage). */
const STAGE_ACTORS: Record<TenderStage, string[]> = {
  creation:    ['Salesperson', 'Manager', 'Director', 'SuperAdmin', 'Admin'],
  rfq:         ['Salesperson', 'Manager', 'Director', 'SuperAdmin', 'Admin'],
  evaluation:  ['Manager', 'Director', 'SuperAdmin'],
  client_po:   ['Purchaser', 'SuperAdmin', 'Admin'],
  supplier_po: ['Purchaser', 'SuperAdmin', 'Admin'],
  receiving:   ['Warehouse', 'Purchaser', 'SuperAdmin', 'Admin'],
  closed:      [],
}

/** Roles that can see the tender module at all (mirror of lib/access.ts /tenders). */
const TENDER_ROLES = ['Director', 'SuperAdmin', 'Manager', 'Admin', 'Salesperson', 'Purchaser', 'Warehouse']

export function isTenderRole(role: string): boolean {
  return TENDER_ROLES.includes(role)
}

/** May this role create a new tender (Stage 1 entry point)? */
export function canCreateTender(role: string): boolean {
  return STAGE_ACTORS.creation.includes(role)
}

/** May this role act on the given stage? */
export function canActOnStage(role: string, stage: string): boolean {
  const actors = STAGE_ACTORS[stage as TenderStage]
  return actors ? actors.includes(role) : false
}

/** Gate keepers — acknowledge Gate 1, approve Gate 2/3. */
export function canManageGate(role: string): boolean {
  return role === 'Manager' || role === 'Director' || role === 'SuperAdmin'
}

/** Only Super Admin may break a locked tender price (via amendment + reason). */
export function canOverrideLock(role: string): boolean {
  return role === 'SuperAdmin'
}

/** Who may change the global variance threshold / tender settings. */
export function canEditTenderSettings(role: string): boolean {
  return role === 'SuperAdmin' || role === 'Admin'
}

/** Next stage in the linear lifecycle, or null at the end. */
export function nextStage(stage: TenderStage): TenderStage | null {
  const i = TENDER_STAGES.indexOf(stage)
  return i >= 0 && i < TENDER_STAGES.length - 1 ? TENDER_STAGES[i + 1] : null
}
