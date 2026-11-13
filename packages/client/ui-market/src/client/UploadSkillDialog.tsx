/** Local skill-file selection, validation feedback, and installation progress. */
import { useEffect, useId, useRef, useState, type DragEvent, type ReactNode } from 'react'
import type { SkillImportProblem, SkillImportValue } from '@deepseek-ai/dsh-market-skills/types'
import {
  Button, fileSizeText, IconArchiveOutlineRegular, IconCloseOutlineRegular, IconWarningOutlineRegular, Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarketResult } from './market-store.ts'
import type { MarketPageProps } from './MarketPage.tsx'
import css from './UploadSkillDialog.module.css'

type Translate = MarketPageProps['t']

/** Inputs and commands for importing one skill into the personal skill folder. */
export interface UploadSkillDialogProps {
  readonly t: Translate
  readonly onClose: () => void
  readonly onImport: (file: File) => Promise<MarketResult<SkillImportValue>>
  readonly onInstalled: () => void
}

/**
 * Render click and drag-and-drop selection with recoverable validation errors. Closing and selecting another file
 * stay blocked until an import settles; success belongs to the caller's persistent toast host.
 * @param props - localized copy and the import and navigation commands.
 * @returns the open upload dialog.
 */
export function UploadSkillDialog({ t, onClose, onImport, onInstalled }: UploadSkillDialogProps): ReactNode {
  const input = useRef<HTMLInputElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const fileDescription = useId()
  const importing = useRef(false)
  const dragDepth = useRef(0)
  const [file, setFile] = useState<File | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  useEffect(() => {
    const reset = (): void => { dragDepth.current = 0; setDragging(false) }
    // File drags outside this modal must not reach the composer's document listeners.
    const containOutside = (event: globalThis.DragEvent): void => {
      const transfer = event.dataTransfer
      if (transfer === null || !transfer.types.includes('Files')) return
      if (event.target instanceof Node && panel.current?.contains(event.target)) return
      event.preventDefault()
      event.stopPropagation()
      transfer.dropEffect = 'none'
      reset()
    }
    const events = ['dragenter', 'dragover', 'dragleave', 'drop'] as const
    for (const name of events) document.addEventListener(name, containOutside, true)
    window.addEventListener('dragend', reset)
    return () => {
      for (const name of events) document.removeEventListener(name, containOutside, true)
      window.removeEventListener('dragend', reset)
    }
  }, [])
  const invalid = file === undefined ? undefined : fileProblem(file, t)
  const close = (): void => { if (!importing.current) onClose() }
  const resetDrag = (): void => { dragDepth.current = 0; setDragging(false) }
  const select = (selected: File): void => {
    if (importing.current) return
    setFile(selected)
    setFailure(undefined)
  }
  const containFileDrag = (event: DragEvent): boolean => {
    if (!event.dataTransfer.types.includes('Files')) return false
    event.preventDefault()
    event.stopPropagation()
    return true
  }
  const drop = (event: DragEvent): void => {
    if (!containFileDrag(event)) return
    resetDrag()
    if (importing.current) return
    const files = event.dataTransfer.files
    if (files.length === 0) return
    if (files.length !== 1) { setFailure(t('uploadSingleFile')); return }
    for (const item of event.dataTransfer.items) {
      if (item.kind === 'file' && typeof item.webkitGetAsEntry === 'function' && item.webkitGetAsEntry()?.isDirectory === true) {
        setFailure(t('uploadInvalidType'))
        return
      }
    }
    const selected = files[0]
    if (selected !== undefined) select(selected)
  }
  const submit = async (): Promise<void> => {
    if (importing.current || file === undefined || invalid !== undefined) return
    importing.current = true
    resetDrag()
    setBusy(true)
    setFailure(undefined)
    let result: MarketResult<SkillImportValue>
    try { result = await onImport(file) }
    catch (error) { result = { ok: false, error } }
    importing.current = false
    setBusy(false)
    if (result.ok) onInstalled()
    else setFailure(importProblem(result.error, t))
  }
  return (
    <Modal open headless onClose={close} title={t('addUpload')} className={css.dialog as string}>
      <div ref={panel} className={css.panel} aria-busy={busy}
        onDragEnter={containFileDrag} onDragLeave={containFileDrag}
        onDragOver={(event) => { if (containFileDrag(event)) event.dataTransfer.dropEffect = 'none' }}
        onDrop={(event) => { if (containFileDrag(event)) resetDrag() }}>
        <div className={css.header}>
          <h2 className={css.title}>{t('addUpload')}</h2>
          <Button variant="ghost" size="sm" className={css.close} aria-label={t('close')} disabled={busy} onClick={close}>
            <IconCloseOutlineRegular size={14} />
          </Button>
        </div>
        <div className={css.content}>
          <input ref={input} type="file" accept=".zip,.md" hidden disabled={busy} aria-label={t('uploadFile')}
            onChange={(event) => {
              const selected = event.currentTarget.files?.[0]
              event.currentTarget.value = ''
              if (selected === undefined) return
              select(selected)
            }} />
          <button type="button" className={css.dropZone} disabled={busy} data-modal-autofocus
            data-dragging={dragging || undefined} aria-label={file === undefined ? t('uploadChoose') : t('uploadChange')}
            aria-describedby={fileDescription}
            onClick={() => { input.current?.click() }}
            onDragEnter={(event) => {
              if (!containFileDrag(event) || importing.current) return
              dragDepth.current += 1
              setDragging(true)
            }}
            onDragOver={(event) => {
              if (containFileDrag(event)) event.dataTransfer.dropEffect = importing.current ? 'none' : 'copy'
            }}
            onDragLeave={(event) => {
              if (!containFileDrag(event)) return
              dragDepth.current = Math.max(0, dragDepth.current - 1)
              if (dragDepth.current === 0) setDragging(false)
            }}
            onDragEnd={resetDrag} onDrop={drop}>
            <IconArchiveOutlineRegular size={28} />
            <span id={fileDescription} className={css.fileInfo}>
              <span className={css.fileName}>{file?.name ?? t('uploadDropHint')}</span>
              {file !== undefined && <span className={css.size}>{fileSizeText(file.size)}</span>}
              {file !== undefined && <span className={css.size}>{t('uploadDropHint')}</span>}
            </span>
          </button>
          <section className={css.requirements} aria-label={t('uploadRequirements')}>
            <h3 className={css.requirementsTitle}>{t('uploadRequirements')}</h3>
            <ul className={css.requirementsList}>
              <li>{t('uploadArchiveRequirement')}</li>
              <li>{t('uploadMetadataRequirement')}</li>
            </ul>
            <p className={css.hint}>{t('uploadHint')}</p>
          </section>
          <div className={css.feedback}>
            {(failure ?? invalid) !== undefined && (
              <p className={css.error} role="alert"><IconWarningOutlineRegular size={14} />{failure ?? invalid}</p>
            )}
          </div>
        </div>
        <div className={css.footer}>
          <button type="button" className={css.browse} disabled={busy} onClick={() => { input.current?.click() }}>
            {t('uploadBrowse')}
          </button>
          <div className={css.actions}>
            <Button variant="ghost" size="sm" disabled={busy} onClick={close}>{t('cancel')}</Button>
            <Button variant="primary" size="sm" disabled={busy || file === undefined || invalid !== undefined}
              onClick={() => { void submit() }}>{busy ? t('installing') : t('install')}</Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

function fileProblem(file: File, t: Translate): string | undefined {
  if (!/\.(zip|md)$/i.test(file.name)) return t('uploadInvalidType')
  if (file.size === 0) return t('uploadEmpty')
  return undefined
}

const PROBLEM_KEY = {
  'unsupported-file': 'uploadInvalidType',
  'invalid-base64': 'uploadInvalidData',
  'invalid-archive': 'uploadInvalidArchive',
  'unsafe-path': 'uploadUnsafeArchive',
  'invalid-skill': 'uploadInvalidSkill',
} as const satisfies Record<SkillImportProblem, string>

function importProblem(error: unknown, t: Translate): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    if (error.code === 'client-market/file-read-failed') return t('uploadInvalidData')
    if (error.code === 'market-skills/import-conflict') {
      const details = 'details' in error ? error.details : undefined
      const name = typeof details === 'object' && details !== null && 'name' in details && typeof details.name === 'string' ? details.name : ''
      return t('uploadConflict', { name })
    }
    if (error.code === 'market-skills/import-invalid') {
      const details = 'details' in error ? error.details : undefined
      const reason = typeof details === 'object' && details !== null && 'reason' in details ? details.reason : undefined
      if (typeof reason === 'string' && Object.hasOwn(PROBLEM_KEY, reason)) {
        const problem = reason as SkillImportProblem
        return t(PROBLEM_KEY[problem])
      }
      return t('uploadInvalidSkill')
    }
    if (error.code === 'market-skills/import-failed') return t('uploadFailed')
  }
  return t('uploadUnknown')
}
