/** Small form + dialog helpers shared by the operations pages (machines, inventory, purchase, production, quality). */
import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toISODate } from '@/lib/dates'

export type Errors<T> = Partial<Record<keyof T, string | null | undefined>>

export interface FormApi<T> {
  v: T
  set: <K extends keyof T>(k: K, v: T[K]) => void
  patch: (p: Partial<T>) => void
  setValues: Dispatch<SetStateAction<T>>
  err: (k: keyof T) => string | null
  errors: Errors<T>
  valid: boolean
  firstError: string | null
  touchAll: () => void
}

/**
 * Form state with live validation.
 *  - `err(k)` shows a field's error once the user has touched it (or after `touchAll()`).
 *  - `valid` / `firstError` drive the disabled submit button and its hint.
 */
export function useForm<T extends object>(init: T | (() => T), validate: (v: T) => Errors<T>): FormApi<T> {
  const [values, setValues] = useState<T>(init)
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [all, setAll] = useState(false)
  const errors = validate(values)
  const set = useCallback(<K extends keyof T>(k: K, v: T[K]) => {
    setValues((p) => ({ ...p, [k]: v }))
    setTouched((t) => (t[k as string] ? t : { ...t, [k as string]: true }))
  }, [])
  const patch = useCallback((p: Partial<T>) => {
    setValues((prev) => ({ ...prev, ...p }))
    setTouched((t) => {
      const n = { ...t }
      for (const k of Object.keys(p)) n[k] = true
      return n
    })
  }, [])
  const err = (k: keyof T): string | null => (all || touched[k as string] ? errors[k] || null : null)
  const firstError = (Object.values(errors) as (string | null | undefined)[]).find((e) => !!e) ?? null
  return { v: values, set, patch, setValues, err, errors, valid: !firstError, firstError, touchAll: () => setAll(true) }
}

/**
 * Open/close state for a modal that carries a payload. `key` changes on every open, so
 * `<Form key={dlg.key} …/>` mounts fresh state each time while the close animation keeps the old content.
 */
export function useDialog<T = null>() {
  const [state, setState] = useState<{ open: boolean; data: T | null; key: number }>({ open: false, data: null, key: 0 })
  const show = useCallback((data?: T | null) => setState((s) => ({ open: true, data: data ?? null, key: s.key + 1 })), [])
  const close = useCallback(() => setState((s) => ({ ...s, open: false })), [])
  return { ...state, show, close }
}

/** Keeps the last non-null value (so drawers keep their content during the exit animation). */
export function useLast<T>(value: T | null | undefined): T | null {
  const ref = useRef<T | null>(null)
  if (value != null) ref.current = value
  return value ?? ref.current
}

/** A deep-link query param plus a function that removes it (replace, no history entry). */
export function useQueryParam(name: string): [string | null, (value?: string | null) => void] {
  const [params, setParams] = useSearchParams()
  const value = params.get(name)
  const set = useCallback(
    (v?: string | null) =>
      setParams(
        (p) => {
          const n = new URLSearchParams(p)
          if (v) n.set(name, v)
          else n.delete(name)
          return n
        },
        { replace: true },
      ),
    [name, setParams],
  )
  return [value, set]
}

/** '' → null, '1,234.5' → 1234.5; anything unparseable → null (validators then ask for a value). */
export function toNum(s: string | number | null | undefined): number | null {
  if (s == null) return null
  if (typeof s === 'number') return Number.isFinite(s) ? s : null
  const t = s.replace(/,/g, '').trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}
export const numStr = (n: number | null | undefined) => (n == null ? '' : String(n))

/** ISO timestamp ↔ <input type="datetime-local"> value (local time). */
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${toISODate(d)}T${p(d.getHours())}:${p(d.getMinutes())}`
}
export function localInputToIso(s: string): string | null {
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
export const nowLocalInput = () => isoToLocalInput(new Date().toISOString())
export const nowHHMM = () => {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
