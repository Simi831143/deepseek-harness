/**
 * The connector section of the market page and the detail dialog of one connector. The grid
 * lists the user's custom connectors first, then catalog connectors and installed ones the
 * catalog no longer lists, each with its state. Connecting a market connector installs it when
 * needed, asks once whether its program may run on this computer, then switches it on; the Host
 * starts the program and the state follows the connector stream. A custom connector is added
 * through the add dialog and switches from its card. A running install shows its progress on the
 * card and in the dialog. The dialog retries a failed start, shows why it failed with the
 * program's last stderr lines, asks the assistant to diagnose it, updates and uninstalls a
 * market connector, and edits and deletes a custom one.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import type { MarketItemView, MarketSnapshot, MarketText } from '@deepseek-ai/dsh-market/types'
import type { ConnectorLaunchView, ConnectorView, CustomConnectorConfig } from '@deepseek-ai/dsh-market-connectors/types'
import {
  Button, IconApiOutlineRegular, IconCloseOutlineRegular, IconDownloadOutlineRegular, IconEditOutlineRegular,
  IconEllipsisOutlineRegular, IconInfoOutlineRegular, IconLoadingOutlineRegular, IconNewChatOutlineRegular, IconPlusOutlineRegular,
  IconRefreshOutlineRegular, IconSearchOutlineRegular, IconTrashOutlineRegular, IconWarningOutlineRegular, Input, Menu, MenuItemButton,
  Modal, Pill, Switch, Tag, type TagTone,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { joinCommandLine } from './command-line.ts'
import { ConnectorSettings } from './ConnectorSettings.tsx'
import { CustomConnectorDialog, summaryOf } from './CustomConnectorDialog.tsx'
import { InstallProgress } from './InstallProgress.tsx'
import { ItemIcon } from './ItemIcon.tsx'
import type { MarketPageProps } from './MarketPage.tsx'
import cardCss from './MarketCard.module.css'
import css from './MarketPage.module.css'
import detailCss from './SkillDetail.module.css'
import localCss from './Connectors.module.css'

type Translate = MarketPageProps['t']
type TextOf = (value: MarketText) => string

/** One connector the section shows: a custom connector, a catalog entry with its installed state, or both. */
interface ConnectorEntry {
  readonly id: string
  readonly item: MarketItemView | undefined
  readonly view: ConnectorView | undefined
}

const FALLBACK_ICON = { kind: 'connector' } as const

/** The dialog the section shows over the grid. */
type Dialog =
  | { readonly kind: 'detail'; readonly id: string; readonly connect: boolean }
  | { readonly kind: 'add' }
  | { readonly kind: 'edit'; readonly config: CustomConnectorConfig }

/**
 * Render the connector section.
 * @param props - page props, the market snapshot and the text picker.
 * @returns the toolbar, category chips, connector grid and the open dialog.
 */
export function ConnectorCatalog(props: MarketPageProps & { market: MarketSnapshot | undefined; text: TextOf }): ReactNode {
  const { t, market, text } = props
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const connectors = props.useMarket(state => state.connectors)
  const entries = useMemo((): ConnectorEntry[] => {
    const all = connectors?.connectors ?? []
    const views = new Map(all.filter(view => view.origin === 'market').map(view => [view.id, view]))
    const items = (market?.items ?? []).filter(item => item.kind === 'connector')
    const listed = new Set(items.map(item => item.id))
    return [
      ...all.filter(view => view.origin === 'custom').map(view => ({ id: view.id, item: undefined, view })),
      ...items.map(item => ({ id: item.id, item, view: views.get(item.id) })),
      ...[...views.values()].filter(view => !listed.has(view.id)).map(view => ({ id: view.id, item: undefined, view })),
    ]
  }, [market, connectors])
  const categories = (market?.categories ?? []).filter(entry => entry.kind === 'connector')
  const needle = query.trim().toLowerCase()
  const visible = entries
    .filter(entry => category === null || entry.item?.category === category)
    .filter(entry => needle === '' || searchFields(entry, text).some(field => field.toLowerCase().includes(needle)))
  const close = (): void => { setDialog(null) }
  return (
    <>
      <div className={css.toolbar}>
        <Input className={css.search ?? ''} type="search" icon={<IconSearchOutlineRegular size={14} />} placeholder={t('searchConnectors')}
          aria-label={t('searchConnectors')} value={query} onChange={(event) => { setQuery(event.currentTarget.value) }} />
        <Button variant="primary" size="sm" icon={<IconPlusOutlineRegular size={13} />} onClick={() => { setDialog({ kind: 'add' }) }}>
          {t('addConnector')}
        </Button>
      </div>
      {market === undefined
        ? <p className={css.empty}>{t('loading')}</p>
        : (
          <section aria-label={t('tabConnectors')}>
            {categories.length > 0 && (
              <div className={css.chips} role="group" aria-label={t('recommended')}>
                <Pill active={category === null} onClick={() => { setCategory(null) }}>{t('allCategories')}</Pill>
                {categories.map(entry => (
                  <Pill key={entry.id} active={category === entry.id} onClick={() => { setCategory(entry.id) }}>{text(entry.name)}</Pill>
                ))}
              </div>
            )}
            {visible.length === 0
              ? <p className={css.empty}>{entries.length === 0 ? t('emptyConnectors') : t('emptyConnectorSearch')}</p>
              : (
                <ul className={css.grid}>
                  {visible.map(entry => (
                    <ConnectorCard key={entry.id} {...props} entry={entry}
                      onOpen={(connect) => { setDialog({ kind: 'detail', id: entry.id, connect }) }} />
                  ))}
                </ul>
              )}
          </section>
        )}
      {dialog?.kind === 'detail' && (
        <ConnectorDetail {...props} id={dialog.id} connectOnOpen={dialog.connect} onClose={close}
          onEdit={(config) => { setDialog({ kind: 'edit', config }) }} />
      )}
      {(dialog?.kind === 'add' || dialog?.kind === 'edit') && (
        <CustomConnectorDialog t={t} {...dialog.kind === 'edit' ? { editing: dialog.config } : {}}
          parse={props.parseCustomConnectors} save={props.saveCustomConnector} onClose={close} />
      )}
    </>
  )
}

function searchFields(entry: ConnectorEntry, text: TextOf): string[] {
  const custom = entry.view?.custom
  if (custom !== undefined) return [custom.name, summaryOf(custom)]
  return [entry.id, ...entry.item === undefined ? [] : [text(entry.item.name), text(entry.item.description), ...entry.item.tags ?? []]]
}

/** Display name: a custom connector's name, a catalog entry's title, or the installed id. */
function nameOf(id: string, item: MarketItemView | undefined, view: ConnectorView | undefined, text: TextOf): string {
  if (view?.custom !== undefined) return view.custom.name
  return item === undefined ? id : text(item.name)
}

function ConnectorCard(props: MarketPageProps & { entry: ConnectorEntry; text: TextOf; onOpen: (connect: boolean) => void }): ReactNode {
  const { entry: { id, item, view }, t, text, onOpen } = props
  const installing = props.useMarket(state => state.market?.installing.includes(`connector:${id}`) ?? false)
  const progress = props.useMarket(state => state.market?.progress.find(entry => entry.key === `connector:${id}`))
  const busy = props.useMarket(state => state.connectorBusy.includes(id))
  const name = nameOf(id, item, view, text)
  const status = statusOf(view)
  const custom = view?.custom
  // An accepted or custom connector switches in place; any other one connects through the dialog, which asks first.
  let action: ReactNode
  if (installing) {
    action = <span className={css.cardAction} aria-label={t('installing')}><IconLoadingOutlineRegular size={16} className={css.spin} /></span>
  } else if (view !== undefined && (custom !== undefined || (view.confirmed && view.launch !== undefined))) {
    action = (
      <Switch tone="success" className={css.cardSwitch} checked={view.enabled} disabled={busy} label={t('connectorSwitch', { name })}
        onChange={(next) => { void props.setConnectorEnabled(id, next, false, name) }} />
    )
  } else {
    action = (
      <Button variant="outline" size="sm" className={localCss.connect ?? ''} onClick={() => { onOpen(true) }}>
        {t('connect')}
      </Button>
    )
  }
  // The title button covers the card (see .cardOpen), so a click anywhere but the action opens the detail.
  return (
    <li className={clsx(cardCss.card, css.cardClickable)}>
      <div className={css.cardHead}>
        {custom === undefined
          ? <ItemIcon item={item ?? FALLBACK_ICON} className={css.icon} glyphSize={18} />
          : <span className={css.icon} aria-hidden="true"><IconApiOutlineRegular size={18} /></span>}
        <div className={css.cardTitleBlock}>
          <button type="button" className={css.cardOpen} aria-label={t('openDetail', { name })} onClick={() => { onOpen(false) }}>
            <span className={css.cardTitle} title={name}>{name}</span>
          </button>
          {(custom !== undefined || status !== undefined) && (
            <span className={css.cardMetaRow}>
              {custom !== undefined && <Tag tone="outline">{t('customTag')}</Tag>}
              {status !== undefined && <Tag tone={status.tone}>{t(status.key)}</Tag>}
            </span>
          )}
        </div>
        {action}
      </div>
      {custom !== undefined
        ? <p className={clsx(css.cardDescription, localCss.summary)} title={summaryOf(custom)}>{summaryOf(custom)}</p>
        : item !== undefined && <p className={css.cardDescription}>{text(item.description)}</p>}
      {progress !== undefined && <InstallProgress progress={progress} t={t} compact />}
    </li>
  )
}

/** Props of the connector detail dialog. */
export type ConnectorDetailProps = MarketPageProps & {
  id: string
  text: TextOf
  /** Start connecting as soon as the dialog opens, as the card's connect button asks. */
  connectOnOpen: boolean
  onClose: () => void
  /** Open the form that changes a custom connector. */
  onEdit: (config: CustomConnectorConfig) => void
}

/**
 * Render the detail dialog of one connector.
 * @param props - connector id, page actions, copy and the close command.
 * @returns the open dialog, or nothing once the connector is neither published nor installed nor added.
 */
export function ConnectorDetail(props: ConnectorDetailProps): ReactNode {
  const { id, t, text, onClose } = props
  const item = props.useMarket(state => state.market?.items.find(entry => entry.kind === 'connector' && entry.id === id))
  const view = props.useMarket(state => state.connectors?.connectors.find(entry => entry.id === id))
  const installing = props.useMarket(state => state.market?.installing.includes(`connector:${id}`) ?? false)
  const progress = props.useMarket(state => state.market?.progress.find(entry => entry.key === `connector:${id}`))
  const busy = props.useMarket(state => state.connectorBusy.includes(id))
  const [accepting, setAccepting] = useState<ConnectorLaunchView | null>(null)
  const [confirmingRemoval, setConfirmingRemoval] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const name = nameOf(id, item, view, text)
  const ref = { kind: 'connector' as const, id }
  const custom = view?.custom

  const connect = async (): Promise<void> => {
    let current = view
    if (current === undefined) {
      setPreparing(true)
      const installed = await props.install(ref, name)
      current = installed ? (await props.refreshConnectors())?.connectors.find(entry => entry.id === id) : undefined
      if (!mounted.current) return
      setPreparing(false)
    }
    // A refused mcp.json shows its reason in the dialog; there is no program to accept.
    if (current?.launch === undefined) return
    if (!current.confirmed) { setAccepting(current.launch); return }
    await props.setConnectorEnabled(id, true, false, name)
  }
  const autoConnected = useRef(false)
  useEffect(() => {
    if (!props.connectOnOpen || autoConnected.current) return
    autoConnected.current = true
    void connect()
  })

  if (item === undefined && view === undefined) return null
  const accept = async (): Promise<void> => {
    setAccepting(null)
    await props.setConnectorEnabled(id, true, true, name)
  }
  const remove = async (): Promise<void> => {
    setConfirmingRemoval(false)
    if (custom === undefined) { await props.uninstall(ref, name); return }
    if (await props.removeCustomConnector(custom.name)) onClose()
  }
  const status = statusOf(view)
  const outdated = custom === undefined && item?.installedVersion !== undefined && item.installedVersion !== item.version
  const working = installing || preparing || busy
  const switchable = view !== undefined && (custom !== undefined || (view.confirmed && view.launch !== undefined))

  return (
    <Modal open headless onClose={onClose} title={name} className={detailCss.dialog as string}>
      <div className={detailCss.header}>
        {custom === undefined
          ? <ItemIcon item={item ?? FALLBACK_ICON} className={detailCss.icon} glyphSize={28} />
          : <span className={detailCss.icon} aria-hidden="true"><IconApiOutlineRegular size={28} /></span>}
        <div className={detailCss.headerBody}>
          <div className={detailCss.titleRow}>
            <h2 className={detailCss.title}>{name}</h2>
            {switchable && (
              <Switch tone="success" checked={view.enabled} disabled={busy} label={t('connectorSwitch', { name })}
                onChange={(next) => { void props.setConnectorEnabled(id, next, false, name) }} />
            )}
            <Button variant="ghost" size="sm" className={detailCss.close} aria-label={t('close')} onClick={onClose}>
              <IconCloseOutlineRegular size={16} />
            </Button>
          </div>
          {(custom !== undefined || status !== undefined) && (
            <div className={localCss.status}>
              {custom !== undefined && <Tag tone="outline">{t('customTag')}</Tag>}
              {status !== undefined && <Tag tone={status.tone}>{t(status.key)}</Tag>}
            </div>
          )}
          <div className={detailCss.actions}>
            {working
              ? (
                <Button variant="primary" size="sm" disabled icon={<IconLoadingOutlineRegular size={14} className={detailCss.spin} />}>
                  {installing || preparing ? t('installing') : t('connectorStarting')}
                </Button>
              )
              : view?.state === 'failed'
                ? (
                  <>
                    <Button variant="primary" size="sm" icon={<IconRefreshOutlineRegular size={14} />}
                      onClick={() => { void props.retryConnector(id, name) }}>
                      {t('retry')}
                    </Button>
                    <Button variant="outline" size="sm" icon={<IconNewChatOutlineRegular size={14} />}
                      onClick={() => { onClose(); props.diagnose(diagnosisPrompt(view, name, t)) }}>
                      {t('diagnose')}
                    </Button>
                  </>
                )
                : custom === undefined && (view === undefined || (!view.enabled && !view.confirmed)) && (
                  <Button variant="primary" size="sm" onClick={() => { void connect() }}>{t('connect')}</Button>
                )}
            {outdated && !working && (
              <Button variant="outline" size="sm" icon={<IconDownloadOutlineRegular size={14} />}
                onClick={() => { void props.install(ref, name) }}>
                {t('update')}
              </Button>
            )}
            {view !== undefined && (
              <MoreMenu t={t} removeLabel={custom === undefined ? t('uninstall') : t('delete')}
                {...custom === undefined ? {} : { onEdit: () => { props.onEdit(custom) } }}
                onRemove={() => { setConfirmingRemoval(true) }} />
            )}
          </div>
          {progress !== undefined && <InstallProgress progress={progress} t={t} />}
        </div>
      </div>
      <div className={detailCss.body}>
        {accepting !== null && (
          <div className={detailCss.confirm} role="alertdialog" aria-label={t('confirmConnect', { name })}>
            <p className={detailCss.confirmTitle}>{t('confirmConnect', { name })}</p>
            <p className={detailCss.confirmText}>{t('confirmConnectText')}</p>
            <code className={localCss.program}>{programLine(accepting)}</code>
            <div className={detailCss.confirmActions}>
              <Button variant="outline" size="sm" onClick={() => { setAccepting(null) }}>{t('cancel')}</Button>
              <Button variant="primary" size="sm" onClick={() => { void accept() }}>{t('confirmConnectAccept')}</Button>
            </div>
          </div>
        )}
        {confirmingRemoval && (
          <div className={detailCss.confirm} role="alertdialog"
            aria-label={custom === undefined ? t('confirmUninstall', { name }) : t('confirmDelete', { name })}>
            <p className={detailCss.confirmTitle}>{custom === undefined ? t('confirmUninstall', { name }) : t('confirmDelete', { name })}</p>
            <p className={detailCss.confirmText}>{custom === undefined ? t('confirmUninstallConnector') : t('confirmDeleteText')}</p>
            <div className={detailCss.confirmActions}>
              <Button variant="outline" size="sm" onClick={() => { setConfirmingRemoval(false) }}>{t('cancel')}</Button>
              <Button variant="primary" size="sm" onClick={() => { void remove() }}>{custom === undefined ? t('uninstall') : t('delete')}</Button>
            </div>
          </div>
        )}
        {view !== undefined && <FailureInfo view={view} t={t} />}
        {item !== undefined && custom === undefined && <p className={detailCss.description}>{text(item.description)}</p>}
        {view?.settings !== undefined && (
          <ConnectorSettings id={id} settings={view.settings} busy={busy} t={t} text={text} save={props.saveConnectorSettings} />
        )}
        <section className={detailCss.section}>
          <h3 className={detailCss.sectionTitle}><IconInfoOutlineRegular size={16} />{t('basicInfo')}</h3>
          {custom === undefined
            ? (
              <dl className={detailCss.facts}>
                {item !== undefined && (
                  <div className={detailCss.fact}>
                    <dt>{t('version')}</dt>
                    <dd>{t('versionValue', { version: item.version })}</dd>
                  </div>
                )}
                <div className={detailCss.fact}>
                  <dt>{t('connectorStatus')}</dt>
                  <dd>{t(status?.key ?? 'connectorOff')}</dd>
                </div>
              </dl>
            )
            : <CustomFacts config={custom} t={t} />}
        </section>
      </div>
    </Modal>
  )
}

/** Why a start failed: the hint in the user's language, the Host's reason, and the program's last stderr lines. */
function FailureInfo({ view, t }: { view: ConnectorView; t: Translate }): ReactNode {
  if (view.error === undefined) return null
  const hint = hintText(view, t)
  return (
    <div className={localCss.failure} role="alert">
      {hint !== undefined && <p className={localCss.failureHint}><IconWarningOutlineRegular size={14} />{hint}</p>}
      <p className={hint === undefined ? css.alert : localCss.failureReason}>
        {hint === undefined && <IconWarningOutlineRegular size={14} />}{view.error}
      </p>
      {view.stderr !== undefined && view.stderr.length > 0 && (
        <div className={localCss.stderrBlock}>
          <span className={localCss.stderrTitle}>{t('stderrTitle')}</span>
          <pre className={localCss.stderr}>{view.stderr.join('\n')}</pre>
        </div>
      )}
    </div>
  )
}

/** Commands whose missing runtime the hint can name. */
const RUNTIME_OF: Readonly<Record<string, 'hintNode' | 'hintUv' | 'hintPython'>> = {
  npx: 'hintNode', npm: 'hintNode', node: 'hintNode', pnpm: 'hintNode', pnpx: 'hintNode',
  uv: 'hintUv', uvx: 'hintUv',
  python: 'hintPython', python3: 'hintPython', py: 'hintPython', pip: 'hintPython', pip3: 'hintPython',
}

function hintText(view: ConnectorView, t: Translate): string | undefined {
  switch (view.hint) {
    case undefined: return undefined
    case 'command-not-found': {
      const command = view.launch?.command ?? ''
      const program = command.split(/[\\/]/).at(-1)?.replace(/\.(exe|cmd|bat)$/i, '').toLowerCase() ?? ''
      return t(RUNTIME_OF[program] ?? 'hintCommand', { command })
    }
    case 'cwd-not-found': return t('hintCwdNotFound', { cwd: view.custom?.transport === 'stdio' ? view.custom.cwd ?? '' : '' })
    case 'start-timeout': return t('hintStartTimeout')
    case 'unauthorized': return t('hintUnauthorized')
    case 'maybe-sse': return t('hintMaybeSse')
    case 'unreachable': return t('hintUnreachable')
    case 'setting-required': return t('hintSettingRequired')
  }
}

/**
 * The request a diagnosis conversation starts with. Environment variable and header names are
 * listed without their values, so no token reaches the conversation or the model service.
 */
function diagnosisPrompt(view: ConnectorView, name: string, t: Translate): string {
  const lines: string[] = []
  const config = view.custom
  const omitted = (names: readonly string[]): string => `${names.join(', ')} ${t('valuesOmitted')}`
  if (config?.transport === 'stdio') {
    lines.push(`${t('connectorType')}: ${t('typeStdio')}`, `${t('fieldCommand')}: ${joinCommandLine(config.command, config.args)}`)
    lines.push(`${t('fieldCwd')}: ${config.cwd ?? t('connectorCwdDefault')}`)
    const envNames = Object.keys(config.env)
    if (envNames.length > 0) lines.push(`${t('fieldEnv')}: ${omitted(envNames)}`)
  } else if (config?.transport === 'streamable-http') {
    lines.push(`${t('connectorType')}: ${t('typeHttp')}`, `${t('fieldUrl')}: ${config.url}`)
    const headerNames = Object.keys(config.headers)
    if (headerNames.length > 0) lines.push(`${t('fieldHeaders')}: ${omitted(headerNames)}`)
  } else if (view.launch !== undefined) {
    lines.push(`${t('fieldCommand')}: ${programLine(view.launch)}`)
  }
  lines.push(`${t('failureReason')}: ${view.error ?? ''}`)
  if (view.stderr !== undefined && view.stderr.length > 0) lines.push(`${t('stderrTitle')}:`, '```', ...view.stderr, '```')
  return t('promptDiagnose', { name, details: lines.join('\n') })
}

/** A custom connector's configuration; environment and header values stay hidden until shown. */
function CustomFacts({ config, t }: { config: CustomConnectorConfig; t: Translate }): ReactNode {
  return (
    <dl className={localCss.config}>
      <dt>{t('connectorType')}</dt>
      <dd>{config.transport === 'stdio' ? t('typeStdio') : t('typeHttp')}</dd>
      {config.transport === 'stdio'
        ? (
          <>
            <dt>{t('fieldCommand')}</dt>
            <dd><code className={localCss.mono}>{joinCommandLine(config.command, config.args)}</code></dd>
            <dt>{t('fieldCwd')}</dt>
            <dd>{config.cwd === undefined ? t('connectorCwdDefault') : <code className={localCss.mono}>{config.cwd}</code>}</dd>
            {Object.keys(config.env).length > 0 && (
              <>
                <dt>{t('fieldEnv')}</dt>
                <dd><SecretPairs pairs={config.env} t={t} /></dd>
              </>
            )}
          </>
        )
        : (
          <>
            <dt>{t('fieldUrl')}</dt>
            <dd><code className={localCss.mono}>{config.url}</code></dd>
            {Object.keys(config.headers).length > 0 && (
              <>
                <dt>{t('fieldHeaders')}</dt>
                <dd><SecretPairs pairs={config.headers} t={t} /></dd>
              </>
            )}
          </>
        )}
      {config.toolCallTimeoutMs !== undefined && (
        <>
          <dt>{t('fieldTimeout')}</dt>
          <dd>{t('timeoutValue', { seconds: Math.round(config.toolCallTimeoutMs / 1000) })}</dd>
        </>
      )}
    </dl>
  )
}

const MASK = '••••••'

function SecretPairs({ pairs, t }: { pairs: Readonly<Record<string, string>>; t: Translate }): ReactNode {
  const [shown, setShown] = useState(false)
  return (
    <div className={localCss.pairs}>
      <ul className={localCss.pairList}>
        {Object.entries(pairs).map(([key, value]) => (
          <li key={key}><code className={localCss.mono}>{key}</code> <code className={localCss.mono}>{shown ? value : MASK}</code></li>
        ))}
      </ul>
      <Button variant="ghost" size="sm" onClick={() => { setShown(value => !value) }}>{shown ? t('hideValues') : t('showValues')}</Button>
    </div>
  )
}

function MoreMenu({ t, removeLabel, onEdit, onRemove }: {
  t: Translate
  removeLabel: string
  onEdit?: () => void
  onRemove: () => void
}): ReactNode {
  const [open, setOpen] = useState(false)
  return (
    <Menu open={open} onClose={() => { setOpen(false) }} align="start" portal autoFocus
      anchor={(
        <Button variant="outline" size="sm" className={detailCss.more} aria-label={t('more')} aria-haspopup="menu" aria-expanded={open}
          onClick={() => { setOpen(value => !value) }}>
          <IconEllipsisOutlineRegular size={16} />
        </Button>
      )}>
      {onEdit !== undefined && (
        <MenuItemButton icon={<IconEditOutlineRegular size={14} />} onSelect={() => { setOpen(false); onEdit() }}>
          {t('edit')}
        </MenuItemButton>
      )}
      <MenuItemButton danger icon={<IconTrashOutlineRegular size={14} />} onSelect={() => { setOpen(false); onRemove() }}>
        {removeLabel}
      </MenuItemButton>
    </Menu>
  )
}

/** The tag a connector shows; a switched-off valid connector shows none, its switch says it. */
function statusOf(view: ConnectorView | undefined): { readonly tone: TagTone; readonly key: 'connectorConnected' | 'connectorStarting' | 'connectorFailed' | 'connectorInvalid' } | undefined {
  if (view === undefined) return undefined
  switch (view.state) {
    case 'connected': return { tone: 'success', key: 'connectorConnected' }
    case 'starting': return { tone: 'info', key: 'connectorStarting' }
    case 'failed': return { tone: 'danger', key: 'connectorFailed' }
    case 'off': return view.origin === 'market' && view.launch === undefined ? { tone: 'warning', key: 'connectorInvalid' } : undefined
  }
}

function programLine(launch: ConnectorLaunchView): string {
  return [launch.command, ...launch.args].join(' ')
}
