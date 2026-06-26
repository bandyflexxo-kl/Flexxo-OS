'use client'

import { BackgroundTasksProvider } from '@/context/BackgroundTasksContext'
import BottomTasksPanel            from '@/components/admin/BottomTasksPanel'
import type { ReactNode }          from 'react'

/**
 * Client-side wrapper for the dashboard layout.
 * Provides BackgroundTasksContext to all dashboard pages and renders
 * the unified BottomTasksPanel (photo tasks + sync jobs) at fixed bottom-right.
 */
export default function DashboardProviders({ children, role }: { children: ReactNode; role: string }) {
  return (
    <BackgroundTasksProvider role={role}>
      {children}
      <BottomTasksPanel />
    </BackgroundTasksProvider>
  )
}
