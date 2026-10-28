/** The market page: section tabs, the skill catalog, and the installed-skill manager. */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import type { MarketItemView, MarketKindName, MarketSnapshot, MarketText } from '@deepseek-ai/dsh-market/types'
import type { InstalledSkillOrigin, InstalledSkillView } from '@deepseek-ai/dsh-market-skills/types'
import {
  Button, IconChevronDownOutlineRegular, IconChevronLeftOutlineRegular, IconLoadingOutlineRegular, IconPlusOutlineRegular,
  IconSearchOutlineRegular, IconSkillOutlineRegular, IconWarningOutlineRegular, Input, Menu, MenuItemButton, Pill, SegmentedTabs,
  Switch, Tag, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { MarketFace } from './index.ts'
import { ItemIcon } from './ItemIcon.tsx'
import type { createMarketNavigation } from './navigation-store.ts'
import { SkillDetail } from './SkillDetail.tsx'
import cardCss from './MarketCard.module.css'
import css from './MarketPage.module.css'

/** Props the `main` slot assembles for the market page. */
export type MarketPageProps =
  PropsRuntime<'main'>
  & PropsLocale<'market'>
  & InjectFace<MarketFace>
  & PropsStore<ReturnType<typeof createMarketNavigation>>

type Translate = MarketPageProps['t']

/**
 * Render the market page.
 * @param props - market state, actions, navigation store and copy.
 * @returns the page.
 */
export function MarketPage(props: MarketPageProps): ReactNode {
  const { t, actions } = props
  const view = props.useStore(state => state.view)
  const state = props.useMarket(snapshot => snapshot)
  const language = props.useLanguage(value => value)
  const text = useCallback(
    (value: MarketText): string => language === 'en' && value.en !== undefined ? value.en : value.zh,
    [language],
  )
  const tab: MarketKindName = view.kind === 'installed' ? 'skill' : view.tab
  // Opening the page revalidates the catalog; an unchanged file costs one 304.
  useEffect(() => { void props.refresh() }, [props.refresh])
  const tabs = [
    { value: 'expert' as const, label: t('tabExperts'), id: 'market-tab-expert', panelId: 'market-panel' },
    { value: 'skill' as const, label: t('tabSkills'), id: 'market-tab-skill', panelId: 'market-panel' },
    { value: 'connector' as const, label: t('tabConnectors'), id: 'market-tab-connector', panelId: 'market-panel' },
  ] as const
  return (
    <div className={css.page}>
      <header className={css.head}>
        <SegmentedTabs className={css.tabs} items={tabs} value={tab} label={t('tabsLabel')}
          onChange={(value) => { actions.setView({ kind: 'catalog', tab: value }) }} />
      </header>
      <section id="market-panel" role="tabpanel" aria-labelledby={`market-tab-${tab}`} className={css.panel}>
        {notice(state.market, state.streamFailed, t)}
        {view.kind === 'installed'
          ? <InstalledSkills {...props} text={text} />
          : tab === 'skill'
            ? <SkillCatalog {...props} market={state.market} text={text} />
            : <p className={css.empty}>{t('comingSoon')}</p>}
      </section>
    </div>
  )
}

function notice(market: MarketSnapshot | undefined, streamFailed: boolean, t: Translate): ReactNode {
  if (streamFailed) return <p className={css.alert} role="alert"><IconWarningOutlineRegular size={14} />{t('loadFailed', { reason: '' })}</p>
  if (market === undefined) return null
  if (market.fetchError !== undefined && market.source === 'cache') return <p className={css.info}>{t('offline')}</p>
  if (market.fetchError !== undefined && market.source === 'none') return <p className={css.alert} role="alert">{t('noCatalog')}</p>
  return null
}

function SkillCatalog(props: MarketPageProps & { market: MarketSnapshot | undefined; text: (value: MarketText) => string }): ReactNode {
  const { t, market, text, actions } = props
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  // The open dialog follows its skill through catalog and install updates.
  const [detailId, setDetailId] = useState<string | null>(null)
  const installedCount = props.useMarket(state => state.installedSkills?.skills.length)
  const skills = useMemo(() => (market?.items ?? []).filter(item => item.kind === 'skill'), [market])
  const categories = (market?.categories ?? []).filter(entry => entry.kind === 'skill')
  const featured = (market?.featured ?? [])
    .filter(ref => ref.kind === 'skill')
    .flatMap(ref => skills.filter(item => item.id === ref.id))
  const visible = useMemo(() => {
    const inCategory = category === null ? skills : skills.filter(item => item.category === category)
    const needle = query.trim().toLowerCase()
    if (needle === '') return inCategory
    return inCategory.filter(item => [item.id, text(item.name), text(item.description), ...item.tags ?? []]
      .some(field => field.toLowerCase().includes(needle)))
  }, [skills, category, query, text])
  useEffect(() => { void props.loadInstalledSkills() }, [props.loadInstalledSkills])
  const openDetail = (item: MarketItemView): void => { setDetailId(item.id) }
  return (
    <>
      <div className={css.toolbar}>
        <SearchInput label={t('search')} value={query} onChange={setQuery} />
        <Button variant="outline" size="sm" onClick={() => { actions.setView({ kind: 'installed' }) }}>
          {t('installed')}{installedCount === undefined ? null : <span className={css.count}>{installedCount}</span>}
        </Button>
        <AddSkillMenu {...props} />
      </div>
      {market === undefined
        ? <p className={css.empty}>{t('loading')}</p>
        : (
          <>
            {featured.length > 0 && query === '' && category === null && (
              <section aria-label={t('featured')}>
                <h2 className={css.sectionTitle}>{t('featured')}</h2>
                <ul className={clsx(css.grid, css.featured)}>
                  {featured.map(item => <SkillCard key={item.id} item={item} onOpen={openDetail} {...props} />)}
                </ul>
              </section>
            )}
            <section aria-label={t('recommended')}>
              <h2 className={css.sectionTitle}>{t('recommended')}</h2>
              {categories.length > 0 && (
                <div className={css.chips} role="group" aria-label={t('recommended')}>
                  <Pill active={category === null} onClick={() => { setCategory(null) }}>{t('allCategories')}</Pill>
                  {categories.map(entry => (
                    <Pill key={entry.id} active={category === entry.id} onClick={() => { setCategory(entry.id) }}>{text(entry.name)}</Pill>
                  ))}
                </div>
              )}
              {visible.length === 0
                ? <p className={css.empty}>{skills.length === 0 ? t('emptyCatalog') : t('emptySearch')}</p>
                : (
                  <ul className={css.grid}>
                    {visible.map(item => <SkillCard key={item.id} item={item} onOpen={openDetail} {...props} />)}
                  </ul>
                )}
            </section>
          </>
        )}
      {detailId !== null && <SkillDetail {...props} skill={detailId} onClose={() => { setDetailId(null) }} />}
    </>
  )
}

function SkillCard(props: MarketPageProps & {
  item: MarketItemView
  text: (value: MarketText) => string
  onOpen: (item: MarketItemView) => void
}): ReactNode {
  const { item, text, t, onOpen } = props
  const installing = props.useMarket(state => state.market?.installing.includes(`${item.kind}:${item.id}`) ?? false)
  const name = text(item.name)
  const ref = { kind: item.kind, id: item.id }
  const upToDate = item.installedVersion !== undefined && item.installedVersion === item.version
  // The title button covers the card (see .cardOpen), so a click anywhere but the install button opens the detail.
  return (
    <li className={clsx(cardCss.card, css.cardClickable)}>
      <div className={css.cardHead}>
        <ItemIcon item={item} className={css.icon} glyphSize={18} />
        <div className={css.cardTitleBlock}>
          <button type="button" className={css.cardOpen} aria-label={t('openDetail', { name })} onClick={() => { onOpen(item) }}>
            <span className={css.cardTitle} title={name}>{name}</span>
          </button>
          {name !== item.id && <span className={css.cardMeta}>{item.id}</span>}
        </div>
        {installing
          ? <span className={css.cardAction} aria-label={t('installing')}><IconLoadingOutlineRegular size={16} className={css.spin} /></span>
          : upToDate
            ? <Tag tone="outline">{t('installedBadge')}</Tag>
            : (
              <Tooltip label={item.installedVersion === undefined ? t('install') : t('update')} side="top">
                <button type="button" className={css.cardAction} aria-label={`${item.installedVersion === undefined ? t('install') : t('update')} ${name}`}
                  onClick={() => { void props.install(ref, name) }}>
                  <IconPlusOutlineRegular size={16} />
                </button>
              </Tooltip>
            )}
      </div>
      <p className={css.cardDescription}>{text(item.description)}</p>
    </li>
  )
}

function SearchInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }): ReactNode {
  return (
    <Input className={css.search ?? ''} type="search" icon={<IconSearchOutlineRegular size={14} />} placeholder={label}
      aria-label={label} value={value} onChange={(event) => { onChange(event.currentTarget.value) }} />
  )
}

/** The skill 创建技能 and 编辑 open with; Desktop bundles it from the lc-market content repository. */
export const SKILL_CREATOR = 'skill-creator'

function AddSkillMenu(props: MarketPageProps): ReactNode {
  const { t } = props
  const [open, setOpen] = useState(false)
  const close = (): void => { setOpen(false) }
  return (
    <Menu open={open} onClose={close} align="end" portal autoFocus listClassName={css.addMenu}
      anchor={(
        <Button variant="primary" size="sm" icon={<IconPlusOutlineRegular size={13} />} aria-haspopup="menu" aria-expanded={open}
          onClick={() => { setOpen(value => !value) }}>
          {t('addSkill')}<IconChevronDownOutlineRegular size={12} aria-hidden="true" />
        </Button>
      )}>
      {/* 查找技能 joins this menu with the market_skill_search tool in phase 1b; without it the model cannot reach the catalog. */}
      <MenuItemButton icon={<IconSkillOutlineRegular size={14} />} onSelect={() => { close(); props.trySkill(SKILL_CREATOR, t('promptCreate')) }}>
        <span className={css.menuItem}><span>{t('addCreate')}</span><span className={css.menuDescription}>{t('addCreateDescription')}</span></span>
      </MenuItemButton>
    </Menu>
  )
}

const ORIGIN_KEY = { market: 'originMarket', user: 'originUser' } as const satisfies Record<InstalledSkillOrigin, string>

/** How one installed skill is shown: market downloads take their catalog name, icon and description. */
interface InstalledDisplay {
  readonly skill: InstalledSkillView
  readonly catalog: MarketItemView | undefined
  readonly title: string
  readonly description: string
}

function InstalledSkills(props: MarketPageProps & { text: (value: MarketText) => string }): ReactNode {
  const { t, actions, text } = props
  const [query, setQuery] = useState('')
  const installed = props.useMarket(state => state.installedSkills)
  const loading = props.useMarket(state => state.installedLoading)
  const switching = props.useMarket(state => state.switching)
  const marketItems = props.useMarket(state => state.market?.items)
  useEffect(() => { void props.loadInstalledSkills() }, [props.loadInstalledSkills])
  const [detailId, setDetailId] = useState<string | null>(null)
  const skills = useMemo(() => installed?.skills ?? [], [installed])
  const displays = useMemo(() => {
    const catalog = new Map((marketItems ?? []).filter(item => item.kind === 'skill').map(item => [item.id, item]))
    return skills.map((skill): InstalledDisplay => {
      const entry = skill.origin === 'market' ? catalog.get(skill.name) : undefined
      return {
        skill, catalog: entry,
        title: entry === undefined ? skill.name : text(entry.name),
        description: entry === undefined ? skill.description : text(entry.description),
      }
    })
  }, [skills, marketItems, text])
  const needle = query.trim().toLowerCase()
  const visible = needle === ''
    ? displays
    : displays.filter(display => [display.skill.name, display.title, display.description]
      .some(field => field.toLowerCase().includes(needle)))
  return (
    <>
      <div className={css.toolbar}>
        <Button variant="ghost" size="sm" icon={<IconChevronLeftOutlineRegular size={14} />}
          onClick={() => { actions.setView({ kind: 'catalog', tab: 'skill' }) }}>
          {t('back')}
        </Button>
        <span className={css.spacer} />
        <SearchInput label={t('searchInstalled')} value={query} onChange={setQuery} />
      </div>
      <h2 className={css.sectionTitle}>{t('installedTitle')}<span className={css.count}>{skills.length}</span></h2>
      {installed?.complete === false && <p className={css.info}>{t('incomplete')}</p>}
      {installed === undefined && loading
        ? <p className={css.empty}>{t('loading')}</p>
        : visible.length === 0
          ? <p className={css.empty}>{skills.length === 0 ? t('emptyInstalled') : t('emptySearch')}</p>
          : (
            <ul className={css.grid}>
              {visible.map(display => (
                <InstalledCard key={display.skill.name} display={display} busy={switching.includes(display.skill.name)}
                  onOpen={() => { setDetailId(display.skill.name) }} {...props} />
              ))}
            </ul>
          )}
      {detailId !== null && <SkillDetail {...props} skill={detailId} onClose={() => { setDetailId(null) }} />}
    </>
  )
}

function InstalledCard(props: MarketPageProps & { display: InstalledDisplay; busy: boolean; onOpen: () => void }): ReactNode {
  const { display: { skill, catalog, title, description }, busy, t, onOpen } = props
  // The title button covers the card (see .cardOpen), so a click anywhere but the switch opens the detail.
  return (
    <li className={clsx(cardCss.card, css.cardClickable, !skill.enabled && css.cardOff)}>
      <div className={css.cardHead}>
        {catalog === undefined
          ? <span className={css.letter} aria-hidden="true">{skill.name.slice(0, 1).toUpperCase()}</span>
          : <ItemIcon item={catalog} className={css.icon} glyphSize={18} />}
        <div className={css.cardTitleBlock}>
          <button type="button" className={css.cardOpen} aria-label={t('openDetail', { name: title })} onClick={onOpen}>
            <span className={css.cardTitle} title={title}>{title}</span>
          </button>
          <span className={css.cardMetaRow}>
            <Tag tone="outline">{t(ORIGIN_KEY[skill.origin])}</Tag>
            {title !== skill.name && <span className={css.cardMeta}>/{skill.name}</span>}
          </span>
        </div>
        <Switch tone="success" className={css.cardSwitch} checked={skill.enabled} disabled={busy}
          label={t('enableSwitch', { name: title })}
          onChange={(next) => { void props.setSkillsEnabled([skill.name], next) }} />
      </div>
      <p className={css.cardDescription}>{description}</p>
    </li>
  )
}
