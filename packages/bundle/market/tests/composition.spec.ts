/** The market bundle's actual patch composed through a profile Loader with one HTTP catalog. */
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { boot, initProfile, loadOverlayPatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import Market from '@deepseek-ai/dsh-market'
import MarketSkills from '@deepseek-ai/dsh-market-skills'
import MarketConnectors from '@deepseek-ai/dsh-market-connectors'
import * as MarketPlugins from '@deepseek-ai/dsh-market-plugins'
import PluginManager from '@deepseek-ai/dsh-plugin-manager'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { strToU8, zipSync } from 'fflate'
import { expect, it } from 'vitest'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'

it('composes one catalog reader and registers skills, connectors and profile plugins', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-unified-market-composition-'))
  const skill = 'market-probe'
  const zip = zipSync({ [`${skill}/SKILL.md`]: strToU8(`---\nname: ${skill}\ndescription: Market probe\n---\nInstalled from the shared catalog.\n`) })
  let reads = 0
  const publisher = createServer((request, response) => {
    if (request.url === '/skill.zip') {
      response.writeHead(200, { 'content-length': zip.byteLength }).end(zip)
      return
    }
    if (request.url !== '/index.json') { response.writeHead(404).end(); return }
    reads += 1
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({
      schemaVersion: 1, generatedAt: '',
      items: [{ kind: 'skill', id: skill, version: '1.0.0', name: { zh: '市场探针' }, description: { zh: '共享目录技能' },
        package: { path: 'skill.zip', sha256: createHash('sha256').update(zip).digest('hex'), size: zip.byteLength } }],
      format: 2, title: 'Unified market', plugins: [{
        name: 'market-plugin-probe', title: 'Plugin probe', description: 'Shared catalog plugin',
        versions: [{ version: '1.0.0', publishTimestamp: 1, engines: {},
          source: { type: 'tarball', path: 'plugin.tgz', sha256: '0'.repeat(64), size: 1 } }],
      }],
    }))
  })
  let ctx: Context | undefined
  try {
    await new Promise<void>((resolve, reject) => {
      publisher.once('error', reject)
      publisher.listen(0, '127.0.0.1', resolve)
    })
    const address = publisher.address()
    if (address === null || typeof address === 'string') throw new Error('Expected a TCP publisher')
    const catalogUrl = `http://127.0.0.1:${String(address.port)}/index.json`
    const dir = join(home, 'profiles', 'test')
    initProfile(dir, [])
    await writeFile(join(home, 'package.json'), '{"name":"test-installation","dependencies":{}}\n')
    await writeFile(join(dir, 'cordis.yml'), '[]\n')
    const profile: ProfileContext = {
      name: 'test', dir, patchPath: join(dir, 'cordis.patch.yml'), installAnchor: join(home, 'package.json'),
      cwd: home, home, startedBundles: [], overlays: [], telemetryDisabledEnv: undefined,
    }
    const modules = {
      '@deepseek-ai/dsh-market': Market,
      '@deepseek-ai/dsh-market-skills': MarketSkills,
      '@deepseek-ai/dsh-market-connectors': MarketConnectors,
      '@deepseek-ai/dsh-market-plugins': MarketPlugins,
    }
    const patches = loadOverlayPatches('market-test', fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)))
    // The browser contribution has its own Client composition tests; this Host fixture mounts the actual Host rows.
    expect(patches.flatMap(patch => patch.insert ?? []).filter(row => row.id === 'ui-market'))
      .toMatchObject([{ name: '@deepseek-ai/dsh-client-ui-market' }])
    for (const patch of patches) {
      if (patch.insert !== undefined) patch.insert = patch.insert.filter(row => row.id !== 'ui-market')
      for (const row of patch.insert ?? []) {
        if (!(row.name in modules)) throw new Error(`Unexpected market module: ${row.name}`)
        row.name = `cordis:${row.name}`
      }
    }
    patches.push({ id: 'market', config: { catalogUrl, home: join(home, 'market') } })
    ctx = await boot('market-test', join(dir, 'cordis.yml'), patches, async (root) => {
      root.provide('profileContext', profile)
      root.provide('workingDirectory', { defaultDirectory: home })
      root.provide('typert', {})
      await root.plugin(Storage)
      root.storage.backend.register('memory', new MemoryStorageBackend())
      const domain = new DomainFacility(root, { backend: 'memory', routes: {} })
      root.storage.mount('domain', domain)
      root.provide('storageDomain', domain)
      await root.plugin(MemoryCredentials)
      await root.plugin(SystemPrompt)
      await root.plugin(ToolRuntime)
      await root.plugin(SkillRegistry, { disabled: [] })
      await root.plugin(PluginManager)
      Object.assign(root.loader.builtins, modules)
    })
    await ctx.market.refreshCatalog()
    const catalog = ctx.market.catalogSnapshot()
    expect(catalog.kinds).toEqual(expect.arrayContaining(['skill', 'connector', 'plugin']))
    expect(ctx.get('pluginMarket')).toBeUndefined()
    expect(catalog.items.map(item => ({ kind: item.kind, id: item.id, version: item.version }))).toMatchInlineSnapshot(`
      [
        {
          "id": "market-probe",
          "kind": "skill",
          "version": "1.0.0",
        },
        {
          "id": "market-plugin-probe",
          "kind": "plugin",
          "version": "1.0.0",
        },
      ]
    `)
    const readsBeforeInstall = reads
    await ctx.market.installItem({ kind: 'skill', id: skill })
    expect(reads).toBeGreaterThan(readsBeforeInstall)
    expect((await ctx.skills.get(skill))?.content).toBe('Installed from the shared catalog.')
    const installedFile = join(home, 'market', 'packages', 'skill', skill, 'SKILL.md')
    expect(await readFile(installedFile, 'utf8')).toContain('Market probe')
    await ctx.market.uninstallPackage({ kind: 'skill', id: skill })
    expect(await ctx.skills.get(skill)).toBeUndefined()
    await expect(readFile(installedFile)).rejects.toMatchObject({ code: 'ENOENT' })
    const adapter = [...ctx.loader.entries()].find(entry => entry.options.id === 'market-plugins')
    expect(adapter?.fiber).toBeDefined()
    await adapter?.fiber?.dispose()
    expect(ctx.market.catalogSnapshot().kinds).not.toContain('plugin')
  } finally {
    try { await ctx?.fiber.dispose() } finally {
      try {
        if (publisher.listening) await new Promise<void>((resolve, reject) => {
          publisher.close((error) => { if (error === undefined) resolve(); else reject(error) })
          publisher.closeAllConnections()
        })
      } finally { await rm(home, { recursive: true, force: true }) }
    }
  }
})
