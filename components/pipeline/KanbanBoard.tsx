'use client'

import { useState } from 'react'
import Link from 'next/link'
import Badge, { temperatureColor } from '@/components/ui/Badge'
import Toast from '@/components/ui/Toast'

interface Card {
  historyId: string
  companyId: string
  companyName: string
  leadTemperature: string | null
  status: string
  contact: { name: string; phone: string | null } | null
  assignee: { name: string } | null
  daysInStage: number
}

interface Stage { id: string; name: string; colorHex: string | null }

interface Column {
  stage: Stage
  cards: Card[]
}

interface Props {
  columns: Column[]
  stages: Stage[]
}

export default function KanbanBoard({ columns: initialColumns, stages }: Props) {
  const [columns, setColumns] = useState(initialColumns)
  const [dragging, setDragging] = useState<{ card: Card; fromStageId: string } | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  function onDragStart(card: Card, stageId: string) {
    setDragging({ card, fromStageId: stageId })
  }

  async function onDrop(toStageId: string) {
    if (!dragging || dragging.fromStageId === toStageId) {
      setDragging(null)
      return
    }
    const { card } = dragging
    const toStage = stages.find((s) => s.id === toStageId)!

    // Optimistic update
    setColumns((prev) =>
      prev.map((col) => {
        if (col.stage.id === dragging.fromStageId) {
          return { ...col, cards: col.cards.filter((c) => c.companyId !== card.companyId) }
        }
        if (col.stage.id === toStageId) {
          return { ...col, cards: [...col.cards, { ...card, daysInStage: 0 }] }
        }
        return col
      })
    )
    setDragging(null)

    const res = await fetch('/api/pipeline/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId: card.companyId, toStageId, fromHistoryId: card.historyId }),
    })

    if (res.ok) {
      setToast(`Moved ${card.companyName} to ${toStage.name}`)
    } else {
      setToast('Failed to move card — please refresh')
    }
  }

  return (
    <>
      {toast && <Toast message={toast} type="success" onClose={() => setToast(null)} />}
      <div className="flex gap-4 min-h-[600px] items-start">
        {columns.map((col) => (
          <div
            key={col.stage.id}
            className="w-64 shrink-0 bg-gray-100 rounded-xl p-3"
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => onDrop(col.stage.id)}
          >
            <div className="flex items-center gap-2 mb-3">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: col.stage.colorHex ?? '#94A3B8' }} />
              <h3 className="text-xs font-semibold text-gray-700">{col.stage.name}</h3>
              <span className="ml-auto text-xs text-gray-400">{col.cards.length}</span>
            </div>
            <div className="space-y-2">
              {col.cards.map((card) => (
                <div
                  key={card.companyId}
                  draggable
                  onDragStart={() => onDragStart(card, col.stage.id)}
                  className="bg-white rounded-lg p-3 shadow-sm cursor-grab active:cursor-grabbing border border-gray-200 hover:shadow-md transition-shadow"
                >
                  <Link
                    href={`/companies/${card.companyId}`}
                    className="font-medium text-sm text-gray-900 hover:text-blue-600 block mb-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {card.companyName}
                  </Link>
                  {card.contact && (
                    <p className="text-xs text-gray-500">
                      {card.contact.name}
                      {card.contact.phone && ` · ${card.contact.phone}`}
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-2">
                    {card.leadTemperature && (
                      <Badge color={temperatureColor(card.leadTemperature)}>{card.leadTemperature}</Badge>
                    )}
                    <span className="text-xs text-gray-400 ml-auto">{card.daysInStage}d</span>
                  </div>
                  {card.assignee && (
                    <p className="text-xs text-gray-400 mt-1">{card.assignee.name}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
