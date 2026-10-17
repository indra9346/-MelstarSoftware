import { useEffect, useState } from 'react'

/** Current time, re-rendering every `ms` (default each second, aligned to the second). */
export function useNow(ms = 1000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>
    const tick = () => {
      setNow(new Date())
      t = setTimeout(tick, ms - (Date.now() % ms))
    }
    t = setTimeout(tick, ms - (Date.now() % ms))
    return () => clearTimeout(t)
  }, [ms])
  return now
}
