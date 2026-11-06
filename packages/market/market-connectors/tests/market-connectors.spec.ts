/**
 * Connector kind: the launch manifest rules, and installed connectors running as real stdio
 * programs whose tools appear and disappear with the connector switch. Connector packages
 * are Windows programs, so the process tests start their program through a `.cmd` file
 * inside the package and run on Windows only.
 */
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import Market from '@deepseek-ai/dsh-market'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { strToU8, zipSync } from 'fflate'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import MarketConnectors, { ConnectorSettingsError, LaunchManifestError, parseConnectorSettings, parseLaunchManifest } from '../src/index.ts'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step()
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-market-connectors-'))
  cleanup.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

describe('parseLaunchManifest', () => {
  const dir = join(tmpdir(), 'connector')

  it('resolves the command inside the package and expands ${dir}', () => {
    const spec = parseLaunchManifest(dir, JSON.stringify({
      command: 'python/python.exe', args: ['-I', '-B', '${dir}/server.py'], env: { HOME_DIR: '${dir}' }, toolCallTimeoutMs: 120000,
    }))
    expect(spec).toEqual({
      command: join(dir, 'python', 'python.exe'), commandPath: 'python/python.exe',
      args: ['-I', '-B', `${dir}/server.py`], env: { HOME_DIR: dir }, cwd: dir, toolCallTimeoutMs: 120000,
    })
  })

  it.each([
    ['not JSON', '{'],
    ['no command', JSON.stringify({ args: [] })],
    ['an unknown field', JSON.stringify({ command: 'a.exe', shell: true })],
    ['an absolute command', JSON.stringify({ command: 'C:\\Windows\\System32\\cmd.exe' })],
    ['a POSIX absolute command', JSON.stringify({ command: '/bin/sh' })],
    ['a command leaving the package', JSON.stringify({ command: '../other/a.exe' })],
    ['the package directory as command', JSON.stringify({ command: '.' })],
    ['an unknown placeholder', JSON.stringify({ command: 'a.exe', args: ['${home}'] })],
    ['an env name outside the grammar', JSON.stringify({ command: 'a.exe', env: { 'A-B': '1' } })],
    ['Python without -I', JSON.stringify({ command: 'python/python.exe', args: ['server.py'] })],
  ])('refuses %s', (_label, text) => {
    expect(() => parseLaunchManifest(dir, text)).toThrow(LaunchManifestError)
  })
})

describe('parseConnectorSettings', () => {
  const key = { env: 'LAB_API_KEY', label: { zh: '密钥', en: 'Key' } }

  it('fills the defaults and keeps file order', () => {
    expect(parseConnectorSettings(JSON.stringify({ settings: [key, { env: 'LAB_REGION', label: { zh: '区域' }, secret: false, required: true, url: 'https://lab.example/keys' }] })))
      .toEqual([
        { env: 'LAB_API_KEY', label: { zh: '密钥', en: 'Key' }, secret: true, required: false },
        { env: 'LAB_REGION', label: { zh: '区域' }, secret: false, required: true, url: 'https://lab.example/keys' },
      ])
  })

  it.each([
    ['not JSON', '{'],
    ['no settings', JSON.stringify({ settings: [] })],
    ['an unknown field', JSON.stringify({ settings: [{ ...key, default: 'x' }] })],
    ['an env name outside the grammar', JSON.stringify({ settings: [{ ...key, env: 'LAB-KEY' }] })],
    ['a non-http url', JSON.stringify({ settings: [{ ...key, url: 'file:///etc/passwd' }] })],
    ['a duplicate env name', JSON.stringify({ settings: [key, key] })],
  ])('refuses %s', (_label, text) => {
    expect(() => parseConnectorSettings(text)).toThrow(ConnectorSettingsError)
  })

  it('refuses a setting that would take over a variable mcp.json sets', () => {
    expect(() => parseConnectorSettings(JSON.stringify({ settings: [key] }), ['LAB_API_KEY'])).toThrow(/already sets/)
  })
})

const FIXTURE_SERVER = fileURLToPath(new URL('./fixtures/echo-server.mjs', import.meta.url))

interface Catalog {
  readonly url: string
  /** Publish one connector package version and list it as the catalog's only item. */
  publish(version: string, files?: Record<string, string>): Promise<void>
}

async function serveCatalog(id: string, log: string): Promise<Catalog> {
  const files = new Map<string, Uint8Array>()
  const server = createServer((req, res) => {
    const body = files.get(new URL(req.url ?? '/', 'http://localhost').pathname)
    if (body === undefined) { res.writeHead(404).end(); return }
    res.writeHead(200, { 'content-length': body.byteLength }).end(Buffer.from(body))
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  cleanup.push(() => new Promise<void>((resolve) => { server.close(() => { resolve() }) }))
  const serverScript = await readFile(FIXTURE_SERVER, 'utf8')
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/market/index.json`,
    async publish(version, overrides = {}) {
      const entries: Record<string, string> = {
        'mcp.json': JSON.stringify({ command: 'server.cmd', env: { FIXTURE_LOG: log, FIXTURE_VERSION: version } }),
        'server.cmd': `@"${process.execPath}" "%~dp0server.mjs"\r\n`,
        'server.mjs': serverScript,
        'SKILL.md': `---\nname: ${id}\ndescription: How to use the echo connector\n---\nCall the echo tool.\n`,
        ...overrides,
      }
      const zip = zipSync(Object.fromEntries(Object.entries(entries).map(([name, text]) => [`${id}/${name}`, strToU8(text)])))
      const path = `packages/connector/${id}-${version}.zip`
      files.set(`/market/${path}`, zip)
      files.set('/market/index.json', strToU8(JSON.stringify({
        schemaVersion: 1, generatedAt: '', items: [{
          kind: 'connector', id, version, name: { zh: id }, description: { zh: id },
          package: { path, sha256: createHash('sha256').update(zip).digest('hex'), size: zip.byteLength },
        }],
      })))
    },
  }
}

async function mount(catalogUrl: string) {
  const home = await tempDir()
  const ctx = new Context()
  cleanup.push(() => ctx.fiber.dispose())
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend())
  const storageDomain = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', storageDomain)
  ctx.provide('storageDomain', storageDomain)
  ctx.provide('typert', {})
  await ctx.plugin(MemoryCredentials)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  // Prompt assembly includes the tools, which needs an executor.
  await ctx.plugin(NativeToolExecutor)
  await ctx.plugin(SkillRegistry, { disabled: [] })
  await ctx.plugin(Market, { catalogUrl, home: join(home, 'market') })
  await vi.waitFor(() => { expect(ctx.market.catalogSnapshot().source).toBe('remote') })
  await ctx.plugin(MarketConnectors)
  return ctx
}

async function lines(log: string): Promise<string[]> {
  return (await readFile(log, 'utf8').catch(() => '')).split('\n').filter(Boolean).map(line => line.replace(/ \d+$/, ''))
}

/**
 * Process starts and exits in the log. mcp-client may start a legacy server twice for one
 * connection (a probe, then the session), so tests compare counts instead of exact lines.
 */
async function processes(log: string): Promise<{ readonly starts: readonly string[]; readonly running: number }> {
  const events = await lines(log)
  const starts = events.filter(line => line.startsWith('start'))
  return { starts, running: starts.length - events.filter(line => line === 'exit').length }
}

/** The rendered system prompt, where the connector settings section appears. */
async function prompt(ctx: Context): Promise<string> {
  return renderPrompt(await ctx.systemPrompt.assemble())
}

const TOOL = 'mcp__echo-lab__echo'
const WAIT = { timeout: 20_000 }

describe.runIf(process.platform === 'win32')('MarketConnectors', () => {
  async function connected() {
    const log = join(await tempDir(), 'events.log')
    const catalog = await serveCatalog('echo-lab', log)
    await catalog.publish('1.0.0')
    const ctx = await mount(catalog.url)
    await ctx.market.installItem({ kind: 'connector', id: 'echo-lab' })
    await ctx.marketConnectors.setConnectorEnabled({ id: 'echo-lab', enabled: true, confirmed: true })
    // Matching the whole view shows the start error when the program fails.
    await vi.waitFor(() => { expect(ctx.marketConnectors.connectorList().connectors[0]).toEqual(expect.objectContaining({ state: 'connected' })) }, WAIT)
    return { ctx, log, catalog }
  }

  it('asks for acceptance once, then runs the program and serves its tools and skill while connected', async () => {
    const log = join(await tempDir(), 'events.log')
    const catalog = await serveCatalog('echo-lab', log)
    await catalog.publish('1.0.0')
    const ctx = await mount(catalog.url)
    await expect(ctx.marketConnectors.setConnectorEnabled({ id: 'echo-lab', enabled: true, confirmed: true }))
      .rejects.toMatchObject({ code: 'market-connectors/not-installed' })
    await ctx.market.installItem({ kind: 'connector', id: 'echo-lab' })
    expect(ctx.marketConnectors.connectorList().connectors).toEqual([{
      id: 'echo-lab', origin: 'market', enabled: false, confirmed: false, state: 'off', launch: { command: 'server.cmd', args: [] },
    }])
    await expect(ctx.marketConnectors.setConnectorEnabled({ id: 'echo-lab', enabled: true }))
      .rejects.toMatchObject({ code: 'market-connectors/confirmation-required' })
    expect(await lines(log)).toEqual([])

    await ctx.marketConnectors.setConnectorEnabled({ id: 'echo-lab', enabled: true, confirmed: true })
    await vi.waitFor(() => { expect(ctx.tools.get(TOOL)).toBeDefined() }, WAIT)
    expect(ctx.marketConnectors.connectorList().connectors[0]).toMatchObject({ enabled: true, confirmed: true, state: 'connected' })
    expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['echo-lab'])

    await ctx.marketConnectors.setConnectorEnabled({ id: 'echo-lab', enabled: false })
    expect(ctx.tools.get(TOOL)).toBeUndefined()
    expect(await ctx.skills.list()).toEqual([])
    await vi.waitFor(async () => { expect((await processes(log)).running).toBe(0) }, WAIT)

    // Accepted once: switching on again needs no confirmation.
    await ctx.marketConnectors.setConnectorEnabled({ id: 'echo-lab', enabled: true })
    await vi.waitFor(() => { expect(ctx.tools.get(TOOL)).toBeDefined() }, WAIT)
  }, 60_000)

  it('keeps the program running across catalog reads', async () => {
    const { ctx, log } = await connected()
    await vi.waitFor(async () => { expect((await processes(log)).running).toBe(1) }, WAIT)
    const before = await lines(log)
    await ctx.market.refreshCatalog()
    await ctx.market.refreshCatalog()
    await new Promise(resolve => setTimeout(resolve, 500))
    expect(ctx.marketConnectors.connectorList().connectors[0]?.state).toBe('connected')
    expect(await lines(log)).toEqual(before)
  }, 60_000)

  it('stops the program before an update replaces its files, then starts the new version', async () => {
    const { ctx, log, catalog } = await connected()
    await catalog.publish('2.0.0')
    await ctx.market.refreshCatalog()
    await ctx.market.installItem({ kind: 'connector', id: 'echo-lab' })
    await vi.waitFor(() => { expect(ctx.marketConnectors.connectorList().connectors[0]?.state).toBe('connected') }, WAIT)
    expect(ctx.tools.get(TOOL)).toBeDefined()
    await vi.waitFor(async () => { expect((await processes(log)).running).toBe(1) }, WAIT)
    const events = await lines(log)
    // Every 1.0.0 process exited before the first 2.0.0 process started.
    const old = events.slice(0, events.indexOf('start 2.0.0'))
    expect(old.filter(line => line === 'start 1.0.0').length).toBe(old.filter(line => line === 'exit').length)
    expect((await processes(log)).starts.at(-1)).toBe('start 2.0.0')
  }, 60_000)

  it('stops the program on uninstall and asks for acceptance again after a reinstall', async () => {
    const { ctx, log } = await connected()
    await ctx.market.uninstallPackage({ kind: 'connector', id: 'echo-lab' })
    expect(ctx.tools.get(TOOL)).toBeUndefined()
    expect(ctx.marketConnectors.connectorList().connectors).toEqual([])
    await vi.waitFor(async () => { expect((await processes(log)).running).toBe(0) }, WAIT)
    await ctx.market.installItem({ kind: 'connector', id: 'echo-lab' })
    expect(ctx.marketConnectors.connectorList().connectors[0]).toMatchObject({ enabled: false, confirmed: false })
  }, 60_000)

  it('reports a program that fails to start and starts it again on retry', async () => {
    const log = join(await tempDir(), 'events.log')
    const catalog = await serveCatalog('echo-lab', log)
    await catalog.publish('1.0.0', { 'server.cmd': `@"${process.execPath}" -e "process.exit(3)"\r\n` })
    const ctx = await mount(catalog.url)
    await ctx.market.installItem({ kind: 'connector', id: 'echo-lab' })
    await ctx.marketConnectors.setConnectorEnabled({ id: 'echo-lab', enabled: true, confirmed: true })
    await vi.waitFor(() => { expect(ctx.marketConnectors.connectorList().connectors[0]?.state).toBe('failed') }, WAIT)
    expect(ctx.marketConnectors.connectorList().connectors[0]?.error).toContain('mcp-client(echo-lab)')
    expect(ctx.tools.get(TOOL)).toBeUndefined()

    const retried = await ctx.marketConnectors.retryConnector({ id: 'echo-lab' })
    expect(retried.connectors[0]?.state).toBe('starting')
    await vi.waitFor(() => { expect(ctx.marketConnectors.connectorList().connectors[0]?.state).toBe('failed') }, WAIT)
  }, 60_000)

  it('refuses a package whose manifest cannot start a program', async () => {
    const log = join(await tempDir(), 'events.log')
    const catalog = await serveCatalog('echo-lab', log)
    await catalog.publish('1.0.0', { 'mcp.json': JSON.stringify({ command: 'missing.exe' }) })
    const ctx = await mount(catalog.url)
    await expect(ctx.market.installItem({ kind: 'connector', id: 'echo-lab' })).rejects.toMatchObject({
      code: 'market/install-failed', details: { reason: 'mcp.json command missing.exe is not a file in the package' },
    })
    expect(ctx.marketConnectors.connectorList().connectors).toEqual([])
  })

  const KEY_SETTINGS = JSON.stringify({ settings: [{ env: 'FIXTURE_KEY', label: { zh: '密钥' }, url: 'https://lab.example/keys' }] })

  it('passes a saved setting to the program, restarts it on a change, and lists the state for the model', async () => {
    const log = join(await tempDir(), 'events.log')
    const catalog = await serveCatalog('echo-lab', log)
    await catalog.publish('1.0.0', { 'settings.json': KEY_SETTINGS })
    const ctx = await mount(catalog.url)
    await ctx.market.installItem({ kind: 'connector', id: 'echo-lab' })
    expect(ctx.marketConnectors.connectorList().connectors[0]?.settings).toEqual([
      { env: 'FIXTURE_KEY', label: { zh: '密钥' }, secret: true, required: false, url: 'https://lab.example/keys', configured: false },
    ])
    await ctx.marketConnectors.setConnectorEnabled({ id: 'echo-lab', enabled: true, confirmed: true })
    await vi.waitFor(() => { expect(ctx.marketConnectors.connectorList().connectors[0]?.state).toBe('connected') }, WAIT)
    expect(await lines(log)).not.toContain('key first')
    expect(await prompt(ctx)).toContain('- echo-lab: FIXTURE_KEY not saved')

    const saved = await ctx.marketConnectors.saveConnectorSettings({ id: 'echo-lab', values: { FIXTURE_KEY: ' first ' } })
    expect(saved.connectors[0]?.settings?.[0]?.configured).toBe(true)
    expect(JSON.stringify(saved)).not.toContain('first')
    await vi.waitFor(async () => { expect(await lines(log)).toContain('key first') }, WAIT)
    await vi.waitFor(() => { expect(ctx.marketConnectors.connectorList().connectors[0]?.state).toBe('connected') }, WAIT)
    const prompted = await prompt(ctx)
    expect(prompted).toContain('FIXTURE_KEY saved')
    expect(prompted).not.toContain('first')

    // An update keeps the saved value: it lives in the credential store, not in the package.
    await catalog.publish('2.0.0', { 'settings.json': KEY_SETTINGS })
    await ctx.market.refreshCatalog()
    await ctx.market.installItem({ kind: 'connector', id: 'echo-lab' })
    await vi.waitFor(async () => {
      const events = await lines(log)
      const update = events.indexOf('start 2.0.0')
      expect(update).toBeGreaterThanOrEqual(0)
      expect(events.slice(update)).toContain('key first')
    }, WAIT)
    await vi.waitFor(() => { expect(ctx.marketConnectors.connectorList().connectors[0]?.state).toBe('connected') }, WAIT)

    await expect(ctx.marketConnectors.saveConnectorSettings({ id: 'echo-lab', values: { OTHER: 'x' } }))
      .rejects.toMatchObject({ code: 'market-connectors/unknown-setting' })
    await expect(ctx.marketConnectors.saveConnectorSettings({ id: 'echo-lab', values: { FIXTURE_KEY: '  ' } }))
      .rejects.toMatchObject({ code: 'market-connectors/invalid-setting' })

    await ctx.marketConnectors.saveConnectorSettings({ id: 'echo-lab', values: { FIXTURE_KEY: null } })
    expect(await ctx.credentials.listRecords()).toEqual([])
  }, 90_000)

  it('does not start a connector until its required setting is saved, and forgets the value on uninstall', async () => {
    const log = join(await tempDir(), 'events.log')
    const catalog = await serveCatalog('echo-lab', log)
    await catalog.publish('1.0.0', { 'settings.json': KEY_SETTINGS.replace('"url"', '"required":true,"url"') })
    const ctx = await mount(catalog.url)
    await ctx.market.installItem({ kind: 'connector', id: 'echo-lab' })
    await ctx.marketConnectors.setConnectorEnabled({ id: 'echo-lab', enabled: true, confirmed: true })
    expect(ctx.marketConnectors.connectorList().connectors[0]).toMatchObject({
      state: 'off', enabled: true, hint: 'setting-required', error: 'needs a value for FIXTURE_KEY',
    })
    expect(await lines(log)).toEqual([])

    await ctx.marketConnectors.saveConnectorSettings({ id: 'echo-lab', values: { FIXTURE_KEY: 'needed' } })
    await vi.waitFor(() => { expect(ctx.marketConnectors.connectorList().connectors[0]?.state).toBe('connected') }, WAIT)
    expect(await lines(log)).toContain('key needed')

    await ctx.market.uninstallPackage({ kind: 'connector', id: 'echo-lab' })
    expect(await ctx.credentials.listRecords()).toEqual([])
  }, 60_000)

  it('restarts with a value edited in the credential store, and retries a failed start when a value is saved', async () => {
    const log = join(await tempDir(), 'events.log')
    const catalog = await serveCatalog('echo-lab', log)
    await catalog.publish('1.0.0', {
      'settings.json': KEY_SETTINGS,
      'server.cmd': `@if "%FIXTURE_KEY%"=="bad" exit /b 3\r\n@"${process.execPath}" "%~dp0server.mjs"\r\n`,
    })
    const ctx = await mount(catalog.url)
    await ctx.market.installItem({ kind: 'connector', id: 'echo-lab' })
    await ctx.marketConnectors.saveConnectorSettings({ id: 'echo-lab', values: { FIXTURE_KEY: 'bad' } })
    await ctx.marketConnectors.setConnectorEnabled({ id: 'echo-lab', enabled: true, confirmed: true })
    await vi.waitFor(() => { expect(ctx.marketConnectors.connectorList().connectors[0]?.state).toBe('failed') }, WAIT)
    expect(await prompt(ctx)).not.toContain('Market connector settings')

    await ctx.marketConnectors.saveConnectorSettings({ id: 'echo-lab', values: { FIXTURE_KEY: 'good' } })
    await vi.waitFor(() => { expect(ctx.marketConnectors.connectorList().connectors[0]?.state).toBe('connected') }, WAIT)

    // An edit of the credential file reaches the service as a record update, not as a Remote call.
    await ctx.credentials.modifyRecord(credentialKey('market-connectors', 'echo-lab'),
      () => Promise.resolve({ kind: 'api-key', env: { FIXTURE_KEY: 'edited' } }))
    await vi.waitFor(async () => { expect(await lines(log)).toContain('key edited') }, WAIT)
    await vi.waitFor(() => { expect(ctx.marketConnectors.connectorList().connectors[0]?.state).toBe('connected') }, WAIT)
    await vi.waitFor(async () => { expect((await processes(log)).running).toBe(1) }, WAIT)
    // Records of other owners restart nothing.
    const before = (await processes(log)).starts.length
    await ctx.credentials.modifyRecord(credentialKey('feishu-account', 'default'), () => Promise.resolve({ kind: 'grant', payload: {} }))
    await new Promise(resolve => setTimeout(resolve, 300))
    expect((await processes(log)).starts.length).toBe(before)
  }, 90_000)

  it('refuses settings it cannot save', async () => {
    const log = join(await tempDir(), 'events.log')
    const catalog = await serveCatalog('echo-lab', log)
    await catalog.publish('1.0.0', { 'settings.json': KEY_SETTINGS })
    const ctx = await mount(catalog.url)
    await expect(ctx.marketConnectors.saveConnectorSettings({ id: 'echo-lab', values: { FIXTURE_KEY: 'k' } }))
      .rejects.toMatchObject({ code: 'market-connectors/not-installed' })
    await ctx.market.installItem({ kind: 'connector', id: 'echo-lab' })
    // An empty change writes nothing.
    await ctx.marketConnectors.saveConnectorSettings({ id: 'echo-lab', values: {} })
    expect(await ctx.credentials.listRecords()).toEqual([])
    await expect(ctx.marketConnectors.saveConnectorSettings({ id: 'echo-lab', values: { FIXTURE_KEY: 'x'.repeat(4097) } }))
      .rejects.toMatchObject({ code: 'market-connectors/invalid-setting' })

    vi.spyOn(ctx.credentials, 'modifyRecord').mockRejectedValueOnce(new Error('store is locked'))
    await expect(ctx.marketConnectors.saveConnectorSettings({ id: 'echo-lab', values: { FIXTURE_KEY: 'k' } }))
      .rejects.toMatchObject({ code: 'market-connectors/settings-unavailable', details: { reason: 'store is locked' } })
    await ctx.marketConnectors.saveConnectorSettings({ id: 'echo-lab', values: { FIXTURE_KEY: 'k' } })

    // An unreadable store keeps the connector from starting without its values.
    vi.spyOn(ctx.credentials, 'readRecord').mockRejectedValue(new Error('store is locked'))
    await ctx.market.refreshCatalog()
    await vi.waitFor(() => {
      expect(ctx.marketConnectors.connectorList().connectors[0]?.error).toBe('settings cannot be read: store is locked')
    }, WAIT)
    // An uninstall that cannot delete the record still uninstalls; the record stays for the next sync.
    vi.spyOn(ctx.credentials, 'deleteRecord').mockRejectedValueOnce(new Error('store is locked'))
    await ctx.market.uninstallPackage({ kind: 'connector', id: 'echo-lab' })
    expect(ctx.marketConnectors.connectorList().connectors).toEqual([])
    expect((await ctx.credentials.listRecords()).length).toBe(1)
  }, 60_000)

  it('refuses a package whose settings.json is invalid, and settings of a connector refused at load', async () => {
    const log = join(await tempDir(), 'events.log')
    const catalog = await serveCatalog('echo-lab', log)
    await catalog.publish('1.0.0', { 'settings.json': '{"settings":[]}' })
    const ctx = await mount(catalog.url)
    await expect(ctx.market.installItem({ kind: 'connector', id: 'echo-lab' })).rejects.toMatchObject({ code: 'market/install-failed' })

    // A package installed before the rule existed is refused at load instead.
    await catalog.publish('1.0.0')
    await ctx.market.refreshCatalog()
    await ctx.market.installItem({ kind: 'connector', id: 'echo-lab' })
    const installed = ctx.market.installedItems('connector').find(item => item.record.id === 'echo-lab')
    if (installed === undefined) throw new Error('echo-lab is installed')
    await writeFile(join(installed.directory, 'settings.json'), '{"settings":[]}')
    await ctx.market.refreshCatalog()
    await vi.waitFor(() => { expect(ctx.marketConnectors.connectorList().connectors[0]?.error).toMatch(/settings\.json is invalid/) }, WAIT)
    await expect(ctx.marketConnectors.saveConnectorSettings({ id: 'echo-lab', values: { FIXTURE_KEY: 'k' } }))
      .rejects.toMatchObject({ code: 'market-connectors/invalid-manifest' })
  }, 60_000)

  it('stops every program when the service is disposed', async () => {
    const { ctx, log } = await connected()
    await vi.waitFor(async () => { expect((await processes(log)).running).toBe(1) }, WAIT)
    await ctx.fiber.dispose()
    await vi.waitFor(async () => { expect((await processes(log)).running).toBe(0) }, WAIT)
  }, 60_000)
})
