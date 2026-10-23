-- ═══════════════════════════════════════════════════════════════════════════
-- Melstar ERP — move reference-data colours to the muted palette of the 2026-10 redesign
-- (departments, work centres, leave types, shifts). Same mapping as the demo seed.
-- Only the original bright defaults are changed; colours picked in Settings are left alone.
-- Safe to run more than once:
--   npx supabase db query --linked --project-ref <ref> -f supabase/recolor_reference_data.sql
-- ═══════════════════════════════════════════════════════════════════════════
begin;

create temporary table recolor (old text primary key, new text not null) on commit drop;
insert into recolor values
  ('#6366f1', '#2a56a1'),  -- indigo  → brand blue
  ('#06b6d4', '#2f8f83'),  -- cyan    → teal
  ('#ec4899', '#a0627f'),  -- pink    → mauve
  ('#10b981', '#3a8f5c'),  -- emerald → green
  ('#f59e0b', '#d08c1e'),  -- amber   → ochre
  ('#f43f5e', '#c94a4a'),  -- rose    → brick red
  ('#ef4444', '#c94a4a'),
  ('#8b5cf6', '#7a5aa6'),  -- violet  → muted purple
  ('#a855f7', '#8c6bb1'),
  ('#0ea5e9', '#4a8cc4'),  -- sky     → steel blue
  ('#f97316', '#c56a2d'),  -- orange  → rust
  ('#14b8a6', '#3f8f8a'),
  ('#3b82f6', '#3d6cba');

update public.departments t set color = r.new from recolor r where lower(t.color) = r.old;
update public.work_centres t set color = r.new from recolor r where lower(t.color) = r.old;
update public.leave_types t set color = r.new from recolor r where lower(t.color) = r.old;
update public.shifts t set color = r.new from recolor r where lower(t.color) = r.old;

commit;
