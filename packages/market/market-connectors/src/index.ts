/**
 * Connector kind of the market, and the connectors the user adds outside it. A market connector
 * is a local MCP program that its market package carries together with its runtime; `mcp.json`
 * at the package root names the program. A custom connector is an MCP server the user pasted or
 * filled in: a local program found on PATH, or a remote Streamable HTTP service. Every connector
 * that is switched on (and, for a market connector, accepted) runs as one mcp-client instance in
 * the global scope, so every Agent sees its tools; switching it off stops it. The
 * `marketConnectors` Remote namespace lists the connectors with their state, switches them,
 * retries a failed start, and adds, changes and removes custom connectors. A market connector
 * package may also carry a `SKILL.md`, which the skill registry serves only while the connector
 * is connected.
 * @module @deepseek-ai/dsh-market-connectors
 */
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Service, type Context, type Fiber, type FiberState } from '@deepseek-ai/cordis'
import type { InstalledItem, MarketCatalogItem, MarketKind } from '@deepseek-ai/dsh-market'
import * as mcpClient from '@deepseek-ai/dsh-mcp-client'
import type {} from '@deepseek-ai/dsh-tools'
import type { SkillCandidate, SkillProviderControl, SkillProviderObservation } from '@deepseek-ai/dsh-skill'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import { defineDomain, domainTable, type Domain } from '@deepseek-ai/dsh-storage-domain'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import {
  CUSTOM_PREFIX, CustomConfigError, customId, customLaunch, normalizeCustomConfig, parseCustomConnectors, type McpLaunch,
} from './custom.ts'
import { describeError, describeStartFailure, findCommand, isDirectory, type StartFailure } from './diagnose.ts'
import { readLaunchManifest, type LaunchSpec } from './manifest.ts'
import { ConnectorSettingStore, digestOf } from './setting-store.ts'
import { MAX_SETTING_VALUE_LENGTH, readConnectorSettings, type ConnectorSettingSpec } from './settings.ts'
import type {
  ConnectorHint, ConnectorIdRequest, ConnectorSettingsRequest, ConnectorsValue, ConnectorSwitchRequest, ConnectorView,
  CustomConnectorConfig, CustomNameRequest, ParseCustomRequest, ParsedCustomConnectors, SaveCustomRequest,
} from './types.ts'

export type * from './types.ts'
export { LAUNCH_MANIFEST, LaunchManifestError, parseLaunchManifest, readLaunchManifest, type LaunchSpec } from './manifest.ts'
export {
  CONNECTOR_SETTINGS, ConnectorSettingsError, MAX_CONNECTOR_SETTINGS, MAX_SETTING_VALUE_LENGTH,
  parseConnectorSettings, readConnectorSettings, type ConnectorSettingSpec, type SettingText,
} from './settings.ts'
export { CUSTOM_NAME_MAX, CUSTOM_PREFIX, CustomConfigError, normalizeCustomConfig, parseCustomConnectors, parseLenientJson } from './custom.ts'
export { findCommand } from './diagnose.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Market and custom connectors: MCP programs and services started and stopped per connector. */
    marketConnectors: MarketConnectors
  }
}

/** System prompt section that lists the setting state of connected market connectors. */
const SETTINGS_PROMPT_SECTION = 'market-connectors:settings'

/** `FiberState` is a const enum, which isolated module compilation cannot import as a value. */
const FIBER_ACTIVE = 2 as FiberState.ACTIVE

/** Provider name of the skills connector packages carry. */
export const MARKET_CONNECTOR_SKILL_PROVIDER = 'market-connector'

/** What the user chose for one installed connector. */
interface ConnectorRecord {
  readonly enabled: boolean
  /** Whether the user accepted the program the connector runs; asked once per installation. */
  readonly confirmed: boolean
  readonly changedAt: string
}

const CONNECTOR_DOMAIN = defineDomain({
  name: 'market_connectors',
  version: 1,
  tables: {
    connectors: domainTable<string, ConnectorRecord>(z.object({ enabled: z.boolean(), confirmed: z.boolean(), changedAt: z.string() })),
  },
})

const timeoutSchema = z.number().int().min(1).optional()
const customRecordSchema = z.discriminatedUnion('transport', [
  z.object({
    transport: z.literal('stdio'), command: z.string(), args: z.array(z.string()), env: z.record(z.string(), z.string()),
    cwd: z.string().optional(), toolCallTimeoutMs: timeoutSchema, enabled: z.boolean(), createdAt: z.string(), changedAt: z.string(),
  }),
  z.object({
    transport: z.literal('streamable-http'), url: z.string(), headers: z.record(z.string(), z.string()),
    toolCallTimeoutMs: timeoutSchema, enabled: z.boolean(), createdAt: z.string(), changedAt: z.string(),
  }),
])

/** One custom connector as stored, keyed by its name: the configuration, its switch and when it was added and changed. */
type CustomRecord = z.infer<typeof customRecordSchema>

const CUSTOM_DOMAIN = defineDomain({
  name: 'market_custom_connectors',
  version: 1,
  tables: {
    connectors: domainTable<string, CustomRecord>(customRecordSchema),
  },
})

/** One program or service this service started, or the outcome of its failed first start. */
interface Running {
  /** Package digest or custom configuration, and the resolved launch; a change restarts it. */
  readonly fingerprint: string
  /** The mcp-client instance; absent before it is created and after a failed start released it. */
  fiber: Fiber | undefined
  state: 'starting' | 'connected' | 'failed'
  error?: string
  hint?: ConnectorHint
  stderr?: readonly string[]
}

/** A connector that should run. */
interface Desired {
  readonly launch: McpLaunch
  readonly fingerprint: string
  /** Look the command and working directory up before starting; custom programs come from the user's machine. */
  readonly preflight: boolean
}

/** Host owner of the connector kind, the custom connectors and the `marketConnectors` Remote namespace. */
export class MarketConnectors extends TypertRemoteService {
  // `tools` is for the mcp-client instances this service starts: they resolve services through its fiber.
  static inject = ['market', 'storageDomain', 'skills', 'tools', 'typert', 'credentials']

  private domain: Domain<typeof CONNECTOR_DOMAIN> | undefined
  private customDomain: Domain<typeof CUSTOM_DOMAIN> | undefined
  /** Installed connectors as the market's last sync listed them. */
  private items: readonly InstalledItem[] = []
  /** Whether the market synced once; before that `items` is not known to be complete. */
  private marketSynced = false
  private readonly launches = new Map<string, LaunchSpec>()
  /** Declared settings of each valid installed connector, by id. */
  private readonly settingSpecs = new Map<string, readonly ConnectorSettingSpec[]>()
  /** Names of the settings with a saved value, by connector id, as the last reconcile read them. */
  private readonly configuredSettings = new Map<string, ReadonlySet<string>>()
  /** Required settings without a saved value, by id of a switched-on connector that therefore does not start. */
  private readonly missingSettings = new Map<string, readonly string[]>()
  private readonly settingStore: ConnectorSettingStore
  /** Why an installed connector's `mcp.json` or `settings.json` was refused, by id. */
  private readonly invalid = new Map<string, string>()
  private readonly running = new Map<string, Running>()
  /** Connectors stopped for an install; they stay stopped until the market's next sync. */
  private readonly held = new Set<string>()
  private readonly listeners = new Set<() => void>()
  /** Counts changes, so the browser can tell a late call result from a newer `watch` frame. */
  private revision = 0
  private readonly lifetime = new AbortController()
  private queue: Promise<void> = Promise.resolve()
  private invalidateSkills: (() => void) | undefined

  /**
   * @param ctx - Host context with the market, storage domain and skill registry services.
   */
  constructor(ctx: Context) {
    super(ctx, 'marketConnectors', { namespace: 'marketConnectors' })
    this.settingStore = new ConnectorSettingStore(ctx)
    // An edit of the credential file restarts the connector with the new values.
    ctx.on('credentials/record-updated', (key) => {
      if (ConnectorSettingStore.connectorOf(key) === undefined) return
      void this.enqueue(() => this.reconcile()).catch((error: unknown) => {
        this.ctx.logger.warn(`market-connectors: settings change of ${key} not applied: ${describeError(error)}`)
      })
    })
    ctx.inject(['systemPrompt'], (inner) => {
      inner.systemPrompt.section({
        name: SETTINGS_PROMPT_SECTION,
        order: inner.systemPrompt.getSectionOrder('MCP_SERVERS'),
        interpolate: false,
        text: () => this.settingsPrompt(),
      })
    })
    let inner: FileSystemSkillProvider | undefined
    ctx.skills.registerProvider((control: SkillProviderControl) => {
      this.invalidateSkills = control.invalidate
      inner = new FileSystemSkillProvider(ctx, control, {
        providerName: MARKET_CONNECTOR_SKILL_PROVIDER,
        includeDefaultRoots: false,
        customSkillDirs: [ctx.market.kindDirectory('connector')],
        watch: false,
      })
      const provider = inner
      return {
        name: MARKET_CONNECTOR_SKILL_PROVIDER,
        list: async options => this.onlyConnected(await provider.list(options)),
        get: (candidate, options) => provider.get(candidate, options),
      }
    })
    ctx.effect(() => async () => { await inner?.dispose() }, 'market-connectors: skill provider')
    ctx.effect(() => () => {
      this.lifetime.abort(new Error('market connectors disposed'))
      this.listeners.clear()
    }, 'market-connectors: lifetime')
  }

  /**
   * Open the connector records, start the switched-on custom connectors in the background, then
   * register the kind; its first sync starts the switched-on market connectors.
   */
  async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(CONNECTOR_DOMAIN)
    this.domain = domain
    this.ctx.effect(() => () => domain.close(), 'market-connectors: records')
    const customDomain = await this.ctx.storageDomain.open(CUSTOM_DOMAIN)
    this.customDomain = customDomain
    this.ctx.effect(() => () => customDomain.close(), 'market-connectors: custom records')
    const kind: MarketKind = {
      kind: 'connector',
      validate: (directory, item) => validateConnector(this.ctx, directory, item),
      sync: items => this.sync(items),
      release: id => this.release(id),
    }
    this.ctx.effect(() => this.ctx.market.registerKind(kind), 'market-connectors: kind')
    // Not awaited: a custom connector that does not start must not hold up the Host.
    void this.enqueue(() => this.reconcile())
  }

  /**
   * List the connectors.
   * @returns every custom and installed market connector with its switch, acceptance, state and program.
   */
  @Remote
  connectorList(): ConnectorsValue {
    return this.snapshot()
  }

  /**
   * Switch one connector on or off. On starts it in the background; follow `watch` for the
   * outcome. Off stops it and keeps its files or configuration.
   * @param request - connector id, target state, and the user's acceptance of a market connector's program.
   * @returns the connectors after the change.
   * @throws RemoteError `market-connectors/not-installed`, `market-connectors/confirmation-required`
   *   when a market connector was never accepted and `confirmed` is not `true`,
   *   `market-connectors/invalid-manifest`, or `market-connectors/state-unavailable`.
   */
  @Remote
  async setConnectorEnabled(request: ConnectorSwitchRequest): Promise<ConnectorsValue> {
    await this.enqueue(async () => {
      const { id } = request
      if (id.startsWith(CUSTOM_PREFIX)) {
        await this.switchCustom(id, request.enabled)
        return
      }
      if (!this.items.some(item => item.record.id === id)) {
        throw new RemoteError('market-connectors/not-installed', `connector ${id} is not installed`, { id })
      }
      const table = this.requireDomain().table('connectors')
      const confirmed = table.get(id)?.confirmed === true || (request.enabled && request.confirmed === true)
      if (request.enabled && !confirmed) {
        throw new RemoteError('market-connectors/confirmation-required', `connector ${id} runs a program the user has not accepted`, { id })
      }
      const invalid = this.invalid.get(id)
      if (request.enabled && invalid !== undefined) {
        throw new RemoteError('market-connectors/invalid-manifest', invalid, { id, reason: invalid })
      }
      await saved(id, () => table.put(id, { enabled: request.enabled, confirmed, changedAt: new Date().toISOString() }))
      // Switching a failed connector on again is a retry.
      if (request.enabled && this.running.get(id)?.state === 'failed') this.running.delete(id)
      await this.reconcile()
    })
    return this.snapshot()
  }

  /**
   * Start a connector whose first start failed; other states are left as they are.
   * @param request - connector id.
   * @returns the connectors after the retry began.
   */
  @Remote
  async retryConnector(request: ConnectorIdRequest): Promise<ConnectorsValue> {
    await this.enqueue(async () => {
      if (this.running.get(request.id)?.state !== 'failed') return
      this.running.delete(request.id)
      await this.reconcile()
    })
    return this.snapshot()
  }

  /**
   * Save or clear the values a market connector's `settings.json` asks for. The values go to the
   * credential store; a running connector restarts with them in the background.
   * @param request - connector id and the changed values by environment variable name.
   * @returns the connectors after the change.
   * @throws RemoteError `market-connectors/not-installed`, `market-connectors/invalid-manifest`
   *   when the package's manifest or settings were refused, `market-connectors/unknown-setting`,
   *   `market-connectors/invalid-setting` for an empty or too long value, or
   *   `market-connectors/settings-unavailable` when the credential store fails.
   */
  @Remote
  async saveConnectorSettings(request: ConnectorSettingsRequest): Promise<ConnectorsValue> {
    await this.enqueue(async () => {
      const { id } = request
      if (!this.items.some(item => item.record.id === id)) {
        throw new RemoteError('market-connectors/not-installed', `connector ${id} is not installed`, { id })
      }
      const reason = this.invalid.get(id)
      if (reason !== undefined) throw new RemoteError('market-connectors/invalid-manifest', reason, { id, reason })
      // Reconcile records the declared settings of every installed connector it did not refuse.
      const specs = this.settingSpecs.get(id) as readonly ConnectorSettingSpec[]
      const declared = new Set(specs.map(spec => spec.env))
      const changes: Record<string, string | null> = {}
      for (const [env, value] of Object.entries(request.values)) {
        if (!declared.has(env)) throw new RemoteError('market-connectors/unknown-setting', `connector ${id} has no setting ${env}`, { id, env })
        const trimmed = value?.trim() ?? null
        if (trimmed !== null && (trimmed.length === 0 || trimmed.length > MAX_SETTING_VALUE_LENGTH)) {
          throw new RemoteError('market-connectors/invalid-setting', `setting ${env} must be 1 to ${MAX_SETTING_VALUE_LENGTH} characters`, { id, env })
        }
        changes[env] = trimmed
      }
      if (Object.keys(changes).length === 0) return
      try {
        await this.settingStore.write(id, changes)
      } catch (error) {
        const reason = describeError(error)
        throw new RemoteError('market-connectors/settings-unavailable', reason, { id, reason })
      }
      // A connector that failed for a missing or wrong value starts again with the new one.
      if (this.running.get(id)?.state === 'failed') this.running.delete(id)
      await this.reconcile()
    })
    return this.snapshot()
  }

  /**
   * Read the MCP servers in pasted text, without saving anything.
   * @param request - the pasted text.
   * @returns each server found with the configuration it would be saved with, or why it cannot be added.
   */
  @Remote
  parseCustomConnectors(request: ParseCustomRequest): ParsedCustomConnectors {
    return parseCustomConnectors(request.text, new Set(this.customNames().map(name => name.toLowerCase())))
  }

  /**
   * Add a custom connector, or change one. A connector that is switched on starts, or restarts
   * when its configuration changed, in the background; saving a failed one unchanged retries it.
   * @param request - the configuration, the name it replaces when changing one, and its switch.
   * @returns the connectors after the change.
   * @throws RemoteError `market-connectors/invalid-custom` when the configuration breaks a rule,
   *   `market-connectors/name-taken`, `market-connectors/not-found` when `previousName` names no
   *   custom connector, or `market-connectors/state-unavailable`.
   */
  @Remote
  async saveCustomConnector(request: SaveCustomRequest): Promise<ConnectorsValue> {
    await this.enqueue(async () => {
      let config: CustomConnectorConfig
      try {
        config = normalizeCustomConfig(request.config)
      } catch (error) {
        if (!(error instanceof CustomConfigError)) throw error
        throw new RemoteError('market-connectors/invalid-custom', error.message, {
          name: request.config.name, problem: error.problem, ...error.detail === undefined ? {} : { detail: error.detail },
        })
      }
      const table = this.requireCustomDomain().table('connectors')
      const { previousName } = request
      const previous = previousName === undefined ? undefined : table.get(previousName)
      if (previousName !== undefined && previous === undefined) {
        throw new RemoteError('market-connectors/not-found', `custom connector ${previousName} does not exist`, { name: previousName })
      }
      const lower = config.name.toLowerCase()
      if (this.customNames().some(name => name !== previousName && name.toLowerCase() === lower)) {
        throw new RemoteError('market-connectors/name-taken', `a custom connector is already named ${config.name}`, { name: config.name })
      }
      const now = new Date().toISOString()
      const record = recordOf(config, request.enabled ?? previous?.enabled ?? true, previous?.createdAt ?? now, now)
      await saved(customId(config.name), async () => {
        // Write the new record before removing the old one, so a failed write loses nothing.
        await table.put(config.name, record)
        if (previousName !== undefined && previousName !== config.name) await table.delete(previousName)
      })
      if (this.running.get(customId(config.name))?.state === 'failed') this.running.delete(customId(config.name))
      await this.reconcile()
    })
    return this.snapshot()
  }

  /**
   * Stop a custom connector and delete its configuration.
   * @param request - connector name.
   * @returns the connectors after the change.
   * @throws RemoteError `market-connectors/not-found` or `market-connectors/state-unavailable`.
   */
  @Remote
  async removeCustomConnector(request: CustomNameRequest): Promise<ConnectorsValue> {
    await this.enqueue(async () => {
      const table = this.requireCustomDomain().table('connectors')
      if (table.get(request.name) === undefined) {
        throw new RemoteError('market-connectors/not-found', `custom connector ${request.name} does not exist`, { name: request.name })
      }
      await saved(customId(request.name), () => table.delete(request.name))
      await this.reconcile()
    })
    return this.snapshot()
  }

  /**
   * Follow connector state for one browser.
   * @param signal - observation lifetime.
   * @returns the current connectors, then the connectors after every change.
   */
  @Remote({ mode: 'stream' })
  async *watch(signal: AbortSignal): AsyncIterable<ConnectorsValue> {
    let dirty = true
    let wake: (() => void) | undefined
    const changed = (): void => { dirty = true; wake?.() }
    this.listeners.add(changed)
    signal.addEventListener('abort', changed, { once: true })
    try {
      while (!signal.aborted && !this.lifetime.signal.aborted) {
        if (dirty) { dirty = false; yield this.snapshot(); continue }
        await new Promise<void>((resolve) => { wake = resolve })
      }
    } finally {
      this.listeners.delete(changed)
      signal.removeEventListener('abort', changed)
    }
  }

  private async switchCustom(id: string, enabled: boolean): Promise<void> {
    const name = id.slice(CUSTOM_PREFIX.length)
    const table = this.requireCustomDomain().table('connectors')
    const record = table.get(name)
    if (record === undefined) throw new RemoteError('market-connectors/not-installed', `custom connector ${name} does not exist`, { id })
    await saved(id, () => table.put(name, { ...record, enabled, changedAt: new Date().toISOString() }))
    if (enabled && this.running.get(id)?.state === 'failed') this.running.delete(id)
    await this.reconcile()
  }

  private sync(items: readonly InstalledItem[]): Promise<void> {
    return this.enqueue(async () => {
      this.items = items
      this.marketSynced = true
      // The market syncs after every install attempt, so a released connector may run again.
      this.held.clear()
      await this.reconcile()
    })
  }

  private release(id: string): Promise<void> {
    return this.enqueue(async () => {
      this.held.add(id)
      await this.stop(id)
    })
  }

  /**
   * Bring the running programs and services in line with the switched-on custom connectors and
   * the installed, switched-on, accepted and valid market connectors. One whose package,
   * configuration and launch are unchanged keeps running, so the sync after every catalog read
   * restarts nothing.
   */
  private async reconcile(): Promise<void> {
    const table = this.requireDomain().table('connectors')
    const installed = new Set(this.items.map(item => item.record.id))
    for (const [id] of this.marketSynced ? [...table.entries()] : []) {
      // An uninstalled connector asks for acceptance again when it is installed again.
      if (!installed.has(id)) await table.delete(id)
    }
    if (this.marketSynced) {
      // Its settings go too, whether or not it was ever switched on.
      await this.settingStore.prune(installed).catch((error: unknown) => {
        this.ctx.logger.warn(`market-connectors: settings of uninstalled connectors not removed: ${describeError(error)}`)
      })
    }
    this.launches.clear()
    this.settingSpecs.clear()
    this.configuredSettings.clear()
    this.missingSettings.clear()
    this.invalid.clear()
    const desired = new Map<string, Desired>()
    for (const item of this.items) {
      const id = item.record.id
      if (id.startsWith(CUSTOM_PREFIX)) {
        this.invalid.set(id, reservedIdReason(id))
        continue
      }
      let spec: LaunchSpec
      let specs: readonly ConnectorSettingSpec[]
      try {
        spec = await readLaunchManifest(item.directory)
        specs = await readConnectorSettings(item.directory, Object.keys(spec.env))
      } catch (error) {
        this.invalid.set(id, describeError(error))
        continue
      }
      this.launches.set(id, spec)
      this.settingSpecs.set(id, specs)
      let values: Readonly<Record<string, string>>
      try {
        values = await this.settingStore.read(id, specs)
      } catch (error) {
        // An unreadable credential store must not start the program without its values.
        this.invalid.set(id, `settings cannot be read: ${describeError(error)}`)
        continue
      }
      this.configuredSettings.set(id, new Set(Object.keys(values)))
      const record = table.get(id)
      if (record?.enabled !== true || !record.confirmed || this.held.has(id)) continue
      const missing = specs.filter(setting => setting.required && values[setting.env] === undefined).map(setting => setting.env)
      // A running copy is stopped below because it is no longer desired.
      if (missing.length > 0) {
        this.missingSettings.set(id, missing)
        continue
      }
      const launch: McpLaunch = {
        transport: 'stdio', serverName: id, command: spec.command, args: [...spec.args], env: { ...spec.env, ...values }, cwd: spec.cwd,
        failOnStartupError: true, ...spec.toolCallTimeoutMs === undefined ? {} : { toolCallTimeoutMs: spec.toolCallTimeoutMs },
      }
      const fingerprint = `${item.record.sha256}\n${JSON.stringify(spec)}\n${digestOf(values)}`
      desired.set(id, { launch, fingerprint, preflight: false })
    }
    const home = homedir()
    for (const [name, record] of this.customEntries()) {
      if (!record.enabled) continue
      const launch = customLaunch(configOf(name, record), home)
      desired.set(customId(name), { launch, fingerprint: `custom\n${JSON.stringify(launch)}`, preflight: launch.transport === 'stdio' })
    }
    for (const [id, run] of [...this.running]) {
      if (desired.get(id)?.fingerprint !== run.fingerprint) await this.stop(id)
    }
    for (const [id, want] of desired) {
      if (!this.running.has(id)) this.start(id, want)
    }
    this.changed()
  }

  /** Start one connector; the first connection settles in the background and is reported through `watch`. */
  private start(id: string, want: Desired): void {
    const run: Running = { fingerprint: want.fingerprint, fiber: undefined, state: 'starting' }
    this.running.set(id, run)
    void this.launch(id, run, want)
  }

  private async launch(id: string, run: Running, want: Desired): Promise<void> {
    const { launch } = want
    if (want.preflight && launch.transport === 'stdio') {
      const failure = await preflight(launch)
      if (this.running.get(id) !== run) return
      if (failure !== undefined) {
        this.fail(run, failure)
        return
      }
    }
    if (this.lifetime.signal.aborted) return
    const fiber = this.ctx.plugin(mcpClient, launch)
    run.fiber = fiber
    void fiber.then(() => {
      // A fiber settles without starting when it was disposed while loading.
      if (fiber.state !== FIBER_ACTIVE) throw new Error(`mcp-client(${id}) did not start`)
    }).then(() => {
      if (this.running.get(id) !== run) return
      run.state = 'connected'
      this.invalidateSkills?.()
      this.changed()
    }, (error: unknown) => {
      if (this.running.get(id) !== run) return
      // The failed instance already released its server name; dropping it frees the fiber.
      run.fiber = undefined
      this.fail(run, describeStartFailure(error, launch.transport, launch.transport === 'streamable-http' ? launch.url : undefined))
      // dispose() may return without a promise once the fiber is gone, as cordis itself allows.
      void Promise.resolve(fiber.dispose()).catch((disposeError: unknown) => {
        this.ctx.logger.warn(`market-connectors: ${id} failed start could not be released: ${describeError(disposeError)}`)
      })
    })
  }

  private fail(run: Running, failure: StartFailure): void {
    run.state = 'failed'
    run.error = failure.error
    if (failure.hint !== undefined) run.hint = failure.hint
    if (failure.stderr !== undefined) run.stderr = failure.stderr
    this.changed()
  }

  /** Stop one connector and wait until its process and tools are gone. */
  private async stop(id: string): Promise<void> {
    const run = this.running.get(id)
    if (run === undefined) return
    this.running.delete(id)
    if (run.state === 'connected') this.invalidateSkills?.()
    this.changed()
    try {
      await run.fiber?.dispose()
    } catch (error) {
      // The process may still hold its files; an install that follows reports the busy directory.
      this.ctx.logger.warn(`market-connectors: ${id} did not stop cleanly: ${describeError(error)}`)
    }
  }

  private snapshot(): ConnectorsValue {
    const table = this.domain?.table('connectors')
    const custom = this.customEntries()
      .sort(([left], [right]) => left.toLowerCase().localeCompare(right.toLowerCase()) || left.localeCompare(right))
      .map(([name, record]): ConnectorView => {
        const id = customId(name)
        const config = configOf(name, record)
        return {
          id,
          origin: 'custom',
          enabled: record.enabled,
          confirmed: true,
          ...this.runView(id),
          ...config.transport === 'stdio' ? { launch: { command: config.command, args: config.args } } : {},
          custom: config,
        }
      })
    const market = this.items.map(item => item.record.id).sort().map((id): ConnectorView => {
      const record = table?.get(id)
      const launch = this.launches.get(id)
      const missing = this.missingSettings.get(id)
      const invalid = this.invalid.get(id) ?? (missing === undefined ? undefined : `needs a value for ${missing.join(', ')}`)
      const run = this.runView(id)
      const specs = this.settingSpecs.get(id) ?? []
      const configured = this.configuredSettings.get(id)
      return {
        id,
        origin: 'market',
        enabled: record?.enabled ?? false,
        confirmed: record?.confirmed ?? false,
        ...run,
        ...run.error === undefined && invalid !== undefined ? { error: invalid } : {},
        ...missing === undefined ? {} : { hint: 'setting-required' as const },
        ...launch === undefined ? {} : { launch: { command: launch.commandPath, args: launch.args } },
        ...specs.length === 0 ? {} : { settings: specs.map(spec => ({ ...spec, configured: configured?.has(spec.env) === true })) },
      }
    })
    return { revision: this.revision, connectors: [...custom, ...market] }
  }

  private runView(id: string): Pick<ConnectorView, 'state' | 'error' | 'hint' | 'stderr'> {
    const run = this.running.get(id)
    if (run === undefined) return { state: 'off' }
    return {
      state: run.state,
      ...run.error === undefined ? {} : { error: run.error },
      ...run.hint === undefined ? {} : { hint: run.hint },
      ...run.stderr === undefined ? {} : { stderr: run.stderr },
    }
  }

  private customEntries(): [string, CustomRecord][] {
    return [...this.customDomain?.table('connectors').entries() ?? []]
  }

  private customNames(): string[] {
    return this.customEntries().map(([name]) => name)
  }

  /**
   * Tell the model which settings of the connected market connectors have a saved value and
   * where the user changes them; never the values. Empty when no connected connector declares one.
   */
  private settingsPrompt(): string {
    const lines: string[] = []
    for (const [id, specs] of this.settingSpecs) {
      if (specs.length === 0 || this.running.get(id)?.state !== 'connected') continue
      const configured = this.configuredSettings.get(id)
      const states = specs.map(spec => `${spec.env} ${configured?.has(spec.env) === true ? 'saved' : 'not saved'}`)
      lines.push(`- ${id}: ${states.join('; ')}`)
    }
    if (lines.length === 0) return ''
    return [
      'Market connector settings. The user saves these values in the connector\'s detail dialog: 市场 → 连接器 → the connector → 设置. Desktop keeps them in its credential store and restarts the connector with them.',
      'When a tool result shows a missing, wrong or rate-limited key, tell the user to open that dialog. Do not ask for the value in the conversation; if the user pastes one, ask them to save it in the dialog instead and suggest replacing the pasted key. Do not edit the connector\'s mcp.json or set environment variables: an update replaces the files, and Desktop does not pass environment variables named like keys or tokens to connectors.',
      ...lines,
    ].join('\n')
  }

  /** A connector's skill is visible only while its tools are. */
  private onlyConnected(output: readonly SkillCandidate[] | SkillProviderObservation): SkillProviderObservation {
    const observation = 'candidates' in output ? output : { candidates: output, complete: true }
    return {
      candidates: observation.candidates.filter(candidate => this.running.get(candidate.name)?.state === 'connected'),
      complete: observation.complete,
    }
  }

  private requireDomain(): Domain<typeof CONNECTOR_DOMAIN> {
    if (this.domain === undefined) throw new Error('market-connectors: connector records are not open yet')
    return this.domain
  }

  private requireCustomDomain(): Domain<typeof CUSTOM_DOMAIN> {
    if (this.customDomain === undefined) throw new Error('market-connectors: custom connector records are not open yet')
    return this.customDomain
  }

  private enqueue(job: () => Promise<void>): Promise<void> {
    const result = this.queue.then(job)
    this.queue = result.catch(() => undefined)
    return result
  }

  private changed(): void {
    this.revision += 1
    for (const listener of this.listeners) listener()
  }
}

/** Run a record write, reporting a storage failure as `market-connectors/state-unavailable`. */
async function saved(id: string, write: () => Promise<unknown>): Promise<void> {
  try {
    await write()
  } catch (error) {
    const reason = describeError(error)
    throw new RemoteError('market-connectors/state-unavailable', reason, { id, reason })
  }
}

function recordOf(config: CustomConnectorConfig, enabled: boolean, createdAt: string, changedAt: string): CustomRecord {
  const timeout = config.toolCallTimeoutMs === undefined ? {} : { toolCallTimeoutMs: config.toolCallTimeoutMs }
  if (config.transport === 'stdio') {
    return {
      transport: 'stdio', command: config.command, args: [...config.args], env: { ...config.env },
      ...config.cwd === undefined ? {} : { cwd: config.cwd }, ...timeout, enabled, createdAt, changedAt,
    }
  }
  return { transport: 'streamable-http', url: config.url, headers: { ...config.headers }, ...timeout, enabled, createdAt, changedAt }
}

function configOf(name: string, record: CustomRecord): CustomConnectorConfig {
  const timeout = record.toolCallTimeoutMs === undefined ? {} : { toolCallTimeoutMs: record.toolCallTimeoutMs }
  if (record.transport === 'stdio') {
    return {
      name, transport: 'stdio', command: record.command, args: record.args, env: record.env,
      ...record.cwd === undefined ? {} : { cwd: record.cwd }, ...timeout,
    }
  }
  return { name, transport: 'streamable-http', url: record.url, headers: record.headers, ...timeout }
}

/** Check that a custom program's working directory and command exist before starting it. */
async function preflight(launch: Extract<McpLaunch, { transport: 'stdio' }>): Promise<StartFailure | undefined> {
  if (!await isDirectory(launch.cwd)) {
    return { error: `working directory ${launch.cwd} does not exist`, hint: 'cwd-not-found' }
  }
  if (await findCommand(launch.command, launch.cwd, { ...process.env, ...launch.env }) === undefined) {
    return { error: `command ${launch.command} was not found`, hint: 'command-not-found' }
  }
  return undefined
}

function reservedIdReason(id: string): string {
  return `connector id ${id} starts with ${CUSTOM_PREFIX}, which is reserved for custom connectors`
}

/**
 * Check an unpacked connector package: its id, its launch manifest, and its skill when it carries one.
 * @param ctx - context for the temporary skill provider.
 * @param directory - staging directory of the unpacked package.
 * @param item - catalog entry; a skill in the package must be named after its id.
 * @throws when the id uses the custom prefix, `mcp.json` cannot start a program in the package,
 *   `settings.json` is present but invalid, or `SKILL.md` names another skill.
 */
async function validateConnector(ctx: Context, directory: string, item: MarketCatalogItem): Promise<void> {
  if (item.id.startsWith(CUSTOM_PREFIX)) throw new Error(reservedIdReason(item.id))
  const spec = await readLaunchManifest(directory)
  await readConnectorSettings(directory, Object.keys(spec.env))
  if ((await stat(join(directory, 'SKILL.md')).catch(() => undefined))?.isFile() !== true) return
  const lifetime = new AbortController()
  const probe = new FileSystemSkillProvider(ctx, { signal: lifetime.signal, invalidate: () => {} }, {
    providerName: 'market-connector-validate', includeDefaultRoots: false, customSkillDirs: [directory], watch: false,
  })
  try {
    const output = await probe.list({})
    const candidates = 'candidates' in output ? output.candidates : output
    const skill = candidates.find(candidate => candidate.path?.endsWith('SKILL.md') === true)
    if (skill === undefined) throw new Error('SKILL.md needs YAML frontmatter with a valid name and a description')
    if (skill.name !== item.id) throw new Error(`SKILL.md name is ${skill.name}; the catalog id is ${item.id}`)
  } finally {
    lifetime.abort()
    await probe.dispose()
  }
}

export default MarketConnectors
