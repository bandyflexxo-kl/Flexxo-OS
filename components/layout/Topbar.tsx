interface TopbarProps {
  title: string
  actions?: React.ReactNode
}

export default function Topbar({ title, actions }: TopbarProps) {
  return (
    <div className="flex items-center justify-between px-4 sm:px-6 lg:px-8 py-4 border-b border-gray-200 bg-white">
      <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
  )
}
