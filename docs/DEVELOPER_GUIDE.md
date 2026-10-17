# Melstar ERP — developer guide

React 18 + Vite 5 + TypeScript (strict) + Tailwind 3 + Framer Motion 11 + Recharts 2 + jsPDF 3 (+ jspdf-autotable 5) + lucide-react + @dnd-kit/core.
Backend: Supabase (Postgres + Auth + Realtime + Storage) **or** a static demo mode (IndexedDB). Both run through the same in-memory store.

Check your work with: `npx tsc -p tsconfig.app.json --noEmit` (from the project root). Unit tests: `npx vitest run`.

Code style: 2 spaces, no semicolons, single quotes, `@/` imports, function components, short comments only where they add something. Match the files that already exist.

---

## 1. Data layer — `src/data`

- **Types:** `src/data/types.ts` — one interface per table, snake_case fields = Postgres columns. `NewRow<'table'>` is the insert payload (id/timestamps optional).
- **Store:** `import { db, useTable, useRow, useSettings, useTables } from '@/data/store'`
  - Reads (sync): `db.all('employees')`, `db.get('employees', id)`, `db.where(t, pred)`, `db.find(t, pred)`, `db.settings()`.
  - Writes (sync, optimistic): `db.insert(t, row)` → row, `db.update(t, id, patch)` → row, `db.remove(t, id)`, `db.batch(() => { … })`.
    Writes apply instantly and persist in the background. A failed write is **rolled back and toasted automatically**.
    When a flow must be confirmed before you say "done" (payroll run, multi-row posting), `await db.flushed()` inside `try`.
  - React: `const rows = useTable('leave_requests')` re-renders when that table changes (local edits, other tabs, Supabase Realtime). Derive with `useMemo`.
- Never import Supabase directly in pages. Server-side functions go through services (e.g. `services/attendance.ts`).

## 2. Security model (Supabase mode — enforced by RLS in `supabase/migrations`)

Roles carry permission keys (`src/data/types.ts → Permission`). In the UI: `const s = useSession()` → `s.can('leaves.manage')`, `s.canAny([...])`, `s.employee` (linked employee or null), `s.user` (app user), `s.role`, `s.isAdminPortal`.
Hide/disable actions the user can't perform. The server enforces the same rules:

- Self-service users (no permission) can only **read their own** rows in personal tables and can only:
  - insert their own `leave_requests` (status pending), `regularisations`, `advances`, `petty_cash_vouchers`, `employee_documents`, `emergency_contacts`, `todos`, `task_comments` (on visible tasks), `announcement_reads`;
  - update their own `employees` row **contact fields only** (phone, personal_email, address, city, pincode, photo, blood_group, marital_status);
  - cancel their own leave (status → `cancelled`; pending, or approved and not yet started);
  - move tasks assigned to them (only `status`, `checklist`, `sort_order`, `completed_at`);
  - mark their own notifications read; delete own pending regularisations/advances/vouchers.
- Employees see other people only through a directory (name, code, department, designation, work centre, phone, email). Fields like bank, PAN, DOB are empty strings for them.
- Self-service users cannot read `app_users` other than their own: show reviewer names with a fallback (e.g. `L.userName(id)` returns '—'; prefer "HR" text).
- **Notifications are created by the database** (and by `services/notificationRules.ts` in static mode) for: leave/regularisation/advance/voucher submitted & decided, task assigned/commented, payslip published, announcement posted. **Do not insert notifications for these yourself.** You may insert other notifications (e.g. low stock, maintenance due) for users you can see.
- Petty-cash voucher numbers are assigned by the server (the client's provisional number is replaced).
- Check-in/out: use `checkIn(emp, geo)` / `checkOut(emp)` from `services/attendance.ts` (server clock in Supabase mode).
- Stock: insert a `stock_movements` row through `postMovement()` (`services/inventory.ts`). In Supabase mode the database trigger recomputes `balance_after` under a row lock and updates `inventory_items.stock_qty`; direct edits to `stock_qty` are ignored.
- Petty-cash payment: `payVoucher()` calls the `petty_cash_pay()` RPC in Supabase mode (entry + voucher in one transaction). Vouchers above the approval limit need `settings.manage`, enforced in the database too.
- Inserts into `audit_logs` and `notifications` don't ask for the row back (the writer may not be allowed to read it).
- Numeric columns are coerced to numbers on arrival (`normalizeRow` in the Supabase backend).
- Files: `storeFile(file, employeeId, area)` → string to save in the row; `openFile(stored)` / `fileUrl(stored)` to view (`services/files.ts`).

## 3. Business rules & helpers (`src/lib`)

- `dates.ts` — ISO date strings; `todayISO, addDays, eachDay, monthOf, monthDates, daysInMonth, fyOf, fyLabel, fyRange, fyMonths, fmtDate, fmtDateShort, fmtDay, fmtMonth, fmtTime, fmtHHMM, fmtDateTime, fmtDuration, relativeTime, tenure, ageInYears, combine, hhmmToMinutes, minutesToHHMM`.
- `format.ts` — `inr, inr2, inrCompact, num, pct, round2, initials, fullName, plural, titleCase, maskTail, fileSize, amountInWords`.
- `attendance.ts` — `computePunch` (late/worked/OT/status), `buildAttendanceContext` + `resolveDay` (derived day status: present / half_day / leave / holiday / week_off / absent / today / upcoming), `summariseMonth` (paid days, LOP, OT, late marks — **payroll uses this**), `liveStatus`, `DAY_STATUS_META` (labels + colours).
- `leaves.ts` — `countLeaveDays` (excludes week-offs + plant holidays), `leaveBalances` (opening + allotted + adjustment − used − pending), `proratedQuota`, `overlaps`, `weeklyOffsFor`.
- `payroll.ts` — `computePayslip` (PF/ESI/PT/TDS/OT/recoveries), `annualTax`, `professionalTax`, `otHourlyRate`, `monthlyGross`, `structureFromGross`, `annualCtc`, `emiDue`, `DEFAULT_PAYROLL_CONFIG`. Unit-tested in `payroll.test.ts`. Config lives in `db.settings().payroll`.
- `ids.ts` — `uuid`, `nextNumber('T-', codes)`, `nextFyNumber('PO', codes, date)` → `PO/2026-27/0011`.
- `export.ts` — `exportCsv(name, rows, cols)`, `exportPdf({filename,title,subtitle,rows,columns,landscape,summary})`, `pdfHeader(doc,title,subtitle)`, `pdfFooter(doc)` for custom PDFs (lazy-import `jspdf` / `jspdf-autotable` inside the function).
- `misc.ts` — `cn, sum, groupBy, sortBy, clamp, distanceMeters, readFileAsDataUrl, downloadBlob`.

Holidays with `type: 'optional'` are **not** plant closures (attendance/leave maths ignore them).

## 4. Services (`src/services`)

- `audit(action, entity, entityId, summary, changes?)` and `diff(before, patch)` — call `audit` for every create / update / delete / approve / reject / cancel / process / pay / export.
- `session.tsx` — `useSession()`, `useAuth()` (`signOut`, `changePassword`).
- `attendance.ts`, `files.ts`, `users.ts` (login management), `notificationRules.ts`.
- Put module business logic in `src/services/<module>.ts` (pure functions using `db`), keep pages thin.

## 5. UI kit (`import { … } from '@/components/ui'`)

`Button` (variant primary|secondary|outline|ghost|danger|success, size sm|md|lg|icon|icon-sm, `loading`, `icon`), `Card`, `CardHeader({title, subtitle, actions, icon})`, `CardBody`, `InfoGrid({items:[[k,v]]})`,
`Field({label, hint, error, required})`, `Input` (`leading` icon), `Textarea`, `Select({options:[{value,label}], placeholder})`, `Switch`, `Checkbox`, `Segmented`,
`Modal({open, onClose, title, subtitle, footer, size sm|md|lg|xl, side})` (bottom sheet on phones; put buttons in `footer`),
`toast.success|error|info|warning(title, body?)`, `guard(fn, successMsg)`, `confirm({title, message, danger, confirmLabel})`, `confirmWithNote({…, input:{label, required}})` → `{ok, note}`,
`Badge({tone})`, `StatusBadge({status})` (colours for every status string), `DataTable({rows, columns, rowKey, searchText, toolbar, onRowClick, exportName, mobileCard, initialSort})`,
`EmptyState`, `StatCard({label, value, format, icon, accent, hint, onClick})`, `AnimatedNumber`, `Progress`, `Ring`, `PageHeader({title, subtitle, actions, kicker})`, `Avatar`, `Tabs({tabs:[{value,label,count}], value, onChange})`, `Menu({items})`, `Skeleton`, `SectionTitle`, `KV`.
Also: `EmployeeCell({id, sub})` (`@/components/EmployeeCell`), `useLookups()` (`@/hooks/useLookups` → `empName, deptName, desigTitle, wcName, userName, emp/dept/desig/wc maps, employeeOptions()`), `ChartBox, ChartGradients, SERIES, axisProps, gridProps, tooltipProps, Legend` (`@/components/charts`), `useIsMobile()`, `useNow()`.

## 6. Look & feel

- Brand: light aurora/glass, gradient cyan `#06b6d4` → indigo `#6366f1` → pink `#ec4899`, ink `#1e2b5c` (`text-ink`, `text-ink-soft`, `text-ink-faint`), `bg-grad`, `.grad-text`, `font-display` (Space Grotesk) for headings, Inter body. Cards: `card` class (no backdrop blur — keeps phones smooth).
- Fully responsive to **320 px**: single column on phones (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`), no fixed widths, `min-w-0` on flex children, `truncate` long names, tables via `DataTable` (cards on phones), wide grids inside `overflow-x-auto`.
- Motion: Framer Motion, opacity/transform only, short (≤ .5 s), spring for overlays, `layout`/`layoutId` for tabs and kanban. No scroll-linked effects. Don't animate every row of long lists (stagger only the first ~8).
- Every form: labels, required markers, inline validation messages, sensible defaults, live computed values (e.g. leave days, PO totals, net pay), disabled submit while invalid, success toast.
- Empty states and permission-aware actions everywhere. Money with `inr()`, dates with `fmtDate()`.
- Company facts: `db.settings()` (legal name, CIN, addresses, plant timings) and `src/config/company.ts`. Work centres: CNC Turning Cell, VMC Milling Cell, Press & Bending, Welding Bay, Sub-assembly Line, QA Inspection.

## 7. Routing

Routes are declared in `src/App.tsx` (admin portal under `/admin`, employee self-service under `/me`). Each page file default-exports a component. Query params are used for deep links (`/admin/production?wo=<id>`, `/admin/purchase?po=<id>`, `/admin/machines?m=<id>`).
