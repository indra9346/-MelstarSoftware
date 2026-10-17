/** Form fields bound to a useForm() instance: label, required marker, inline error, value + onChange. */
import type { InputHTMLAttributes, ReactNode } from 'react'
import { Field, Input, Select, Switch, Textarea, type Option } from '@/components/ui'
import type { FormApi } from './form'
import { NumInput } from './kit'

type StrKeys<T> = { [K in keyof T]: T[K] extends string ? K : never }[keyof T]
interface Base<T> {
  f: FormApi<T>
  k: StrKeys<T>
  label: ReactNode
  required?: boolean
  hint?: ReactNode
  className?: string
}

function bind<T>(f: FormApi<T>, k: StrKeys<T>) {
  return {
    value: String(f.v[k] ?? ''),
    onChange: (e: { target: { value: string } }) => f.set(k, e.target.value as T[StrKeys<T>]),
    invalid: !!f.err(k),
  }
}

export function TextF<T>({ f, k, label, required, hint, className, ...rest }: Base<T> & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { leading?: ReactNode }) {
  return (
    <Field label={label} required={required} hint={hint} error={f.err(k)} className={className}>
      <Input {...bind(f, k)} {...rest} />
    </Field>
  )
}

export function NumF<T>({ f, k, label, required, hint, className, ...rest }: Base<T> & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { leading?: ReactNode }) {
  return (
    <Field label={label} required={required} hint={hint} error={f.err(k)} className={className}>
      <NumInput {...bind(f, k)} {...rest} />
    </Field>
  )
}

export function DateF<T>({ f, k, label, required, hint, className, min, max, type = 'date' }: Base<T> & { min?: string; max?: string; type?: 'date' | 'datetime-local' | 'time' }) {
  return (
    <Field label={label} required={required} hint={hint} error={f.err(k)} className={className}>
      <Input type={type} {...bind(f, k)} min={min} max={max} />
    </Field>
  )
}

export function AreaF<T>({ f, k, label, required, hint, className, rows = 3, placeholder }: Base<T> & { rows?: number; placeholder?: string }) {
  return (
    <Field label={label} required={required} hint={hint} error={f.err(k)} className={className}>
      <Textarea {...bind(f, k)} rows={rows} placeholder={placeholder} />
    </Field>
  )
}

export function SelectF<T>({ f, k, label, required, hint, className, options, placeholder, disabled }: Base<T> & { options: Option[]; placeholder?: string; disabled?: boolean }) {
  return (
    <Field label={label} required={required} hint={hint} error={f.err(k)} className={className}>
      <Select {...bind(f, k)} options={options} placeholder={placeholder} disabled={disabled} />
    </Field>
  )
}

type BoolKeys<T> = { [K in keyof T]: T[K] extends boolean ? K : never }[keyof T]
export function SwitchF<T>({ f, k, label, description, className }: { f: FormApi<T>; k: BoolKeys<T>; label: ReactNode; description?: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Switch checked={!!f.v[k]} onChange={(v) => f.set(k, v as T[BoolKeys<T>])} label={label} description={description} />
    </div>
  )
}
