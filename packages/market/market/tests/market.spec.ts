/** Market core: catalog validation, safe unpacking, verified installs, and kind sync. */
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { zipSync, strToU8 } from 'fflate'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { extractArchive, MarketArchiveError } from '../src/archive.ts'
import { MarketCatalogError, parseCatalog, resolveCatalogPath } from '../src/catalog.ts'
import Market, { type InstalledItem, type MarketKind } from '../src/index.ts'
import { installPackage } from '../src/installer.ts'
import type { MarketCatalogItem } from '../src/types.ts'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step()
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-market-'))
  cleanup.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

function catalogText(items: object[], extra: object = {}): string {
  return JSON.stringify({ schemaVersion: 1, generatedAt: '2026-10-20T00:00:00Z', items, ...extra })
}

describe('parseCatalog', () => {
  const item = { kind: 'skill', id: 'pdf-cjk', version: '1.0.0', name: { zh: '中文 PDF' }, description: { zh: '处理中文 PDF' } }

  it('accepts a schema 1 catalog and defaults missing lists', () => {
    const catalog = parseCatalog(catalogText([item]))
    expect(catalog.items).toHaveLength(1)
    expect(catalog.categories).toEqual([])
    expect(catalog.featured).toEqual([])
  })

  it.each([
    ['not JSON', '{'],
    ['wrong schema version', JSON.stringify({ schemaVersion: 2, generatedAt: '', items: [] })],
    ['an id outside the grammar', catalogText([{ ...item, id: 'Bad_Id' }])],
    ['an id longer than 32 characters', catalogText([{ ...item, id: `a${'b'.repeat(32)}` }])],
    ['a package path climbing out', catalogText([{ ...item, package: { path: '../x.zip', sha256: '0'.repeat(64), size: 1 } }])],
    ['an absolute icon URL', catalogText([{ ...item, icon: 'https://elsewhere.example/icon.png' }])],
    ['an example without zh text', catalogText([{ ...item, examples: [{ en: 'only English' }] }])],
    ['a duplicate item', catalogText([item, item])],
  ])('rejects %s', (_label, text) => {
    expect(() => parseCatalog(text)).toThrow(MarketCatalogError)
  })

  it('keeps package paths on the catalog origin', () => {
    expect(resolveCatalogPath('http://host/market/index.json', 'packages/skill/a.zip')).toBe('http://host/market/packages/skill/a.zip')
    expect(() => resolveCatalogPath('http://host/market/index.json', '//other/a.zip')).toThrow(MarketCatalogError)
  })
})

describe('extractArchive', () => {
  it('strips one shared top-level directory', async () => {
    const dir = await tempDir()
    const written = await extractArchive(zipSync({ 'pdf-cjk/SKILL.md': strToU8('body'), 'pdf-cjk/scripts/a.py': strToU8('x') }), dir)
    expect(written.sort()).toEqual(['SKILL.md', 'scripts/a.py'])
    expect(await readFile(join(dir, 'SKILL.md'), 'utf8')).toBe('body')
  })

  it.each([
    ['a parent segment', { '../evil.md': strToU8('x') }],
    ['an absolute path', { '/evil.md': strToU8('x') }],
    ['a drive letter', { 'C:/evil.md': strToU8('x') }],
  ])('refuses %s', async (_label, entries) => {
    const dir = await tempDir()
    await expect(extractArchive(zipSync(entries), dir)).rejects.toThrow(MarketArchiveError)
  })

  it('refuses a non-zip and an empty zip', async () => {
    const dir = await tempDir()
    await expect(extractArchive(strToU8('not a zip'), dir)).rejects.toThrow(MarketArchiveError)
    await expect(extractArchive(zipSync({}), dir)).rejects.toThrow(MarketArchiveError)
  })
})

interface Published {
  readonly url: string
  setCatalog(text: string): void
  setPackage(path: string, data: Uint8Array): void
  requests: string[]
}

async function publish(): Promise<Published> {
  const files = new Map<string, Uint8Array>()
  const requests: string[] = []
  const server: Server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname
    requests.push(`${req.method} ${path} ${req.headers['if-none-match'] ?? ''}`.trim())
    const body = files.get(path)
    if (body === undefined) { res.writeHead(404).end(); return }
    const etag = `"${sha256(body).slice(0, 12)}"`
    if (req.headers['if-none-match'] === etag) { res.writeHead(304).end(); return }
    res.writeHead(200, { etag, 'content-length': body.byteLength }).end(Buffer.from(body))
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  cleanup.push(() => new Promise<void>((resolve) => { server.close(() => { resolve() }) }))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}/market/index.json`,
    setCatalog: (text) => { files.set('/market/index.json', strToU8(text)) },
    setPackage: (path, data) => { files.set(`/market/${path}`, data) },
    requests,
  }
}

async function mountMarket(catalogUrl: string, home: string) {
  const ctx = new Context()
  cleanup.push(() => ctx.fiber.dispose())
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend())
  const storageDomain = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', storageDomain)
  ctx.provide('storageDomain', storageDomain)
  ctx.provide('typert', {})
  await ctx.plugin(Market, { catalogUrl, home })
  return ctx
}

function recordingKind(validate: MarketKind['validate'] = async () => {}): MarketKind & { synced: InstalledItem[][] } {
  const synced: InstalledItem[][] = []
  return { kind: 'skill', validate, sync: async (items) => { synced.push([...items]) }, synced }
}

describe('Market', () => {
  const skillZip = zipSync({ 'pdf-cjk/SKILL.md': strToU8('---\nname: pdf-cjk\ndescription: d\n---\nbody') })
  const skillItem = (data: Uint8Array) => ({
    kind: 'skill', id: 'pdf-cjk', version: '1.0.0', name: { zh: '中文 PDF' }, description: { zh: '处理' },
    package: { path: 'packages/skill/pdf-cjk-1.0.0.zip', sha256: sha256(data), size: data.byteLength },
  })

  it('installs, syncs the kind, reinstalls nothing at the same digest, and uninstalls', async () => {
    const server = await publish()
    server.setCatalog(catalogText([skillItem(skillZip)]))
    server.setPackage('packages/skill/pdf-cjk-1.0.0.zip', skillZip)
    const home = await tempDir()
    const ctx = await mountMarket(server.url, home)
    await vi.waitFor(() => { expect(ctx.market.catalogSnapshot().source).toBe('remote') })
    const kind = recordingKind()
    ctx.effect(() => ctx.market.registerKind(kind))
    expect(ctx.market.catalogSnapshot().kinds).toEqual(['skill'])

    const installed = await ctx.market.installPackage({ kind: 'skill', id: 'pdf-cjk' }, new AbortController().signal)
    expect(installed.items[0]?.installedVersion).toBe('1.0.0')
    const directory = join(home, 'packages', 'skill', 'pdf-cjk')
    expect(await readFile(join(directory, 'SKILL.md'), 'utf8')).toContain('name: pdf-cjk')
    expect(kind.synced.at(-1)?.map(item => item.record.id)).toEqual(['pdf-cjk'])
    expect(kind.synced.at(-1)?.[0]?.directory).toBe(directory)

    const downloads = server.requests.filter(line => line.includes('.zip')).length
    await ctx.market.installItem({ kind: 'skill', id: 'pdf-cjk' })
    expect(server.requests.filter(line => line.includes('.zip')).length).toBe(downloads)

    const removed = await ctx.market.uninstallPackage({ kind: 'skill', id: 'pdf-cjk' })
    expect(removed.items[0]?.installedVersion).toBeUndefined()
    expect(kind.synced.at(-1)).toEqual([])
    await expect(stat(directory)).rejects.toThrow()
  })

  it('refuses a digest mismatch and keeps nothing', async () => {
    const server = await publish()
    server.setCatalog(catalogText([{ ...skillItem(skillZip), package: { ...skillItem(skillZip).package, sha256: '0'.repeat(64) } }]))
    server.setPackage('packages/skill/pdf-cjk-1.0.0.zip', skillZip)
    const home = await tempDir()
    const ctx = await mountMarket(server.url, home)
    await vi.waitFor(() => { expect(ctx.market.catalogSnapshot().source).toBe('remote') })
    ctx.effect(() => ctx.market.registerKind(recordingKind()))
    await expect(ctx.market.installItem({ kind: 'skill', id: 'pdf-cjk' })).rejects.toMatchObject({ code: 'market/install-failed' })
    await expect(stat(join(home, 'packages', 'skill', 'pdf-cjk'))).rejects.toThrow()
    expect(ctx.market.catalogSnapshot().installing).toEqual([])
  })

  it('reports the domain refusal and leaves the previous install in place', async () => {
    const server = await publish()
    server.setCatalog(catalogText([skillItem(skillZip)]))
    server.setPackage('packages/skill/pdf-cjk-1.0.0.zip', skillZip)
    const ctx = await mountMarket(server.url, await tempDir())
    await vi.waitFor(() => { expect(ctx.market.catalogSnapshot().source).toBe('remote') })
    ctx.effect(() => ctx.market.registerKind(recordingKind(async () => { throw new Error('SKILL.md name must equal pdf-cjk') })))
    await expect(ctx.market.installItem({ kind: 'skill', id: 'pdf-cjk' })).rejects.toMatchObject({
      code: 'market/install-failed', details: { reason: 'SKILL.md name must equal pdf-cjk' },
    })
  })

  it('names unknown items and unhandled kinds', async () => {
    const server = await publish()
    server.setCatalog(catalogText([skillItem(skillZip)]))
    const ctx = await mountMarket(server.url, await tempDir())
    await vi.waitFor(() => { expect(ctx.market.catalogSnapshot().source).toBe('remote') })
    await expect(ctx.market.installItem({ kind: 'skill', id: 'pdf-cjk' })).rejects.toMatchObject({ code: 'market/kind-unavailable' })
    ctx.effect(() => ctx.market.registerKind(recordingKind()))
    await expect(ctx.market.installItem({ kind: 'skill', id: 'missing' })).rejects.toMatchObject({ code: 'market/not-found' })
    expect(() => ctx.market.registerKind(recordingKind())).toThrow('already registered')
  })

  it('serves the cached catalog when the server is unreachable and revalidates with its ETag', async () => {
    const server = await publish()
    server.setCatalog(catalogText([skillItem(skillZip)], { categories: [{ kind: 'skill', id: 'office', name: { zh: '办公' } }] }))
    const home = await tempDir()
    const first = await mountMarket(server.url, home)
    await vi.waitFor(() => { expect(first.market.catalogSnapshot().source).toBe('remote') })
    await first.fiber.dispose()

    const offline = await mountMarket('http://127.0.0.1:9/market/index.json', home)
    expect(offline.market.catalogSnapshot().source).toBe('none')
    await offline.fiber.dispose()

    const second = await mountMarket(server.url, home)
    expect(second.market.catalogSnapshot().source).toBe('cache')
    expect(second.market.catalogSnapshot().categories).toHaveLength(1)
    await vi.waitFor(() => { expect(second.market.catalogSnapshot().source).toBe('remote') })
    expect(server.requests.at(-1)).toMatch(/^GET \/market\/index\.json "/)
  })

  it('keeps the last good catalog and reports a failed refresh', async () => {
    const server = await publish()
    server.setCatalog(catalogText([skillItem(skillZip)]))
    const ctx = await mountMarket(server.url, await tempDir())
    await vi.waitFor(() => { expect(ctx.market.catalogSnapshot().source).toBe('remote') })
    server.setCatalog('{ broken')
    const after = await ctx.market.refreshCatalog()
    expect(after.items).toHaveLength(1)
    expect(after.fetchError).toContain('not JSON')
  })

  it('streams a fresh snapshot after each change', async () => {
    const server = await publish()
    server.setCatalog(catalogText([]))
    const ctx = await mountMarket(server.url, await tempDir())
    const lifetime = new AbortController()
    const iterator = ctx.market.watch(lifetime.signal)[Symbol.asyncIterator]()
    const first = await iterator.next()
    if (first.done === true) throw new Error('watch ended before its first snapshot')
    const next = iterator.next()
    ctx.effect(() => ctx.market.registerKind(recordingKind()))
    const second = await next
    if (second.done === true) throw new Error('watch ended before its second snapshot')
    expect(second.value.revision).toBeGreaterThan(first.value.revision)
    lifetime.abort()
    expect((await iterator.next()).done).toBe(true)
  })

  it('treats an install with the catalog digest as current when only the version number moved', async () => {
    const server = await publish()
    server.setCatalog(catalogText([skillItem(skillZip)]))
    server.setPackage('packages/skill/pdf-cjk-1.0.0.zip', skillZip)
    const ctx = await mountMarket(server.url, await tempDir())
    await vi.waitFor(() => { expect(ctx.market.catalogSnapshot().source).toBe('remote') })
    ctx.effect(() => ctx.market.registerKind(recordingKind()))
    await ctx.market.installItem({ kind: 'skill', id: 'pdf-cjk' })
    server.setCatalog(catalogText([{ ...skillItem(skillZip), version: '1.0.1', examples: [{ zh: '把这份 PDF 转成文字' }] }]))
    const after = await ctx.market.refreshCatalog()
    expect(after.items[0]).toMatchObject({ version: '1.0.1', installedVersion: '1.0.1', examples: [{ zh: '把这份 PDF 转成文字' }] })
  })

  it('reads the catalog again before installing, so a stale catalog installs the package now published', async () => {
    const server = await publish()
    const v2 = zipSync({ 'pdf-cjk/SKILL.md': strToU8('---\nname: pdf-cjk\ndescription: d\n---\nversion two') })
    server.setCatalog(catalogText([skillItem(skillZip)]))
    const ctx = await mountMarket(server.url, await tempDir())
    await vi.waitFor(() => { expect(ctx.market.catalogSnapshot().source).toBe('remote') })
    ctx.effect(() => ctx.market.registerKind(recordingKind()))
    // The publisher replaces 1.0.0 with 2.0.0 and removes the 1.0.0 package from the share.
    server.setCatalog(catalogText([{ ...skillItem(v2), version: '2.0.0', package: { ...skillItem(v2).package, path: 'packages/skill/pdf-cjk-2.0.0.zip' } }]))
    server.setPackage('packages/skill/pdf-cjk-2.0.0.zip', v2)
    expect(ctx.market.catalogSnapshot().items[0]?.version).toBe('1.0.0')

    const after = await ctx.market.installPackage({ kind: 'skill', id: 'pdf-cjk' }, new AbortController().signal)
    expect(after.items[0]).toMatchObject({ version: '2.0.0', installedVersion: '2.0.0' })
    expect(server.requests.filter(line => line.includes('.zip'))).toEqual(['GET /market/packages/skill/pdf-cjk-2.0.0.zip'])
  })

  it('releases an item after validation and before its directory is replaced, then syncs', async () => {
    const server = await publish()
    const v2 = zipSync({ 'pdf-cjk/SKILL.md': strToU8('---\nname: pdf-cjk\ndescription: d\n---\nversion two') })
    server.setCatalog(catalogText([skillItem(skillZip)]))
    server.setPackage('packages/skill/pdf-cjk-1.0.0.zip', skillZip)
    const home = await tempDir()
    const ctx = await mountMarket(server.url, home)
    await vi.waitFor(() => { expect(ctx.market.catalogSnapshot().source).toBe('remote') })
    const events: string[] = []
    const kind = recordingKind(async () => { events.push('validate') })
    kind.release = async (id) => {
      events.push(`release ${id}: ${await readFile(join(home, 'packages', 'skill', id, 'SKILL.md'), 'utf8').catch(() => 'absent')}`)
    }
    const recorded = kind.synced
    kind.sync = async (items) => { events.push('sync'); recorded.push([...items]) }
    ctx.effect(() => ctx.market.registerKind(kind))
    await ctx.market.installItem({ kind: 'skill', id: 'pdf-cjk' })
    server.setCatalog(catalogText([{ ...skillItem(v2), version: '2.0.0', package: { ...skillItem(v2).package, path: 'packages/skill/pdf-cjk-2.0.0.zip' } }]))
    server.setPackage('packages/skill/pdf-cjk-2.0.0.zip', v2)
    await ctx.market.refreshCatalog()
    events.length = 0
    await ctx.market.installItem({ kind: 'skill', id: 'pdf-cjk' })
    expect(events).toEqual(['validate', expect.stringMatching(/^release pdf-cjk: ---/), 'sync'])
    expect(events[1]).not.toContain('version two')
    expect(await readFile(join(home, 'packages', 'skill', 'pdf-cjk', 'SKILL.md'), 'utf8')).toContain('version two')
    // The replaced copy is deleted after the install returns.
    await vi.waitFor(async () => { expect(await readdir(join(home, 'tmp'))).toEqual([]) })
  })

  it('reports install progress once per whole percent and drops it afterwards', async () => {
    const server = await publish()
    const files = 500
    const entries: Record<string, Uint8Array> = { 'pdf-cjk/SKILL.md': strToU8('---\nname: pdf-cjk\ndescription: d\n---\nbody') }
    for (let index = 1; index < files; index += 1) entries[`pdf-cjk/scripts/${index}.py`] = strToU8('x')
    const zip = zipSync(entries)
    server.setCatalog(catalogText([skillItem(zip)]))
    server.setPackage('packages/skill/pdf-cjk-1.0.0.zip', zip)
    const ctx = await mountMarket(server.url, await tempDir())
    await vi.waitFor(() => { expect(ctx.market.catalogSnapshot().source).toBe('remote') })
    const seen: unknown[] = []
    ctx.effect(() => ctx.market.registerKind(recordingKind(async () => { seen.push(ctx.market.catalogSnapshot().progress) })))
    const before = ctx.market.catalogSnapshot().revision
    const after = await ctx.market.installPackage({ kind: 'skill', id: 'pdf-cjk' }, new AbortController().signal)
    expect(seen).toEqual([[{ key: 'skill:pdf-cjk', phase: 'unpack', done: files, total: files }]])
    expect(after.progress).toEqual([])
    expect(after.revision - before).toBeLessThan(files)
  })

  it('syncs the kind again when the install fails after releasing the item', async () => {
    const server = await publish()
    server.setCatalog(catalogText([skillItem(skillZip)]))
    server.setPackage('packages/skill/pdf-cjk-1.0.0.zip', skillZip)
    const ctx = await mountMarket(server.url, await tempDir())
    await vi.waitFor(() => { expect(ctx.market.catalogSnapshot().source).toBe('remote') })
    const kind = recordingKind()
    kind.release = () => Promise.reject(new Error('the connector would not stop'))
    ctx.effect(() => ctx.market.registerKind(kind))
    await vi.waitFor(() => { expect(kind.synced).toHaveLength(1) })
    await expect(ctx.market.installItem({ kind: 'skill', id: 'pdf-cjk' })).rejects.toMatchObject({
      code: 'market/install-failed', details: { reason: 'the connector would not stop' },
    })
    expect(kind.synced).toHaveLength(2)
    expect(kind.synced.at(-1)).toEqual([])
  })

  it('reports every downloaded chunk and every written file in order', async () => {
    const server = await publish()
    const zip = zipSync({ 'pdf-cjk/SKILL.md': strToU8('body'), 'pdf-cjk/scripts/a.py': strToU8('x') })
    server.setPackage('packages/skill/pdf-cjk-1.0.0.zip', zip)
    const home = await tempDir()
    const progress = vi.fn()
    const item: MarketCatalogItem = { ...skillItem(zip), kind: 'skill' }
    const placed = await installPackage(server.url.replace('index.json', 'packages/skill/pdf-cjk-1.0.0.zip'), item, async () => {}, {
      packagesRoot: join(home, 'packages'), stagingRoot: join(home, 'tmp'), downloadTimeoutMs: 10_000, renameRetryMs: 0,
    }, new AbortController().signal, { release: async () => {}, progress })
    expect(progress.mock.calls.at(0)?.[0]).toBe('download')
    expect(progress.mock.calls.filter(([phase]) => phase === 'download').at(-1)).toEqual(['download', zip.byteLength, zip.byteLength])
    expect(progress.mock.calls.filter(([phase]) => phase === 'unpack')).toEqual([['unpack', 1, 2], ['unpack', 2, 2]])
    expect(placed).toEqual({ directory: join(home, 'packages', 'skill', 'pdf-cjk') })
  })

  it('rejects a non-http catalog URL at load', async () => {
    const ctx = new Context()
    cleanup.push(() => ctx.fiber.dispose())
    ctx.provide('storageDomain', {})
    ctx.provide('typert', {})
    await expect(ctx.plugin(Market, { catalogUrl: 'file:///etc/index.json', home: await tempDir() })).rejects.toThrow('http(s)')
  })

  it('writes the cache only after a valid remote read', async () => {
    const server = await publish()
    server.setCatalog('{ broken')
    const home = await tempDir()
    const ctx = await mountMarket(server.url, home)
    await vi.waitFor(() => { expect(ctx.market.catalogSnapshot().fetchError).toBeDefined() })
    await expect(stat(join(home, 'cache', 'index.json'))).rejects.toThrow()
    await writeFile(join(home, 'marker'), '')
  })
})
