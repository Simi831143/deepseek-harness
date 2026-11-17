/** Profile plugin installation behind the shared market's catalog and verified downloads. */
import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { evaluatePluginCompatibility, getDshRuntimeVersion } from '@deepseek-ai/dsh-app-boot'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { MarketManagedKind, MarketManagedState } from '@deepseek-ai/dsh-market'
import type { MarketCatalogItem } from '@deepseek-ai/dsh-market/types'
import type { BundleInfo, ChangeResult, PluginInstallRequestId } from '@deepseek-ai/dsh-plugin-manager/types'
import type { MarketVersion } from '@deepseek-ai/dsh-plugin-market-index'
import { z as zod } from 'zod'
import type {} from '@deepseek-ai/dsh-plugin-manager'
import { validateTarballManifest } from './manifest.ts'

/** Plugin name used by the Loader. */
export const name = 'market-plugins'

/** Shared catalog owner and launcher-provided plugin installation services. */
export const inject = ['market', 'pluginManager', 'profileContext']

/** Limits for reading a plugin's manifest before package installation. */
export interface Config {
  /** Largest accepted uncompressed package.json, in bytes. */
  manifestMaxBytes: number
}

/** Validated limits for package metadata. */
export const Config: z<Partial<Config>, Config> = z.object({
  manifestMaxBytes: z.natural().min(1).default(1_048_576),
})

/** A plugin operation failed; completed manager changes remain authoritative. */
export class MarketPluginError extends Error {
  /** @param code - stable failure category. @param message - affected plugin and failure. @param options - original cause. */
  constructor(readonly code: 'unavailable' | 'provided' | 'incompatible' | 'package' | 'operation', message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'MarketPluginError'
  }
}

class PluginKind implements MarketManagedKind {
  readonly kind = 'plugin'
  readonly mode = 'managed'
  private bundles: readonly BundleInfo[] = []
  private exemptions: Readonly<Record<string, readonly string[]>> = {}
  private readonly restarts = new Set<string>()
  private readonly lifetime = new AbortController()
  private readonly pending = new Set<Promise<void>>()

  constructor(private readonly ctx: Context, private readonly config: Config) {}

  get active(): boolean { return !this.lifetime.signal.aborted }

  refresh(): Promise<void> {
    if (this.lifetime.signal.aborted) return Promise.resolve()
    return this.track(this.readInventory())
  }

  async dispose(): Promise<void> {
    this.lifetime.abort(new DOMException('Market plugin provider unloaded', 'AbortError'))
    await Promise.allSettled([...this.pending])
  }

  private async readInventory(): Promise<void> {
    const bundles = await this.ctx.pluginManager.listBundles()
    if (this.lifetime.signal.aborted) return
    const exemptions = this.ctx.pluginManager.listVersionExemptions().exemptions
    this.bundles = bundles
    this.exemptions = exemptions
    for (const name of this.restarts) {
      if (!bundles.some(bundle => bundle.name === name && bundle.installed)) this.restarts.delete(name)
    }
  }

  view(item: MarketCatalogItem): MarketManagedState {
    const plugin = item.plugin
    const bundle = this.bundles.find(candidate => candidate.name === (plugin?.name ?? item.id))
    const versions = plugin?.versions.map(version => ({ version: version.version, ...this.compatibility(plugin.name, version) }))
    const selected = versions?.find(version => version.version === item.version)
    return {
      installed: bundle?.installed === true || bundle?.availability === 'installation',
      provided: bundle?.availability === 'installation',
      enabled: bundle?.enabled ?? false,
      compatible: selected?.compatible ?? false,
      restartRequired: this.restarts.has(plugin?.name ?? item.id),
      ...selected?.reason === undefined ? {} : { reason: selected.reason },
      ...bundle?.version === undefined ? {} : { installedVersion: bundle.version },
      ...versions === undefined ? {} : { versions },
    }
  }

  async install(item: MarketCatalogItem, data: Uint8Array, caller: AbortSignal): Promise<void> {
    const signal = AbortSignal.any([caller, this.lifetime.signal])
    signal.throwIfAborted()
    await this.track(this.runInstall(item, data, signal))
  }

  async uninstall(id: string, caller: AbortSignal): Promise<void> {
    const signal = AbortSignal.any([caller, this.lifetime.signal])
    signal.throwIfAborted()
    await this.track(this.runUninstall(id, signal))
  }

  private track(operation: Promise<void>): Promise<void> {
    const pending = operation.finally(() => { this.pending.delete(pending) })
    this.pending.add(pending)
    return pending
  }

  private async runInstall(item: MarketCatalogItem, data: Uint8Array, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    const plugin = item.plugin
    const version = plugin?.versions.find(candidate => candidate.version === item.version)
    if (plugin === undefined || version === undefined || version.source.type !== 'tarball') {
      throw new MarketPluginError('unavailable', `${item.id}@${item.version} has no market tarball`)
    }
    await this.refresh()
    signal.throwIfAborted()
    const state = this.view(item)
    if (state.provided === true) throw new MarketPluginError('provided', `${plugin.name} is supplied by this application`)
    if (!state.compatible) throw new MarketPluginError('incompatible', state.reason ?? `${plugin.name}@${version.version} is incompatible`)
    await validateTarballManifest(data, plugin.name, version.version, this.config.manifestMaxBytes)
    signal.throwIfAborted()
    const file = join(this.ctx.profileContext.dir, '.plugin-market', 'tarballs', `${randomUUID()}.tgz`)
    await mkdir(join(this.ctx.profileContext.dir, '.plugin-market', 'tarballs'), { recursive: true, mode: 0o700 })
    const handle = await open(file, 'wx', 0o600)
    try {
      try { await handle.writeFile(data) } finally { await handle.close() }
      signal.throwIfAborted()
      if (state.installed) {
        const removed = await this.ctx.pluginManager.removeBundle(plugin.name)
        this.requireSuccess(removed, plugin.name)
        signal.throwIfAborted()
      }
      const result = await this.installFile(file, state.installed ? state.enabled !== false : true, signal)
      if (result.application === 'restart-required') this.restarts.add(plugin.name)
      else this.restarts.delete(plugin.name)
      this.requireSuccess(result, `${plugin.name}@${version.version}`)
      if (result.bundle !== plugin.name || result.version !== version.version) {
        throw new MarketPluginError('package', `Installed package differs from ${plugin.name}@${version.version}; inspect Plugins before continuing`)
      }
    } finally {
      await this.releaseUnreferenced(file)
    }
  }

  private async runUninstall(id: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    await this.refresh()
    signal.throwIfAborted()
    const bundle = this.bundles.find(candidate => candidate.name === id)
    if (bundle?.availability === 'installation') throw new MarketPluginError('provided', `${id} is supplied by this application`)
    if (bundle?.installed !== true) return
    this.requireSuccess(await this.ctx.pluginManager.removeBundle(id), id)
    this.restarts.delete(id)
  }

  private compatibility(name: string, version: MarketVersion): { compatible: boolean; reason?: string } {
    if (version.source.type !== 'tarball') return { compatible: false, reason: 'This market requires a published plugin tarball' }
    const issue = evaluatePluginCompatibility({ name, version: version.version,
      ...version.engines.dsh === undefined ? {} : { engines: { dsh: version.engines.dsh } },
    }, this.exemptions, getDshRuntimeVersion())
    if (issue === undefined || issue.exempted) return { compatible: true }
    const requirements = Object.entries(issue.requirements).map(([name, range]) => `${name} ${range}`).join(', ')
    return { compatible: false, reason: `${name}@${version.version} requires ${requirements}` }
  }

  private requireSuccess(result: ChangeResult, target: string): void {
    if (result.application === 'cancelled') throw new DOMException(`Installation cancelled: ${target}`, 'AbortError')
    if (result.error !== undefined || result.application === 'failed') {
      const detail = result.error?.diagnostic ?? result.packageResult?.output ?? result.error?.code ?? 'operation failed'
      throw new MarketPluginError('operation', `${target}: ${detail}; inspect Plugins for the current installed state`)
    }
  }

  private async installFile(file: string, enabled: boolean, signal: AbortSignal): Promise<ChangeResult> {
    signal.throwIfAborted()
    const requestId = brandString<PluginInstallRequestId>(randomUUID())
    const operation = this.ctx.pluginManager.installBundle(file, { enabled, saveExact: true, requestId })
    let cancellation: Promise<void> | undefined
    let cancellationError: unknown
    const cancel = (): void => {
      cancellation ??= this.ctx.pluginManager.cancelInstall(requestId).then(
        () => undefined, (error: unknown) => { cancellationError = error },
      )
    }
    signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) cancel()
    try {
      return await operation
    } finally {
      signal.removeEventListener('abort', cancel)
      await cancellation
      if (cancellationError !== undefined) {
        throw new MarketPluginError('operation', 'Could not confirm plugin installation cancellation; inspect Plugins before retrying', { cause: cancellationError })
      }
    }
  }

  private async releaseUnreferenced(file: string): Promise<void> {
    const raw: unknown = JSON.parse(await readFile(join(this.ctx.profileContext.dir, 'package.json'), 'utf8'))
    const manifest = dependencyManifest.parse(raw)
    const referenced = [manifest.dependencies, manifest.devDependencies, manifest.optionalDependencies]
      .some(dependencies => Object.values(dependencies ?? {}).some((spec) => {
        if (!spec.startsWith('file:') && !spec.startsWith('link:')) return false
        const local = spec.replace(/^(?:file|link):/, '').replace(/^~(?=$|[\\/])/, homedir())
        return relative(file, resolve(this.ctx.profileContext.dir, local)) === ''
      }))
    if (referenced) return
    try { await unlink(file) } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
      throw new MarketPluginError('operation', `Could not delete unused market package ${file}; fix filesystem access and remove it`, { cause: error })
    }
  }
}

const dependencyManifest = zod.object({
  dependencies: zod.record(zod.string(), zod.string()).optional(),
  devDependencies: zod.record(zod.string(), zod.string()).optional(),
  optionalDependencies: zod.record(zod.string(), zod.string()).optional(),
})

/**
 * Register profile plugins as a managed market kind and publish manager changes through the shared market stream.
 * @param ctx - shared market, plugin manager, and current profile context.
 * @param config - manifest validation limit.
 * @returns after the initial authoritative plugin inventory has been read.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const kind = new PluginKind(ctx, config)
  const pending = new Set<Promise<void>>()
  const registration: { unregister?: () => void; detach?: () => void } = {}
  ctx.effect(() => async () => {
    registration.detach?.()
    await kind.dispose()
    await Promise.allSettled([...pending])
    registration.unregister?.()
  }, 'market-plugins: lifecycle')
  await kind.refresh()
  if (!kind.active) return
  registration.unregister = ctx.market.registerKind(kind)
  registration.detach = ctx.on('plugin-manager/changed', () => {
    const operation = ctx.market.invalidateKind('plugin').catch((error: unknown) => {
      ctx.logger.warn('market-plugins: installed state could not be refreshed', error)
    }).finally(() => { pending.delete(operation) })
    pending.add(operation)
  })
}
