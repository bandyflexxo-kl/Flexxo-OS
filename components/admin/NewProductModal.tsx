'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { buildStockCode } from '@/lib/stockCodeGen'

export type ShopCategoryOption = { id: string; name: string; parentName: string | null }

type Masters = {
  brands:     { classCode: string;    description: string | null }[]
  categories: { categoryCode: string; description: string | null }[]
  groups:     { groupCode: string;    description: string | null }[]
  uoms?:      string[]
}
type DuplicateReport = {
  codeInQne: boolean
  codeInCrm: boolean
  similarNames: { name: string; qneItemCode: string | null; score: number }[]
}
type ExtraUom = { uomCode: string; rate: string; salesPrice: string; purchasePrice: string; barCode: string }

const blankUom = (): ExtraUom => ({ uomCode: '', rate: '', salesPrice: '', purchasePrice: '', barCode: '' })

export default function NewProductModal({
  shopCategories,
  onClose,
  onCreated,
}: {
  shopCategories: ShopCategoryOption[]
  onClose:        () => void
  onCreated:      () => void
}) {
  // ── master data ────────────────────────────────────────────────
  const [masters,       setMasters]       = useState<Masters | null>(null)
  const [mastersError,  setMastersError]  = useState<string | null>(null)
  const [loadingMasters,setLoadingMasters]= useState(true)

  // ── form state ─────────────────────────────────────────────────
  const [supplierModel, setSupplierModel] = useState('')  // admin-typed; code = [BRAND]-[model]
  const [brand,      setBrand]      = useState('')   // QNE classCode
  const [category,   setCategory]   = useState('')   // QNE categoryCode
  const [group,      setGroup]      = useState('')   // QNE groupCode
  const [shopCatId,  setShopCatId]  = useState('')

  // guided name builder parts (brand + code are reused from above)
  const [nbDesc,     setNbDesc]     = useState('')
  const [nbIdentity, setNbIdentity] = useState('')
  const [nbSize,     setNbSize]     = useState('')
  const [nbColor,    setNbColor]    = useState('')
  const [nbPacking,  setNbPacking]  = useState('')

  const [baseUOM,    setBaseUOM]    = useState('')
  const [listPrice,  setListPrice]  = useState('')
  const [purchPrice, setPurchPrice] = useState('')
  const [minPrice,   setMinPrice]   = useState('')
  const [barcode,    setBarcode]    = useState('')
  const [description,setDescription]= useState('')
  const [remarks,    setRemarks]    = useState('')
  const [extraUoms,  setExtraUoms]  = useState<ExtraUom[]>([])

  // ── duplicate check ────────────────────────────────────────────
  const [dup,        setDup]        = useState<DuplicateReport | null>(null)
  const [checkingDup,setCheckingDup]= useState(false)

  // ── submit / push ──────────────────────────────────────────────
  const [errors,     setErrors]     = useState<Record<string, string[]>>({})
  const [formError,  setFormError]  = useState<string | null>(null)
  const [saving,     setSaving]     = useState(false)
  const [savedId,    setSavedId]    = useState<string | null>(null)
  const [savedCode,  setSavedCode]  = useState<string>('')
  const [pushing,    setPushing]    = useState(false)
  const [pushMsg,    setPushMsg]    = useState<string | null>(null)
  const [pushDone,   setPushDone]   = useState(false)

  // Code = [BRAND]-[supplier model], built live (same helper the server uses).
  const autoCode = useMemo(
    () => (brand && supplierModel.trim() ? buildStockCode(brand, supplierModel) : ''),
    [brand, supplierModel],
  )

  // assembled QNE stock name (SOP order)
  const stockName = useMemo(() =>
    [brand, autoCode, nbDesc, nbIdentity, nbSize, nbColor, nbPacking]
      .map(s => s.trim()).filter(Boolean).join(' / '),
    [brand, autoCode, nbDesc, nbIdentity, nbSize, nbColor, nbPacking],
  )

  useEffect(() => {
    let alive = true
    fetch('/api/admin/qne/stock-masters')
      .then(async r => {
        const body = await r.json()
        if (!r.ok) throw new Error(body.error || 'Failed to load QNE master data')
        return body as Masters
      })
      .then(m => { if (alive) setMasters(m) })
      .catch(e => { if (alive) setMastersError(e.message) })
      .finally(() => { if (alive) setLoadingMasters(false) })
    return () => { alive = false }
  }, [])

  // debounced duplicate check on code/name change
  const dupTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (savedId) return
    if (autoCode.trim().length < 1 && stockName.trim().length < 3) { setDup(null); return }
    if (dupTimer.current) clearTimeout(dupTimer.current)
    dupTimer.current = setTimeout(async () => {
      setCheckingDup(true)
      try {
        const qs = new URLSearchParams({ code: autoCode.trim(), name: stockName.trim() })
        const r = await fetch(`/api/admin/products/check-duplicate?${qs}`)
        const body = await r.json()
        if (r.ok) setDup(body as DuplicateReport)
      } catch { /* ignore — non-blocking hint */ }
      finally { setCheckingDup(false) }
    }, 500)
    return () => { if (dupTimer.current) clearTimeout(dupTimer.current) }
  }, [autoCode, stockName, savedId])

  const addMaster = useCallback(async (type: 'brand' | 'category' | 'group') => {
    const code = window.prompt(`New QNE ${type} code (this WRITES to QNE):`)?.trim()
    if (!code) return
    const r = await fetch('/api/admin/qne/stock-masters', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ type, code }),
    })
    const body = await r.json()
    if (!r.ok) { alert(body.error ? JSON.stringify(body.error) : 'Failed to add'); return }
    setMasters(prev => {
      if (!prev) return prev
      if (type === 'brand')    return { ...prev, brands:     [...prev.brands,     { classCode: code, description: code }].sort((a,b)=>a.classCode.localeCompare(b.classCode)) }
      if (type === 'category') return { ...prev, categories: [...prev.categories, { categoryCode: code, description: code }].sort((a,b)=>a.categoryCode.localeCompare(b.categoryCode)) }
      return { ...prev, groups: [...prev.groups, { groupCode: code, description: code }].sort((a,b)=>a.groupCode.localeCompare(b.groupCode)) }
    })
    if (type === 'brand') setBrand(code)
    else if (type === 'category') setCategory(code)
    else setGroup(code)
  }, [])

  const groupedShopCats = useMemo(() => {
    const m = new Map<string, ShopCategoryOption[]>()
    for (const c of shopCategories) {
      const key = c.parentName ?? 'Other'
      if (!m.has(key)) m.set(key, [])
      m.get(key)!.push(c)
    }
    return [...m.entries()]
  }, [shopCategories])

  async function handleSave(acknowledgeDuplicate = false) {
    setErrors({}); setFormError(null); setSaving(true)
    const payload = {
      supplierModel: supplierModel.trim(),
      nameDescription: nbDesc.trim(),
      ...(nbIdentity.trim() ? { nameIdentity: nbIdentity.trim() } : {}),
      ...(nbSize.trim()     ? { nameSize:     nbSize.trim() } : {}),
      ...(nbColor.trim()    ? { nameColor:    nbColor.trim() } : {}),
      ...(nbPacking.trim()  ? { namePacking:  nbPacking.trim() } : {}),
      baseUOM: baseUOM.trim(),
      category, group, brand,
      shopCategoryId: shopCatId,
      listPrice:     Number(listPrice),
      purchasePrice: Number(purchPrice),
      ...(minPrice.trim()    ? { minPrice: Number(minPrice) } : {}),
      ...(barcode.trim()     ? { barcode: barcode.trim() } : {}),
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(remarks.trim()     ? { remarks: remarks.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 5) } : {}),
      ...(extraUoms.length   ? { extraUoms: extraUoms
            .filter(u => u.uomCode.trim() && u.rate.trim())
            .map(u => ({
              uomCode: u.uomCode.trim(),
              rate: Number(u.rate),
              ...(u.salesPrice.trim()    ? { salesPrice: Number(u.salesPrice) } : {}),
              ...(u.purchasePrice.trim() ? { purchasePrice: Number(u.purchasePrice) } : {}),
              ...(u.barCode.trim()       ? { barCode: u.barCode.trim() } : {}),
            })) } : {}),
      acknowledgeDuplicate,
    }
    try {
      const r = await fetch('/api/admin/products', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      const body = await r.json()
      if (r.status === 201) { setSavedId(body.product.id); setSavedCode(body.product.qneItemCode ?? ''); onCreated(); return }
      if (r.status === 409 && body.error === 'CODE_EXISTS_IN_QNE') {
        setDup(body.duplicate as DuplicateReport)
        setFormError('This code already exists in QNE. Review the match below, then confirm it is genuinely new to continue.')
        return
      }
      if (body.error && typeof body.error === 'object') setErrors(body.error as Record<string, string[]>)
      else setFormError(typeof body.error === 'string' ? body.error : 'Could not save the product.')
    } catch {
      setFormError('Network error — please retry.')
    } finally { setSaving(false) }
  }

  async function handlePush() {
    if (!savedId) return
    setPushing(true); setPushMsg(null)
    try {
      const r = await fetch(`/api/admin/products/${savedId}/push-to-qne`, { method: 'POST' })
      const body = await r.json()
      if (r.ok) { setPushDone(true); setPushMsg(`Pushed to QNE — stock code ${body.qneStockCode}.`); onCreated() }
      else setPushMsg(body.error || 'Push failed.')
    } catch { setPushMsg('Network error — please retry.') }
    finally { setPushing(false) }
  }

  const err = (k: string) => errors[k]?.[0]
  const field = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500'

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto py-8">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 my-auto">
        {/* header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">New Product (Stock Code)</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="px-6 py-5 space-y-6 max-h-[70vh] overflow-y-auto">
          {loadingMasters && <p className="text-sm text-gray-500">Loading QNE brands / categories / groups…</p>}
          {mastersError && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
              {mastersError} <br />Connect the Radmin VPN and reopen this form.
            </div>
          )}

          {savedId ? (
            /* ── post-save: push step ── */
            <div className="space-y-4">
              <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-800">
                ✓ Saved to CRM as <strong>{savedCode}</strong> (status: local only). It is not in QNE yet.
              </div>
              <p className="text-sm text-gray-600">
                The next step writes this item to QNE’s accounting system. This is the approval gate —
                click only when you are sure the details are correct.
              </p>
              {pushMsg && (
                <div className={`rounded-lg px-4 py-3 text-sm ${pushDone ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-800'}`}>
                  {pushMsg}
                </div>
              )}
              <div className="flex gap-3 justify-end">
                <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">
                  {pushDone ? 'Close' : 'Later'}
                </button>
                {!pushDone && (
                  <button onClick={handlePush} disabled={pushing}
                    className="px-4 py-2 text-sm rounded-lg bg-green-600 text-white font-medium hover:bg-green-700 disabled:opacity-50">
                    {pushing ? 'Pushing to QNE…' : 'Push to QNE →'}
                  </button>
                )}
              </div>
            </div>
          ) : (
            /* ── creation form ── */
            <>
              {/* Supplier model → builds the code [BRAND]-[model] (SOP) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Supplier model code <span className="text-red-500">*</span></label>
                <input value={supplierModel} onChange={e => setSupplierModel(e.target.value.toUpperCase())}
                  placeholder="e.g. CE320A" className={field} />
                {err('supplierModel') && <p className="text-xs text-red-600 mt-1">{err('supplierModel')}</p>}
                <div className="mt-2 flex items-center gap-2 text-sm">
                  <span className="text-gray-500">Stock code:</span>
                  <span className="font-mono font-semibold text-gray-900">
                    {autoCode || <span className="text-gray-400 font-sans font-normal">— pick a brand &amp; type the model —</span>}
                  </span>
                  <span className="text-xs text-gray-400">(auto: brand + model)</span>
                </div>
                {checkingDup && <p className="text-xs text-gray-400 mt-1">Checking for duplicates…</p>}
                {dup && (dup.codeInCrm || dup.codeInQne || dup.similarNames.length > 0) && (
                  <div className="mt-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800 space-y-1">
                    {dup.codeInCrm && <p>⚠ This code already exists in the CRM catalogue.</p>}
                    {dup.codeInQne && <p>⚠ This code already exists in QNE.</p>}
                    {dup.similarNames.length > 0 && (
                      <div>
                        <p className="font-medium">Similar existing products:</p>
                        <ul className="list-disc ml-4">
                          {dup.similarNames.map((s, i) => <li key={i}>{s.name}{s.qneItemCode ? ` (${s.qneItemCode})` : ''}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Guided name builder */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">Product name builder (SOP order)</label>
                <div className="grid grid-cols-2 gap-2">
                  <input value={nbDesc}     onChange={e => setNbDesc(e.target.value)}     placeholder="Description * (search keyword)" className={field} />
                  <input value={nbIdentity} onChange={e => setNbIdentity(e.target.value)} placeholder="Identity (e.g. Premium)"     className={field} />
                  <input value={nbSize}     onChange={e => setNbSize(e.target.value)}     placeholder="Size (A4 / L×W×H mm)"        className={field} />
                  <input value={nbColor}    onChange={e => setNbColor(e.target.value)}    placeholder="Color"                       className={field} />
                  <input value={nbPacking}  onChange={e => setNbPacking(e.target.value)}  placeholder="Packing (5rim/ctn)"          className={`${field} col-span-2`} />
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-600">
                  Preview: <span className="font-mono text-gray-900">{stockName || '— pick a brand & type a description —'}</span>
                </div>
                {err('nameDescription') && <p className="text-xs text-red-600">{err('nameDescription')}</p>}
              </div>

              {/* Taxonomy: brand / QNE category / QNE group */}
              <div className="grid grid-cols-1 gap-3">
                {([
                  ['Brand (QNE class)', brand, setBrand, masters?.brands.map(b => b.classCode) ?? [], 'brand', 'brand'],
                  ['QNE category',      category, setCategory, masters?.categories.map(c => c.categoryCode) ?? [], 'category', 'category'],
                  ['QNE group',         group, setGroup, masters?.groups.map(g => g.groupCode) ?? [], 'group', 'group'],
                ] as const).map(([label, val, set, opts, key, type]) => (
                  <div key={key}>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-sm font-medium text-gray-700">{label} <span className="text-red-500">*</span></label>
                      <button type="button" onClick={() => addMaster(type)} className="text-xs text-green-700 hover:underline">+ Add new</button>
                    </div>
                    <select value={val} onChange={e => set(e.target.value)} className={field}>
                      <option value="">— select —</option>
                      {opts.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                    {err(key) && <p className="text-xs text-red-600 mt-1">{err(key)}</p>}
                  </div>
                ))}
              </div>

              {/* Shop sub-category (CRM/website — separate from QNE) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Shop sub-category (website display) <span className="text-red-500">*</span></label>
                <select value={shopCatId} onChange={e => setShopCatId(e.target.value)} className={field}>
                  <option value="">— select —</option>
                  {groupedShopCats.map(([parent, subs]) => (
                    <optgroup key={parent} label={parent}>
                      {subs.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </optgroup>
                  ))}
                </select>
                {err('shopCategoryId') && <p className="text-xs text-red-600 mt-1">{err('shopCategoryId')}</p>}
              </div>

              {/* Prices + base UOM */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Base UOM <span className="text-red-500">*</span></label>
                  <input value={baseUOM} onChange={e => setBaseUOM(e.target.value.toUpperCase())} placeholder="e.g. RIM, PCS" list="uom-options" className={field} />
                  <datalist id="uom-options">
                    {(masters?.uoms ?? []).map(u => <option key={u} value={u} />)}
                  </datalist>
                  {err('baseUOM') && <p className="text-xs text-red-600 mt-1">{err('baseUOM')}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Selling price (RM) <span className="text-red-500">*</span></label>
                  <input value={listPrice} onChange={e => setListPrice(e.target.value)} inputMode="decimal" placeholder="12.50" className={field} />
                  {err('listPrice') && <p className="text-xs text-red-600 mt-1">{err('listPrice')}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Purchase price (RM) <span className="text-red-500">*</span></label>
                  <input value={purchPrice} onChange={e => setPurchPrice(e.target.value)} inputMode="decimal" placeholder="8.00" className={field} />
                  {err('purchasePrice') && <p className="text-xs text-red-600 mt-1">{err('purchasePrice')}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Min. selling price (RM)</label>
                  <input value={minPrice} onChange={e => setMinPrice(e.target.value)} inputMode="decimal" placeholder="optional" className={field} />
                  {err('minPrice') && <p className="text-xs text-red-600 mt-1">{err('minPrice')}</p>}
                </div>
              </div>

              {/* Optional: barcode, description, remarks */}
              <div className="grid grid-cols-1 gap-3">
                <input value={barcode} onChange={e => setBarcode(e.target.value)} placeholder="Barcode (optional)" className={field} />
                <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Catalogue description (optional)" rows={2} className={field} />
                <textarea value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="Specs / remarks — one per line, up to 5 (optional)" rows={2} className={field} />
              </div>

              {/* Optional: extra UOMs */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-sm font-medium text-gray-700">Additional units (optional)</label>
                  <button type="button" onClick={() => setExtraUoms(u => [...u, blankUom()])} className="text-xs text-green-700 hover:underline">+ Add unit</button>
                </div>
                {extraUoms.map((u, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 mb-2">
                    <input value={u.uomCode} onChange={e => setExtraUoms(arr => arr.map((x, j) => j === i ? { ...x, uomCode: e.target.value.toUpperCase() } : x))} placeholder="CTN" className={`${field} col-span-3`} />
                    <input value={u.rate} onChange={e => setExtraUoms(arr => arr.map((x, j) => j === i ? { ...x, rate: e.target.value } : x))} inputMode="decimal" placeholder="× base (60)" className={`${field} col-span-3`} />
                    <input value={u.salesPrice} onChange={e => setExtraUoms(arr => arr.map((x, j) => j === i ? { ...x, salesPrice: e.target.value } : x))} inputMode="decimal" placeholder="sell" className={`${field} col-span-2`} />
                    <input value={u.purchasePrice} onChange={e => setExtraUoms(arr => arr.map((x, j) => j === i ? { ...x, purchasePrice: e.target.value } : x))} inputMode="decimal" placeholder="cost" className={`${field} col-span-3`} />
                    <button type="button" onClick={() => setExtraUoms(arr => arr.filter((_, j) => j !== i))} className="col-span-1 text-gray-400 hover:text-red-600">×</button>
                  </div>
                ))}
              </div>

              {formError && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-800">{formError}</div>}
            </>
          )}
        </div>

        {/* footer (creation only) */}
        {!savedId && (
          <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-gray-200">
            <p className="text-xs text-gray-400">Saving stores the product in the CRM only — QNE is written in a separate, confirmed step.</p>
            <div className="flex gap-3">
              <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">Cancel</button>
              <button
                onClick={() => handleSave(!!dup?.codeInQne)}
                disabled={saving || loadingMasters}
                className="px-4 py-2 text-sm rounded-lg bg-green-600 text-white font-medium hover:bg-green-700 disabled:opacity-50">
                {saving ? 'Saving…' : 'Save to CRM'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
