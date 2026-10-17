import { useState, type FormEvent } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, Banknote, Building2, Eye, EyeOff, KeyRound, Lock, Mail, MapPin, ShieldCheck, UserRound, Users, Wrench, type LucideIcon } from 'lucide-react'
import { useAuth } from '@/services/session'
import { DATA_MODE } from '@/config/env'
import { DEMO_LOGINS, type DemoLogin } from '@/config/demoCredentials'
import { COMPANY } from '@/config/company'
import { Button, Field, Input } from '@/components/ui'
import { LogoMark, SwanCredit } from '@/components/brand'
import { useNow } from '@/hooks/useClock'

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
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <BrandPanel />
      <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10 sm:px-8 lg:min-h-0">
        <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }} className="w-full max-w-[420px]">
          <div className="mb-7 flex items-center gap-3 lg:hidden">
            <LogoMark size={42} />
            <div>
              <p className="font-display text-xl font-bold leading-none">Melstar ERP</p>
              <p className="mt-1 text-[11px] font-semibold uppercase tracking-[.18em] text-ink-soft">Manufacturing Systems</p>
            </div>
          </div>

          <div className="card p-6 sm:p-8">
            <p className="kicker">Welcome back</p>
            <h1 className="mt-1 text-[26px] font-bold leading-tight">Sign in to your workspace</h1>
            <p className="mt-1.5 text-sm text-ink-soft">Admins land on the plant dashboard; employees on their own space.</p>

            <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
              <Field label="E-mail" htmlFor="email">
                <Input id="email" type="email" autoComplete="username" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} leading={<Mail className="h-4 w-4" />} placeholder="name@melstarmanufacturing.in" />
              </Field>
              <Field label="Password" htmlFor="password">
                <div className="relative">
                  <Input id="password" type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} leading={<Lock className="h-4 w-4" />} className="pr-11" placeholder="••••••••" />
                  <button type="button" onClick={() => setShow((s) => !s)} className="absolute inset-y-0 right-1.5 my-auto grid h-8 w-8 place-items-center rounded-lg text-ink-faint hover:bg-indigo-50 hover:text-ink" aria-label={show ? 'Hide password' : 'Show password'}>
                    {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </Field>
              {error && (
                <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl bg-rose-50 px-3.5 py-2.5 text-[13px] font-medium text-rose-700" role="alert">
                  {error}
                </motion.p>
              )}
              <Button type="submit" size="lg" className="w-full" loading={busy} icon={busy ? undefined : <ArrowRight className="order-last h-4 w-4" />}>
                Sign in
              </Button>
              <button type="button" onClick={() => setForgot((f) => !f)} className="mx-auto block text-[12.5px] font-semibold text-brand-indigo hover:underline">
                Forgot password?
              </button>
              {forgot && <p className="rounded-xl bg-indigo-50 px-3.5 py-2.5 text-[12.5px] text-ink-soft">Ask HR or the ERP administrator to reset it from <b>Users &amp; roles</b>. You can change it any time from <b>My profile</b>.</p>}
            </form>

            {SHOW_DEMO_LOGINS && (
              <div className="mt-6 border-t border-indigo-50 pt-5">
                <p className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-ink-faint">
                  <KeyRound className="h-3.5 w-3.5" /> Demo logins · one per role
                </p>
                <p className="mb-2.5 mt-0.5 text-[12px] text-ink-faint">Tap a role to fill its login, then Sign in.</p>
                <div className="grid grid-cols-1 gap-2 xs:grid-cols-2">
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
        </motion.div>
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
      className={`flex min-w-0 items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition hover:-translate-y-px hover:shadow-soft ${active ? 'border-brand-indigo bg-indigo-50/80 ring-2 ring-indigo-500/20' : 'border-indigo-100 bg-white/80 hover:border-indigo-200'}`}
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-cyan-500 to-indigo-500 text-white">
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-semibold text-ink">{title}</span>
        <span className="block truncate text-[11.5px] text-ink-soft">{sub}</span>
      </span>
    </button>
  )
}

function BrandPanel() {
  const now = useNow(1000)
  const time = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
  const years = now.getFullYear() - 2011 - (now.getMonth() < 9 || (now.getMonth() === 9 && now.getDate() < 4) ? 1 : 0)
  return (
    <div className="relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-between lg:p-12">
      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-[#0e1a4a] via-[#1e2b5c] to-[#3b2a6b]" />
      <div className="absolute -left-24 -top-24 -z-10 h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,rgba(6,182,212,.45),transparent_65%)]" />
      <div className="absolute -bottom-40 right-[-120px] -z-10 h-[560px] w-[560px] rounded-full bg-[radial-gradient(circle,rgba(236,72,153,.35),transparent_65%)]" />
      <div className="absolute inset-0 -z-10 opacity-[.12] [background-image:linear-gradient(rgba(255,255,255,.5)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.5)_1px,transparent_1px)] [background-size:48px_48px]" />

      <div className="flex items-center gap-3 text-white">
        <LogoMark size={44} />
        <div>
          <p className="font-display text-xl font-bold leading-none">Melstar ERP</p>
          <p className="mt-1 text-[11px] font-semibold uppercase tracking-[.2em] text-white/60">Manufacturing Systems Pvt Ltd</p>
        </div>
      </div>

      <div className="text-white">
        <motion.h2 initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }} className="font-display text-[52px] font-bold leading-[1.02] tracking-tight xl:text-[60px]">
          Precision
          <br />
          <span className="bg-gradient-to-r from-cyan-300 via-indigo-300 to-pink-300 bg-clip-text text-transparent">engineered.</span>
          <br />
          Run with clarity.
        </motion.h2>
        <p className="mt-5 max-w-md text-[15px] leading-relaxed text-white/70">
          People, attendance, payroll, petty cash, tasks, machines, inventory, purchase and quality — one live system for the Doddaballapura plant.
        </p>
        <div className="mt-8 grid max-w-lg grid-cols-3 gap-3">
          {[
            ['Since', '2011'],
            ['Years', String(years)],
            ['Work centres', '6'],
          ].map(([k, v], i) => (
            <motion.div key={k} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 + i * 0.08, duration: 0.6 }} className="rounded-2xl border border-white/15 bg-white/[.07] px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-white/55">{k}</p>
              <p className="font-display text-2xl font-bold">{v}</p>
            </motion.div>
          ))}
        </div>
      </div>

      <div className="flex items-end justify-between gap-6 text-white/65">
        <p className="flex max-w-sm items-start gap-2 text-[12.5px] leading-relaxed">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
          {COMPANY.plant_address}
        </p>
        <div className="text-right">
          <p className="num font-display text-2xl font-semibold text-white">{time}</p>
          <p className="text-[11px] uppercase tracking-wider">IST · CIN {COMPANY.cin}</p>
        </div>
      </div>
    </div>
  )
}
