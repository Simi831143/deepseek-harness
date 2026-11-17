/** Profile plugin installs through the shared market, real Loader, and bundled pnpm. */
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { boot, initProfile, readProfileManifest, readProfilePatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import PluginManager from '@deepseek-ai/dsh-plugin-manager'
import Storage, { storageBackendServiceKey } from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import { create as createTarball } from 'tar'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import Market from '../../market/src/index.ts'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import * as MarketPlugins from '../src/index.ts'
import { validateTarballManifest } from '../src/manifest.ts'

async function archive(home: string, version = '1.0.0', options: { name?: string; bundle?: boolean; extraManifest?: boolean } = {}): Promise<Buffer> {
  const root = join(home, `source-${version}-${Math.random()}`)
  const directory = join(root, 'package')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'package.json'), JSON.stringify({
    name: options.name ?? '@test/market-plugin', version,
    ...options.bundle === false ? {} : { dsh: { bundle: { patch: './cordis.patch.yml' } } },
  }))
  await writeFile(join(directory, 'cordis.patch.yml'), '[]\n')
  if (options.extraManifest === true) {
    await mkdir(join(root, 'second'))
    await writeFile(join(root, 'second', 'package.json'), '{}')
  }
  const file = join(root, 'plugin.tgz')
  await createTarball({ file, gzip: true, cwd: root }, options.extraManifest === true ? ['package', 'second'] : ['package'])
  return readFile(file)
}

async function temporary(): Promise<string> {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'dsh-market-plugins-')))
  onTestFinished(() => rm(home, { recursive: true, force: true }))
  return home
}

it.each([
  { label: 'different package name', name: 'wrong-plugin' },
  { label: 'different version', version: '2.0.0' },
  { label: 'missing bundle declaration', bundle: false },
  { label: 'multiple package manifests', extraManifest: true },
])('refuses $label before pnpm can change a profile', async (options) => {
  const data = await archive(await temporary(), options.version ?? '1.0.0', options)
  await expect(validateTarballManifest(data, '@test/market-plugin', '1.0.0', 1_048_576)).rejects.toThrow()
})

it('bounds the uncompressed manifest and refuses malformed archives', async () => {
  const data = await archive(await temporary())
  await expect(validateTarballManifest(data, '@test/market-plugin', '1.0.0', 1)).rejects.toThrow()
  await expect(validateTarballManifest(Buffer.from('invalid'), '@test/market-plugin', '1.0.0', 1024)).rejects.toThrow()
})

// Real pnpm subprocesses use the repository's integration budget under shared-host contention.
describe('profile plugin package lifecycle', { timeout: 120_000 }, () => {
  it('installs, updates a disabled plugin, and uninstalls its archive through one market service', async () => {
    const home = await temporary()
    const versions = new Map<string, Buffer>([
      ['1.0.0', await archive(home, '1.0.0')], ['2.0.0', await archive(home, '2.0.0')],
    ])
    let published = ['1.0.0']
    let reachable = true
    const requests: string[] = []
    const publisher = createServer((request, response) => {
      const path = request.url ?? ''
      requests.push(path)
      if (!reachable) { response.writeHead(503).end(); return }
      if (path === '/index.json') {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ schemaVersion: 1, generatedAt: '2026-11-17', items: [], format: 2, title: 'Test market',
          plugins: published.length === 0 ? [] : [{ name: '@test/market-plugin', title: 'Demo plugin',
            versions: published.map(version => ({ version, publishTimestamp: 1, source: { type: 'tarball',
              path: `${version}.tgz`, size: versions.get(version)!.byteLength,
              sha256: createHash('sha256').update(versions.get(version)!).digest('hex'),
            } })),
          }],
        }))
        return
      }
      const data = versions.get(path.slice(1).replace(/\.tgz$/, ''))
      if (data === undefined) { response.writeHead(404).end(); return }
      response.setHeader('content-length', String(data.byteLength))
      response.end(data)
    })
    onTestFinished(async () => {
      if (publisher.listening) await new Promise<void>((resolve, reject) => {
        publisher.close((error) => { if (error === undefined) resolve(); else reject(error) })
        publisher.closeAllConnections()
      })
    })
    await new Promise<void>((resolve, reject) => {
      publisher.once('error', reject)
      publisher.listen(0, '127.0.0.1', resolve)
    })
    const address = publisher.address()
    if (address === null || typeof address === 'string') throw new Error('Expected a TCP publisher')
    const url = `http://127.0.0.1:${String(address.port)}/index.json`
    const dir = join(home, 'profiles', 'test')
    const anchor = join(home, 'package.json')
    initProfile(dir, [])
    await writeFile(anchor, '{"name":"test-installation","dependencies":{}}\n')
    const pnpm = fileURLToPath(new URL('../../../../apps/desktop/node_modules/pnpm/bin/pnpm.mjs', import.meta.url))
    const profile: ProfileContext = {
      name: 'test', startedBundles: [], dir, patchPath: join(dir, 'cordis.patch.yml'), installAnchor: anchor,
      cwd: home, home, overlays: [], telemetryDisabledEnv: undefined,
      packageManager: { command: process.execPath, args: ['--expose-internals', pnpm], env: { PATH: '', ELECTRON_RUN_AS_NODE: '1' } },
    }
    await writeFile(join(dir, 'cordis.yml'), JSON.stringify([
      { id: 'storage', name: 'cordis:storage' },
      { id: 'memory', name: 'cordis:memory' },
      { id: 'domains', name: 'cordis:domains', config: { backend: 'memory' } },
      { id: 'manager', name: 'cordis:manager' },
      { id: 'market', name: 'cordis:market', config: { catalogUrl: url, home: join(home, 'market') } },
      { id: 'plugins', name: 'cordis:plugins' },
    ]))
    const memory = {
      inject: ['storage'], apply(ctx: Context) {
        ctx.effect(() => ctx.storage.backend.register('memory', new MemoryStorageBackend()), 'test memory backend')
        ctx.provide(storageBackendServiceKey('memory'), true)
      },
    }
    const ctx = await boot('test', join(dir, 'cordis.yml'), readProfilePatches('test', profile), (root) => {
      root.provide('profileContext', profile)
      root.provide('typert', {})
      root.provide('appReady', { onReady: (listener: () => void) => { listener(); return () => {} } })
      Object.assign(root.loader.builtins, { storage: Storage, memory, domains: StorageDomain,
        manager: PluginManager, market: Market, plugins: MarketPlugins })
    })
    onTestFinished(() => ctx.fiber.dispose(), 60_000)
    const market = ctx.market
    await vi.waitFor(() => { expect(market.catalogSnapshot().kinds).toContain('plugin') })
    await market.refreshCatalog()
    const ref = { kind: 'plugin' as const, id: '@test/market-plugin' }
    const installed = await market.installPackage(ref, new AbortController().signal)
    expect(installed.items[0]).toMatchObject({ installedVersion: '1.0.0', managed: { installed: true, restartRequired: true } })
    const oldSpec = readProfileManifest('test', dir).dependencies?.[ref.id]
    expect(oldSpec).toMatch(/\.tgz$/)
    const tarballs = join(dir, '.plugin-market', 'tarballs')
    expect(await readdir(tarballs)).toHaveLength(1)
    expect(await ctx.pluginManager.setBundleEnabled(ref.id, false)).toMatchObject({ application: 'restart-required' })
    published = ['2.0.0', '1.0.0']
    const updated = await market.installPackage(ref, new AbortController().signal)
    expect(updated.items[0]).toMatchObject({ installedVersion: '2.0.0', managed: { installed: true, enabled: false } })
    const newSpec = readProfileManifest('test', dir).dependencies?.[ref.id]
    expect(newSpec).not.toBe(oldSpec)
    expect(await readdir(tarballs)).toHaveLength(1)
    expect(readProfileManifest('test', dir).dsh?.profile?.bundles).not.toContain(ref.id)
    await market.uninstallPackage(ref)
    expect(await readdir(tarballs)).toEqual([])
    expect(readProfileManifest('test', dir).dependencies ?? {}).not.toHaveProperty(ref.id)
    const stale = market.catalogSnapshot().items.map(item => item.id)
    const count = requests.filter(path => path.endsWith('.tgz')).length
    reachable = false
    await expect(market.installPackage(ref, new AbortController().signal)).rejects.toMatchObject({ code: 'market/catalog-unavailable' })
    reachable = true
    published = []
    await expect(market.installPackage(ref, new AbortController().signal)).rejects.toMatchObject({ code: 'market/not-found' })
    expect(requests.filter(path => path.endsWith('.tgz'))).toHaveLength(count)
    expect({ installed: installed.items[0]?.installedVersion, updated: updated.items[0]?.installedVersion,
      enabledAfterUpdate: updated.items[0]?.managed?.enabled, remainingArchives: await readdir(tarballs), stale,
      downloads: count,
    }).toMatchInlineSnapshot(`
    {
      "downloads": 2,
      "enabledAfterUpdate": false,
      "installed": "1.0.0",
      "remainingArchives": [],
      "stale": [
        "@test/market-plugin",
      ],
      "updated": "2.0.0",
    }
  `)
  })
})
