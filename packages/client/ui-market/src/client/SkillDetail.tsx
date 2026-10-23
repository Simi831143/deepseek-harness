/**
 * Detail dialog of one skill, opened from the market catalog and from the
 * installed-skill manager alike. It joins the skill's catalog entry (display
 * name, icon, description, example requests, version) with its installed
 * state (switch, uninstall, overview of its instructions), so any skill shows
 * the parts it has: a catalog skill not yet installed offers Install, an
 * installed skill offers the switch, and a market download also offers
 * Uninstall; built-in skills ship with the application and only switch off.
 * Picking an example
 * installs the skill when needed, then opens a new conversation whose composer
 * holds the skill chip and the example.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { MarketItemView, MarketText } from '@deepseek-ai/dsh-market/types'
import type { InstalledSkillOrigin, InstalledSkillView } from '@deepseek-ai/dsh-market-skills/types'
import {
  Button, IconCloseOutlineRegular, IconDownloadOutlineRegular, IconEllipsisOutlineRegular,
  IconFlatListOutlineRegular, IconInfoOutlineRegular, IconLoadingOutlineRegular, IconNewChatOutlineRegular, IconSkillOutlineRegular,
  IconSparkleRegular, IconTrashOutlineRegular, Menu, MenuItemButton, Modal, Switch,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { ItemIcon } from './ItemIcon.tsx'
import type { MarketPageProps } from './MarketPage.tsx'
import { SkillOverview } from './SkillOverview.tsx'
import css from './SkillDetail.module.css'

/** Props of the skill detail dialog. */
export type SkillDetailProps = MarketPageProps & {
  /** Skill name: the catalog id and the installed name are the same. */
  skill: string
  text: (value: MarketText) => string
  onClose: () => void
}

const ORIGIN_KEY = { market: 'originMarket', user: 'originUser' } as const satisfies Record<InstalledSkillOrigin, string>

/**
 * Render the detail dialog of one skill.
 * @param props - the skill name, page actions, copy and the close command.
 * @returns the open dialog, or nothing once the skill is neither published nor installed.
 */
export function SkillDetail(props: SkillDetailProps): ReactNode {
  const { skill, text, t, onClose } = props
  const item = props.useMarket(state => state.market?.items.find(entry => entry.kind === 'skill' && entry.id === skill))
  const installed = props.useMarket(state => state.installedSkills?.skills.find(entry => entry.name === skill))
  const installing = props.useMarket(state => state.market?.installing.includes(`skill:${skill}`) ?? false)
  const switching = props.useMarket(state => state.switching.includes(skill))
  const [installingForTry, setInstallingForTry] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  // The installed list is read on demand; the dialog needs it for the switch and the overview.
  useEffect(() => { void props.loadInstalledSkills() }, [props.loadInstalledSkills])

  if (item === undefined && installed === undefined) return null
  const name = item === undefined ? skill : text(item.name)
  const description = item === undefined ? installed?.description ?? '' : text(item.description)
  const examples = (item?.examples ?? []).map(text)
  const busy = installing || installingForTry
  const ref = { kind: 'skill' as const, id: skill }

  const ensureInstalled = async (): Promise<boolean> => {
    if (installed !== undefined) return true
    setInstallingForTry(true)
    const ok = await props.install(ref, name)
    // A dialog closed during the install has given up on the request.
    if (!mounted.current) return false
    setInstallingForTry(false)
    return ok
  }
  const tryWith = async (request: string): Promise<void> => {
    if (!await ensureInstalled()) return
    // A disabled skill would not load; trying it is asking for it, so switch it on first.
    if (installed?.enabled === false && !await props.setSkillsEnabled([skill], true)) return
    if (!mounted.current) return
    onClose()
    props.trySkill(skill, request)
  }
  const overviewHeading = <h3 className={css.sectionTitle}><IconFlatListOutlineRegular size={16} />{t('overview')}</h3>
  const uninstall = async (): Promise<void> => {
    setConfirming(false)
    await props.uninstall(ref, name)
  }

  return (
    <Modal open headless onClose={onClose} title={name} className={css.dialog as string}>
      <div className={css.header}>
        {item === undefined
          ? <span className={css.icon} aria-hidden="true"><IconSkillOutlineRegular size={28} /></span>
          : <ItemIcon item={item} className={css.icon} glyphSize={28} />}
        <div className={css.headerBody}>
          <div className={css.titleRow}>
            <h2 className={css.title}>{name}</h2>
            {installed !== undefined && (
              <Switch tone="success" checked={installed.enabled} disabled={switching} label={t('enableSwitch', { name })}
                onChange={(next) => { void props.setSkillsEnabled([skill], next) }} />
            )}
            <Button variant="ghost" size="sm" className={css.close} aria-label={t('close')} onClick={onClose}>
              <IconCloseOutlineRegular size={16} />
            </Button>
          </div>
          {name !== skill && <span className={css.id}>/{skill}</span>}
          <div className={css.actions}>
            <PrimaryAction {...props} item={item} installed={installed} busy={busy}
              onInstall={() => { void ensureInstalled() }} onTry={() => { void tryWith('') }} />
            {installed?.removable === true && (
              <MoreMenu {...props} onUninstall={() => { setConfirming(true) }} />
            )}
          </div>
        </div>
      </div>
      <div className={css.body}>
        {confirming && installed !== undefined && (
          <div className={css.confirm} role="alertdialog" aria-label={t('confirmUninstall', { name })}>
            <p className={css.confirmTitle}>{t('confirmUninstall', { name })}</p>
            <p className={css.confirmText}>{t('confirmUninstallMarket')}</p>
            <div className={css.confirmActions}>
              <Button variant="outline" size="sm" onClick={() => { setConfirming(false) }}>{t('cancel')}</Button>
              <Button variant="primary" size="sm" disabled={switching} onClick={() => { void uninstall() }}>{t('uninstall')}</Button>
            </div>
          </div>
        )}
        {description !== '' && <p className={css.description}>{description}</p>}
        {examples.length > 0 && (
          <section className={css.section} aria-busy={busy}>
            <h3 className={css.sectionTitle}>
              <IconSparkleRegular size={16} />
              {busy ? t('tryAskingInstalling') : t('tryAsking')}
            </h3>
            <ul className={css.examples}>
              {examples.map(example => (
                <li key={example}>
                  <button type="button" className={css.example} disabled={busy || switching} title={example}
                    onClick={() => { void tryWith(example) }}>
                    <span className={css.exampleText}>{example}</span>
                    <IconNewChatOutlineRegular size={16} className={css.exampleIcon} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        <section className={css.section}>
          {installed !== undefined
            ? <SkillOverview {...props} skill={skill} heading={overviewHeading} />
            : <>{overviewHeading}<p className={css.muted}>{t('notInstalledOverview')}</p></>}
        </section>
        <section className={css.section}>
          <h3 className={css.sectionTitle}><IconInfoOutlineRegular size={16} />{t('basicInfo')}</h3>
          <dl className={css.facts}>
            {item !== undefined && (
              <div className={css.fact}>
                <dt>{t('version')}</dt>
                <dd>{t('versionValue', { version: item.version })}</dd>
              </div>
            )}
            {installed !== undefined && (
              <div className={css.fact}>
                <dt>{t('source')}</dt>
                <dd>{t(ORIGIN_KEY[installed.origin])}</dd>
              </div>
            )}
          </dl>
        </section>
      </div>
    </Modal>
  )
}

function PrimaryAction({ item, installed, t, busy, onInstall, onTry }: SkillDetailProps & {
  item: MarketItemView | undefined
  installed: InstalledSkillView | undefined
  busy: boolean
  onInstall: () => void
  onTry: () => void
}): ReactNode {
  if (busy) {
    return (
      <Button variant="primary" size="sm" disabled icon={<IconLoadingOutlineRegular size={14} className={css.spin} />}>
        {t('installing')}
      </Button>
    )
  }
  if (installed === undefined && item !== undefined) {
    return (
      <Button variant="primary" size="sm" icon={<IconDownloadOutlineRegular size={14} />} onClick={onInstall}>
        {item.installedVersion === undefined ? t('install') : t('update')}
      </Button>
    )
  }
  // An installed skill offers Try it, which already says it is installed; no separate mark.
  const outdated = item?.installedVersion !== undefined && item.installedVersion !== item.version
  return (
    <>
      <Button variant="primary" size="sm" icon={<IconNewChatOutlineRegular size={14} />} onClick={onTry}>{t('tryIt')}</Button>
      {outdated && (
        <Button variant="outline" size="sm" icon={<IconDownloadOutlineRegular size={14} />} onClick={onInstall}>{t('update')}</Button>
      )}
    </>
  )
}

function MoreMenu({ t, onUninstall }: SkillDetailProps & { onUninstall: () => void }): ReactNode {
  const [open, setOpen] = useState(false)
  return (
    <Menu open={open} onClose={() => { setOpen(false) }} align="start" portal autoFocus
      anchor={(
        <Button variant="outline" size="sm" className={css.more} aria-label={t('more')} aria-haspopup="menu" aria-expanded={open}
          onClick={() => { setOpen(value => !value) }}>
          <IconEllipsisOutlineRegular size={16} />
        </Button>
      )}>
      <MenuItemButton danger icon={<IconTrashOutlineRegular size={14} />} onSelect={() => { setOpen(false); onUninstall() }}>
        {t('uninstall')}
      </MenuItemButton>
    </Menu>
  )
}
