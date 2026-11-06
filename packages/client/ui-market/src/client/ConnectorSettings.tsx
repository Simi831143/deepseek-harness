/**
 * The settings section of a market connector's detail dialog: one field per value the
 * connector's `settings.json` asks for, such as an API key. A saved secret is never sent to the
 * page, so its field stays empty and shows that a value is saved; typing a new value replaces it
 * and the clear button removes it. Saving sends only the changed fields; the Host keeps the
 * values in its credential store and restarts a running connector with them.
 */
import { useId, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import type { MarketText } from '@deepseek-ai/dsh-market/types'
import type { ConnectorSettingView, ConnectorsValue } from '@deepseek-ai/dsh-market-connectors/types'
import { Button, IconLinkOutlineRegular, IconSettingsOutlineRegular, IconWarningOutlineRegular, Input, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarketResult } from './market-store.ts'
import type { MarketPageProps } from './MarketPage.tsx'
import dialogCss from './CustomConnectorDialog.module.css'
import detailCss from './SkillDetail.module.css'
import localCss from './Connectors.module.css'

type Translate = MarketPageProps['t']

/** Props of the settings section. */
export interface ConnectorSettingsProps {
  readonly id: string
  readonly settings: readonly ConnectorSettingView[]
  readonly busy: boolean
  readonly t: Translate
  readonly text: (value: MarketText) => string
  readonly save: (id: string, values: Readonly<Record<string, string | null>>) => Promise<MarketResult<ConnectorsValue>>
}

/**
 * Render the settings fields of one market connector.
 * @param props - connector id, its declared settings with their saved state, copy and the save action.
 * @returns the settings section.
 */
export function ConnectorSettings(props: ConnectorSettingsProps): ReactNode {
  const { id, settings, busy, t, text } = props
  const [draft, setDraft] = useState<Readonly<Record<string, string>>>({})
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [saved, setSaved] = useState(false)
  const typed = Object.entries(draft).filter(([, value]) => value.trim().length > 0)
  const submit = async (changes: Readonly<Record<string, string | null>>): Promise<void> => {
    setFailure(undefined)
    setSaved(false)
    const result = await props.save(id, changes)
    if (!result.ok) { setFailure(t('settingsSaveFailed', { reason: reasonOf(result.error) })); return }
    setDraft({})
    setSaved(true)
  }
  return (
    <section className={detailCss.section}>
      <h3 className={detailCss.sectionTitle}><IconSettingsOutlineRegular size={16} />{t('settingsTitle')}</h3>
      <form className={localCss.settings} onSubmit={(event) => { event.preventDefault(); void submit(Object.fromEntries(typed)) }}>
        {settings.map(setting => (
          <SettingField key={setting.env} setting={setting} value={draft[setting.env] ?? ''} busy={busy} t={t} text={text}
            onChange={(value) => { setSaved(false); setDraft(current => ({ ...current, [setting.env]: value })) }}
            onClear={() => { void submit({ [setting.env]: null }) }} />
        ))}
        <p className={dialogCss.hint}>{t('settingsStoredNote')}</p>
        {failure !== undefined && <p className={dialogCss.error} role="alert"><IconWarningOutlineRegular size={14} />{failure}</p>}
        <div className={localCss.settingsActions}>
          {saved && <span className={dialogCss.hint} role="status">{t('settingsSaved')}</span>}
          <Button type="submit" variant="primary" size="sm" disabled={busy || typed.length === 0}>{t('settingsSave')}</Button>
        </div>
      </form>
    </section>
  )
}

function SettingField(props: {
  setting: ConnectorSettingView
  value: string
  busy: boolean
  t: Translate
  text: (value: MarketText) => string
  onChange: (value: string) => void
  onClear: () => void
}): ReactNode {
  const { setting, value, busy, t, text } = props
  const inputId = useId()
  const hintId = `${inputId}-hint`
  const placeholder = setting.configured ? t('settingSavedPlaceholder') : t('settingEmptyPlaceholder')
  return (
    <div className={dialogCss.field}>
      <div className={localCss.settingLabelRow}>
        <label className={dialogCss.label} htmlFor={inputId}>{text(setting.label)}</label>
        {setting.required && <Tag tone="outline">{t('settingRequired')}</Tag>}
        <Tag tone={setting.configured ? 'success' : 'outline'}>{setting.configured ? t('settingConfigured') : t('settingNotConfigured')}</Tag>
      </div>
      <div className={localCss.settingInputRow}>
        <Input id={inputId} aria-describedby={hintId} className={clsx(dialogCss.input)} value={value} placeholder={placeholder}
          type={setting.secret ? 'password' : 'text'} autoComplete="off" spellCheck={false} disabled={busy}
          onChange={(event) => { props.onChange(event.currentTarget.value) }} />
        {setting.configured && (
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={props.onClear}>{t('settingClear')}</Button>
        )}
      </div>
      <span id={hintId} className={dialogCss.hint}>
        {setting.description === undefined ? <code>{setting.env}</code> : text(setting.description)}
        {setting.url !== undefined && (
          <a className={localCss.settingLink} href={setting.url} target="_blank" rel="noopener noreferrer">
            <IconLinkOutlineRegular size={12} />{t('settingGetValue')}
          </a>
        )}
      </span>
    </div>
  )
}

function reasonOf(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') return error.message
  return String(error)
}
