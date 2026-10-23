import { useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Check, Copy, Eye, EyeOff, Plus, RefreshCw, X } from 'lucide-react'
import { Input, toast } from '@/components/ui'
import { cn } from '@/lib/misc'
import { SWATCHES, generatePassword, passwordStrength } from '@/services/hr'

/* ── Chips (skills, sectors, other directorships …) ─────────────────────────── */

export function ChipsInput({
  value, onChange, placeholder = 'Type and press Enter', max = 25, maxLen = 40, invalid, onBlur, id,
}: {
  value: string[]
  onChange: (v: string[]) => void
  placeholder?: string
  max?: number
  maxLen?: number
  invalid?: boolean
  onBlur?: () => void
  id?: string
}) {
  const [text, setText] = useState('')
  const ref = useRef<HTMLInputElement>(null)

  const add = (raw: string) => {
    const parts = raw.split(/[,\n;]/).map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean)
    setText('')
    if (!parts.length) return
    const next = [...value]
    for (const p of parts) {
      const v = p.slice(0, maxLen)
      if (next.length >= max) {
        toast.warning(`Up to ${max} items`)
        break
      }
      if (!next.some((x) => x.toLowerCase() === v.toLowerCase())) next.push(v)
    }
    onChange(next)
  }

  return (
    <div
      onClick={() => ref.current?.focus()}
      aria-invalid={invalid || undefined}
      className={cn(
        'flex min-h-[46px] w-full min-w-0 cursor-text flex-wrap items-center gap-1.5 rounded-md border bg-white px-2.5 py-2 transition-[border-color,box-shadow] duration-200 focus-within:ring-4',
        invalid ? 'border-rose-400 focus-within:ring-rose-500/15' : 'border-brand-200/70 focus-within:border-brand-600 focus-within:ring-brand-500/15',
      )}
    >
      <AnimatePresence initial={false}>
        {value.map((v) => (
          <span
            key={v}
            className="inline-flex max-w-full items-center gap-1 rounded-full bg-brand-50 py-0.5 pl-2.5 pr-1 text-[12.5px] font-medium text-brand-700 ring-1 ring-inset ring-brand-200/70"
          >
            <span className="truncate">{v}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onChange(value.filter((x) => x !== v))
              }}
              className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-brand-500 hover:bg-brand-100 hover:text-brand-800"
              aria-label={`Remove ${v}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </AnimatePresence>
      <input
        id={id}
        ref={ref}
        value={text}
        onChange={(e) => {
          const v = e.target.value
          if (/[,;\n]/.test(v)) add(v)
          else setText(v)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            add(text)
          } else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1))
        }}
        onBlur={() => {
          if (text.trim()) add(text)
          onBlur?.()
        }}
        placeholder={value.length ? '' : placeholder}
        className="min-w-[7rem] flex-1 border-0 bg-transparent px-1 py-0.5 text-[15px] text-ink outline-none placeholder:text-ink-faint focus:outline-none"
        style={{ outline: 'none' }}
      />
      {text.trim() && (
        <button type="button" onClick={() => add(text)} className="grid h-6 w-6 place-items-center rounded-md text-brand-600 hover:bg-brand-50" aria-label="Add">
          <Plus className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}

/* ── Number input that allows an empty value (null) while typing ───────────── */

export function NumberInput({
  value, onChange, ...rest
}: { value: number | null; onChange: (v: number | null) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & { invalid?: boolean; leading?: ReactNode }) {
  const [text, setText] = useState(value == null ? '' : String(value))
  useEffect(() => {
    const n = Number(text)
    const parsed = text.trim() === '' || !Number.isFinite(n) ? null : n
    if (parsed !== value) setText(value == null ? '' : String(value))
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Input
      type="number"
      inputMode="decimal"
      value={text}
      onChange={(e) => {
        const t = e.target.value
        setText(t)
        const n = Number(t)
        onChange(t.trim() === '' || !Number.isFinite(n) ? null : n)
      }}
      {...rest}
    />
  )
}

/* ── Password with show/hide, generate, copy and a strength meter ──────────── */

export function PasswordField({
  value, onChange, generate, autoComplete = 'new-password', invalid, placeholder, onBlur, id,
}: {
  value: string
  onChange: (v: string) => void
  generate?: boolean
  autoComplete?: string
  invalid?: boolean
  placeholder?: string
  onBlur?: () => void
  id?: string
}) {
  const [show, setShow] = useState(false)
  const [copied, setCopied] = useState(false)
  const st = passwordStrength(value)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch {
      toast.error('Copy is blocked by the browser', 'Select the password and copy it manually.')
    }
  }
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 gap-2">
        <div className="relative min-w-0 flex-1">
          <Input
            id={id}
            type={show ? 'text' : 'password'}
            autoComplete={autoComplete}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
            invalid={invalid}
            placeholder={placeholder ?? 'At least 8 characters'}
            className={cn('font-mono', value && 'pr-[4.5rem]')}
            spellCheck={false}
          />
          <div className="absolute inset-y-0 right-1.5 flex items-center gap-0.5">
            {value && (
              <button type="button" onClick={() => void copy()} className="grid h-8 w-8 place-items-center rounded-md text-ink-faint hover:bg-brand-50 hover:text-ink" aria-label="Copy password" title="Copy">
                {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
              </button>
            )}
            <button type="button" onClick={() => setShow((s) => !s)} className="grid h-8 w-8 place-items-center rounded-md text-ink-faint hover:bg-brand-50 hover:text-ink" aria-label={show ? 'Hide password' : 'Show password'}>
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        {generate && (
          <button
            type="button"
            onClick={() => {
              onChange(generatePassword(14))
              setShow(true)
            }}
            className="inline-flex h-[46px] shrink-0 items-center gap-1.5 rounded-md border border-brand-200/80 bg-white px-3 text-[13px] font-medium text-brand-600 transition hover:border-line-strong hover:bg-brand-50"
            title="Generate a strong password"
          >
            <RefreshCw className="h-4 w-4" />
            <span className="hidden xs:inline">Generate</span>
          </button>
        )}
      </div>
      <div className="mt-2 flex items-center gap-2.5" aria-live="polite">
        <div className="grid flex-1 grid-cols-4 gap-1">
          {[1, 2, 3, 4].map((i) => (
            <span key={i} className="h-1.5 overflow-hidden rounded-full bg-slate-200/80">
              <span className="block h-full rounded-full transition-[width] duration-200" style={{ width: value && st.score >= i ? '100%' : '0%', backgroundColor: st.color }} />
            </span>
          ))}
        </div>
        <span className="w-16 shrink-0 text-right text-[11.5px] font-semibold" style={{ color: value ? st.color : '#8a93a5' }}>
          {value ? st.label : 'Strength'}
        </span>
      </div>
    </div>
  )
}

/* ── Colour swatches + custom picker ───────────────────────────────────────── */

export function ColorPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {SWATCHES.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={cn('grid h-8 w-8 place-items-center rounded-full ring-offset-2 transition', value.toLowerCase() === c ? 'ring-2 ring-ink' : '')}
          style={{ background: c }}
          aria-label={`Colour ${c}`}
          aria-pressed={value.toLowerCase() === c}
        >
          {value.toLowerCase() === c && <Check className="h-4 w-4 text-white" />}
        </button>
      ))}
      <label className="relative grid h-8 w-8 cursor-pointer place-items-center overflow-hidden rounded-full border border-dashed border-brand-300 bg-white text-ink-soft" title="Custom colour">
        <Plus className="h-4 w-4" />
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#2a56a1'} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Custom colour" />
      </label>
    </div>
  )
}

/** Small coloured chip, e.g. a department. */
export function ColorChip({ color, children, className }: { color: string; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn('inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-medium', className)}
      style={{ background: `${color}17`, color, boxShadow: `inset 0 0 0 1px ${color}33` }}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
      <span className="truncate">{children}</span>
    </span>
  )
}
