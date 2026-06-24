/**
 * lib/syncJobStore.ts
 * In-process singleton that tracks background sync jobs.
 * Lives as a module-level Map — survives across API route calls within
 * the same Node.js process (i.e. the local dev server running with VPN).
 * The client polls /api/admin/sync-jobs from any page to get live state.
 */

export type JobType   = 'products' | 'documents' | 'prices' | 'customers'
export type JobStatus = 'running' | 'done' | 'error'

export type SyncJob = {
  id:         string
  type:       JobType
  label:      string
  status:     JobStatus
  progress:   string   // current step text
  startedAt:  number   // Date.now()
  finishedAt: number | null
  summary:    string | null  // shown on completion
  error:      string | null  // shown on failure
}

const store = new Map<string, SyncJob>()

// Remove finished jobs older than 30 min to prevent memory accumulation
function gc(): void {
  const cutoff = Date.now() - 30 * 60 * 1000
  for (const [id, job] of store) {
    if (job.finishedAt !== null && job.finishedAt < cutoff) store.delete(id)
  }
}

export function createJob(type: JobType, label: string): string {
  gc()
  const id = crypto.randomUUID()
  store.set(id, {
    id, type, label,
    status:     'running',
    progress:   'Starting…',
    startedAt:  Date.now(),
    finishedAt: null,
    summary:    null,
    error:      null,
  })
  return id
}

export function setProgress(id: string, progress: string): void {
  const job = store.get(id)
  if (job?.status === 'running') job.progress = progress
}

export function finishJob(id: string, summary: string): void {
  const job = store.get(id)
  if (!job) return
  job.status     = 'done'
  job.progress   = 'Complete'
  job.summary    = summary
  job.finishedAt = Date.now()
}

export function failJob(id: string, error: string): void {
  const job = store.get(id)
  if (!job) return
  job.status     = 'error'
  job.progress   = 'Failed'
  job.error      = error
  job.finishedAt = Date.now()
}

export function getJobs(): SyncJob[] {
  return [...store.values()].sort((a, b) => b.startedAt - a.startedAt).slice(0, 20)
}

export function getJob(id: string): SyncJob | undefined {
  return store.get(id)
}
