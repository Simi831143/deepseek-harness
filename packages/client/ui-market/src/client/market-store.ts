/**
 * Browser state of the market page: the Host's market snapshot from one watch
 * stream, the installed-skill list read on demand, and the last notice. One
 * store per client, shared by every market view.
 */
import type { MarketItemRef, MarketSnapshot } from '@deepseek-ai/dsh-market/types'
import type {
  ConnectorIdRequest, ConnectorSettingsRequest, ConnectorsValue, ConnectorSwitchRequest, CustomNameRequest, ParseCustomRequest,
  ParsedCustomConnectors, SaveCustomRequest,
} from '@deepseek-ai/dsh-market-connectors/types'
import type {
  InstalledSkillsValue, SkillDocumentValue, SkillNameRequest, SkillSwitchRequest,
} from '@deepseek-ai/dsh-market-skills/types'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'

/** One transient outcome the page reports in a toast. */
export type MarketNotice =
  | { readonly seq: number; readonly kind: 'installed' | 'uninstalled' | 'removed'; readonly name: string }
  | { readonly seq: number; readonly kind: 'install-failed' | 'uninstall-failed' | 'connect-failed' | 'remove-failed'; readonly name: string; readonly reason: string }
  | { readonly seq: number; readonly kind: 'reveal-failed'; readonly name: string }
  | { readonly seq: number; readonly kind: 'switch-failed' | 'load-failed'; readonly reason: string }

/** Everything the market views render. */
export interface MarketState {
  /** Latest Host snapshot; absent until the stream answers. */
  readonly market: MarketSnapshot | undefined
  /** Whether the stream ended and stopped reconnecting. */
  readonly streamFailed: boolean
  /** Installed skills of every source; absent until first read. */
  readonly installedSkills: InstalledSkillsValue | undefined
  readonly installedLoading: boolean
  /** Skill names whose switch is being written. */
  readonly switching: readonly string[]
  /** Whether the Host can show a path in its file manager; false until the Host answers or after a failed read. */
  readonly canReveal: boolean
  /** Installed connectors from the connector stream; absent until it answers, or when the Host has no connector kind. */
  readonly connectors: ConnectorsValue | undefined
  /** Connector ids whose switch or retry is being written. */
  readonly connectorBusy: readonly string[]
  readonly notice: MarketNotice | null
}

/** Result of one Remote call. */
export type MarketResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown }

/** The Remote calls the store needs. */
export interface MarketRemote {
  /** @returns the reconnecting snapshot stream; each item must be accepted after it is read. */
  watch(): AsyncIterable<{ readonly value: MarketSnapshot; accept(): void }>
  install(ref: MarketItemRef): Promise<MarketResult<MarketSnapshot>>
  uninstall(ref: MarketItemRef): Promise<MarketResult<MarketSnapshot>>
  refresh(): Promise<MarketResult<MarketSnapshot>>
  installedSkills(): Promise<MarketResult<InstalledSkillsValue>>
  setSkillsEnabled(request: SkillSwitchRequest): Promise<MarketResult<InstalledSkillsValue>>
  skillDocument(request: SkillNameRequest): Promise<MarketResult<SkillDocumentValue>>
  uninstallPersonal(request: SkillNameRequest): Promise<MarketResult<InstalledSkillsValue>>
  canReveal(): Promise<MarketResult<boolean>>
  /** Show one Host path selected in the Host's file manager. */
  reveal(path: string): Promise<MarketResult<unknown>>
  /** @returns the reconnecting connector stream; each item must be accepted after it is read. */
  watchConnectors(): AsyncIterable<{ readonly value: ConnectorsValue; accept(): void }>
  connectorList(): Promise<MarketResult<ConnectorsValue>>
  setConnectorEnabled(request: ConnectorSwitchRequest): Promise<MarketResult<ConnectorsValue>>
  retryConnector(request: ConnectorIdRequest): Promise<MarketResult<ConnectorsValue>>
  parseCustomConnectors(request: ParseCustomRequest): Promise<MarketResult<ParsedCustomConnectors>>
  saveCustomConnector(request: SaveCustomRequest): Promise<MarketResult<ConnectorsValue>>
  removeCustomConnector(request: CustomNameRequest): Promise<MarketResult<ConnectorsValue>>
  saveConnectorSettings(request: ConnectorSettingsRequest): Promise<MarketResult<ConnectorsValue>>
}

/** Store operations injected into the views. */
export interface MarketActions {
  /** @returns whether the item is installed afterwards; a failure is reported as a notice. */
  install(ref: MarketItemRef, name: string): Promise<boolean>
  uninstall(ref: MarketItemRef, name: string): Promise<void>
  /**
   * Delete a personal skill's files from its personal skill folder.
   * @param skill - skill name.
   * @param name - display name for the notice.
   * @returns whether the skill was deleted; a failure is reported as a notice.
   */
  uninstallPersonal(skill: string, name: string): Promise<boolean>
  /**
   * Show a skill's instruction file selected in the Host's file manager.
   * @param path - absolute instruction file path on the Host.
   * @param name - display name for the failure notice.
   */
  revealSkill(path: string, name: string): Promise<void>
  refresh(): Promise<void>
  loadInstalledSkills(): Promise<void>
  /** @returns whether the switch was saved; a failure is reported as a notice. */
  setSkillsEnabled(names: readonly string[], enabled: boolean): Promise<boolean>
  /**
   * Read one skill's instructions for the detail overview.
   * @param skill - skill name.
   * @returns the Markdown body and declared version, or the failure.
   */
  readSkillDocument(skill: string): Promise<MarketResult<SkillDocumentValue>>
  /**
   * Switch one installed connector on or off.
   * @param id - connector id.
   * @param enabled - target state.
   * @param confirmed - whether the user just accepted the program the connector runs.
   * @param name - display name for the failure notice.
   * @returns whether the switch was saved; a failure is reported as a notice.
   */
  setConnectorEnabled(id: string, enabled: boolean, confirmed: boolean, name: string): Promise<boolean>
  /**
   * Start a connector whose start failed.
   * @param id - connector id.
   * @param name - display name for the failure notice.
   */
  retryConnector(id: string, name: string): Promise<void>
  /** @returns the installed connectors read now, such as right after an install; undefined when the read failed. */
  refreshConnectors(): Promise<ConnectorsValue | undefined>
  /**
   * Read the MCP servers in pasted text; nothing is saved.
   * @param text - pasted JSON.
   * @returns each server with its configuration or why it cannot be added, or the failed call.
   */
  parseCustomConnectors(text: string): Promise<MarketResult<ParsedCustomConnectors>>
  /**
   * Add or change a custom connector. The caller shows a refusal next to the form.
   * @param request - configuration, the name it replaces, and its switch.
   * @returns the connectors after the change, or the refusal.
   */
  saveCustomConnector(request: SaveCustomRequest): Promise<MarketResult<ConnectorsValue>>
  /**
   * Stop a custom connector and delete its configuration.
   * @param name - connector name.
   * @returns whether it was deleted; the outcome is reported as a notice.
   */
  removeCustomConnector(name: string): Promise<boolean>
  /**
   * Save or clear a market connector's settings. The caller shows a refusal next to the form.
   * @param id - connector id.
   * @param values - new values by environment variable name; `null` clears one.
   * @returns the connectors after the change, or the refusal.
   */
  saveConnectorSettings(id: string, values: Readonly<Record<string, string | null>>): Promise<MarketResult<ConnectorsValue>>
  dismissNotice(): void
}

/** The store's lifetime handle and observable. */
export interface MarketStore extends MarketActions {
  readonly state: HostObservable<MarketState>
  /** Stop publishing; the stream owner closes the stream. */
  dispose(): void
}

/**
 * Follow the market stream and expose the page's actions.
 * @param remote - market Remote calls.
 * @returns the store; the caller disposes it with the plugin.
 */
export function createMarketStore(remote: MarketRemote): MarketStore {
  let state: MarketState = {
    market: undefined, streamFailed: false, installedSkills: undefined, installedLoading: false, switching: [],
    canReveal: false, connectors: undefined, connectorBusy: [], notice: null,
  }
  let disposed = false
  let seq = 0
  const listeners = new Set<() => void>()
  const publish = (patch: Partial<MarketState>): void => {
    if (disposed) return
    state = { ...state, ...patch }
    for (const listener of listeners) listener()
  }
  const notify = (notice: DistributiveOmit<MarketNotice, 'seq'>): void => {
    seq += 1
    publish({ notice: { ...notice, seq } })
  }
  let installedRead = 0
  const loadInstalledSkills = async (): Promise<void> => {
    const read = ++installedRead
    publish({ installedLoading: true })
    const result = await remote.installedSkills()
    if (read !== installedRead) return
    if (result.ok) publish({ installedSkills: result.value, installedLoading: false })
    else {
      publish({ installedLoading: false })
      notify({ kind: 'load-failed', reason: reasonOf(result.error) })
    }
  }
  void (async () => {
    for await (const frame of remote.watch()) {
      frame.accept()
      const previous = state.market
      publish({ market: frame.value, streamFailed: false })
      // Installs change which market skills exist; a list already shown follows them.
      if (state.installedSkills !== undefined && installedSetChanged(previous, frame.value)) void loadInstalledSkills()
    }
  })().catch(() => { publish({ streamFailed: true }) })
  void (async () => {
    for await (const frame of remote.watchConnectors()) {
      frame.accept()
      publish({ connectors: frame.value })
    }
  })().catch(() => {
    // A Host without the connector kind never answers; its tab stays hidden because the
    // market snapshot does not list the kind, so there is nothing to report here.
  })
  const busy = async <T>(id: string, call: () => Promise<MarketResult<T>>): Promise<MarketResult<T>> => {
    publish({ connectorBusy: [...new Set([...state.connectorBusy, id])] })
    const result = await call()
    publish({ connectorBusy: state.connectorBusy.filter(entry => entry !== id) })
    return result
  }
  /**
   * Show the connectors a call returned, unless a newer stream frame already arrived: calls and
   * the stream use different channels, and a stale "starting" would otherwise stay on screen.
   */
  const callResult = (value: ConnectorsValue): void => {
    if (state.connectors !== undefined && value.revision < state.connectors.revision) return
    publish({ connectors: value })
  }
  // A Host without a desktop, or one that did not answer, offers no file-manager action.
  void remote.canReveal().then((result) => { publish({ canReveal: result.ok && result.value }) })

  return {
    state: {
      getSnapshot: () => state,
      subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    },
    async install(ref, name) {
      const result = await remote.install(ref)
      if (result.ok) { publish({ market: result.value }); notify({ kind: 'installed', name }) }
      else notify({ kind: 'install-failed', name, reason: reasonOf(result.error) })
      return result.ok
    },
    async uninstall(ref, name) {
      const result = await remote.uninstall(ref)
      if (result.ok) { publish({ market: result.value }); notify({ kind: 'uninstalled', name }) }
      else notify({ kind: 'uninstall-failed', name, reason: reasonOf(result.error) })
      if (state.installedSkills !== undefined) await loadInstalledSkills()
    },
    async uninstallPersonal(skill, name) {
      const result = await remote.uninstallPersonal({ name: skill })
      if (result.ok) { publish({ installedSkills: result.value }); notify({ kind: 'uninstalled', name }) }
      else notify({ kind: 'uninstall-failed', name, reason: reasonOf(result.error) })
      return result.ok
    },
    async revealSkill(path, name) {
      if (!(await remote.reveal(path)).ok) notify({ kind: 'reveal-failed', name })
    },
    async refresh() {
      const result = await remote.refresh()
      if (result.ok) publish({ market: result.value })
      else notify({ kind: 'load-failed', reason: reasonOf(result.error) })
    },
    loadInstalledSkills,
    async setSkillsEnabled(names, enabled) {
      publish({ switching: [...new Set([...state.switching, ...names])] })
      const result = await remote.setSkillsEnabled({ names, enabled })
      publish({ switching: state.switching.filter(name => !names.includes(name)) })
      if (result.ok) publish({ installedSkills: result.value })
      else notify({ kind: 'switch-failed', reason: reasonOf(result.error) })
      return result.ok
    },
    readSkillDocument: skill => remote.skillDocument({ name: skill }),
    async setConnectorEnabled(id, enabled, confirmed, name) {
      const result = await busy(id, () => remote.setConnectorEnabled({ id, enabled, ...confirmed ? { confirmed } : {} }))
      if (result.ok) callResult(result.value)
      else notify({ kind: 'connect-failed', name, reason: reasonOf(result.error) })
      return result.ok
    },
    async retryConnector(id, name) {
      const result = await busy(id, () => remote.retryConnector({ id }))
      if (result.ok) callResult(result.value)
      else notify({ kind: 'connect-failed', name, reason: reasonOf(result.error) })
    },
    async refreshConnectors() {
      const result = await remote.connectorList()
      if (!result.ok) return undefined
      callResult(result.value)
      return result.value
    },
    parseCustomConnectors: text => remote.parseCustomConnectors({ text }),
    async saveCustomConnector(request) {
      const result = await remote.saveCustomConnector(request)
      if (result.ok) callResult(result.value)
      return result
    },
    async removeCustomConnector(name) {
      const result = await remote.removeCustomConnector({ name })
      if (result.ok) { callResult(result.value); notify({ kind: 'removed', name }) }
      else notify({ kind: 'remove-failed', name, reason: reasonOf(result.error) })
      return result.ok
    },
    async saveConnectorSettings(id, values) {
      const result = await busy(id, () => remote.saveConnectorSettings({ id, values }))
      if (result.ok) callResult(result.value)
      return result
    },
    dismissNotice() { publish({ notice: null }) },
    dispose() { disposed = true; listeners.clear() },
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

function installedSetChanged(previous: MarketSnapshot | undefined, next: MarketSnapshot): boolean {
  const installed = (snapshot: MarketSnapshot | undefined): string =>
    (snapshot?.items ?? []).filter(item => item.installedVersion !== undefined).map(item => `${item.kind}:${item.id}@${item.installedVersion}`).join(',')
  return installed(previous) !== installed(next)
}

function reasonOf(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') return error.message
  return String(error)
}
