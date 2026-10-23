# Melstar ERP

Company ERP for **Melstar Manufacturing Systems Private Limited** (CIN U29309KA2011PTC060656) — registered office Rajajinagar, Bengaluru; plant at Plot No. 15, Road No. 3, KIADB Industrial Area Obadenahalli, Phase 3, Doddaballapura 562163.

One web app, two portals:

- **Admin portal** (`/admin`) — directors, HR, accounts and supervisors run the whole plant: people, attendance, leave, payroll, petty cash, tasks, machines & maintenance, inventory & assets, purchase, customers & work orders, quality, reports, users & roles, audit log and settings. What each person sees depends on their role.
- **Employee portal** (`/me`) — every employee: check-in/out, own attendance and corrections, leave, payslips and advances, tasks and to-dos, petty-cash claims, announcements, notifications and profile.

Designed & developed by [Swan Digital Solutions](https://swandigitalsolutions.com).

---

## Demo logins — one per role

| Role | Person | E-mail | Password | What they see |
|---|---|---|---|---|
| **Super Admin** | Melstar Admin | `admin@melstarmanufacturing.in` | `Melstar@Admin2026` | Everything — every module, users & roles, audit log, settings |
| **Plant Head** (Super Admin) | Prakash Hegde | `prakash.hegde@melstarmanufacturing.in` | `Welcome@Melstar1` | Everything, plus their own self-service view as an employee |
| **HR Manager** | Lakshmi Narayan | `lakshmi.narayan@melstarmanufacturing.in` | `Welcome@Melstar1` | Employees, attendance, leave & holidays, announcements, reports; payroll read-only |
| **Accounts** | Vinay Kamath | `vinay.kamath@melstarmanufacturing.in` | `Welcome@Melstar1` | Payroll runs, petty cash, vendors & purchase orders, finance reports |
| **Production Supervisor** | Ramesh Babu | `ramesh.babu@melstarmanufacturing.in` | `Welcome@Melstar1` | Tasks, machines & maintenance, inventory, quality, team attendance |
| **Employee** | Ravi Kumar M (CNC supervisor) | `ravi.kumar@melstarmanufacturing.in` | `Ravi@Melstar2026` | Own space only — check-in, attendance, leave, payslips, tasks, claims, profile |

The sign-in page shows these as one-tap buttons (offline mode always; live mode while `VITE_SHOW_DEMO_LOGINS=true`). Every login except the Super Admin also has a self-service employee view. Permissions per role can be changed in **Users & roles**.

The logins are defined in [`src/config/demoCredentials.ts`](src/config/demoCredentials.ts) and created by the seed script; `npx vite-node scripts/verify-logins.ts` signs in with each one and prints its role.

> **These are live logins to the Supabase database.** Before go-live: set `VITE_SHOW_DEMO_LOGINS=false`, run the purge script (which removes the demo employee logins) and change the admin password.

---|---|---|
| **Admin** (Super Admin) | `admin@melstarmanufacturing.in` | `Melstar@Admin2026` |
| **Employee** (Ravi Kumar M, Production Supervisor – CNC Turning Cell) | `ravi.kumar@melstarmanufacturing.in` | `Ravi@Melstar2026` |

Extra demo logins (password `Welcome@Melstar1`) to show role-based access:
`lakshmi.narayan@…` (HR Manager), `vinay.kamath@…` (Accounts), `ramesh.babu@…` (Production Supervisor), `prakash.hegde@…` (Super Admin, linked to the Plant Head) — all `@melstarmanufacturing.in`.

The credentials are defined in [`src/config/demoCredentials.ts`](src/config/demoCredentials.ts) and created by the seed script. **Change these passwords before handing the system over** (Users & roles → Reset password, or My profile → Change password).

---

## Run it

```bash
npm install
npm run dev          # http://localhost:5195  (live Supabase, uses .env.local)
npm run build        # production build in dist/
npx vitest run       # payroll / statutory / payslip unit tests (22)
```

Offline demo on its own port (no Supabase needed): `VITE_STATIC_DATA_MODE=true npm run dev -- --port 5196`.
In the Claude Code desktop app both are in `schoolERP/.claude/launch.json` as **melstar-erp** (live, port 5195) and **melstar-erp-offline** (port 5196).

### Data modes

| Mode | When | Where data lives |
|---|---|---|
| **Supabase (live)** | `VITE_STATIC_DATA_MODE=false` + Supabase URL/key in `.env.local` | Postgres on Supabase project `tdykidrgeewhzkvaivts` (Melstarsoftware, Singapore). Real logins (Supabase Auth), Row Level Security, Realtime, private file storage. |
| **Offline demo** | `VITE_STATIC_DATA_MODE=true` (or no Supabase config) | IndexedDB in the browser, seeded with the same demo data. Two tabs stay in sync. Settings → Data → Reset demo data. |

`.env.local` (not committed) is written by the seed script:

```
VITE_STATIC_DATA_MODE=false
VITE_MELSTAR_SUPABASE_URL=https://tdykidrgeewhzkvaivts.supabase.co
VITE_MELSTAR_SUPABASE_KEY=<publishable key>
VITE_SHOW_DEMO_LOGINS=true      # one-tap role logins on the sign-in page — false at go-live
```

The variable names are project-specific on purpose: this PC has a machine-wide `VITE_SUPABASE_ANON_KEY` from another project that would otherwise override them.

---

## Modules

**People** — Employees (directory, departments, designations, full HR record, documents, emergency contacts, exit), Attendance (live board, daily marking, monthly register, regularisations, overtime approval, shifts), Leaves & holidays (requests, balances & year-end carry-forward, team calendar, Karnataka holiday calendar, leave types), Payroll (salary structures with CTC/tax preview, monthly runs Draft → Processed → Approved → Paid, payslip PDFs, bank transfer file, advances & loans with EMI recovery, PF/ESI/PT/TDS statutory summaries).

**Work** — Tasks (kanban with drag & drop, checklists, comments, due dates), Announcements (audience by department, pinning, read receipts), Notifications (real-time bell + page), Approvals inbox (leave, attendance corrections, overtime, petty cash, advances, draft POs).

**Plant** — Machines & maintenance (18 machines across the six work centres, PM schedules, breakdown log, MTTR/MTBF/availability), Customers & work orders (routing through work centres, progress, on-time delivery), Quality (incoming / in-process / final / first-article inspections with measured parameters, NCRs), Inventory & assets (stock in/out/adjust with ledger, reorder alerts, tool crib, assets and gauge calibration), Vendors & purchase (POs with GST, approval, goods receipt into stock, PO PDF).

**Finance** — Petty cash (claims with bill upload, approval limit, payment from the cash box, running cash book, imprest top-ups).

**Insights & admin** — Reports (people, payroll/statutory, finance, operations — CSV/PDF), Users & roles (logins, permission matrix, custom roles), Audit log (every change with before → after), Settings (company profile and directors, payroll & statutory rates, attendance policy and plant timings, petty-cash rules, data tools).

**Employee portal** — Home (check-in/out with location check, today, balances, tasks, notices), Attendance (calendar, corrections), Leaves (balances, apply with live day count, cancel), Payslips & advances (PDF download, YTD, tax projection, advance requests), Tasks & to-dos, Petty-cash claims, Announcements, Notifications, Profile (contact details, emergency contacts, documents, password).

### Statutory rules (defaults — editable in Settings → Payroll)

- **EPF** 12% employee on Basic + DA (capped at the ₹15,000 wage ceiling by default); employer 12% split EPS 8.33% (capped) + EPF 3.67%, EDLI 0.5%, admin 0.5%.
- **ESI** 0.75% employee / 3.25% employer when fixed monthly gross ≤ ₹21,000.
- **Karnataka Professional Tax** ₹200/month from ₹25,000 gross; ₹300 in February (₹2,500 a year).
- **TDS** projected annual tax ÷ 12. New regime (default): ₹75,000 standard deduction, 0–4 L nil … above 24 L 30%, s.87A rebate up to ₹12 L taxable with marginal relief, 4% cess. Old regime supported with declared deductions.
- **Overtime** (Basic + DA) ÷ 26 ÷ 8 × 2 per hour (Factories Act s.59), approved OT only.
- Salary for a month = components × paid days ÷ calendar days. Paid days include week-offs, plant holidays and paid leave; LOP = absence, unpaid leave, half-day shortfalls and late-mark penalties (3 late marks = ½ day by default).

Rates change with budgets and notifications — **confirm them with the company's CA before the first live payroll.**

---

## Supabase

Everything in `supabase/` has been applied to project **tdykidrgeewhzkvaivts**:

| File | What it does |
|---|---|
| `migrations/20261016000001_schema.sql` | 45 tables with constraints (PAN/IFSC/GSTIN formats, money ≥ 0, unique codes, one punch per employee per day …), indexes, `updated_at` triggers |
| `migrations/20261016000002_security.sql` | Role/permission helpers, **Row Level Security on every table**, employee-safe `employee_directory` view, guard triggers (employees can't approve their own requests or edit anything but their contact details), private `erp-files` storage bucket |
| `migrations/20261016000003_functions.sql` | `attendance_check_in` / `attendance_check_out` (server clock, late/OT maths), `touch_last_login`, Realtime publication for all tables |
| `migrations/20261016000004_notifications.sql` | Database triggers that notify approvers and employees (leave, corrections, advances, claims, tasks, comments, payslips, announcements) |
| `migrations/20261016000005_hardening.sql` | Fixes from Supabase's security/performance advisors: fixed `search_path`s, no anonymous access to definer functions, invoker directory view, one merged policy per table and command |
| `migrations/20261017000006_petty_cash_rules.sql` | Approval limit enforced in the database (above-limit vouchers need a Super Admin) and `petty_cash_pay()` — pays a voucher and posts the cash book in one transaction |
| `migrations/20261017000007_stock_and_delivery.sql` | Stock movements applied by the database under a row lock (balances can't drift when two people post at once); work-order completion/dispatch dates for on-time delivery |
| `migrations/20261017000008_quiet_bulk_loads.sql` | Notification triggers fire only for real users, not for seed scripts or migrations |
| `migrations/20261023000009_approval_controls.sql` | Maker-checker (approvers can't approve their own leave, claims, advances, corrections or OT; Super Admin exempt), voucher approval limit also on insert and no amount/claimant edits after a decision, storage reads scoped by area (documents, bills, leave proofs), task comments kept when a login is deleted |
| `functions/admin-users/` | Edge Function used by Users & roles to create logins / reset passwords / deactivate (checks `users.manage`) |
| `seed/reference_data.sql` | Company master data only (no demo people) for a clean project |
| `purge_demo_data.sql` | **Go-live**: removes all demo employees, logins and transactions, keeps the company setup |

Demo data was loaded with `npx vite-node scripts/seed-supabase.ts` (use `--reset` to wipe and reload). Checks you can re-run at any time:

- `npx vite-node scripts/verify-rls.ts` — signs in as the demo employee and the admin and compares what each can read; the employee's attempts to edit their bank account or payslips are blocked.
- `npx vite-node scripts/verify-edge-fn.ts` — confirms the login-management function refuses anonymous callers (401) and employees (403) and validates admin input. It creates nothing.

### Re-create on another Supabase project

```bash
npx supabase login
# apply every file in supabase/migrations in name order (0001 … 0009), e.g.
npx supabase db query --linked --project-ref <ref> -f supabase/migrations/20261016000001_schema.sql
npx supabase functions deploy admin-users --project-ref <ref> --use-api
SUPABASE_PROJECT_REF=<ref> npx vite-node scripts/seed-supabase.ts      # demo data + logins, writes .env.local
# or, for a clean start: run supabase/seed/reference_data.sql and create the first admin (see the end of that file)
```

### Go-live checklist

1. Settings → Data: switch **Demo autopilot** off (it simulates biometric punches for the demo).
2. Run `supabase/purge_demo_data.sql` in the Supabase SQL editor.
3. Settings → Company: GSTIN, PAN, TAN, PF establishment code, ESI code, PT registration, phone, e-mail.
4. Add employees, salary structures and logins; change the admin password.
5. In Supabase → Authentication → Sign In / Providers, turn **off "Allow new users to sign up"** (logins are created by admins; a self-signed-up account can't see any data anyway, because RLS requires an `app_users` row). On the Pro plan also switch on **leaked-password protection**.
6. Deploy `dist/` (Vercel / Netlify / any static host with SPA fallback to `index.html`) with the `VITE_*` variables above, and add that site's URL under Authentication → URL Configuration.

### Verified

- Both logins against the live project; admin and employee sessions side by side with live sync (approve a leave in one, the employee's balance and bell update instantly).
- Server-side check-in/out, leave apply → approve, petty-cash claim → server voucher number → approve & pay, draft payroll run (35 payslips) → delete, announcement → notifications, stock issue through the database trigger, employee contact-detail edit, task move by an assignee.
- Every admin and employee page renders without errors at desktop, 375 px and 320 px with no sideways scroll.
- Supabase advisors: only intentional warnings remain (RLS helper and check-in functions are callable by signed-in users; leaked-password protection is a dashboard switch).

### Notes

- PDFs print amounts as "Rs." — the built-in PDF fonts have no ₹ glyph.
- Demo autopilot (Settings → Data) simulates biometric punches for employees without a login so the live board looks alive; switch it off at go-live.
- First load fetches every table the user may see (about 2 s for an admin from India to the Singapore region); after that everything is live and instant.

---

## Project layout

```
src/
  config/        company facts, demo credentials, env, navigation
  data/          types (= Postgres columns), store, backends (IndexedDB / Supabase), demo seed + autopilot
  lib/           dates, formatting, attendance / leave / payroll engines (+ tests), PDF/CSV export
  services/      session, audit, notifications, attendance, leaves, payroll, petty cash, tasks, …
  components/    UI kit, layout (sidebar, top bar, command palette), charts, module components
  pages/         admin/*, employee/*, shared/*, auth/Login
supabase/        migrations, edge function, reference data, purge script
scripts/         seed-supabase, verify-rls, gen-reference-sql
docs/            DEVELOPER_GUIDE.md
```

Company and director details come from the public registry data on the company website; employees, customers, vendors and transactions in the demo are illustrative.
