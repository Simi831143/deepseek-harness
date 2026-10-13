/** Optional Electron update card; the native shell owns actions and Web owns visible copy. */
import clsx from 'clsx'
import {
  IconDownloadOutlineRegular, IconLoadingOutlineRegular, IconRefreshOutlineRegular, IconRightUpOutlineRegular, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './DesktopUpdateIndicator.module.css'
import type { DesktopUpdateFailureKind, DesktopUpdatePresentation, DesktopUpdateView } from '../types.ts'
import type { SettingsRootInjected } from './shell-contract.ts'

type SettingsTranslate = PropsLocale<'settings'>['t']

const BUSY_PHASES: ReadonlySet<DesktopUpdatePresentation['phase']> = new Set([
  'checking', 'downloading', 'verifying', 'installing',
])

function failureCopy(failure: DesktopUpdateFailureKind | undefined, t: SettingsTranslate): string {
  const failures: Readonly<Record<DesktopUpdateFailureKind, string>> = {
    check: t('desktop.update.checkFailed'),
    'check-network': t('desktop.update.checkNetworkFailed'),
    download: t('desktop.update.downloadFailed'),
    'download-network': t('desktop.update.downloadNetworkFailed'),
    install: t('desktop.update.installFailed'),
    'install-network': t('desktop.update.installNetworkFailed'),
    'stop-failed': t('desktop.update.stopFailed'),
    'tasks-changed': t('desktop.update.tasksChanged'),
    'tasks-unavailable': t('desktop.update.tasksUnavailable'),
  }
  return failures[failure ?? 'install']
}

/** Visible card content for one shell state; `action` is absent while the shell is busy. */
interface UpdateCardCopy {
  readonly title: string
  readonly subtitle?: string
  readonly action?: string
  readonly tooltip: string
  readonly percent?: number
  readonly error: boolean
}

function cardCopy(state: DesktopUpdatePresentation | undefined, failed: boolean, t: SettingsTranslate): UpdateCardCopy {
  if (failed || state === undefined) {
    const retry = t('desktop.update.retry')
    return { title: retry, action: t('desktop.update.retryAction'), tooltip: retry, error: true }
  }
  const version = state.version === undefined ? undefined : t('desktop.update.versionLine', { version: state.version })
  switch (state.phase) {
    case 'available':
      return { title: t('desktop.update.available'), ...version === undefined ? {} : { subtitle: version },
        action: t('desktop.update.downloadAction'), tooltip: version ?? t('desktop.update.available'), error: false }
    case 'downloading': {
      const percent = state.percent ?? 0
      return { title: t('desktop.update.downloading'), subtitle: t('desktop.update.progress', { percent }), percent,
        tooltip: state.version === undefined ? t('desktop.update.progress', { percent })
          : t('desktop.update.downloadDetail', { percent, version: state.version }), error: false }
    }
    case 'ready':
      return { title: t('desktop.update.ready'), ...version === undefined ? {} : { subtitle: version },
        action: t('desktop.update.restartAction'),
        tooltip: state.version === undefined ? t('desktop.update.readyHintNoVersion')
          : t('desktop.update.readyHint', { version: state.version }), error: false }
    case 'error':
      return { title: failureCopy(state.failure, t), action: t('desktop.update.retryAction'),
        tooltip: failureCopy(state.failure, t), error: true }
    case 'checking':
    case 'verifying':
    case 'installing':
    case 'idle': {
      const label = t(`desktop.update.${state.phase === 'idle' ? 'checking' : state.phase}`)
      return { title: label, ...version === undefined ? {} : { subtitle: version }, tooltip: state.version ?? label, error: false }
    }
  }
}

function cardIcon(state: DesktopUpdatePresentation | undefined, error: boolean, busy: boolean) {
  if (error) return <IconRefreshOutlineRegular size={14} />
  if (state?.phase === 'downloading') return <IconDownloadOutlineRegular size={14} />
  if (busy) return <IconLoadingOutlineRegular className={css.spinner} size={14} />
  return <IconRightUpOutlineRegular size={14} />
}

/**
 * Render update status as a card above the settings trigger: status text, one action, and download progress.
 * @param props - Connection priority, sidebar width, and localized bridge-failure copy.
 * @returns Desktop-only card in the expanded sidebar, or nothing in browsers.
 */
export function DesktopUpdateIndicator({ wide, hidden, t, view, onOpen }: {
  wide: boolean
  hidden: boolean
  t: SettingsTranslate
  view: DesktopUpdateView
  onOpen: () => void
}) {
  const { presentation: state, failed, opening } = view
  if (!wide || hidden || (!failed && (state === undefined || state.phase === 'idle'))) return null
  const copy = cardCopy(state, failed, t)
  const busy = opening || (!failed && state !== undefined && BUSY_PHASES.has(state.phase))
  return <section className={clsx(css.card, copy.error && css.error)} aria-label={t('desktop.update.region')}>
    <div className={css.row}>
      <span className={css.icon} aria-hidden="true">{cardIcon(state, copy.error, busy)}</span>
      <span className={css.text}>
        <span className={css.title}>{copy.title}</span>
        {copy.subtitle !== undefined && <span className={css.subtitle}>{copy.subtitle}</span>}
      </span>
      {copy.action !== undefined && <Tooltip label={copy.tooltip} side="top">
        <button type="button" className={css.action} aria-disabled={busy}
          aria-label={`${copy.action}: ${copy.title}`} onClick={() => { if (!busy) onOpen() }}>{copy.action}</button>
      </Tooltip>}
    </div>
    {copy.percent !== undefined && <div className={css.track} role="progressbar" aria-label={copy.title}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={copy.percent}>
      <div className={css.bar} style={{ width: `${String(Math.min(100, Math.max(0, copy.percent)))}%` }} />
    </div>}
  </section>
}

type BadgeProps = PropsRuntime<'sidebar.toggle.badge'> & PropsLocale<'settings'>
  & Pick<InjectFace<SettingsRootInjected>, 'useDesktopUpdate' | 'useConnectionState'>

/**
 * @param props - Framework-bound carrier and connection state.
 * @returns A non-interactive brand-blue notification on the sidebar expand button.
 */
export function DesktopUpdateBadge({ useDesktopUpdate, useConnectionState, t }: BadgeProps) {
  const { presentation: state, failed } = useDesktopUpdate(value => value)
  const connection = useConnectionState(value => value)
  if (((connection === 'disconnected' || connection === 'connecting') && state?.phase !== 'installing')
    || (!failed && (state === undefined || state.phase === 'idle'))) return null
  const copy = cardCopy(state, failed, t)
  const label = copy.subtitle === undefined ? copy.title : `${copy.title} ${copy.subtitle}`
  return <Tooltip label={copy.tooltip} side="right">
    <span role="img" aria-label={label} className={css.badge} />
  </Tooltip>
}
