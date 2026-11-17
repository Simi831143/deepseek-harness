/** Managed plugin state, cleanup, cancellation, and registration lifetime. */
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import type { ProfileContext } from '@deepseek-ai/dsh-app-boot'
import type { MarketManagedKind } from '@deepseek-ai/dsh-market'
import type { MarketCatalogItem } from '@deepseek-ai/dsh-market/types'
import type { BundleInfo, ChangeResult, InstallBundleOptions, PluginInstallRequestId } from '@deepseek-ai/dsh-plugin-manager/types'
import { parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index'
import { create as createTarball } from 'tar'
import { expect, it, onTestFinished, vi } from 'vitest'
import * as MarketPlugins from '../src/index.ts'

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'dsh-market-plugin-provider-'))
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }) })
  const profile: ProfileContext = {
    name: 'test', dir: home, home, cwd: home, patchPath: join(home, 'cordis.patch.yml'), installAnchor: join(home, 'anchor.json'),
    startedBundles: [], overlays: [], telemetryDisabledEnv: undefined,
  }
  await writeFile(join(home, 'package.json'), '{}')
  ctx.provide('profileContext', profile)
  let kind: MarketManagedKind | undefined
  let bundles: BundleInfo[] = []
  const disposed = vi.fn()
  const refresh = vi.fn(() => Promise.resolve())
  class Market extends Service {
    constructor(scope: Context) { super(scope, 'market') }
    registerKind(candidate: MarketManagedKind) { kind = candidate; return disposed }
    invalidateKind() { return refresh() }
  }
  const list = vi.fn(() => Promise.resolve(bundles))
  const exemptions = vi.fn(() => ({ exemptions: {}, warnings: [] }))
  const install = vi.fn((file: string, _options?: InstallBundleOptions): Promise<ChangeResult> => Promise.resolve({
    changed: false, application: 'failed', stage: 'install', target: file, error: { code: 'operation-error', diagnostic: 'pnpm refused' },
  }))
  const remove = vi.fn((name: string): Promise<ChangeResult> => Promise.resolve({ changed: true, application: 'applied', stage: 'remove', target: name }))
  const cancel = vi.fn((_id: PluginInstallRequestId) => Promise.resolve({ status: 'cancelled' as const }))
  class Manager extends Service {
    constructor(scope: Context) { super(scope, 'pluginManager') }
    listBundles() { return list() }
    listVersionExemptions() { return exemptions() }
    installBundle(file: string, options?: InstallBundleOptions) { return install(file, options) }
    removeBundle(name: string) { return remove(name) }
    cancelInstall(id: PluginInstallRequestId) { return cancel(id) }
  }
  await ctx.plugin(Market)
  await ctx.plugin(Manager)
  const fiber = await ctx.plugin(MarketPlugins)
  if (kind === undefined) throw new Error('Expected managed plugin registration')
  const source = join(home, 'source', 'package')
  await mkdir(source, { recursive: true })
  await writeFile(join(source, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } } }))
  await writeFile(join(source, 'cordis.patch.yml'), '[]\n')
  const file = join(home, 'package.tgz')
  await createTarball({ file, gzip: true, cwd: join(home, 'source') }, ['package'])
  const data = await readFile(file)
  const plugin = parseMarketIndex({ format: 2, title: 'Market', plugins: [{ name: 'demo', versions: [{ version: '1.0.0', publishTimestamp: 1,
    source: { type: 'tarball', path: 'demo.tgz', sha256: '0'.repeat(64), size: data.byteLength },
  }] }] }, 'https://market.example/index.json').plugins[0]!
  const item: MarketCatalogItem = { kind: 'plugin', id: 'demo', version: '1.0.0', name: { zh: 'Demo' }, description: { zh: 'Demo' }, plugin }
  return { ctx, home, fiber, kind, data, item, list, exemptions, install, remove, cancel, refresh, disposed,
    setBundles: (next: BundleInfo[]) => { bundles = next },
    tarballs: () => readdir(join(home, '.plugin-market', 'tarballs')),
  }
}

function bundle(availability: BundleInfo['availability'] = 'profile'): BundleInfo {
  return { name: 'demo', version: '0.9.0', official: false, availability, enabled: false, installed: availability !== 'installation',
    optional: false, removable: availability !== 'installation', updatable: false, rows: [], overrides: [] }
}

it('reads installation state from Plugin Manager and refuses application-provided packages', async () => {
  const f = await fixture()
  f.setBundles([bundle('installation')])
  await f.kind.refresh()
  expect(f.kind.view(f.item)).toMatchObject({ installed: true, provided: true, installedVersion: '0.9.0' })
  await expect(f.kind.install(f.item, f.data, new AbortController().signal)).rejects.toMatchObject({ code: 'provided' })
  await expect(f.kind.uninstall('demo', new AbortController().signal)).rejects.toMatchObject({ code: 'provided' })
  expect(f.install).not.toHaveBeenCalled()
  expect(f.remove).not.toHaveBeenCalled()
})

it('removes an unreferenced download when installation fails', async () => {
  const f = await fixture()
  await expect(f.kind.install(f.item, f.data, new AbortController().signal)).rejects.toThrow('pnpm refused')
  expect(await f.tarballs()).toEqual([])
})

it('retains a download still referenced after an activation failure', async () => {
  const f = await fixture()
  f.install.mockImplementation(async (file) => {
    await writeFile(join(f.home, 'package.json'), JSON.stringify({ optionalDependencies: { demo: `file:${file}` } }))
    return { changed: true, application: 'failed', stage: 'enable', target: 'demo', error: { code: 'operation-error', diagnostic: 'activation failed' } }
  })
  await expect(f.kind.install(f.item, f.data, new AbortController().signal)).rejects.toThrow('activation failed')
  expect(await f.tarballs()).toHaveLength(1)
})

it('stops before replacing an installed version when removal fails', async () => {
  const f = await fixture()
  f.setBundles([bundle()])
  f.remove.mockResolvedValue({ changed: false, application: 'failed', stage: 'remove', target: 'demo', error: { code: 'stop-profile' } })
  await expect(f.kind.install(f.item, f.data, new AbortController().signal)).rejects.toThrow('stop-profile')
  expect(f.install).not.toHaveBeenCalled()
  expect(await f.tarballs()).toEqual([])
})

it('cancels the owned pnpm operation and waits for its settled cleanup', async () => {
  const f = await fixture()
  const entered = Promise.withResolvers<undefined>()
  const completed = Promise.withResolvers<ChangeResult>()
  const releaseCancel = Promise.withResolvers<undefined>()
  const signal = new AbortController()
  f.install.mockImplementation(() => { entered.resolve(undefined); return completed.promise })
  f.cancel.mockImplementation(async () => {
    completed.resolve({ changed: false, application: 'cancelled', stage: 'install', target: 'demo' })
    await releaseCancel.promise
    return { status: 'cancelled' }
  })
  const installing = f.kind.install(f.item, f.data, signal.signal)
  const observed = expect(installing).rejects.toMatchObject({ name: 'AbortError' })
  onTestFinished(async () => {
    releaseCancel.resolve(undefined)
    completed.resolve({ changed: false, application: 'cancelled', stage: 'install', target: 'demo' })
    await observed
  })
  await entered.promise
  signal.abort()
  await vi.waitFor(() => { expect(f.cancel).toHaveBeenCalledWith(f.install.mock.calls[0]?.[1]?.requestId) })
  expect(await f.tarballs()).toHaveLength(1)
  releaseCancel.resolve(undefined)
  await observed
  expect(await f.tarballs()).toEqual([])
})

it('withdraws its kind and waits for refreshes already accepted before disposal', async () => {
  const f = await fixture()
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  f.refresh.mockImplementation(async () => { entered.resolve(undefined); await release.promise })
  f.ctx.emit('plugin-manager/changed', { reason: 'install' })
  await entered.promise
  let disposed = false
  const disposing = f.fiber.dispose().then(() => { disposed = true })
  onTestFinished(async () => { release.resolve(undefined); await disposing })
  await Promise.resolve()
  expect(disposed).toBe(false)
  release.resolve(undefined)
  await disposing
  expect(f.disposed).toHaveBeenCalledOnce()
  f.ctx.emit('plugin-manager/changed', { reason: 'remove' })
  expect(f.refresh).toHaveBeenCalledOnce()
})

it('cancels an active install and keeps the provider registered until its cleanup settles', async () => {
  const f = await fixture()
  const entered = Promise.withResolvers<undefined>()
  const completed = Promise.withResolvers<ChangeResult>()
  const cancelling = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  f.install.mockImplementation(() => { entered.resolve(undefined); return completed.promise })
  f.cancel.mockImplementation(async () => {
    cancelling.resolve(undefined)
    await release.promise
    completed.resolve({ changed: false, application: 'cancelled', stage: 'install', target: 'demo' })
    return { status: 'cancelled' }
  })
  const installing = f.kind.install(f.item, f.data, new AbortController().signal)
  const observed = expect(installing).rejects.toMatchObject({ name: 'AbortError' })
  onTestFinished(async () => { release.resolve(undefined); await observed })
  await entered.promise
  const disposing = f.fiber.dispose()
  onTestFinished(async () => { release.resolve(undefined); await disposing })
  await cancelling.promise
  expect(f.disposed).not.toHaveBeenCalled()
  expect(await f.tarballs()).toHaveLength(1)
  release.resolve(undefined)
  await observed
  await disposing
  expect(f.disposed).toHaveBeenCalledOnce()
  expect(await f.tarballs()).toEqual([])
  const calls = f.list.mock.calls.length
  await f.kind.refresh()
  await expect(f.kind.install(f.item, f.data, new AbortController().signal)).rejects.toMatchObject({ name: 'AbortError' })
  await expect(f.kind.uninstall('demo', new AbortController().signal)).rejects.toMatchObject({ name: 'AbortError' })
  expect(f.list).toHaveBeenCalledTimes(calls)
  expect(f.install).toHaveBeenCalledOnce()
  expect(f.remove).not.toHaveBeenCalled()
})

it('waits for a committed uninstall before withdrawing the provider', async () => {
  const f = await fixture()
  f.setBundles([bundle()])
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  f.remove.mockImplementation(async () => {
    entered.resolve(undefined)
    await release.promise
    f.setBundles([])
    return { changed: true, application: 'applied', stage: 'remove', target: 'demo' }
  })
  const removing = f.kind.uninstall('demo', new AbortController().signal)
  onTestFinished(async () => { release.resolve(undefined); await removing })
  await entered.promise
  const disposing = f.fiber.dispose()
  onTestFinished(async () => { release.resolve(undefined); await disposing })
  await Promise.resolve()
  expect(f.disposed).not.toHaveBeenCalled()
  release.resolve(undefined)
  await removing
  await disposing
  expect(f.disposed).toHaveBeenCalledOnce()
  expect(f.remove).toHaveBeenCalledOnce()
  expect(f.install).not.toHaveBeenCalled()
})

it('stops a suspended inventory read before later manager calls when the provider unloads', async () => {
  const f = await fixture()
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<BundleInfo[]>()
  f.list.mockImplementation(() => { entered.resolve(undefined); return release.promise })
  const reading = f.kind.refresh()
  onTestFinished(async () => { release.resolve([]); await reading })
  await entered.promise
  const before = f.exemptions.mock.calls.length
  const disposing = f.fiber.dispose()
  onTestFinished(async () => { release.resolve([]); await disposing })
  await Promise.resolve()
  expect(f.disposed).not.toHaveBeenCalled()
  release.resolve([])
  await reading
  await disposing
  expect(f.exemptions).toHaveBeenCalledTimes(before)
  expect(f.disposed).toHaveBeenCalledOnce()
})
