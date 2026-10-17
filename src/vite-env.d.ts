/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_STATIC_DATA_MODE?: string
  readonly VITE_MELSTAR_SUPABASE_URL?: string
  readonly VITE_MELSTAR_SUPABASE_KEY?: string
  readonly VITE_SHOW_DEMO_LOGINS?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
