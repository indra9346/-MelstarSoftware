/**
 * Compare the live database's public columns with the rows the app writes (the demo seed builds
 * a complete row for every table). Run:
 *   npx supabase db query --linked --project-ref <ref> "select table_name, string_agg(column_name, ',' order by column_name) cols from information_schema.columns where table_schema='public' group by table_name" -o json > live.json
 *   npx vite-node scripts/compare-live-schema.ts live.json
 */
import { readFileSync } from 'node:fs'
import { generateSeed } from '../src/data/seed'
import { TABLE_NAMES } from '../src/data/types'

const file = process.argv[2]
if (!file) throw new Error('Pass the JSON file written by `supabase db query -o json`.')
const live = new Map<string, Set<string>>(
  (JSON.parse(readFileSync(file, 'utf8')).rows as { table_name: string; cols: string }[]).map((r) => [r.table_name, new Set(r.cols.split(','))]),
)

const { tables } = await generateSeed()
let problems = 0
for (const t of TABLE_NAMES) {
  const cols = live.get(t)
  if (!cols) {
    console.log(`✗ ${t}: table missing in the live database`)
    problems++
    continue
  }
  const keys = new Set<string>()
  for (const row of (tables[t] ?? []) as Record<string, unknown>[]) Object.keys(row).forEach((k) => keys.add(k))
  const missing = [...keys].filter((k) => !cols.has(k))
  const unused = [...cols].filter((c) => keys.size && !keys.has(c))
  if (missing.length) {
    console.log(`✗ ${t}: app writes columns the database lacks: ${missing.join(', ')}`)
    problems++
  }
  if (unused.length) console.log(`· ${t}: database-only columns (not in seed rows): ${unused.join(', ')}`)
  if (!keys.size) console.log(`· ${t}: no seed rows to compare`)
}
const extra = [...live.keys()].filter((t) => !(TABLE_NAMES as readonly string[]).includes(t))
if (extra.length) console.log(`· live tables/views the app does not load: ${extra.join(', ')}`)
console.log(problems ? `\n${problems} problem(s)` : `\nAll ${TABLE_NAMES.length} tables match.`)
