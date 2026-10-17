import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { BadgeCheck, Eye, FileText, FileUp, Image as ImageIcon, Trash2, UploadCloud } from 'lucide-react'
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Input, Modal, Select, Switch, confirm, guard, toast } from '@/components/ui'
import { useTable } from '@/data/store'
import type { DocumentType, EmployeeDocument } from '@/data/types'
import { fmtDate, todayISO } from '@/lib/dates'
import { fileSize } from '@/lib/format'
import { cn } from '@/lib/misc'
import { MAX_FILE_BYTES, openFile } from '@/services/files'
import { ACCEPTED_DOCS, DOC_TYPES, deleteDocument, docTypeLabel, documentExpiry, setDocumentVerified, uploadDocument, validateDocument, type DocumentFormValues } from '@/services/hr'

/** Open a stored file. Data URLs are opened as blob URLs (browsers block top-level data: navigation). */
export async function viewStoredFile(stored: string | null | undefined) {
  if (!stored) return
  try {
    if (stored.startsWith('data:')) {
      const blob = await (await fetch(stored)).blob()
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener')
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      return
    }
    await openFile(stored)
  } catch (e) {
    toast.error('Could not open the file', e instanceof Error ? e.message : String(e))
  }
}

/**
 * Employee documents. HR (`canManage`) verifies and deletes; the employee (or HR) uploads.
 * Expiring documents are flagged 30 days ahead.
 */
export function EmployeeDocuments({ employeeId, canManage, canUpload }: { employeeId: string; canManage: boolean; canUpload: boolean }) {
  const all = useTable('employee_documents')
  const docs = useMemo(() => all.filter((d) => d.employee_id === employeeId).sort((a, b) => b.created_at.localeCompare(a.created_at)), [all, employeeId])
  const [open, setOpen] = useState(false)
  const today = todayISO()
  const verified = docs.filter((d) => d.verified).length
  const attention = docs.filter((d) => documentExpiry(d, today)).length

  const remove = async (d: EmployeeDocument) => {
    if (await confirm({ title: `Delete “${d.title}”?`, message: 'The file is removed permanently from the employee record.', danger: true, confirmLabel: 'Delete' }))
      await guard(() => deleteDocument(d), 'Document deleted')
  }

  return (
    <Card>
      <CardHeader
        title="Documents"
        subtitle={docs.length ? `${docs.length} on file · ${verified} verified${attention ? ` · ${attention} need attention` : ''}` : 'ID proofs, letters, certificates'}
        icon={<FileText className="h-4 w-4" />}
        actions={
          canUpload && (
            <Button size="sm" icon={<FileUp className="h-4 w-4" />} onClick={() => setOpen(true)}>
              Upload
            </Button>
          )
        }
      />
      <CardBody>
        {docs.length ? (
          <ul className="space-y-2.5">
            <AnimatePresence initial={false}>
              {docs.map((d, i) => {
                const exp = documentExpiry(d, today)
                const isImg = d.file_type.startsWith('image/')
                return (
                  <motion.li
                    key={d.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i, 8) * 0.035 } }}
                    exit={{ opacity: 0, x: -12 }}
                    className="flex min-w-0 flex-wrap items-center gap-3 rounded-2xl border border-indigo-100/80 bg-white/80 p-3 sm:flex-nowrap"
                  >
                    <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl', isImg ? 'bg-pink-50 text-pink-600' : 'bg-indigo-50 text-brand-indigo')}>
                      {isImg ? <ImageIcon className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
                    </span>
                    <div className="min-w-0 flex-1 basis-40">
                      <p className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate font-semibold text-ink">{d.title}</span>
                        {exp === 'expired' && <Badge tone="red" dot>Expired {fmtDate(d.expiry_date)}</Badge>}
                        {exp === 'soon' && <Badge tone="amber" dot>Expires {fmtDate(d.expiry_date)}</Badge>}
                      </p>
                      <p className="truncate text-[12px] text-ink-soft">
                        {docTypeLabel(d.doc_type)} · {d.file_name || 'no file'}
                        {d.file_size ? ` · ${fileSize(d.file_size)}` : ''} · added {fmtDate(d.created_at.slice(0, 10))}
                        {!exp && d.expiry_date ? ` · valid till ${fmtDate(d.expiry_date)}` : ''}
                      </p>
                    </div>
                    <div className="ml-auto flex shrink-0 items-center gap-1.5">
                      {canManage ? (
                        <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-2.5 py-1.5" title={d.verified ? 'Verified by HR' : 'Mark as verified'}>
                          <span className={cn('text-[12px] font-semibold', d.verified ? 'text-emerald-600' : 'text-ink-faint')}>{d.verified ? 'Verified' : 'Verify'}</span>
                          <Switch checked={d.verified} onChange={(v) => void guard(() => setDocumentVerified(d, v), v ? 'Marked verified' : 'Verification removed')} />
                        </div>
                      ) : d.verified ? (
                        <Badge tone="green">
                          <span className="inline-flex items-center gap-1">
                            <BadgeCheck className="h-3.5 w-3.5" /> Verified
                          </span>
                        </Badge>
                      ) : (
                        <Badge tone="amber">Pending check</Badge>
                      )}
                      <Button size="icon-sm" variant="ghost" disabled={!d.file_data} onClick={() => void viewStoredFile(d.file_data)} title={d.file_data ? 'Open' : 'No file stored for this record'} aria-label={`Open ${d.title}`}>
                        <Eye className="h-4 w-4" />
                      </Button>
                      {canManage && (
                        <Button size="icon-sm" variant="ghost" className="hover:!bg-rose-50 hover:!text-rose-600" onClick={() => void remove(d)} aria-label={`Delete ${d.title}`}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </motion.li>
                )
              })}
            </AnimatePresence>
          </ul>
        ) : (
          <EmptyState
            icon={<FileText className="h-6 w-6" />}
            title="No documents yet"
            description="Upload Aadhaar (masked), PAN, appointment letter and bank proof to complete the file."
            action={canUpload && <Button size="sm" icon={<FileUp className="h-4 w-4" />} onClick={() => setOpen(true)}>Upload document</Button>}
          />
        )}
      </CardBody>
      <UploadModal employeeId={employeeId} open={open} onClose={() => setOpen(false)} />
    </Card>
  )
}

function UploadModal({ employeeId, open, onClose }: { employeeId: string; open: boolean; onClose: () => void }) {
  const blank = (): DocumentFormValues => ({ doc_type: 'appointment_letter', title: docTypeLabel('appointment_letter'), expiry_date: '', file: null })
  const [f, setF] = useState<DocumentFormValues>(blank)
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setF(blank())
      setTouched(false)
    }
  }, [open])

  const errors = validateDocument(f)
  const invalid = Object.keys(errors).length > 0
  const show = (k: keyof DocumentFormValues) => (touched || (k !== 'file' && k !== 'title') ? errors[k] : undefined)

  const setType = (t: DocumentType) => setF((p) => ({ ...p, doc_type: t, title: !p.title.trim() || DOC_TYPES.some((d) => d.label === p.title) ? docTypeLabel(t) : p.title }))
  const pickFile = (file: File | undefined) => {
    if (!file) return
    setTouched(true)
    setF((p) => ({ ...p, file }))
  }

  const save = async () => {
    setTouched(true)
    if (invalid) return
    setBusy(true)
    const ok = await guard(() => uploadDocument(employeeId, f), 'Document uploaded')
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Upload document"
      subtitle="PDF, image or Word file · up to 10 MB"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={invalid}>
            Upload
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Document type" required error={show('doc_type')} htmlFor="doc-type">
            <Select id="doc-type" value={f.doc_type} onChange={(e) => setType(e.target.value as DocumentType)} options={DOC_TYPES} />
          </Field>
          <Field label="Expiry date" error={show('expiry_date')} hint="Licences, medical or training certificates" htmlFor="doc-exp">
            <Input id="doc-exp" type="date" value={f.expiry_date} onChange={(e) => setF({ ...f, expiry_date: e.target.value })} />
          </Field>
        </div>
        <Field label="Title" required error={show('title')} htmlFor="doc-title">
          <Input id="doc-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} onBlur={() => setTouched(true)} invalid={!!show('title')} maxLength={120} />
        </Field>
        {f.doc_type === 'aadhaar' && <p className="-mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">Upload a <b>masked</b> Aadhaar (first 8 digits hidden) — never the full number.</p>}
        <Field label="File" required error={show('file')}>
          <button
            type="button"
            onClick={() => input.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setDrag(true)
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDrag(false)
              pickFile(e.dataTransfer.files?.[0])
            }}
            className={cn(
              'flex w-full flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed px-4 py-7 text-center transition',
              drag ? 'border-brand-indigo bg-indigo-50' : show('file') ? 'border-rose-300 bg-rose-50/40' : 'border-indigo-200 bg-white/70 hover:border-indigo-300 hover:bg-indigo-50/40',
            )}
          >
            <UploadCloud className="h-7 w-7 text-brand-indigo" />
            {f.file ? (
              <>
                <span className="max-w-full truncate text-sm font-semibold text-ink">{f.file.name}</span>
                <span className="text-[12px] text-ink-soft">{fileSize(f.file.size)} · tap to change</span>
              </>
            ) : (
              <>
                <span className="text-sm font-semibold text-ink">Tap to choose a file</span>
                <span className="text-[12px] text-ink-soft">or drag it here · max {fileSize(MAX_FILE_BYTES)}</span>
              </>
            )}
          </button>
          <input
            ref={input}
            type="file"
            accept={ACCEPTED_DOCS}
            className="sr-only"
            onChange={(e) => {
              pickFile(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </Field>
      </div>
    </Modal>
  )
}
