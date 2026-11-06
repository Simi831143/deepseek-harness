/**
 * The dialog that adds custom connectors or changes one. Adding offers two ways: paste the JSON
 * an MCP project publishes, which may hold several servers, or fill in one server by hand.
 * Changing one shows the form. The Host reads the JSON and checks every configuration; the
 * dialog only turns the form's text into values and shows what the Host found or refused.
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  ConnectorsValue, CustomConnectorConfig, CustomProblem, ParsedCustomConnectors, ParsedCustomEntry, SaveCustomRequest,
} from '@deepseek-ai/dsh-market-connectors/types'
import {
  Button, IconCodeOutlineRegular, IconCopyOutlineRegular, IconGlobeOutlineRegular, IconInfoOutlineRegular, IconWarningOutlineRegular,
  Input, Modal, SegmentedControl, Tag, useClipboardCopy,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { formatPairs, joinCommandLine, parsePairs, splitCommandLine } from './command-line.ts'
import type { MarketResult } from './market-store.ts'
import type { MarketPageProps } from './MarketPage.tsx'
import css from './CustomConnectorDialog.module.css'

type Translate = MarketPageProps['t']

/** Props of the custom connector dialog. */
export interface CustomConnectorDialogProps {
  readonly t: Translate
  /** The connector being changed; absent when adding. */
  readonly editing?: CustomConnectorConfig
  readonly parse: (text: string) => Promise<MarketResult<ParsedCustomConnectors>>
  readonly save: (request: SaveCustomRequest) => Promise<MarketResult<ConnectorsValue>>
  readonly onClose: () => void
}

type Mode = 'paste' | 'form'

/**
 * Render the add or change dialog.
 * @param props - copy, the Host calls, the connector being changed and the close command.
 * @returns the open dialog.
 */
export function CustomConnectorDialog(props: CustomConnectorDialogProps): ReactNode {
  const { t, editing, onClose } = props
  const [mode, setMode] = useState<Mode>(editing === undefined ? 'paste' : 'form')
  const id = useId()
  const title = editing === undefined ? t('addConnectorTitle') : t('editConnectorTitle', { name: editing.name })
  return (
    <Modal open onClose={onClose} title={title} closeLabel={t('close')} className={css.dialog as string} contentClassName={css.content as string}>
      {editing === undefined && (
        <SegmentedControl id={id} label={t('addModesLabel')} value={mode} onChange={setMode}
          options={[{ value: 'paste', label: t('modePaste') }, { value: 'form', label: t('modeForm') }]} />
      )}
      <div id={`${id}-${mode}-panel`} className={editing === undefined ? css.modePanel : undefined} role={editing === undefined ? 'tabpanel' : undefined}
        aria-labelledby={editing === undefined ? `${id}-${mode}` : undefined}>
        {mode === 'paste' ? <PastePanel {...props} /> : <FormPanel {...props} />}
      </div>
    </Modal>
  )
}

const PARSE_DELAY_MS = 300

function PastePanel({ t, parse, save, onClose }: CustomConnectorDialogProps): ReactNode {
  const [text, setText] = useState('')
  const [parsed, setParsed] = useState<ParsedCustomConnectors | undefined>(undefined)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [adding, setAdding] = useState(false)
  const read = useRef(0)
  const reparse = async (value: string): Promise<void> => {
    const seq = ++read.current
    if (value.trim() === '') { setParsed(undefined); return }
    const result = await parse(value)
    if (seq !== read.current) return
    if (result.ok) setParsed(result.value)
    else setFailure(t('saveFailed', { reason: reasonOf(result.error) }))
  }
  useEffect(() => {
    const timer = setTimeout(() => { void reparse(text) }, PARSE_DELAY_MS)
    return () => { clearTimeout(timer) }
  }, [text])
  const ready = parsed?.entries.filter(entry => entry.config !== undefined) ?? []
  const add = async (): Promise<void> => {
    setAdding(true)
    setFailure(undefined)
    const failed: string[] = []
    for (const entry of ready) {
      if (entry.config === undefined) continue
      const result = await save({ config: entry.config, enabled: entry.enabled })
      if (!result.ok) failed.push(`${entry.name}: ${problemText(result.error, t)}`)
    }
    setAdding(false)
    if (failed.length === 0) { onClose(); return }
    setFailure(failed.join('\n'))
    await reparse(text)
  }
  return (
    <div className={css.panel}>
      <Field label={t('pasteLabel')} hint={t('pasteHint')}>
        {control => (
          <textarea {...control} className={css.code} rows={10} spellCheck={false} placeholder={t('pastePlaceholder')} data-modal-autofocus
            value={text} onChange={(event) => { setText(event.target.value) }} />
        )}
      </Field>
      {parsed?.problem !== undefined && (
        <p className={css.error} role="alert"><IconWarningOutlineRegular size={14} />{problemMessage(parsed.problem, parsed.detail, t)}</p>
      )}
      {parsed !== undefined && parsed.entries.length > 0 && (
        <ul className={css.entries} aria-label={t('pasteFound')}>
          {parsed.entries.map(entry => <ParsedRow key={`${entry.renamedFrom ?? ''}:${entry.name}`} entry={entry} t={t} />)}
        </ul>
      )}
      {failure !== undefined && <p className={css.error} role="alert"><IconWarningOutlineRegular size={14} />{failure}</p>}
      <div className={css.footer}>
        <Button variant="outline" size="sm" onClick={onClose}>{t('cancel')}</Button>
        <Button variant="primary" size="sm" disabled={ready.length === 0 || adding} onClick={() => { void add() }}>
          {adding ? t('saving') : t('pasteAdd', { count: ready.length })}
        </Button>
      </div>
    </div>
  )
}

function ParsedRow({ entry, t }: { entry: ParsedCustomEntry; t: Translate }): ReactNode {
  const { config } = entry
  return (
    <li className={css.entry}>
      <div className={css.entryHead}>
        <span className={css.entryName}>{entry.name}</span>
        {config !== undefined && <Tag tone="outline">{config.transport === 'stdio' ? t('typeStdio') : t('typeHttp')}</Tag>}
        {entry.renamedFrom !== undefined && <span className={css.muted}>{t('pasteRenamed', { name: entry.renamedFrom })}</span>}
      </div>
      {config !== undefined && <code className={css.summary}>{summaryOf(config)}</code>}
      {entry.problem !== undefined && <span className={css.entryProblem}>{problemMessage(entry.problem, entry.detail, t)}</span>}
      {config !== undefined && !entry.enabled && <span className={css.muted}>{t('pasteDisabled')}</span>}
      {entry.ignored.length > 0 && <span className={css.muted}>{t('pasteIgnored', { fields: entry.ignored.join(', ') })}</span>}
    </li>
  )
}

/** The form's text fields. */
interface FormText {
  readonly name: string
  readonly transport: CustomConnectorConfig['transport']
  readonly commandLine: string
  readonly cwd: string
  readonly env: string
  readonly url: string
  readonly headers: string
  readonly timeout: string
}

function formOf(config: CustomConnectorConfig | undefined): FormText {
  const timeout = config?.toolCallTimeoutMs === undefined ? '' : String(Math.round(config.toolCallTimeoutMs / 1000))
  if (config?.transport === 'streamable-http') {
    return { name: config.name, transport: config.transport, commandLine: '', cwd: '', env: '', url: config.url, headers: formatPairs(config.headers, ':'), timeout }
  }
  return {
    name: config?.name ?? '', transport: 'stdio', commandLine: config === undefined ? '' : joinCommandLine(config.command, config.args),
    cwd: config?.cwd ?? '', env: config === undefined ? '' : formatPairs(config.env, '='), url: '', headers: '', timeout,
  }
}

type Built = { readonly ok: true; readonly config: CustomConnectorConfig } | { readonly ok: false; readonly message: string }

function build(form: FormText, t: Translate): Built {
  const timeoutText = form.timeout.trim()
  if (timeoutText !== '' && !/^[1-9]\d{0,6}$/.test(timeoutText)) return { ok: false, message: t('invalidTimeout') }
  const timeout = timeoutText === '' ? {} : { toolCallTimeoutMs: Number(timeoutText) * 1000 }
  const name = form.name.trim()
  if (form.transport === 'stdio') {
    const env = parsePairs(form.env, '=')
    if (!env.ok) return { ok: false, message: t('pairLine', { field: t('fieldEnv'), line: env.line }) }
    const { command, args } = splitCommandLine(form.commandLine)
    if (command.trim() === '') return { ok: false, message: t('missingCommand') }
    const cwd = form.cwd.trim()
    return { ok: true, config: { name, transport: 'stdio', command, args, env: env.pairs, ...cwd === '' ? {} : { cwd }, ...timeout } }
  }
  const headers = parsePairs(form.headers, ':')
  if (!headers.ok) return { ok: false, message: t('pairLine', { field: t('fieldHeaders'), line: headers.line }) }
  if (form.url.trim() === '') return { ok: false, message: t('missingUrl') }
  return { ok: true, config: { name, transport: 'streamable-http', url: form.url.trim(), headers: headers.pairs, ...timeout } }
}

function FormPanel({ t, editing, save, onClose }: CustomConnectorDialogProps): ReactNode {
  const [form, setForm] = useState<FormText>(() => formOf(editing))
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [saving, setSaving] = useState(false)
  const typeId = useId()
  const edit = (patch: Partial<FormText>): void => { setForm(value => ({ ...value, ...patch })) }
  const built = useMemo(() => build(form, t), [form, t])
  const json = built.ok ? JSON.stringify({ mcpServers: { [built.config.name]: jsonOf(built.config) } }, null, 2) : ''
  const copy = useClipboardCopy(json)
  const submit = async (): Promise<void> => {
    if (!built.ok) { setFailure(built.message); return }
    setSaving(true)
    setFailure(undefined)
    const result = await save({ ...editing === undefined ? {} : { previousName: editing.name }, config: built.config })
    setSaving(false)
    if (result.ok) onClose()
    else setFailure(problemText(result.error, t))
  }
  return (
    <form className={css.panel} onSubmit={(event) => { event.preventDefault(); void submit() }}>
      <Field label={t('fieldName')} hint={t('fieldNameHint')}>
        {control => (
          <Input {...control} className={css.input ?? ''} value={form.name} maxLength={25} spellCheck={false} data-modal-autofocus
            onChange={(event) => { edit({ name: event.currentTarget.value }) }} />
        )}
      </Field>
      <div className={css.field}>
        <span className={css.label}>{t('fieldType')}</span>
        {editing === undefined
          ? (
            <SegmentedControl id={typeId} label={t('fieldType')} value={form.transport} onChange={(transport) => { edit({ transport }) }}
              options={[{ value: 'stdio', label: t('typeStdio') }, { value: 'streamable-http', label: t('typeHttp') }]} />
          )
          : <FixedType transport={form.transport} t={t} />}
      </div>
      <div id={`${typeId}-${form.transport}-panel`} className={css.group}
        {...editing === undefined ? { role: 'tabpanel', 'aria-labelledby': `${typeId}-${form.transport}` } : {}}>
        {form.transport === 'stdio'
          ? (
            <>
              <Field label={t('fieldCommand')} hint={t('fieldCommandHint')}>
                {control => (
                  <Input {...control} className={css.input ?? ''} value={form.commandLine} spellCheck={false} placeholder={t('fieldCommandPlaceholder')}
                    onChange={(event) => { edit({ commandLine: event.currentTarget.value }) }} />
                )}
              </Field>
              <Field label={t('fieldCwd')}>
                {control => (
                  <Input {...control} className={css.input ?? ''} value={form.cwd} spellCheck={false} placeholder={t('fieldCwdPlaceholder')}
                    onChange={(event) => { edit({ cwd: event.currentTarget.value }) }} />
                )}
              </Field>
              <Field label={t('fieldEnv')} hint={t('fieldEnvHint')}>
                {control => (
                  <textarea {...control} className={css.code} rows={3} spellCheck={false} placeholder={t('fieldEnvPlaceholder')}
                    value={form.env} onChange={(event) => { edit({ env: event.target.value }) }} />
                )}
              </Field>
            </>
          )
          : (
            <>
              <Field label={t('fieldUrl')}>
                {control => (
                  <Input {...control} className={css.input ?? ''} value={form.url} spellCheck={false} placeholder={t('fieldUrlPlaceholder')}
                    onChange={(event) => { edit({ url: event.currentTarget.value }) }} />
                )}
              </Field>
              <Field label={t('fieldHeaders')} hint={t('fieldHeadersHint')}>
                {control => (
                  <textarea {...control} className={css.code} rows={3} spellCheck={false} placeholder={t('fieldHeadersPlaceholder')}
                    value={form.headers} onChange={(event) => { edit({ headers: event.target.value }) }} />
                )}
              </Field>
            </>
          )}
      </div>
      <Field label={t('fieldTimeout')} hint={t('fieldTimeoutHint')}>
        {control => (
          <Input {...control} className={css.timeout ?? ''} value={form.timeout} inputMode="numeric" placeholder="60"
            onChange={(event) => { edit({ timeout: event.currentTarget.value }) }} />
        )}
      </Field>
      {built.ok && (
        <div className={css.field}>
          <div className={css.previewHead}>
            <span className={css.label}>{t('jsonPreview')}</span>
            <Button type="button" variant="ghost" size="sm" icon={<IconCopyOutlineRegular size={14} />} onClick={copy.onCopy}>
              {copy.copied ? t('copied') : t('copy')}
            </Button>
          </div>
          <pre className={css.preview}>{json}</pre>
        </div>
      )}
      {failure !== undefined && <p className={css.error} role="alert"><IconWarningOutlineRegular size={14} />{failure}</p>}
      <div className={css.footer}>
        <Button type="button" variant="outline" size="sm" onClick={onClose}>{t('cancel')}</Button>
        <Button type="submit" variant="primary" size="sm" disabled={saving}>{saving ? t('saving') : t('save')}</Button>
      </div>
    </form>
  )
}

/** The type of the connector being changed: a card with its icon and meaning, and why it cannot change. */
function FixedType({ transport, t }: { transport: CustomConnectorConfig['transport']; t: Translate }): ReactNode {
  const stdio = transport === 'stdio'
  const Icon = stdio ? IconCodeOutlineRegular : IconGlobeOutlineRegular
  return (
    <div className={css.typeBox}>
      <div className={css.typeCard}>
        <span className={css.typeIcon} aria-hidden="true"><Icon size={18} /></span>
        <span className={css.typeText}>
          <span className={css.typeName}>{stdio ? t('typeStdio') : t('typeHttp')}</span>
          <span className={css.typeDescription}>{stdio ? t('typeStdioDescription') : t('typeHttpDescription')}</span>
        </span>
      </div>
      <span className={css.typeNote}><IconInfoOutlineRegular size={12} aria-hidden="true" />{t('typeFixed')}</span>
    </div>
  )
}

/** Attributes that tie a control to its field's label and hint. */
interface FieldControl {
  readonly id: string
  readonly 'aria-describedby'?: string
}

/** A labelled control; the hint describes the control instead of joining its name. */
function Field({ label, hint, children }: { label: string; hint?: string; children: (control: FieldControl) => ReactNode }): ReactNode {
  const id = useId()
  const hintId = `${id}-hint`
  return (
    <div className={css.field}>
      <label className={css.label} htmlFor={id}>{label}</label>
      {children(hint === undefined ? { id } : { id, 'aria-describedby': hintId })}
      {hint !== undefined && <span id={hintId} className={css.hint}>{hint}</span>}
    </div>
  )
}

/** One server in the `mcpServers` format other MCP clients read. */
function jsonOf(config: CustomConnectorConfig): Record<string, unknown> {
  const timeout = config.toolCallTimeoutMs === undefined ? {} : { toolCallTimeoutMs: config.toolCallTimeoutMs }
  if (config.transport === 'stdio') {
    return {
      command: config.command, args: config.args, ...Object.keys(config.env).length === 0 ? {} : { env: config.env },
      ...config.cwd === undefined ? {} : { cwd: config.cwd }, ...timeout,
    }
  }
  return { type: 'http', url: config.url, ...Object.keys(config.headers).length === 0 ? {} : { headers: config.headers }, ...timeout }
}

/**
 * @param config - custom connector configuration.
 * @returns the command line of a local program, or the URL of a remote service.
 */
export function summaryOf(config: CustomConnectorConfig): string {
  return config.transport === 'stdio' ? joinCommandLine(config.command, config.args) : config.url
}

const PROBLEM_KEY = {
  'not-json': 'problemNotJson',
  'no-servers': 'problemNoServers',
  'invalid-name': 'problemInvalidName',
  'name-taken': 'problemNameTaken',
  'sse': 'problemSse',
  'unknown-type': 'problemUnknownType',
  'no-command-or-url': 'problemNoCommandOrUrl',
  'invalid-url': 'problemInvalidUrl',
  'cwd-not-absolute': 'problemCwdNotAbsolute',
  'invalid-field': 'problemInvalidField',
} as const satisfies Record<CustomProblem, string>

function problemMessage(problem: CustomProblem, detail: string | undefined, t: Translate): string {
  return t(PROBLEM_KEY[problem], { detail: detail ?? '' })
}

/** The message of a refused save: the rule it broke, or the Host's reason. */
function problemText(error: unknown, t: Translate): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const { code } = error
    const details = 'details' in error && typeof error.details === 'object' && error.details !== null ? error.details as { problem?: unknown; detail?: unknown } : {}
    if (code === 'market-connectors/invalid-custom' && typeof details.problem === 'string' && details.problem in PROBLEM_KEY) {
      return problemMessage(details.problem as CustomProblem, typeof details.detail === 'string' ? details.detail : undefined, t)
    }
    if (code === 'market-connectors/name-taken') return t('problemNameTaken')
  }
  return t('saveFailed', { reason: reasonOf(error) })
}

function reasonOf(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') return error.message
  return String(error)
}
