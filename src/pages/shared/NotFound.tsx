import { Link } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { EmptyState } from '@/components/ui'

export default function NotFoundPage() {
  return (
    <EmptyState
      className="mx-auto mt-10 max-w-lg"
      icon={<Compass className="h-6 w-6" />}
      title="Page not found"
      description="The page you opened does not exist or has moved."
      action={<Link to="/" className="text-sm font-medium text-brand-600 hover:underline">Go to dashboard</Link>}
    />
  )
}
