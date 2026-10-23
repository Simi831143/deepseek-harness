/**
 * Market core: one published catalog, package installation, and installed-item
 * records shared by the skill, expert and connector domain packages. The core
 * knows no domain: each kind's package registers a {@link MarketKind} that
 * validates unpacked content and brings its runtime in line with the installed
 * set. Browsers reach the core through the `market` Remote namespace.
 * @module @deepseek-ai/dsh-market
 */
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Service, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineDomain, domainTable, type Domain } from '@deepseek-ai/dsh-storage-domain'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { z as zod } from 'zod'
import { findItem, itemKey, MarketCatalogError, parseCatalog, resolveCatalogPath } from './catalog.ts'
import { installPackage, itemDirectory, removePackage, type InstallerOptions } from './installer.ts'
import type {
  MarketCatalog, MarketCatalogItem, MarketCatalogSource, MarketInstalledRecord, MarketItemRef, MarketItemView, MarketKindName,
  MarketSnapshot,
} from './types.ts'

export type * from './types.ts'
export { MARKET_ID, MARKET_ID_MAX_LENGTH, itemKey } from './catalog.ts'
export { MarketArchiveError } from './archive.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Market core: catalog, installation and installed records. */
    market: Market
  }
}

/** One installed item handed to its kind's domain package. */
export interface InstalledItem {
  readonly record: MarketInstalledRecord
  /** Directory holding the unpacked package. */
  readonly directory: string
  /** The item's current catalog entry, absent when the catalog no longer lists it or is unavailable. */
  readonly catalog?: MarketCatalogItem
}

/** Domain behavior for one kind of item. */
export interface MarketKind {
  readonly kind: MarketKindName
  /**
   * Check an unpacked package before it replaces any installed copy.
   * @param directory - staging directory holding the unpacked files.
   * @param item - the catalog entry being installed.
   * @throws to refuse the package; the message reaches the user.
   */
  validate(directory: string, item: MarketCatalogItem): Promise<void>
  /**
   * Bring the domain's runtime in line with the complete installed set of this
   * kind. Called after registration and after every install or uninstall; must
   * be idempotent.
   * @param items - every installed item of this kind.
   */
  sync(items: readonly InstalledItem[]): Promise<void>
}

/** Market core configuration. */
export interface Config {
  /** Absolute URL of the published `index.json`; empty disables remote reads. */
  catalogUrl: string
  /** Market home; defaults to `<DSH home>/market`. */
  home?: string
  /** Deadline for one catalog request. */
  catalogTimeoutMs: number
  /** Deadline for one package download. */
  downloadTimeoutMs: number
  /** How long a directory rename keeps retrying while another process holds the path. */
  renameRetryMs: number
}

const installedSchema = zod.object({
  kind: zod.enum(['skill', 'expert', 'connector']),
  id: zod.string(),
  version: zod.string(),
  sha256: zod.string(),
  installedAt: zod.string(),
})

const MARKET_DOMAIN = defineDomain({
  name: 'market',
  version: 1,
  tables: { installed: domainTable<string, MarketInstalledRecord>(installedSchema) },
})

const CACHE_FILE = 'index.json'
const CACHE_META_FILE = 'index.meta.json'
const cacheMetaSchema = zod.object({ etag: zod.string().optional(), fetchedAt: zod.string(), url: zod.string() })

/** Host owner of the `market` Remote namespace and the `ctx.market` service. */
export class Market extends TypertRemoteService {
  static inject = ['storageDomain', 'typert']
  static Config: z<Partial<Config>, Config> = z.object({
    catalogUrl: z.string().default(''),
    home: z.string(),
    catalogTimeoutMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(15_000),
    downloadTimeoutMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(120_000),
    renameRetryMs: z.natural().default(60_000),
  })

  private readonly home: string
  private readonly installer: InstallerOptions
  private readonly kinds = new Map<MarketKindName, MarketKind>()
  private readonly listeners = new Set<() => void>()
  private readonly installing = new Set<string>()
  private readonly lifetime = new AbortController()
  private domain: Domain<typeof MARKET_DOMAIN> | undefined
  private catalog: MarketCatalog | undefined
  private source: MarketCatalogSource = 'none'
  private fetchedAt: string | undefined
  private fetchError: string | undefined
  private etag: string | undefined
  private revision = 0
  private queue: Promise<void> = Promise.resolve()
  private refreshing: Promise<void> | undefined

  /**
   * @param ctx - Host context with the storage domain facility.
   * @param config - catalog location and timing.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'market', { namespace: 'market' })
    this.home = config.home ?? join(resolveDshHome(), 'market')
    this.installer = {
      packagesRoot: join(this.home, 'packages'),
      stagingRoot: join(this.home, 'tmp'),
      downloadTimeoutMs: config.downloadTimeoutMs,
      renameRetryMs: config.renameRetryMs,
    }
    if (config.catalogUrl !== '') {
      const url = new URL(config.catalogUrl)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('market: catalogUrl must be an http(s) URL')
    }
    ctx.effect(() => () => {
      this.lifetime.abort(new Error('market disposed'))
      this.listeners.clear()
    }, 'market: lifetime')
  }

  /** Open the installed-record domain, clear staging, and read the cached catalog; the remote read runs in the background. */
  async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(MARKET_DOMAIN)
    this.domain = domain
    this.ctx.effect(() => () => domain.close(), 'market: installed records')
    await rm(this.installer.stagingRoot, { recursive: true, force: true })
    await this.readCache()
    if (this.config.catalogUrl !== '') void this.refresh().catch(() => undefined)
  }

  /**
   * Register the domain behavior of one kind. Its installed items are synced at once.
   * @param kind - domain behavior.
   * @returns disposer; register it with the domain plugin's effects.
   * @throws when another package already handles the kind.
   */
  registerKind(kind: MarketKind): () => void {
    if (this.kinds.has(kind.kind)) throw new Error(`market: kind ${kind.kind} is already registered`)
    this.kinds.set(kind.kind, kind)
    this.changed()
    void this.enqueue(() => this.syncKind(kind.kind)).catch((error: unknown) => {
      this.ctx.logger.warn(`market: initial ${kind.kind} sync failed: ${String(error)}`)
    })
    return () => {
      if (this.kinds.get(kind.kind) !== kind) return
      this.kinds.delete(kind.kind)
      this.changed()
    }
  }

  /**
   * Directory holding every installed item of one kind, one subdirectory per id.
   * @param kind - item kind.
   * @returns the absolute directory; it may not exist before the first install.
   */
  kindDirectory(kind: MarketKindName): string {
    return join(this.installer.packagesRoot, kind)
  }

  /**
   * Installed items of one kind, with their directories and catalog entries.
   * @param kind - item kind.
   * @returns every installed item of the kind.
   */
  installedItems(kind: MarketKindName): InstalledItem[] {
    const domain = this.domain
    if (domain === undefined) return []
    return [...domain.table('installed').entries()]
      .map(([, record]) => record)
      .filter(record => record.kind === kind)
      .map((record) => {
        const catalog = this.catalog === undefined ? undefined : findItem(this.catalog, record.kind, record.id)
        return {
          record,
          directory: itemDirectory(this.installer.packagesRoot, record.kind, record.id),
          ...catalog === undefined ? {} : { catalog },
        }
      })
  }

  /**
   * Install an item for an in-process caller such as an expert installing its skills.
   * @param ref - kind and id.
   * @param signal - cancellation.
   * @returns after the item is installed and its kind synced; an installed item at the catalog version returns at once.
   */
  async installItem(ref: MarketItemRef, signal: AbortSignal = this.lifetime.signal): Promise<void> {
    await this.enqueue(() => this.runInstall(ref, signal))
  }

  /**
   * Read the complete market state.
   * @returns catalog, install state, and available kinds.
   */
  @Remote
  catalogSnapshot(): MarketSnapshot {
    return this.snapshot()
  }

  /**
   * Fetch the published catalog again, ignoring the cached copy's freshness.
   * @returns the state after the read; a failed read keeps the last good catalog and reports the error.
   */
  @Remote
  async refreshCatalog(): Promise<MarketSnapshot> {
    await this.refresh()
    return this.snapshot()
  }

  /**
   * Install or update one item from the catalog.
   * @param ref - kind and id.
   * @param signal - caller cancellation.
   * @returns the state after the install.
   * @throws RemoteError `market/not-found`, `market/kind-unavailable`, or `market/install-failed`.
   */
  @Remote
  async installPackage(ref: MarketItemRef, signal: AbortSignal): Promise<MarketSnapshot> {
    await this.installItem(ref, signal)
    return this.snapshot()
  }

  /**
   * Remove one installed item and its files.
   * @param ref - kind and id.
   * @returns the state after removal; removing an absent item changes nothing.
   */
  @Remote
  async uninstallPackage(ref: MarketItemRef): Promise<MarketSnapshot> {
    await this.enqueue(async () => {
      const domain = this.requireDomain()
      if (!await domain.table('installed').delete(itemKey(ref))) return
      this.changed()
      await this.syncKind(ref.kind)
      await removePackage(this.installer.packagesRoot, ref.kind, ref.id)
    })
    return this.snapshot()
  }

  /**
   * Follow market state for one browser.
   * @param signal - observation lifetime.
   * @returns the current state, then the state after every change.
   */
  @Remote({ mode: 'stream' })
  async *watch(signal: AbortSignal): AsyncIterable<MarketSnapshot> {
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

  private snapshot(): MarketSnapshot {
    const installed = new Map<string, MarketInstalledRecord>(this.domain === undefined ? [] : [...this.domain.table('installed').entries()])
    const catalog = this.catalog
    const items: MarketItemView[] = (catalog?.items ?? []).map((item) => {
      const record = installed.get(itemKey(item))
      const iconUrl = item.icon === undefined ? undefined : this.safeResolve(item.icon)
      // Installed files identical to the catalog's package are that version, even when the
      // publisher only raised the number (display fields live outside the package).
      const installedVersion = record === undefined ? undefined : record.sha256 === item.package?.sha256 ? item.version : record.version
      return {
        ...item,
        ...iconUrl === undefined ? {} : { iconUrl },
        ...installedVersion === undefined ? {} : { installedVersion },
      }
    })
    return {
      revision: this.revision,
      source: this.source,
      ...this.fetchedAt === undefined ? {} : { fetchedAt: this.fetchedAt },
      ...this.fetchError === undefined ? {} : { fetchError: this.fetchError },
      categories: catalog?.categories ?? [],
      featured: catalog?.featured ?? [],
      items,
      kinds: [...this.kinds.keys()],
      installing: [...this.installing],
    }
  }

  private safeResolve(path: string): string | undefined {
    if (this.config.catalogUrl === '') return undefined
    try {
      return resolveCatalogPath(this.config.catalogUrl, path)
    } catch (_crossOrigin) {
      return undefined
    }
  }

  private async runInstall(ref: MarketItemRef, signal: AbortSignal): Promise<void> {
    const kind = this.kinds.get(ref.kind)
    if (kind === undefined) throw new RemoteError('market/kind-unavailable', `no package handles ${ref.kind} items`, { kind: ref.kind })
    const item = this.catalog === undefined ? undefined : findItem(this.catalog, ref.kind, ref.id)
    if (item?.package === undefined) {
      throw new RemoteError('market/not-found', `${itemKey(ref)} is not in the catalog`, { kind: ref.kind, id: ref.id })
    }
    const domain = this.requireDomain()
    const key = itemKey(item)
    const current = domain.table('installed').get(key)
    if (current?.sha256 === item.package.sha256) return
    this.installing.add(key)
    this.changed()
    try {
      const url = resolveCatalogPath(this.config.catalogUrl, item.package.path)
      await installPackage(url, item, (directory, entry) => kind.validate(directory, entry), this.installer,
        AbortSignal.any([signal, this.lifetime.signal]))
      await domain.table('installed').put(key, {
        kind: item.kind, id: item.id, version: item.version, sha256: item.package.sha256, installedAt: new Date().toISOString(),
      })
    } catch (error) {
      if (error instanceof RemoteError) throw error
      signal.throwIfAborted()
      const reason = error instanceof Error ? error.message : String(error)
      throw new RemoteError('market/install-failed', reason, { kind: ref.kind, id: ref.id, reason })
    } finally {
      this.installing.delete(key)
      this.changed()
    }
    await this.syncKind(item.kind)
  }

  private async syncKind(kind: MarketKindName): Promise<void> {
    const handler = this.kinds.get(kind)
    if (handler === undefined || this.domain === undefined) return
    await handler.sync(this.installedItems(kind))
  }

  private async refresh(): Promise<void> {
    this.refreshing ??= this.fetchCatalog().finally(() => { this.refreshing = undefined })
    return this.refreshing
  }

  private async fetchCatalog(): Promise<void> {
    if (this.config.catalogUrl === '') return
    const signal = AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(this.config.catalogTimeoutMs)])
    try {
      const response = await fetch(this.config.catalogUrl, {
        signal, redirect: 'error',
        headers: this.etag === undefined || this.catalog === undefined ? {} : { 'if-none-match': this.etag },
      })
      if (response.status === 304) {
        await response.body?.cancel()
        this.fetchedAt = new Date().toISOString()
        this.fetchError = undefined
        this.source = 'remote'
      } else {
        if (!response.ok) throw new Error(`catalog request returned HTTP ${response.status}`)
        const text = await response.text()
        const catalog = parseCatalog(text)
        this.catalog = catalog
        this.etag = response.headers.get('etag') ?? undefined
        this.fetchedAt = new Date().toISOString()
        this.fetchError = undefined
        this.source = 'remote'
        await this.writeCache(text)
      }
    } catch (error) {
      if (this.lifetime.signal.aborted) return
      this.fetchError = error instanceof MarketCatalogError || error instanceof Error ? error.message : String(error)
      this.ctx.logger.warn(`market: catalog read failed: ${this.fetchError}`)
    }
    this.changed()
    for (const kind of this.kinds.keys()) {
      void this.enqueue(() => this.syncKind(kind)).catch((error: unknown) => {
        this.ctx.logger.warn(`market: ${kind} sync after catalog read failed: ${String(error)}`)
      })
    }
  }

  private async readCache(): Promise<void> {
    const directory = join(this.home, 'cache')
    let text: string
    let metaText: string
    try {
      text = await readFile(join(directory, CACHE_FILE), 'utf8')
      metaText = await readFile(join(directory, CACHE_META_FILE), 'utf8')
    } catch (_absentCache) {
      return
    }
    try {
      const meta = cacheMetaSchema.parse(JSON.parse(metaText))
      if (meta.url !== this.config.catalogUrl) return
      this.catalog = parseCatalog(text)
      this.etag = meta.etag
      this.fetchedAt = meta.fetchedAt
      this.source = 'cache'
    } catch (error) {
      this.ctx.logger.warn(`market: cached catalog ignored: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async writeCache(text: string): Promise<void> {
    const directory = join(this.home, 'cache')
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await writeFileAtomic(join(directory, CACHE_FILE), text, { mode: 0o600 })
    const meta = { ...this.etag === undefined ? {} : { etag: this.etag }, fetchedAt: this.fetchedAt, url: this.config.catalogUrl }
    await writeFileAtomic(join(directory, CACHE_META_FILE), `${JSON.stringify(meta)}\n`, { mode: 0o600 })
  }

  private requireDomain(): Domain<typeof MARKET_DOMAIN> {
    if (this.domain === undefined) throw new Error('market: installed records are not open yet')
    return this.domain
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

export default Market
