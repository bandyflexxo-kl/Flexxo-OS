'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type TaskItem = {
  id:          string
  productName: string
  unit:        string
  qty:         string
}

type Task = {
  taskId:     string
  taskStatus: string
  orderId:    string
  orderRef:   string | null
  company:    string
  createdAt:  string
  items:      TaskItem[]
}

export default function WarehouseTaskList({ tasks: initial }: { tasks: Task[] }) {
  const router = useRouter()
  const [tasks,  setTasks]  = useState(initial)
  const [busy,   setBusy]   = useState<Set<string>>(new Set())
  const [errors, setErrors] = useState<Record<string, string>>({})

  async function markDone(task: Task) {
    setBusy(prev => new Set([...prev, task.taskId]))
    setErrors(prev => { const n = { ...prev }; delete n[task.taskId]; return n })
    try {
      const res  = await fetch(`/api/orders/${task.orderId}/picking-done`, { method: 'POST' })
      const data = await res.json() as { ok?: boolean; bookedNow?: boolean; error?: string }
      if (!res.ok) {
        setErrors(prev => ({ ...prev, [task.taskId]: data.error ?? 'Failed' }))
        return
      }
      // Remove this task from list
      setTasks(prev => prev.filter(t => t.taskId !== task.taskId))
      router.refresh()
    } finally {
      setBusy(prev => { const n = new Set(prev); n.delete(task.taskId); return n })
    }
  }

  if (tasks.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center">
        <div className="text-5xl mb-3">✅</div>
        <p className="text-gray-500 font-medium">All tasks complete!</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500 font-medium">{tasks.length} task{tasks.length !== 1 ? 's' : ''} pending</p>
      {tasks.map(task => {
        const isBusy = busy.has(task.taskId)
        const error  = errors[task.taskId]
        return (
          <div key={task.taskId} className={`bg-white rounded-2xl border-2 overflow-hidden transition-opacity ${isBusy ? 'opacity-60' : 'border-gray-200'}`}>
            {/* Header */}
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
              <div>
                <p className="font-bold text-gray-900 text-lg font-mono">{task.orderRef ?? task.orderId.slice(0, 8)}</p>
                <p className="text-sm text-gray-500 mt-0.5">{task.company}</p>
              </div>
              <span className="text-xs text-gray-400">
                {new Date(task.createdAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>

            {/* Items */}
            <div className="divide-y divide-gray-50">
              {task.items.map(item => (
                <div key={item.id} className="px-5 py-3 flex items-center justify-between">
                  <span className="text-sm text-gray-800 font-medium">{item.productName}</span>
                  <span className="text-sm font-bold text-gray-900 tabular-nums ml-4 shrink-0">
                    × {Number(item.qty).toFixed(0)}{item.unit ? ` ${item.unit}` : ''}
                  </span>
                </div>
              ))}
            </div>

            {/* Action */}
            <div className="px-5 py-4 border-t border-gray-100 space-y-2">
              {error && <p className="text-xs text-red-600">{error}</p>}
              <button
                onClick={() => markDone(task)}
                disabled={isBusy}
                className="w-full py-4 bg-green-600 hover:bg-green-700 active:bg-green-800 text-white font-bold text-lg rounded-xl disabled:opacity-50 transition-colors"
              >
                {isBusy ? 'Processing…' : '✓ Done — Picked & Packed'}
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
