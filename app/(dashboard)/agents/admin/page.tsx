'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import Topbar from '@/components/layout/Topbar'

type Role = 'user' | 'assistant'
type ThinkingStep = { tool: string; description: string }
type Message = {
  role:        Role
  content:     string
  thinking?:   ThinkingStep[]
  isStreaming?: boolean
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**'))
          return <strong key={i} className="font-semibold text-gray-900">{part.slice(2, -2)}</strong>
        if (part.startsWith('`') && part.endsWith('`'))
          return <code key={i} className="bg-gray-100 text-gray-800 px-1 py-0.5 rounded text-xs font-mono">{part.slice(1, -1)}</code>
        return <span key={i}>{part}</span>
      })}
    </>
  )
}

function MarkdownContent({ text }: { text: string }) {
  const lines = text.split('\n')
  const elements: React.ReactNode[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith('### ')) { elements.push(<p key={i} className="font-semibold text-gray-900 mt-2 mb-0.5 text-sm">{renderInline(line.slice(4))}</p>); i++ }
    else if (line.startsWith('## ')) { elements.push(<p key={i} className="font-bold text-gray-900 mt-3 mb-1">{renderInline(line.slice(3))}</p>); i++ }
    else if (line.startsWith('- ') || line.startsWith('• ')) {
      const items: React.ReactNode[] = []
      while (i < lines.length && (lines[i].startsWith('- ') || lines[i].startsWith('• '))) { items.push(<li key={i}>{renderInline(lines[i].slice(2))}</li>); i++ }
      elements.push(<ul key={`ul-${i}`} className="list-disc list-outside ml-4 space-y-0.5 my-1 text-sm">{items}</ul>)
    } else if (/^\d+\.\s/.test(line)) {
      const items: React.ReactNode[] = []
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) { items.push(<li key={i}>{renderInline(lines[i].replace(/^\d+\.\s/, ''))}</li>); i++ }
      elements.push(<ol key={`ol-${i}`} className="list-decimal list-outside ml-4 space-y-0.5 my-1 text-sm">{items}</ol>)
    } else if (line.trim() === '') { if (elements.length > 0) elements.push(<div key={i} className="h-1.5" />); i++ }
    else { elements.push(<p key={i} className="text-sm leading-relaxed">{renderInline(line)}</p>); i++ }
  }
  return <div className="space-y-0.5">{elements}</div>
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user'
  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0 mt-0.5 ${
        isUser ? 'bg-slate-700 text-white font-bold' : 'bg-gradient-to-br from-slate-600 to-blue-700 text-white'
      }`}>
        {isUser ? 'A' : '🛡️'}
      </div>
      <div className={`max-w-[78%] ${isUser ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
        {!isUser && message.thinking && message.thinking.length > 0 && (
          <div className="flex flex-col gap-1 mb-1">
            {message.thinking.map((step, idx) => (
              <div key={idx} className="flex items-center gap-2 text-xs text-gray-400">
                <span className="text-green-500">✓</span>
                <span className="italic">{step.description}</span>
              </div>
            ))}
          </div>
        )}
        <div className={`rounded-2xl px-4 py-3 ${
          isUser
            ? 'bg-slate-700 text-white rounded-tr-sm'
            : 'bg-white border border-gray-200 text-gray-800 rounded-tl-sm shadow-sm'
        }`}>
          {isUser
            ? <p className="text-sm">{message.content}</p>
            : <div className="text-gray-700"><MarkdownContent text={message.content} />{message.isStreaming && <span className="inline-block w-0.5 h-4 bg-slate-500 ml-0.5 align-middle animate-pulse" />}</div>
          }
        </div>
      </div>
    </div>
  )
}

const STARTER_PROMPTS = [
  { icon: '📋', label: 'Show pending items',         text: "What needs my attention today?" },
  { icon: '✅', label: 'Approve a quotation',         text: "Approve QT-2026-0001" },
  { icon: '👤', label: 'Check account requests',      text: "Show me pending account requests" },
  { icon: '❌', label: 'Reject with reason',           text: "Reject QT-2026-0001, reason: pricing too low" },
]

export default function AdminAgentPage() {
  const [messages,  setMessages]  = useState<Message[]>([])
  const [input,     setInput]     = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error,     setError]     = useState<string | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef       = useRef<HTMLTextAreaElement>(null)
  const abortRef       = useRef<AbortController | null>(null)

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return

    const userMsg: Message = { role: 'user', content: text.trim() }
    const history = [...messages, userMsg]
    setMessages(history)
    setInput('')
    setIsLoading(true)
    setError(null)

    const assistantMsg: Message = { role: 'assistant', content: '', thinking: [], isStreaming: true }
    setMessages([...history, assistantMsg])

    abortRef.current = new AbortController()

    try {
      const res = await fetch('/api/agents/admin/chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          messages:   messages.map(m => ({ role: m.role, content: m.content })),
          newMessage: text.trim(),
        }),
        signal: abortRef.current.signal,
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }

      const reader  = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer    = ''
      let thinking: ThinkingStep[] = []
      let fullText  = ''

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const json = line.slice(6).trim()
          if (!json) continue
          const evt = JSON.parse(json) as
            | { type: 'thinking'; tool: string; description: string }
            | { type: 'text'; text: string }
            | { type: 'done' }
            | { type: 'error'; message: string }

          if (evt.type === 'thinking') {
            thinking = [...thinking, { tool: evt.tool, description: evt.description }]
            setMessages(prev => { const next = [...prev]; const last = next[next.length - 1]; if (last.role === 'assistant') next[next.length - 1] = { ...last, thinking }; return next })
          } else if (evt.type === 'text') {
            fullText = evt.text
            setMessages(prev => { const next = [...prev]; const last = next[next.length - 1]; if (last.role === 'assistant') next[next.length - 1] = { ...last, content: fullText, thinking, isStreaming: true }; return next })
          } else if (evt.type === 'done') {
            setMessages(prev => { const next = [...prev]; const last = next[next.length - 1]; if (last.role === 'assistant') next[next.length - 1] = { ...last, content: fullText, thinking, isStreaming: false }; return next })
          } else if (evt.type === 'error') {
            throw new Error(evt.message)
          }
        }
      }
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') return
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setMessages(prev => prev.filter(m => !(m.role === 'assistant' && m.content === '' && m.isStreaming)))
    } finally {
      setIsLoading(false)
      abortRef.current = null
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [messages, isLoading])

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendMessage(input) }
  }

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <Topbar
        title="Admin AI Agent"
        actions={
          messages.length > 0
            ? <button onClick={() => { setMessages([]); setError(null) }} className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">New conversation</button>
            : undefined
        }
      />

      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="max-w-2xl mx-auto px-4 py-12">
            <div className="text-center mb-10">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-slate-600 to-blue-700 text-white text-3xl flex items-center justify-center mx-auto mb-4 shadow-lg">
                🛡️
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Admin AI Agent</h2>
              <p className="text-gray-500 text-sm max-w-md mx-auto">
                Your approval assistant. Review pending quotations, approve or reject
                account requests, and keep operations moving.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {STARTER_PROMPTS.map(prompt => (
                <button key={prompt.label} onClick={() => void sendMessage(prompt.text)}
                  className="flex items-start gap-3 p-4 bg-white border border-gray-200 rounded-xl text-left hover:border-slate-400 hover:bg-slate-50/30 transition-all group">
                  <span className="text-xl shrink-0 mt-0.5">{prompt.icon}</span>
                  <div>
                    <p className="text-sm font-semibold text-gray-800 group-hover:text-slate-700">{prompt.label}</p>
                    <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{prompt.text.slice(0, 60)}…</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
            {messages.map((msg, i) => <MessageBubble key={i} message={msg} />)}
            {isLoading && messages[messages.length - 1]?.role === 'assistant' && messages[messages.length - 1]?.content === '' && (messages[messages.length - 1]?.thinking?.length ?? 0) === 0 && (
              <div className="flex gap-3 pl-11">
                <div className="flex items-center gap-1.5 text-gray-400 text-sm">
                  <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:0ms]" />
                  <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:300ms]" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {error && (
        <div className="max-w-2xl mx-auto w-full px-4 mb-2">
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-sm text-red-700 flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-3 text-red-400 hover:text-red-600">✕</button>
          </div>
        </div>
      )}

      <div className="border-t border-gray-200 bg-white px-4 py-3">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-end gap-2 bg-gray-50 border border-gray-200 rounded-2xl px-4 py-2 focus-within:border-slate-400 focus-within:ring-2 focus-within:ring-slate-100 transition-all">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder='Ask about pending approvals, type "approve QT-2026-XXXX", or "reject with reason: ..."'
              rows={1}
              className="flex-1 resize-none bg-transparent text-sm text-gray-900 placeholder-gray-400 focus:outline-none leading-relaxed max-h-32 py-1"
              style={{ minHeight: '24px' }}
              disabled={isLoading}
            />
            {isLoading ? (
              <button onClick={() => { abortRef.current?.abort(); setIsLoading(false); setMessages(prev => prev.filter(m => !(m.role === 'assistant' && m.content === '' && m.isStreaming))) }}
                className="p-2 rounded-xl bg-red-500 text-white hover:bg-red-600 transition-colors shrink-0">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
              </button>
            ) : (
              <button onClick={() => void sendMessage(input)} disabled={!input.trim()}
                className="p-2 rounded-xl bg-slate-700 text-white hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors shrink-0">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m0 0l-7 7m7-7l7 7" /></svg>
              </button>
            )}
          </div>
          <p className="text-center text-xs text-gray-300 mt-2">Enter to send · Shift+Enter for new line</p>
        </div>
      </div>
    </div>
  )
}
