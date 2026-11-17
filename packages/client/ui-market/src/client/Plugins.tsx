/** Plugin catalog and exact-version actions through the shared market service. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import type { MarketItemView, MarketSnapshot, MarketText } from '@deepseek-ai/dsh-market/types'
import {
  Button, IconChevronDownOutlineRegular, IconCloseOutlineRegular, IconInfoOutlineRegular, IconLoadingOutlineRegular,
  IconSearchOutlineRegular, Input, Menu, Modal, Pill, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { InstallProgress } from './InstallProgress.tsx'
import { ItemIcon } from './ItemIcon.tsx'
import type { MarketPageProps } from './MarketPage.tsx'
import cardCss from './MarketCard.module.css'
import css from './MarketPage.module.css'
import detailCss from './SkillDetail.module.css'

type PluginProps = MarketPageProps & { text: (value: MarketText) => string }

/**
 * Render market plugins with the same catalog, progress, and operation feedback as other kinds.
 * @param props - page actions, shared market snapshot, and localized catalog text.
 * @returns search, category filters, plugin cards, and the selected detail dialog.
 */
export function PluginCatalog(props: PluginProps & { market: MarketSnapshot | undefined }): ReactNode {
  const { market, text, t } = props
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const plugins = (market?.items ?? []).filter(item => item.kind === 'plugin')
  const categories = (market?.categories ?? []).filter(entry => entry.kind === 'plugin')
  const needle = query.trim().toLowerCase()
  const visible = plugins.filter(item => (category === null || item.category === category)
    && (needle === '' || [item.id, item.plugin?.name ?? '', text(item.name), text(item.description), ...item.tags ?? []]
      .some(field => field.toLowerCase().includes(needle))))
  return (
    <>
      <div className={css.toolbar}>
        <Input className={css.search ?? ''} type="search" icon={<IconSearchOutlineRegular size={14} />}
          placeholder={t('searchPlugins')} aria-label={t('searchPlugins')} value={query}
          onChange={(event) => { setQuery(event.currentTarget.value) }} />
      </div>
      {market === undefined
        ? <p className={css.empty}>{t('loading')}</p>
        : (
          <section aria-label={t('tabPlugins')}>
            {categories.length > 0 && (
              <div className={css.chips} role="group" aria-label={t('recommended')}>
                <Pill active={category === null} onClick={() => { setCategory(null) }}>{t('allCategories')}</Pill>
                {categories.map(entry => (
                  <Pill key={entry.id} active={category === entry.id} onClick={() => { setCategory(entry.id) }}>{text(entry.name)}</Pill>
                ))}
              </div>
            )}
            {visible.length === 0
              ? <p className={css.empty}>{plugins.length === 0 ? t('emptyPlugins') : t('emptyPluginSearch')}</p>
              : (
                <ul className={css.grid}>
                  {visible.map(item => <PluginCard key={item.id} {...props} item={item} onOpen={() => { setDetailId(item.id) }} />)}
                </ul>
              )}
          </section>
        )}
      {detailId !== null && <PluginDetail key={detailId} {...props} id={detailId} onClose={() => { setDetailId(null) }} />}
    </>
  )
}

function PluginCard(props: PluginProps & { item: MarketItemView; onOpen: () => void }): ReactNode {
  const { item, text, t, onOpen } = props
  const busy = props.useMarket(state => state.market?.installing.includes(`plugin:${item.id}`) ?? false)
  const progress = props.useMarket(state => state.market?.progress.find(entry => entry.key === `plugin:${item.id}`))
  const name = text(item.name)
  return (
    <li className={clsx(cardCss.card, css.cardClickable)}>
      <div className={css.cardHead}>
        <ItemIcon item={item} className={css.icon} glyphSize={18} />
        <div className={css.cardTitleBlock}>
          <button type="button" className={css.cardOpen} aria-label={t('openDetail', { name })} onClick={onOpen}>
            <span className={css.cardTitle} title={name}>{name}</span>
          </button>
          <span className={css.cardMeta}>{item.plugin?.name ?? item.id}</span>
        </div>
        {busy
          ? <span className={css.cardAction} aria-label={t('installing')}><IconLoadingOutlineRegular size={16} className={css.spin} /></span>
          : item.managed?.provided === true
            ? <Tag tone="outline">{t('pluginProvided')}</Tag>
            : item.installedVersion !== undefined
              ? <Tag tone="outline">{item.installedVersion === item.version ? t('installedBadge') : t('update')}</Tag>
              : item.managed?.compatible === false && <Tag tone="outline">{t('pluginIncompatible')}</Tag>}
      </div>
      <p className={css.cardDescription}>{text(item.description)}</p>
      {progress !== undefined && <InstallProgress progress={progress} t={t} compact />}
    </li>
  )
}

/**
 * Render one plugin's versions and confirmed shared-market operations.
 * @param props - market actions, plugin id, text picker, and dialog dismissal.
 * @returns the plugin detail dialog, or nothing when its catalog entry was removed.
 */
export function PluginDetail(props: PluginProps & { id: string; onClose: () => void }): ReactNode {
  const { id, text, t, onClose } = props
  const item = props.useMarket(state => state.market?.items.find(entry => entry.kind === 'plugin' && entry.id === id))
  const busy = props.useMarket(state => state.market?.installing.includes(`plugin:${id}`) ?? false)
  const progress = props.useMarket(state => state.market?.progress.find(entry => entry.key === `plugin:${id}`))
  const [selection, setSelection] = useState<string | null>(null)
  const [versionMenu, setVersionMenu] = useState(false)
  const [confirming, setConfirming] = useState<'install' | 'uninstall' | null>(null)
  const [pending, setPending] = useState(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  if (item === undefined) return null
  const name = text(item.name)
  const version = selection !== null && item.plugin?.versions.some(entry => entry.version === selection) === true ? selection : item.version
  const compatibility = item.managed?.versions?.find(entry => entry.version === version)
  const compatible = compatibility?.compatible ?? item.managed?.compatible ?? false
  const reason = compatibility?.reason ?? item.managed?.reason
  const provided = item.managed?.provided === true
  const installed = item.managed?.installed === true || item.installedVersion !== undefined
  const current = item.installedVersion === version
  const blocked = busy || pending || !compatible || provided || current
  const install = async (): Promise<void> => {
    setPending(true)
    try {
      const installed = await props.install({ kind: 'plugin', id, version }, name)
      if (installed && mounted.current) setConfirming(null)
    } finally {
      if (mounted.current) setPending(false)
    }
  }
  const uninstall = async (): Promise<void> => {
    setPending(true)
    try { await props.uninstall({ kind: 'plugin', id }, name) } finally {
      if (mounted.current) { setPending(false); setConfirming(null) }
    }
  }
  return (
    <Modal open headless onClose={onClose} title={name} className={detailCss.dialog ?? ''}>
      <div className={detailCss.header}>
        <ItemIcon item={item} className={detailCss.icon} glyphSize={28} />
        <div className={detailCss.headerBody}>
          <div className={detailCss.titleRow}>
            <h2 className={detailCss.title}>{name}</h2>
            <Button variant="ghost" size="sm" className={detailCss.close} aria-label={t('close')} onClick={onClose}>
              <IconCloseOutlineRegular size={16} />
            </Button>
          </div>
          <span className={detailCss.id}>{item.plugin?.name ?? id}</span>
          <div className={detailCss.actions}>
            <Button variant="primary" size="sm" disabled={blocked} onClick={() => { setConfirming('install') }}>
              {busy ? t('installing') : provided ? t('pluginProvided') : current ? t('installedBadge') : installed ? t('update') : t('install')}
            </Button>
            {installed && !provided && (
              <Button variant="outline" size="sm" disabled={busy || pending} onClick={() => { setConfirming('uninstall') }}>
                {t('uninstall')}
              </Button>
            )}
          </div>
          {progress !== undefined && <InstallProgress progress={progress} t={t} />}
        </div>
      </div>
      <div className={detailCss.body}>
        {confirming !== null && (
          <div className={detailCss.confirm} role="alertdialog"
            aria-label={t(confirming === 'install' ? 'confirmInstallPlugin' : 'confirmUninstall', { name })}>
            <p className={detailCss.confirmTitle}>{t(confirming === 'install' ? 'confirmInstallPlugin' : 'confirmUninstall', { name })}</p>
            <p className={detailCss.confirmText}>{t(confirming === 'install' ? 'confirmInstallPluginText' : 'confirmUninstallPlugin')}</p>
            <div className={detailCss.confirmActions}>
              <Button variant="outline" size="sm" disabled={busy || pending} onClick={() => { setConfirming(null) }}>{t('cancel')}</Button>
              <Button variant="primary" size="sm" disabled={confirming === 'install' ? blocked : busy || pending}
                onClick={() => { void (confirming === 'install' ? install() : uninstall()) }}>
                {t(confirming === 'install' ? 'install' : 'uninstall')}
              </Button>
            </div>
          </div>
        )}
        <p className={detailCss.description}>{text(item.description)}</p>
        {item.managed?.restartRequired === true && <p className={css.info} role="status">{t('pluginRestartRequired')}</p>}
        {!compatible && <p className={css.info}>{reason ?? t('pluginIncompatible')}</p>}
        <p className={detailCss.muted}>{t('pluginManageHint')}</p>
        <section className={detailCss.section}>
          <h3 className={detailCss.sectionTitle}><IconInfoOutlineRegular size={16} />{t('basicInfo')}</h3>
          <dl className={detailCss.facts}>
            <div className={detailCss.fact}>
              <dt>{t('version')}</dt>
              <dd>
                <Menu open={versionMenu} onClose={() => { setVersionMenu(false) }} portal autoFocus selectedId={version}
                  items={(item.plugin?.versions ?? [{ version: item.version }]).map(entry => ({ id: entry.version, label: entry.version }))}
                  onSelect={(selected) => { setSelection(selected); setConfirming(null); setVersionMenu(false) }}
                  anchor={<Button variant="outline" size="sm" disabled={busy || pending} aria-label={t('pluginSelectVersion')}
                    aria-expanded={versionMenu} onClick={() => { setVersionMenu(!versionMenu) }}>
                    {t('versionValue', { version })}<IconChevronDownOutlineRegular size={12} />
                  </Button>} />
              </dd>
            </div>
            {item.installedVersion !== undefined && (
              <div className={detailCss.fact}><dt>{t('pluginInstalledVersion')}</dt><dd>{item.installedVersion}</dd></div>
            )}
          </dl>
        </section>
      </div>
    </Modal>
  )
}
