/** Personal uploads retain resources, reject conflicting names, and publish only validated directories. */
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Market from '@deepseek-ai/dsh-market'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as skillFilesystem from '@deepseek-ai/dsh-skill-filesystem'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { strToU8, zipSync, type Zippable } from 'fflate'
import { afterEach, expect, it, vi } from 'vitest'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import MarketSkills, { type Config } from '../src/index.ts'

const hooks = vi.hoisted(() => ({
  rename: undefined as (() => Promise<void>) | undefined,
  failRename: false,
}))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    async rename(...args: Parameters<typeof actual.rename>) {
      if (hooks.failRename) throw new Error('disk write failed')
      await hooks.rename?.()
      await actual.rename(...args)
    },
  }
})

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  hooks.rename = undefined
  hooks.failRename = false
  for (const step of cleanup.splice(0).reverse()) await step()
})

const signal = new AbortController().signal
const skillFile = (name = 'camera-notes') => `---\nname: ${name}\ndescription: Write camera notes\n---\n# Notes\n`
const upload = (fileName: string, content: string | Uint8Array) => ({ fileName, data: Buffer.from(content).toString('base64') })

async function mount(config: Partial<Config> = {}, disabled: string[] = []) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-skill-import-'))
  cleanup.push(() => rm(home, { recursive: true, force: true }))
  const dshHome = join(home, 'dsh-home')
  const agentsHome = join(home, 'agents-home')
  vi.stubEnv('DSH_HOME', dshHome)
  vi.stubEnv('DSH_AGENTS_HOME', agentsHome)
  cleanup.push(() => { vi.unstubAllEnvs(); return Promise.resolve() })
  const ctx = new Context()
  cleanup.push(() => ctx.fiber.dispose())
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend())
  const domain = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', domain)
  ctx.provide('storageDomain', domain)
  ctx.provide('typert', {})
  ctx.provide('workingDirectory', { defaultDirectory: home })
  await ctx.plugin(SkillRegistry, { disabled })
  await ctx.plugin(skillFilesystem, { watch: false, dshHome, agentsHome })
  await ctx.plugin(Market, { catalogUrl: '', home: join(home, 'market') })
  const fiber = ctx.plugin(MarketSkills, config)
  await fiber
  return { ctx, home, dshHome, agentsHome, fiber }
}

it('installs Markdown by its declared name and invalidates a cached catalog immediately', async () => {
  const { ctx, dshHome } = await mount()
  expect(await ctx.skills.list()).toEqual([])
  expect(await ctx.marketSkills.importSkill(upload('different-file-name.md', skillFile()), signal)).toEqual({ name: 'camera-notes' })
  expect(await readFile(join(dshHome, 'skills', 'camera-notes', 'SKILL.md'), 'utf8')).toBe(skillFile())
  expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['camera-notes'])
  expect((await ctx.marketSkills.installed(signal)).skills).toEqual([
    expect.objectContaining({ name: 'camera-notes', origin: 'user', enabled: true }),
  ])
  expect(await readdir(join(dshHome, 'skill-imports'))).toEqual([])
})

it.each(['', 'download/'])('imports ZIP layout %s and retains scripts and references without running them', async (prefix) => {
  const { ctx, dshHome } = await mount()
  const zip = zipSync({
    [`${prefix}SKILL.md`]: strToU8(skillFile()),
    [`${prefix}scripts/run.js`]: strToU8('throw new Error("must not run")'),
    [`${prefix}references/notes.txt`]: strToU8('notes'),
  })
  await ctx.marketSkills.importSkill(upload('notes.ZIP', zip), signal)
  expect(await readFile(join(dshHome, 'skills/camera-notes/scripts/run.js'), 'utf8')).toContain('must not run')
  expect(await readFile(join(dshHome, 'skills/camera-notes/references/notes.txt'), 'utf8')).toBe('notes')
})

it('keeps a previously disabled name disabled after import', async () => {
  const { ctx } = await mount({}, ['camera-notes'])
  await ctx.marketSkills.importSkill(upload('notes.md', skillFile()), signal)
  expect(await ctx.skills.list()).toEqual([])
  expect((await ctx.marketSkills.installed(signal)).skills).toEqual([expect.objectContaining({ name: 'camera-notes', enabled: false })])
  expect(ctx.skills.disabledNames()).toEqual(['camera-notes'])
})

it.each([
  ['missing frontmatter', 'plain text'],
  ['invalid name', skillFile('../notes')],
  ['missing description', '---\nname: camera-notes\n---\nbody'],
  ['invalid invocation', '---\nname: camera-notes\ndescription: notes\nuser-invocable: sometimes\n---\nbody'],
  ['invalid YAML', '---\nname: [\n---\nbody'],
])('rejects Markdown with %s without publishing it', async (_label, data) => {
  const { ctx, dshHome } = await mount()
  await expect(ctx.marketSkills.importSkill(upload('notes.md', data), signal))
    .rejects.toMatchObject({ code: 'market-skills/import-invalid', details: { reason: 'invalid-skill' } })
  await expect(stat(join(dshHome, 'skills/camera-notes'))).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await readdir(join(dshHome, 'skill-imports'))).toEqual([])
})

it.each([
  ['notes.txt', 'YQ==', 'unsupported-file'],
  ['notes.md', 'YQ', 'invalid-base64'],
  ['notes.md', 'YR==', 'invalid-base64'],
  ['notes.md', Buffer.from([0xff]).toString('base64'), 'invalid-skill'],
  ['notes.zip', 'YQ==', 'invalid-archive'],
])('rejects invalid upload %s (%s)', async (fileName, data, reason) => {
  const { ctx } = await mount()
  await expect(ctx.marketSkills.importSkill({ fileName, data }, signal))
    .rejects.toMatchObject({ code: 'market-skills/import-invalid', details: { reason } })
})

it('imports ZIP archives containing more than 512 entries and preserves every resource', async () => {
  const { ctx, dshHome } = await mount()
  const resources = Object.fromEntries(Array.from({ length: 513 }, (_, index) => [`references/${index}.txt`, strToU8(`resource ${index}`)]))
  const request = upload('notes.zip', zipSync({ 'SKILL.md': strToU8(skillFile()), ...resources }))
  expect(await ctx.marketSkills.importSkill(request, signal)).toEqual({ name: 'camera-notes' })
  expect(await readdir(join(dshHome, 'skills/camera-notes/references'))).toHaveLength(513)
  for (const [path, content] of Object.entries(resources)) {
    expect(await readFile(join(dshHome, 'skills/camera-notes', path))).toEqual(Buffer.from(content))
  }
  expect(await readdir(join(dshHome, 'skill-imports'))).toEqual([])
})

it.each([
  { '../escape': strToU8('x') },
  { 'assets/file:stream': strToU8('x') },
  { 'assets/NUL.txt': strToU8('x') },
  { 'assets/trailing.': strToU8('x') },
  { 'ASSETS/a': strToU8('x'), 'assets/b': strToU8('x') },
  { 'assets/é.txt': strToU8('x'), 'assets/é.txt': strToU8('x') },
  { 'assets': strToU8('x'), 'assets/file': strToU8('x') },
  { 'link': [strToU8('/tmp/outside'), { os: 3, attrs: 0o120777 << 16 }] },
] satisfies Zippable[])('rejects ZIP paths and filesystem aliases %#', async (entries) => {
  const { ctx, dshHome } = await mount()
  const zip = zipSync({ 'SKILL.md': strToU8(skillFile()), ...entries })
  await expect(ctx.marketSkills.importSkill(upload('notes.zip', zip), signal)).rejects.toMatchObject({ code: 'market-skills/import-invalid' })
  await expect(stat(join(dshHome, 'skills/camera-notes'))).rejects.toMatchObject({ code: 'ENOENT' })
})

it.each([
  { 'a/SKILL.md': strToU8(skillFile()), 'b/SKILL.md': strToU8(skillFile('another')) },
  { 'README.md': strToU8('no instructions') },
  { 'SKILL.md': strToU8(skillFile()), 'nested/SKILL.md': strToU8(skillFile('another')) },
])('rejects ZIPs containing no single skill package %#', async (entries) => {
  const { ctx } = await mount()
  await expect(ctx.marketSkills.importSkill(upload('notes.zip', zipSync(entries)), signal))
    .rejects.toMatchObject({ code: 'market-skills/import-invalid', details: { reason: 'invalid-skill' } })
})

it.each(['personal', 'project', 'disabled'])('refuses a %s name conflict and preserves the existing bytes', async (source) => {
  const { ctx, dshHome, home } = await mount({}, source === 'disabled' ? ['camera-notes'] : [])
  const root = source === 'project' ? join(home, '.agents/skills') : join(dshHome, 'skills')
  await mkdir(join(root, 'camera-notes'), { recursive: true })
  await writeFile(join(root, 'camera-notes/SKILL.md'), skillFile())
  await expect(ctx.marketSkills.importSkill(upload('notes.md', skillFile().replace('# Notes', '# Changed')), signal))
    .rejects.toMatchObject({ code: 'market-skills/import-conflict', details: { name: 'camera-notes' } })
  expect(await readFile(join(root, 'camera-notes/SKILL.md'), 'utf8')).toBe(skillFile())
})

it('refuses an unparseable existing personal path and a case alias in the other personal root', async () => {
  const { ctx, dshHome, agentsHome } = await mount()
  await mkdir(join(dshHome, 'skills/camera-notes'), { recursive: true })
  await writeFile(join(dshHome, 'skills/camera-notes/keep'), 'untouched')
  await expect(ctx.marketSkills.importSkill(upload('notes.md', skillFile()), signal)).rejects.toMatchObject({ code: 'market-skills/import-conflict' })
  expect(await readFile(join(dshHome, 'skills/camera-notes/keep'), 'utf8')).toBe('untouched')
  await mkdir(join(agentsHome, 'skills/CAMERA-NOTES'), { recursive: true })
  await rm(join(dshHome, 'skills/camera-notes'), { recursive: true })
  await expect(ctx.marketSkills.importSkill(upload('notes.md', skillFile()), signal))
    .rejects.toMatchObject({ code: 'market-skills/import-conflict', details: { source: 'user-agents' } })
})

it('serializes two same-name imports and publishes only the first complete skill', async () => {
  const { ctx, dshHome } = await mount()
  const reached = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  hooks.rename = async () => { reached.resolve(undefined); await release.promise }
  const first = ctx.marketSkills.importSkill(upload('first.md', skillFile()), signal)
  await reached.promise
  const second = ctx.marketSkills.importSkill(upload('second.md', skillFile().replace('# Notes', '# Second')), signal)
  const secondOutcome = expect(second).rejects.toMatchObject({ code: 'market-skills/import-conflict' })
  release.resolve(undefined)
  await first
  await secondOutcome
  expect(await readFile(join(dshHome, 'skills/camera-notes/SKILL.md'), 'utf8')).toBe(skillFile())
  expect(await readdir(join(dshHome, 'skill-import-locks'))).toEqual([])
})

it('does not publish a failed rename and removes staging before reporting failure', async () => {
  const { ctx, dshHome } = await mount()
  hooks.failRename = true
  await expect(ctx.marketSkills.importSkill(upload('notes.md', skillFile()), signal)).rejects.toMatchObject({ code: 'market-skills/import-failed' })
  await expect(stat(join(dshHome, 'skills/camera-notes'))).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await readdir(join(dshHome, 'skill-imports'))).toEqual([])
})

it('cancels before publication without leaving staging or a visible skill', async () => {
  const { ctx, dshHome } = await mount()
  const controller = new AbortController()
  controller.abort(new Error('cancelled'))
  await expect(ctx.marketSkills.importSkill(upload('notes.md', skillFile()), controller.signal)).rejects.toThrow('cancelled')
  await expect(stat(join(dshHome, 'skills/camera-notes'))).rejects.toMatchObject({ code: 'ENOENT' })
})

it('keeps registry invalidation alive until an admitted import finishes during disposal', async () => {
  const { ctx, dshHome, fiber } = await mount()
  const reached = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  cleanup.push(() => { release.resolve(undefined); return Promise.resolve() })
  hooks.rename = async () => { reached.resolve(undefined); await release.promise }
  const imported = ctx.marketSkills.importSkill(upload('notes.md', skillFile()), signal)
  await reached.promise
  let disposed = false
  const disposal = fiber.dispose().then(() => { disposed = true })
  expect(await ctx.skills.list()).toEqual([])
  expect(disposed).toBe(false)
  release.resolve(undefined)
  expect(await imported).toEqual({ name: 'camera-notes' })
  await disposal
  expect(await readFile(join(dshHome, 'skills/camera-notes/SKILL.md'), 'utf8')).toBe(skillFile())
  expect(await readdir(join(dshHome, 'skill-imports'))).toEqual([])
  expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['camera-notes'])
})

it('cancels an import waiting for the same-name lock and removes its staging before disposal completes', async () => {
  const { ctx, dshHome, fiber } = await mount()
  const reached = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  hooks.rename = async () => { reached.resolve(undefined); await release.promise }
  const first = ctx.marketSkills.importSkill(upload('notes.md', skillFile()), signal)
  await reached.promise
  const second = ctx.marketSkills.importSkill(upload('notes.md', skillFile()), signal)
  const secondOutcome = expect(second).rejects.toThrow('market-skills disposed')
  await vi.waitFor(async () => { expect(await readdir(join(dshHome, 'skill-imports'))).toHaveLength(2) })
  const disposal = fiber.dispose()
  release.resolve(undefined)
  await first
  await secondOutcome
  await disposal
  expect(await readdir(join(dshHome, 'skill-imports'))).toEqual([])
})

it('rejects forged ZIP expansion sizes and corrupt resource bytes', async () => {
  const { ctx } = await mount()
  const original = zipSync({ 'SKILL.md': strToU8(skillFile()), 'resource': strToU8('large'.repeat(1000)) })
  const forged = Buffer.from(original)
  let cursor = forged.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  cursor = forged.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), cursor + 1)
  forged.writeUInt32LE(1, cursor + 24)
  await expect(ctx.marketSkills.importSkill(upload('notes.zip', forged), signal))
    .rejects.toMatchObject({ code: 'market-skills/import-invalid', details: { reason: 'invalid-archive' } })
  const corrupt = Buffer.from(zipSync({ 'SKILL.md': [strToU8(skillFile()), { level: 0 }] }))
  corrupt[30 + Buffer.byteLength('SKILL.md')] = 1
  await expect(ctx.marketSkills.importSkill(upload('notes.zip', corrupt), signal))
    .rejects.toMatchObject({ code: 'market-skills/import-invalid', details: { reason: 'invalid-archive' } })
})

it('accepts Markdown uploads larger than 10 MiB', async () => {
  const { ctx, dshHome } = await mount()
  const size = 10 * 1024 * 1024 + 1
  const header = skillFile()
  const content = header + 'x'.repeat(size - Buffer.byteLength(header))
  expect(await ctx.marketSkills.importSkill(upload('large.md', content), signal)).toEqual({ name: 'camera-notes' })
  expect((await stat(join(dshHome, 'skills/camera-notes/SKILL.md'))).size).toBe(size)
})

it('preserves a ZIP resource larger than 50 MiB after expansion', async () => {
  const { ctx, dshHome } = await mount()
  const resource = Buffer.alloc(50 * 1024 * 1024 + 1, 120)
  const request = upload('large.zip', zipSync({ 'SKILL.md': strToU8(skillFile()), 'assets/large.bin': resource }))
  expect(await ctx.marketSkills.importSkill(request, signal)).toEqual({ name: 'camera-notes' })
  expect((await readFile(join(dshHome, 'skills/camera-notes/assets/large.bin'))).equals(resource)).toBe(true)
})
