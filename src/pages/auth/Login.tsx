import { useState, type FormEvent } from 'react'
import { Banknote, Boxes, Building2, ClipboardCheck, Eye, EyeOff, Factory, KeyRound, Lock, Mail, MapPin, ShieldCheck, UserRound, Users, Wallet, Wrench, type LucideIcon } from 'lucide-react'
import { useAuth } from '@/services/session'
import { DATA_MODE } from '@/config/env'
import { DEMO_LOGINS, type DemoLogin } from '@/config/demoCredentials'
import { COMPANY } from '@/config/company'
import { Button, Field, Input } from '@/components/ui'
import { LogoMark, SwanCredit } from '@/components/brand'

const SHOW_DEMO_LOGINS = DATA_MODE === 'static' || import.meta.env.VITE_SHOW_DEMO_LOGINS === 'true'

export default function LoginPage() {
  const { signIn, error: bootError } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(bootError)
  const [forgot, setForgot] = useState(false)

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!email.trim() || !password) return setError('Enter your e-mail and password.')
    setBusy(true)
    setError(null)
    try {
      await signIn(email, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const fill = (d: DemoLogin) => {
    setEmail(d.email)
    setPassword(d.password)
    setError(null)
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <InfoPanel />
      <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10 sm:px-8 lg:min-h-0">
        <div className="w-full max-w-[400px]">
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <LogoMark size={38} />
            <div>
              <p className="text-[17px] font-semibold leading-none">Melstar ERP</p>
              <p className="mt-1 text-[12px] text-ink-soft">Melstar Manufacturing Systems Pvt Ltd</p>
            </div>
          </div>

          <div className="card p-6 sm:p-7">
            <h1 className="text-[20px] font-semibold leading-tight">Sign in</h1>
            <p className="mt-1 text-[13px] text-ink-soft">Use the e-mail address registered with HR.</p>

            <form onSubmit={submit} className="mt-5 space-y-4" noValidate>
              <Field label="E-mail" htmlFor="email">
                <Input id="email" type="email" autoComplete="username" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} leading={<Mail className="h-4 w-4" />} placeholder="name@melstarmanufacturing.in" />
              </Field>
              <Field label="Password" htmlFor="password">
                <div className="relative">
                  <Input id="password" type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} leading={<Lock className="h-4 w-4" />} className="pr-10" />
                  <button type="button" onClick={() => setShow((s) => !s)} className="absolute inset-y-0 right-1 my-auto grid h-7 w-7 place-items-center rounded text-ink-faint hover:bg-slate-100 hover:text-ink" aria-label={show ? 'Hide password' : 'Show password'}>
                    {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </Field>
              {error && (
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700" role="alert">
                  {error}
                </p>
              )}
              <Button type="submit" size="lg" className="w-full" loading={busy}>
                Sign in
              </Button>
              <div className="text-center">
                <button type="button" onClick={() => setForgot((f) => !f)} className="text-[13px] font-medium text-brand-600 hover:underline" aria-expanded={forgot}>
                  Forgot password?
                </button>
              </div>
              {forgot && <p className="rounded-md border border-line bg-slate-50 px-3 py-2 text-[12.5px] text-ink-soft">Ask HR or the ERP administrator to reset it from <b className="font-medium text-ink">Users &amp; roles</b>. You can change it any time from <b className="font-medium text-ink">My profile</b>.</p>}
            </form>

            {SHOW_DEMO_LOGINS && (
              <div className="mt-6 border-t border-line pt-4">
                <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink-soft">
                  <KeyRound className="h-3.5 w-3.5" /> Demo logins
                </p>
                <p className="mb-2.5 mt-0.5 text-[12px] text-ink-faint">Select a role to fill its credentials, then sign in.</p>
                <div className="grid grid-cols-1 gap-1.5 xs:grid-cols-2">
                  {DEMO_LOGINS.map((d) => (
                    <DemoButton key={d.email} icon={ROLE_ICONS[d.role] ?? UserRound} title={d.role} sub={d.person} hint={d.sees} active={email === d.email} onClick={() => fill(d)} />
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="mt-6 flex justify-center">
            <SwanCredit />
          </div>
        </div>
      </div>
    </div>
  )
}

const ROLE_ICONS: Record<string, LucideIcon> = {
  'Super Admin': ShieldCheck,
  'Plant Head': Building2,
  'HR Manager': Users,
  Accounts: Banknote,
  'Production Supervisor': Wrench,
  Employee: UserRound,
}

function DemoButton({ icon: Icon, title, sub, hint, active, onClick }: { icon: LucideIcon; title: string; sub: string; hint: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      aria-pressed={active}
      className={`flex min-w-0 items-center gap-2.5 rounded-md border px-2.5 py-2 text-left transition-colors ${active ? 'border-brand-500 bg-brand-50' : 'border-line bg-white hover:border-line-strong hover:bg-slate-50'}`}
    >
      <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-brand-600' : 'text-ink-faint'}`} />
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium text-ink">{title}</span>
        <span className="block truncate text-[11.5px] text-ink-soft">{sub}</span>
      </span>
    </button>
  )
}

const MODULES: [LucideIcon, string, string][] = [
  [Users, 'People', 'Employees, attendance, leave and payroll'],
  [Factory, 'Plant', 'Machines, maintenance and work orders'],
  [Boxes, 'Materials', 'Inventory, assets, vendors and purchase'],
  [ClipboardCheck, 'Quality', 'Inspections and non-conformances'],
  [Wallet, 'Finance', 'Petty cash, advances and statutory reports'],
  [ShieldCheck, 'Control', 'Role-based access and a full audit trail'],
]

function InfoPanel() {
  return (
    <div className="hidden border-r border-line bg-white lg:flex lg:flex-col lg:justify-between lg:px-12 lg:py-10 xl:px-16">
      <div className="flex items-center gap-3">
        <LogoMark size={40} />
        <div>
          <p className="text-[17px] font-semibold leading-none text-ink">Melstar ERP</p>
          <p className="mt-1 text-[12.5px] text-ink-soft">{COMPANY.legal_name}</p>
        </div>
      </div>

      <div className="max-w-lg">
        <h2 className="text-[26px] font-semibold leading-snug text-ink">One system for the Doddaballapura plant</h2>
        <p className="mt-3 text-[14px] leading-relaxed text-ink-soft">Precision CNC machining, fabrication and industrial design, run on a single record of people, plant and materials.</p>
        <dl className="mt-8 grid grid-cols-2 gap-x-8 gap-y-5">
          {MODULES.map(([Icon, title, text]) => (
            <div key={title} className="flex gap-3">
              <Icon className="mt-0.5 h-[18px] w-[18px] shrink-0 text-brand-600" />
              <div>
                <dt className="text-[13.5px] font-medium text-ink">{title}</dt>
                <dd className="mt-0.5 text-[12.5px] leading-snug text-ink-soft">{text}</dd>
              </div>
            </div>
          ))}
        </dl>
      </div>

      <div className="space-y-1.5 border-t border-line pt-5 text-[12px] text-ink-soft">
        <p className="flex items-start gap-2">
          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" />
          {COMPANY.plant_address}
        </p>
        <p className="pl-[22px]">CIN {COMPANY.cin} · Incorporated {COMPANY.incorporated_on.slice(0, 4)}</p>
      </div>
    </div>
  )
}
