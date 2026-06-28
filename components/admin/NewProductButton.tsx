'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import NewProductModal, { type ShopCategoryOption } from '@/components/admin/NewProductModal'

export default function NewProductButton({ shopCategories }: { shopCategories: ShopCategoryOption[] }) {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="px-4 py-2 text-sm rounded-lg bg-green-600 text-white font-medium hover:bg-green-700"
      >
        + New Product
      </button>
      {open && (
        <NewProductModal
          shopCategories={shopCategories}
          onClose={() => setOpen(false)}
          onCreated={() => router.refresh()}
        />
      )}
    </>
  )
}
