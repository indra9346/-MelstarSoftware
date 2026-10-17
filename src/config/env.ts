/**
 * Data-mode switch.
 *
 * Static mode (default) keeps every table in this browser's IndexedDB, seeded with demo data.
 * Supabase mode is enabled by setting VITE_STATIC_DATA_MODE=false plus the two Supabase vars,
 * after applying the SQL in supabase/migrations.
 */
const raw = (import.meta.env.VITE_STATIC_DATA_MODE ?? 'true').toString().trim().toLowerCase()

// Project-specific names so a machine-wide VITE_SUPABASE_* variable from another project can't override them.
export const SUPABASE_URL = import.meta.env.VITE_MELSTAR_SUPABASE_URL?.trim() ?? ''
export const SUPABASE_ANON_KEY = import.meta.env.VITE_MELSTAR_SUPABASE_KEY?.trim() ?? ''

const supabaseConfigured =
  SUPABASE_URL.startsWith('https://') && !SUPABASE_URL.includes('YOUR-PROJECT') && SUPABASE_ANON_KEY.length > 20

export const STATIC_DATA_MODE = raw !== 'false' || !supabaseConfigured
export const DATA_MODE: 'static' | 'supabase' = STATIC_DATA_MODE ? 'static' : 'supabase'
