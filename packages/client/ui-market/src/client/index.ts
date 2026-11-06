/**
 * Market, browser half: the sidebar's Market entry, the page it opens in the
 * main column, and the toast that reports install outcomes. The page reads the
 * `market`, `marketSkills` and `marketConnectors` Remote namespaces, which this
 * plugin mounts itself so the shared API Remotes package needs no market entry,
 * and shows a skill's folder through the `session` namespace's file-manager reveal.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/remote'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { DraftInput } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SkillLabels } from '@deepseek-ai/dsh-client-ui-skill/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { MarketItemView } from '@deepseek-ai/dsh-market/types'
import marketRemote from '@deepseek-ai/dsh-market/remote'
import marketConnectorsRemote from '@deepseek-ai/dsh-market-connectors/remote'
import marketSkillsRemote from '@deepseek-ai/dsh-market-skills/remote'
import { en, ja, es, fr, de, ru, pt, zh, type MarketLocaleKey } from './locales.ts'
import { createMarketStore, type MarketActions, type MarketState } from './market-store.ts'
import { MarketPage, SKILL_CREATOR } from './MarketPage.tsx'
import { MarketPanelIcon } from './MarketPanelIcon.tsx'
import { MarketToast } from './MarketToast.tsx'
import { createMarketNavigation } from './navigation-store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Market page copy. */
    'market': MarketLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'market'

/** The id shared by the sidebar entry and the main panel it opens. */
export const PANEL_ID = 'market' as MainPanelId

/** Services the plugin needs before it mounts its Remote namespaces. */
export const inject = ['remote', 'remote.session', 'slots', 'locale', 'layout', 'uiWorkspace']

/** State and actions every market view receives. */
export interface MarketFace extends MarketActions {
  hooks: { market: HostObservable<MarketState>; language: HostObservable<string> }
  /**
   * Open a new conversation whose composer holds a chip for one skill followed by `text`, unsent.
   * @param skill - skill name; the chip shows its display title.
   * @param text - request text after the chip.
   */
  trySkill(skill: string, text: string): void
  /**
   * Open a new conversation whose composer asks skill-creator to edit one skill, unsent:
   * the skill-creator chip, the request, and a chip for the skill being edited.
   * @param skill - name of the skill to edit.
   */
  editSkill(skill: string): void
  /**
   * Open a new conversation whose composer holds a request to diagnose a connector, unsent.
   * @param prompt - the request with the connector's configuration and failure.
   */
  diagnose(prompt: string): void
}

/** Where the edited skill's chip goes in the `promptEdit` copy. */
const SKILL_SLOT = '{skill}'

/** Catalog titles of market skills in the active language, recomputed only when the catalog or language changes. */
function skillTitles(market: HostObservable<MarketState>, language: HostObservable<string>): HostObservable<SkillLabels> {
  let cache: { items: readonly MarketItemView[]; language: string; titles: SkillLabels } | undefined
  return {
    getSnapshot: () => {
      const items = market.getSnapshot().market?.items ?? []
      const active = language.getSnapshot()
      if (cache?.items === items && cache.language === active) return cache.titles
      const titles = new Map(items.filter(item => item.kind === 'skill')
        .map(item => [item.id, active === 'en' && item.name.en !== undefined ? item.name.en : item.name.zh] as const))
      cache = { items, language: active, titles }
      return titles
    },
    subscribe: (listener) => {
      const offMarket = market.subscribe(listener)
      const offLanguage = language.subscribe(listener)
      return () => { offMarket(); offLanguage() }
    },
  }
}

function registerUi(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'ui-market: dictionaries')
  const t = ctx.locale.bind(NS)
  const stream = ctx.remote.$stream({
    name: 'market', open: signal => ctx.remote.market.watch(signal), ended: () => new Error('market stream ended'),
  })
  const connectorStream = ctx.remote.$stream({
    name: 'marketConnectors', open: signal => ctx.remote.marketConnectors.watch(signal), ended: () => new Error('connector stream ended'),
  })
  // The composer's skill list is cached per conversation; an install or switch must reach it.
  const skillsChanged = (): void => { ctx.get('uiSkill')?.refresh() }
  const afterSkillWrite = <T extends { ok: boolean }>(result: Promise<T>): Promise<T> => result.then((value) => {
    if (value.ok) skillsChanged()
    return value
  })
  const store = createMarketStore({
    watch: () => stream,
    install: ref => afterSkillWrite(ctx.remote.market.installPackage(ref)),
    uninstall: ref => afterSkillWrite(ctx.remote.market.uninstallPackage(ref)),
    refresh: () => ctx.remote.market.refreshCatalog(),
    installedSkills: () => ctx.remote.marketSkills.installed(),
    setSkillsEnabled: request => afterSkillWrite(ctx.remote.marketSkills.setEnabled(request)),
    skillDocument: request => ctx.remote.marketSkills.document(request),
    uninstallPersonal: request => afterSkillWrite(ctx.remote.marketSkills.uninstallPersonal(request)),
    canReveal: () => ctx.remote.session.canOpenWorkspacePath(),
    reveal: path => ctx.remote.session.openWorkspacePath({ path, action: 'reveal' }),
    watchConnectors: () => connectorStream,
    connectorList: () => ctx.remote.marketConnectors.connectorList(),
    setConnectorEnabled: request => ctx.remote.marketConnectors.setConnectorEnabled(request),
    retryConnector: request => ctx.remote.marketConnectors.retryConnector(request),
    parseCustomConnectors: request => ctx.remote.marketConnectors.parseCustomConnectors(request),
    saveCustomConnector: request => ctx.remote.marketConnectors.saveCustomConnector(request),
    removeCustomConnector: request => ctx.remote.marketConnectors.removeCustomConnector(request),
    saveConnectorSettings: request => ctx.remote.marketConnectors.saveConnectorSettings(request),
  })
  ctx.effect(() => () => {
    store.dispose()
    return Promise.all([stream.dispose(), connectorStream.dispose()]).then(() => undefined)
  }, 'ui-market: market streams')
  const language: HostObservable<string> = {
    getSnapshot: () => ctx.locale.getSnapshot().active,
    subscribe: listener => ctx.locale.subscribe(listener),
  }
  // Market skills lend the composer their catalog titles: the `/` menu and the skill chip show 飞书套件, not lark-unified.
  ctx.inject(['uiSkill'], (scope) => {
    scope.effect(() => scope.uiSkill.contributeLabels(skillTitles(store.state, language)), 'ui-market: skill titles')
  })
  const startSession = (prompt: DraftInput): void => {
    ctx.layout.selectPanel(null)
    ctx.uiWorkspace.startSession(undefined, { prompt, clearPreviousDraft: true })
  }
  const face: MarketFace = {
    hooks: { market: store.state, language },
    install: (ref, name) => store.install(ref, name),
    uninstall: (ref, name) => store.uninstall(ref, name),
    uninstallPersonal: (skill, name) => store.uninstallPersonal(skill, name),
    revealSkill: (path, name) => store.revealSkill(path, name),
    refresh: () => store.refresh(),
    loadInstalledSkills: () => store.loadInstalledSkills(),
    setSkillsEnabled: (names, enabled) => store.setSkillsEnabled(names, enabled),
    readSkillDocument: skill => store.readSkillDocument(skill),
    setConnectorEnabled: (id, enabled, confirmed, name) => store.setConnectorEnabled(id, enabled, confirmed, name),
    retryConnector: (id, name) => store.retryConnector(id, name),
    refreshConnectors: () => store.refreshConnectors(),
    parseCustomConnectors: text => store.parseCustomConnectors(text),
    saveCustomConnector: request => store.saveCustomConnector(request),
    removeCustomConnector: name => store.removeCustomConnector(name),
    saveConnectorSettings: (id, values) => store.saveConnectorSettings(id, values),
    dismissNotice: () => { store.dismissNotice() },
    diagnose: (prompt) => { startSession(prompt) },
    trySkill: (skill, text) => {
      // Without the skill plugin the literal still loads the skill host-side; it just shows as text.
      startSession(ctx.get('uiSkill')?.draft(skill, text) ?? `/${skill} ${text}`)
    },
    editSkill: (skill) => {
      const [before = '', after = ''] = t('promptEdit').split(SKILL_SLOT)
      const parts = [{ skill: SKILL_CREATOR }, { text: before }, { skill }, { text: after }]
      const uiSkill = ctx.get('uiSkill')
      startSession(uiSkill === undefined
        ? parts.map(part => 'skill' in part ? `/${part.skill}` : part.text.trim()).filter(Boolean).join(' ')
        : uiSkill.compose(parts))
    },
  }
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'market.toast', locale: NS, inject: () => face,
  }, MarketToast))
  ctx.slots.inject('main', function* () {
    const handle = createMarketNavigation(), instance = handle.create()
    yield ctx.slots.register({
      name: 'main', key: PANEL_ID, locale: NS, store: { ...handle, create: () => instance }, inject: () => face,
    }, MarketPage)
  })
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: PANEL_ID, order: 5, label: () => t('panel'), locale: NS,
  }, MarketPanelIcon))
}

/**
 * Mount the market Remote namespaces, then the UI that uses them.
 * @param ctx - browser plugin context.
 * @returns disposer joining UI and Remote withdrawal.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  // Mounted in order and withdrawn in reverse; a failed mount withdraws the ones before it.
  const mounted: (() => Promise<void>)[] = []
  const withdraw = async (): Promise<void> => { for (const dispose of mounted.splice(0).reverse()) await dispose() }
  try {
    for (const contribution of [marketRemote, marketSkillsRemote, marketConnectorsRemote]) {
      mounted.push(await ctx.remote.$mount(contribution))
    }
  } catch (error) {
    await withdraw()
    throw error
  }
  const ui = ctx.inject([
    'remote.market', 'remote.marketSkills', 'remote.marketConnectors', 'remote.session', 'slots', 'locale', 'layout', 'uiWorkspace',
  ], registerUi)
  try {
    await ui
  } catch (error) {
    await ui.dispose()
    await withdraw()
    throw error
  }
  return async () => { await ui.dispose(); await withdraw() }
}
