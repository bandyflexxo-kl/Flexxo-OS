'use client'

import { useRef, useTransition, useCallback } from 'react'
import { useRouter, useSearchParams }          from 'next/navigation'

type Props = {
  industries:    string[]
  currentQ?:     string
  currentStatus?:string
  currentIndustry?: string
  currentTemp?:  string
}

const STATUSES     = ['Lead','Contacted','Active Customer','Inactive','Lost','Dormant']
const TEMPERATURES = ['Cold','Warm','Hot']

export default function CompaniesFilterBar({
  industries,
  currentQ,
  currentStatus,
  currentIndustry,
  currentTemp,
}: Props) {
  const router        = useRouter()
  const searchParams  = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Build a new URL preserving sort, replacing filters
  function buildUrl(overrides: Record<string, string | undefined>) {
    const params = new URLSearchParams()
    // keep existing sort state
    const sort = searchParams.get('sort')
    const dir  = searchParams.get('dir')
    if (sort) params.set('sort', sort)
    if (dir)  params.set('dir', dir)
    // merge current + overrides
    const merged: Record<string, string | undefined> = {
      q:                currentQ,
      status:           currentStatus,
      industry:         currentIndustry,
      leadTemperature:  currentTemp,
      ...overrides,
    }
    Object.entries(merged).forEach(([k, v]) => { if (v) params.set(k, v) })
    return `/companies?${params.toString()}`
  }

  function navigate(url: string) {
    startTransition(() => router.push(url, { scroll: false }))
  }

  // Debounced text search
  const handleSearchChange = useCallback((value: string) => {
    clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => {
      navigate(buildUrl({ q: value || undefined }))
    }, 300)
  }, [currentStatus, currentIndustry, currentTemp]) // eslint-disable-line react-hooks/exhaustive-deps

  // Immediate select changes
  function handleSelectChange(key: string, value: string) {
    navigate(buildUrl({ [key]: value || undefined }))
  }

  // Active filter count (excluding q)
  const activeFilters = [currentStatus, currentIndustry, currentTemp].filter(Boolean).length

  return (
    <div className="space-y-3 mb-6">
      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-2">

        {/* Search input */}
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 111 11a6 6 0 0116 0z"/>
          </svg>
          <input
            defaultValue={currentQ}
            onChange={e => handleSearchChange(e.target.value)}
            placeholder="Search companies…"
            className="pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50 bg-white w-52 transition-all"
          />
        </div>

        {/* Status */}
        <select
          defaultValue={currentStatus ?? ''}
          onChange={e => handleSelectChange('status', e.target.value)}
          className={`px-3 py-2 border rounded-lg text-sm bg-white outline-none focus:border-blue-400 transition-colors cursor-pointer ${
            currentStatus ? 'border-blue-300 text-blue-700 bg-blue-50' : 'border-gray-200 text-gray-600'
          }`}
        >
          <option value="">All Statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        {/* Industry */}
        <select
          defaultValue={currentIndustry ?? ''}
          onChange={e => handleSelectChange('industry', e.target.value)}
          className={`px-3 py-2 border rounded-lg text-sm bg-white outline-none focus:border-blue-400 transition-colors cursor-pointer ${
            currentIndustry ? 'border-blue-300 text-blue-700 bg-blue-50' : 'border-gray-200 text-gray-600'
          }`}
        >
          <option value="">All Industries</option>
          {industries.map(i => <option key={i} value={i}>{i}</option>)}
        </select>

        {/* Temperature */}
        <select
          defaultValue={currentTemp ?? ''}
          onChange={e => handleSelectChange('leadTemperature', e.target.value)}
          className={`px-3 py-2 border rounded-lg text-sm bg-white outline-none focus:border-blue-400 transition-colors cursor-pointer ${
            currentTemp ? 'border-blue-300 text-blue-700 bg-blue-50' : 'border-gray-200 text-gray-600'
          }`}
        >
          <option value="">All Temps</option>
          {TEMPERATURES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>

        {/* Loading spinner */}
        {isPending && (
          <span className="w-4 h-4 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
        )}

        {/* Clear filters */}
        {(currentQ || activeFilters > 0) && !isPending && (
          <button
            onClick={() => navigate('/companies')}
            className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5 rounded-lg hover:bg-gray-100 transition-colors flex items-center gap-1"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
            </svg>
            Clear{activeFilters > 0 ? ` (${activeFilters})` : ''}
          </button>
        )}
      </div>

      {/* Active filter chips */}
      {activeFilters > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {currentStatus && (
            <span className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2.5 py-1 rounded-full font-medium">
              Status: {currentStatus}
              <button
                onClick={() => navigate(buildUrl({ status: undefined }))}
                className="ml-0.5 text-blue-400 hover:text-blue-700 transition-colors leading-none text-sm"
              >
                ×
              </button>
            </span>
          )}
          {currentIndustry && (
            <span className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2.5 py-1 rounded-full font-medium">
              Industry: {currentIndustry}
              <button
                onClick={() => navigate(buildUrl({ industry: undefined }))}
                className="ml-0.5 text-blue-400 hover:text-blue-700 transition-colors leading-none text-sm"
              >
                ×
              </button>
            </span>
          )}
          {currentTemp && (
            <span className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium border ${
              currentTemp === 'Hot'  ? 'bg-red-50 text-red-700 border-red-200' :
              currentTemp === 'Warm' ? 'bg-orange-50 text-orange-700 border-orange-200' :
                                       'bg-blue-50 text-blue-700 border-blue-200'
            }`}>
              {currentTemp === 'Hot' ? '🔥' : currentTemp === 'Warm' ? '☀️' : '❄️'} {currentTemp}
              <button
                onClick={() => navigate(buildUrl({ leadTemperature: undefined }))}
                className="ml-0.5 opacity-60 hover:opacity-100 transition-opacity leading-none text-sm"
              >
                ×
              </button>
            </span>
          )}
        </div>
      )}
    </div>
  )
}
