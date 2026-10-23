import { Check } from 'lucide-react'
import { cn } from '@/lib/misc'

/** Round checkbox used for to-dos and task checklists. */
export function CheckBubble({ checked, onChange, disabled, size = 22, label, className }: { checked: boolean; onChange?: () => void; disabled?: boolean; size?: number; label: string; className?: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onChange?.()
      }}
      className={cn(
        'grid shrink-0 place-items-center rounded-full border transition-colors outline-none disabled:cursor-not-allowed focus-visible:ring-[3px] focus-visible:ring-brand-500/25',
        checked ? 'border-emerald-600 bg-emerald-600 text-white' : disabled ? 'border-slate-200 bg-slate-50' : 'border-line-strong bg-white hover:border-brand-600',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {checked && <Check style={{ width: size * 0.62, height: size * 0.62 }} strokeWidth={3} aria-hidden />}
    </button>
  )
}
