import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { HeartPulse, MapPin, Pencil, Phone, Plus, Star, Trash2 } from 'lucide-react'
import { Badge, Button, Card, CardBody, CardHeader, Checkbox, EmptyState, Field, Input, Menu, Modal, Select, Textarea, confirm, guard } from '@/components/ui'
import { useTable } from '@/data/store'
import type { EmergencyContact } from '@/data/types'
import { RELATIONS, contactToForm, deleteContact, saveContact, setPrimaryContact, validateContact, type ContactFormValues } from '@/services/hr'

/** Emergency contacts for one employee — exactly one is primary. Used by HR and self-service. */
export function EmergencyContacts({ employeeId, canEdit, compact }: { employeeId: string; canEdit: boolean; compact?: boolean }) {
  const all = useTable('emergency_contacts')
  const contacts = useMemo(
    () => all.filter((c) => c.employee_id === employeeId).sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.name.localeCompare(b.name)),
    [all, employeeId],
  )
  const [editing, setEditing] = useState<EmergencyContact | 'new' | null>(null)

  const remove = async (c: EmergencyContact) => {
    const ok = await confirm({
      title: `Remove ${c.name}?`,
      message: c.is_primary && contacts.length > 1 ? 'This is the primary contact — the next contact becomes primary.' : 'The contact will be removed from the record.',
      danger: true,
      confirmLabel: 'Remove',
    })
    if (ok) await guard(() => deleteContact(c), 'Contact removed')
  }

  return (
    <Card>
      <CardHeader
        title="Emergency contacts"
        subtitle={contacts.length ? `${contacts.length} contact${contacts.length === 1 ? '' : 's'} · the primary one is called first` : 'Who to call in an emergency at the plant'}
        icon={<HeartPulse className="h-4 w-4" />}
        actions={
          canEdit && (
            <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
              Add contact
            </Button>
          )
        }
      />
      <CardBody>
        {contacts.length ? (
          <ul className={compact ? 'grid grid-cols-1 gap-3' : 'grid grid-cols-1 gap-3 md:grid-cols-2'}>
            <AnimatePresence initial={false}>
              {contacts.map((c, i) => (
                <motion.li
                  key={c.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i, 8) * 0.04 } }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  className={`relative min-w-0 rounded-2xl border p-4 ${c.is_primary ? 'border-indigo-200 bg-gradient-to-br from-white to-indigo-50/60' : 'border-indigo-100/80 bg-white/80'}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 font-semibold text-ink">
                        <span className="truncate">{c.name}</span>
                        {c.is_primary && (
                          <Badge tone="indigo">
                            <span className="inline-flex items-center gap-1">
                              <Star className="h-3 w-3 fill-current" /> Primary
                            </span>
                          </Badge>
                        )}
                      </p>
                      <p className="text-[12.5px] text-ink-soft">{c.relation || '—'}</p>
                    </div>
                    {canEdit && (
                      <Menu
                        items={[
                          { label: 'Edit', icon: <Pencil />, onClick: () => setEditing(c) },
                          ...(c.is_primary ? [] : [{ label: 'Make primary', icon: <Star />, onClick: () => void guard(() => setPrimaryContact(c), `${c.name} is now the primary contact`) }]),
                          { label: 'Remove', icon: <Trash2 />, danger: true, onClick: () => void remove(c) },
                        ]}
                      />
                    )}
                  </div>
                  <a href={`tel:${c.phone.replace(/\s/g, '')}`} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-1.5 text-[13px] font-semibold text-emerald-700 transition hover:bg-emerald-100">
                    <Phone className="h-3.5 w-3.5" />
                    <span className="num">{c.phone}</span>
                  </a>
                  {c.address && (
                    <p className="mt-2 flex items-start gap-1.5 text-[12.5px] text-ink-soft">
                      <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span className="min-w-0 break-words">{c.address}</span>
                    </p>
                  )}
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        ) : (
          <EmptyState
            icon={<HeartPulse className="h-6 w-6" />}
            title="No emergency contact yet"
            description="Add at least one person the plant can call in an emergency."
            action={canEdit && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>Add contact</Button>}
          />
        )}
      </CardBody>
      <ContactModal employeeId={employeeId} contact={editing} count={contacts.length} onClose={() => setEditing(null)} />
    </Card>
  )
}

function ContactModal({ employeeId, contact, count, onClose }: { employeeId: string; contact: EmergencyContact | 'new' | null; count: number; onClose: () => void }) {
  const existing = contact && contact !== 'new' ? contact : undefined
  const [f, setF] = useState<ContactFormValues>(() => contactToForm(existing, count === 0))
  const [touched, setTouched] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!contact) return
    setF(contactToForm(contact === 'new' ? undefined : contact, count === 0))
    setTouched(new Set())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact])

  const errors = validateContact(f)
  const invalid = Object.keys(errors).length > 0
  const err = (k: keyof ContactFormValues) => (touched.has(k) ? errors[k] : undefined)
  const touch = (k: keyof ContactFormValues) => setTouched((t) => new Set(t).add(k))
  const lockedPrimary = !!existing?.is_primary || count === 0

  const save = async () => {
    if (invalid) return setTouched(new Set(Object.keys(f)))
    setBusy(true)
    const ok = await guard(() => saveContact(employeeId, f, existing), existing ? 'Contact updated' : 'Contact added')
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <Modal
      open={!!contact}
      onClose={onClose}
      size="sm"
      title={existing ? `Edit ${existing.name}` : 'Add emergency contact'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={invalid}>
            {existing ? 'Save' : 'Add contact'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4">
        <Field label="Name" required error={err('name')} htmlFor="ec-name">
          <Input id="ec-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} onBlur={() => touch('name')} invalid={!!err('name')} placeholder="Full name" />
        </Field>
        <div className="grid grid-cols-1 gap-4 xs:grid-cols-2">
          <Field label="Relation" required error={err('relation')} htmlFor="ec-rel">
            <Select id="ec-rel" value={f.relation} onChange={(e) => setF({ ...f, relation: e.target.value })} onBlur={() => touch('relation')} invalid={!!err('relation')} options={RELATIONS.map((r) => ({ value: r, label: r }))} placeholder="Select…" />
          </Field>
          <Field label="Phone" required error={err('phone')} htmlFor="ec-phone">
            <Input id="ec-phone" type="tel" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} onBlur={() => touch('phone')} invalid={!!err('phone')} placeholder="+91 98450 12345" />
          </Field>
        </div>
        <Field label="Address" error={err('address')} htmlFor="ec-addr">
          <Textarea id="ec-addr" rows={2} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} onBlur={() => touch('address')} invalid={!!err('address')} placeholder="Optional" />
        </Field>
        <div>
          <Checkbox checked={f.is_primary || lockedPrimary} onChange={(v) => !lockedPrimary && setF({ ...f, is_primary: v })} label="Primary contact (called first)" />
          <p className="mt-1 pl-7 text-[12px] text-ink-faint">
            {count === 0 ? 'The first contact is always primary.' : existing?.is_primary ? 'To change the primary contact, make another contact primary.' : 'Only one contact can be primary — the current one will be replaced.'}
          </p>
        </div>
      </div>
    </Modal>
  )
}
