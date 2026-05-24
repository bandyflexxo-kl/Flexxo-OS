type BadgeColor = 'gray' | 'blue' | 'green' | 'yellow' | 'red' | 'purple' | 'orange'

interface BadgeProps {
  children: React.ReactNode
  color?: BadgeColor
}

const colors: Record<BadgeColor, string> = {
  gray: 'bg-gray-100 text-gray-700',
  blue: 'bg-blue-100 text-blue-700',
  green: 'bg-green-100 text-green-700',
  yellow: 'bg-yellow-100 text-yellow-700',
  red: 'bg-red-100 text-red-700',
  purple: 'bg-purple-100 text-purple-700',
  orange: 'bg-orange-100 text-orange-700',
}

export function temperatureColor(temp: string | null | undefined): BadgeColor {
  if (temp === 'Hot') return 'red'
  if (temp === 'Warm') return 'orange'
  return 'blue'
}

export function statusColor(status: string | null | undefined): BadgeColor {
  if (status === 'Active Customer') return 'green'
  if (status === 'Lead') return 'blue'
  if (status === 'Lost' || status === 'Dormant') return 'gray'
  if (status === 'Inactive') return 'yellow'
  return 'gray'
}

export default function Badge({ children, color = 'gray' }: BadgeProps) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colors[color]}`}>
      {children}
    </span>
  )
}
