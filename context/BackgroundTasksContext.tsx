'use client'

import {
  createContext, useContext, useReducer, useCallback, useRef,
  type ReactNode,
} from 'react'

export type TaskStatus = 'running' | 'candidates' | 'applying' | 'done' | 'error'

export type Candidate = { imageUrl: string; title: string }

export type SearchParams = { site?: string; hint?: string }

export type FlaggedCandidate = { title: string; reason: string }

export type BackgroundTask = {
  id:            string
  label:         string
  subLabel?:     string
  productId:     string
  endpoint?:     string          // stored so refineSearch can re-call the same route
  searchParams?: SearchParams    // stored so refineSearch re-uses same site/hint
  status:        TaskStatus
  candidates?:   Candidate[]
  message?:      string
  flagged?:      boolean
  startedAt:     number
  doneAt?:       number
}

type Action =
  | { type: 'ADD';    task: BackgroundTask }
  | { type: 'UPDATE'; id: string; patch: Partial<BackgroundTask> }
  | { type: 'REMOVE'; id: string }

function reducer(state: BackgroundTask[], action: Action): BackgroundTask[] {
  switch (action.type) {
    case 'ADD':    return [action.task, ...state]
    case 'UPDATE': return state.map(t => t.id === action.id ? { ...t, ...action.patch } : t)
    case 'REMOVE': return state.filter(t => t.id !== action.id)
    default:       return state
  }
}

type TaskResult =
  | { type: 'candidates'; candidates: Candidate[] }
  | { type: 'done';       message: string; flagged?: boolean }

export type RunTaskOpts = {
  label:         string
  subLabel?:     string
  productId:     string
  endpoint?:     string
  searchParams?: SearchParams
  execute:       () => Promise<TaskResult>
  onDone?:       (result: { message: string; flagged?: boolean }) => void
}

type CtxValue = {
  tasks:          BackgroundTask[]
  role:           string
  runTask:        (opts: RunTaskOpts) => string
  applyCandidate: (taskId: string, imageUrl: string) => void
  refineSearch:   (taskId: string, flagged: FlaggedCandidate[]) => void
  dismissTask:    (taskId: string) => void
}

const Ctx = createContext<CtxValue | null>(null)

const DONE_TTL  = 12_000
const ERROR_TTL = 18_000

export function BackgroundTasksProvider({ children, role }: { children: ReactNode; role: string }) {
  const [tasks, dispatch] = useReducer(reducer, [])
  const callbacks = useRef<Record<string, ((r: { message: string; flagged?: boolean }) => void) | undefined>>({})
  const timers    = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  function scheduleRemove(id: string, ttl: number) {
    timers.current[id] = setTimeout(() => {
      dispatch({ type: 'REMOVE', id })
      delete timers.current[id]
      delete callbacks.current[id]
    }, ttl)
  }

  function fireRefresh() {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('photo-review-refresh'))
    }
  }

  const dismissTask = useCallback((id: string) => {
    clearTimeout(timers.current[id])
    delete timers.current[id]
    delete callbacks.current[id]
    dispatch({ type: 'REMOVE', id })
  }, [])

  const runTask = useCallback((opts: RunTaskOpts): string => {
    const id = `bt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    callbacks.current[id] = opts.onDone

    dispatch({
      type: 'ADD',
      task: {
        id, label: opts.label, subLabel: opts.subLabel,
        productId:    opts.productId,
        endpoint:     opts.endpoint,
        searchParams: opts.searchParams,
        status: 'running', startedAt: Date.now(),
      },
    })

    void opts.execute()
      .then(result => {
        if (result.type === 'candidates') {
          dispatch({ type: 'UPDATE', id, patch: {
            status: 'candidates', candidates: result.candidates, subLabel: undefined,
          }})
        } else {
          dispatch({ type: 'UPDATE', id, patch: {
            status: 'done', message: result.message, flagged: result.flagged,
            doneAt: Date.now(), subLabel: undefined,
          }})
          callbacks.current[id]?.(result)
          fireRefresh()
          scheduleRemove(id, DONE_TTL)
        }
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'UPDATE', id, patch: {
          status: 'error', message: msg, doneAt: Date.now(), subLabel: undefined,
        }})
        scheduleRemove(id, ERROR_TTL)
      })

    return id
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const applyCandidate = useCallback((taskId: string, imageUrl: string) => {
    const task = tasks.find(t => t.id === taskId)
    if (!task) return

    dispatch({ type: 'UPDATE', id: taskId, patch: {
      status: 'applying', subLabel: 'Uploading & scanning with AI…', candidates: undefined,
    }})

    void fetch(`/api/admin/products/${task.productId}/photo`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ url: imageUrl }),
    })
      .then(async r => {
        // Read defensively: a timed-out/crashed function returns an empty body,
        // and a blind r.json() would throw "Unexpected end of JSON input". Also
        // honour a non-OK status so a failed save isn't shown as "clean ✓".
        const raw = await r.text()
        let d: { flagged?: boolean; reason?: string; error?: string } = {}
        try { d = raw ? JSON.parse(raw) : {} } catch { /* empty/non-JSON body */ }
        if (!r.ok) throw new Error(d.error ?? (raw === '' ? 'The server took too long applying the photo — please try again.' : `Apply failed (HTTP ${r.status})`))
        return d
      })
      .then((d: { flagged?: boolean; reason?: string; error?: string }) => {
        const message = d.flagged
          ? `Still flagged — ${d.reason ?? 'try another method'}`
          : 'Replaced & clean ✓'
        dispatch({ type: 'UPDATE', id: taskId, patch: {
          status: 'done', message, flagged: d.flagged ?? false,
          doneAt: Date.now(), subLabel: undefined,
        }})
        callbacks.current[taskId]?.({ message, flagged: d.flagged ?? false })
        fireRefresh()
        scheduleRemove(taskId, DONE_TTL)
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Failed to apply photo'
        dispatch({ type: 'UPDATE', id: taskId, patch: {
          status: 'error', message: msg, doneAt: Date.now(), subLabel: undefined,
        }})
        scheduleRemove(taskId, ERROR_TTL)
      })
  }, [tasks]) // eslint-disable-line react-hooks/exhaustive-deps

  const refineSearch = useCallback((taskId: string, flagged: FlaggedCandidate[]) => {
    const task = tasks.find(t => t.id === taskId)
    if (!task?.endpoint) return

    dispatch({ type: 'UPDATE', id: taskId, patch: {
      status: 'running', candidates: undefined, subLabel: 'Refining with your feedback…',
    }})

    void fetch(task.endpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        site:     task.searchParams?.site,
        hint:     task.searchParams?.hint,
        feedback: flagged,
      }),
    })
      .then(r => r.json())
      .then((d: { candidates?: Candidate[]; error?: string }) => {
        if (!d.candidates?.length) {
          dispatch({ type: 'UPDATE', id: taskId, patch: {
            status: 'error',
            message: d.error ?? 'No results after refinement',
            doneAt: Date.now(), subLabel: undefined,
          }})
          scheduleRemove(taskId, ERROR_TTL)
          return
        }
        dispatch({ type: 'UPDATE', id: taskId, patch: {
          status: 'candidates', candidates: d.candidates, subLabel: undefined,
        }})
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Refinement failed'
        dispatch({ type: 'UPDATE', id: taskId, patch: {
          status: 'error', message: msg, doneAt: Date.now(), subLabel: undefined,
        }})
        scheduleRemove(taskId, ERROR_TTL)
      })
  }, [tasks]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Ctx.Provider value={{ tasks, role, runTask, applyCandidate, refineSearch, dismissTask }}>
      {children}
    </Ctx.Provider>
  )
}

export function useBackgroundTasks() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useBackgroundTasks must be inside <BackgroundTasksProvider>')
  return ctx
}
