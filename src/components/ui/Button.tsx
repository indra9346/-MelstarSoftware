import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/misc'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'outline'
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm'

const variants: Record<ButtonVariant, string> = {
  primary:
    'btn-shine text-white bg-grad bg-[length:200%_auto] shadow-btn hover:bg-[position:100%_center] hover:shadow-[0_18px_40px_-12px_rgba(236,72,153,.5)]',
  secondary: 'bg-white/90 text-ink border border-indigo-200/80 hover:bg-white hover:border-indigo-300 shadow-sm',
  outline: 'bg-transparent text-brand-indigo border border-brand-indigo/40 hover:bg-indigo-50',
  ghost: 'bg-transparent text-ink-soft hover:bg-indigo-50 hover:text-ink',
  danger: 'bg-rose-500 text-white hover:bg-rose-600 shadow-[0_10px_24px_-10px_rgba(244,63,94,.7)]',
  success: 'bg-emerald-500 text-white hover:bg-emerald-600 shadow-[0_10px_24px_-10px_rgba(16,185,129,.7)]',
}
const sizes: Record<ButtonSize, string> = {
  sm: 'h-9 px-3.5 text-[13px] gap-1.5 rounded-xl',
  md: 'h-11 px-5 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-6 text-[15px] gap-2 rounded-2xl',
  icon: 'h-10 w-10 rounded-xl',
  'icon-sm': 'h-8 w-8 rounded-lg',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: ReactNode
}

/** Brand button. `variant="primary"` = cyan→indigo→pink gradient with a light sweep on hover. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex select-none items-center justify-center whitespace-nowrap font-semibold transition-all duration-300 ease-brand active:scale-[.97] disabled:cursor-not-allowed disabled:opacity-55 disabled:active:scale-100 disabled:hover:shadow-none',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  )
})
