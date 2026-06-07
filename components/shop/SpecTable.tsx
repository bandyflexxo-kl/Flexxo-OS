/**
 * SpecTable — product specification key-value table.
 *
 * Condition 22: must show SKU, unit, brand, category on every product.
 * Null/empty values are automatically hidden.
 */

type Spec = {
  label: string
  value: string | number | null | undefined
  mono?:  boolean  // render value in monospace (for codes/SKUs)
}

export default function SpecTable({ specs }: { specs: Spec[] }) {
  const visible = specs.filter(s => s.value !== null && s.value !== undefined && String(s.value).trim() !== '')
  if (visible.length === 0) return null

  return (
    <div className="border border-gray-100 rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <tbody>
          {visible.map(({ label, value, mono }, i) => (
            <tr
              key={label}
              className={i % 2 === 0 ? 'bg-gray-50/50' : 'bg-white'}
            >
              <td className="py-2.5 pl-4 pr-3 text-xs font-semibold text-gray-400 uppercase tracking-wide w-2/5 align-top">
                {label}
              </td>
              <td className={`py-2.5 pr-4 text-sm text-gray-800 align-top ${mono ? 'font-mono text-xs' : ''}`}>
                {String(value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
