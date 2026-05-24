// TODO: Phase 1B — QNE accounting system integration
// This file is scaffolded but not yet implemented.
// Will handle: importing QNE customer data and item codes
// into staging tables for human review before promotion.

export async function triggerQneCustomerSync(params: {
  triggeredById: string
  syncMethod: 'file_upload' | 'manual_export' | 'api_pull'
}): Promise<{ syncLogId: string }> {
  throw new Error('QNE sync not yet implemented (Phase 1B)')
}

export async function triggerQneItemSync(params: {
  triggeredById: string
}): Promise<{ syncLogId: string }> {
  throw new Error('QNE item sync not yet implemented (Phase 1B)')
}
