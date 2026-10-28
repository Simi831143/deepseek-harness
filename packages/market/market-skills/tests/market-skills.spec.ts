/** Skill kind: installed market skills join the registry, and one switch covers every source. */
import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { createVolatile, updateVolatile } from '@deepseek-ai/cosmokit'
import Market from '@deepseek-ai/dsh-market'
import SkillRegistry, { type Config as SkillConfig } from '@deepseek-ai/dsh-skill'
import * as skillFilesystem from '@deepseek-ai/dsh-skill-filesystem'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { strToU8, zipSync } from 'fflate'
import { afterEach, expect, it, vi } from 'vitest'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import MarketSkills from '../src/index.ts'

// The next `rm` the package under test calls rejects with this error, once.
const removal = vi.hoisted(() => ({ failure: undefined as Error | undefined }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rm(...args: Parameters<typeof actual.rm>): ReturnType<typeof actual.rm> {
      const failure = removal.failure
      removal.failure = undefined
      return failure === undefined ? actual.rm(...args) : Promise.reject(failure)
    },
  }
})

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  removal.failure = undefined
  for (const step of cleanup.splice(0).reverse()) await step()
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-market-skills-'))
  cleanup.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

function skillFile(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n${name} body.\n`
}

async function writeSkill(root: string, name: string, description: string): Promise<void> {
  await mkdir(join(root, name), { recursive: true })
  await writeFile(join(root, name, 'SKILL.md'), skillFile(name, description))
}

async function serveCatalog(packages: Record<string, Uint8Array>, items: object[]): Promise<string> {
  const files = new Map<string, Uint8Array>(Object.entries(packages).map(([path, data]) => [`/market/${path}`, data]))
  files.set('/market/index.json', strToU8(JSON.stringify({ schemaVersion: 1, generatedAt: '', items })))
  const server = createServer((req, res) => {
    const body = files.get(new URL(req.url ?? '/', 'http://localhost').pathname)
    if (body === undefined) { res.writeHead(404).end(); return }
    res.writeHead(200, { 'content-length': body.byteLength }).end(Buffer.from(body))
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  cleanup.push(() => new Promise<void>((resolve) => { server.close(() => { resolve() }) }))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/market/index.json`
}

function skillItem(id: string, data: Uint8Array) {
  return {
    kind: 'skill', id, version: '1.0.0', name: { zh: id }, description: { zh: id },
    package: { path: `packages/skill/${id}.zip`, sha256: createHash('sha256').update(data).digest('hex'), size: data.byteLength },
  }
}

async function mount(catalogUrl: string) {
  const home = await tempDir()
  const bundled = join(home, 'bundled')
  await mkdir(join(bundled, 'office-docx'), { recursive: true })
  await writeFile(join(bundled, 'office-docx', 'SKILL.md'), skillFile('office-docx', 'Write Word files'))
  const ctx = new Context()
  cleanup.push(() => ctx.fiber.dispose())
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend())
  const storageDomain = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', storageDomain)
  ctx.provide('storageDomain', storageDomain)
  ctx.provide('typert', {})
  ctx.provide('workingDirectory', { defaultDirectory: home })
  const registry = ctx.plugin(SkillRegistry, { disabled: [] })
  await registry
  await ctx.plugin(skillFilesystem, { providerName: 'bundled', includeDefaultRoots: false, bundledSkillDir: bundled, watch: false })
  await ctx.plugin(Market, { catalogUrl, home: join(home, 'market') })
  await vi.waitFor(() => { expect(ctx.market.catalogSnapshot().source).toBe('remote') })
  const updates: object[] = []
  ctx.provide('settings', {
    update: (ns: string, patch: { disabled: string[] }) => {
      updates.push({ ns, patch })
      updateVolatile((registry.config as SkillConfig).disabled!, createVolatile(patch.disabled))
      registry.ctx.emit('loader/volatile-update', [['disabled']])
      return Promise.resolve()
    },
  })
  await ctx.plugin(MarketSkills, { registryEntry: 'skill' })
  return { ctx, updates, home }
}

it('serves installed market skills to every reader and withdraws them on uninstall', async () => {
  const zip = zipSync({ 'pdf-cjk/SKILL.md': strToU8(skillFile('pdf-cjk', 'Chinese PDF')) })
  const { ctx } = await mount(await serveCatalog({ 'packages/skill/pdf-cjk.zip': zip }, [skillItem('pdf-cjk', zip)]))
  expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['office-docx'])

  await ctx.market.installItem({ kind: 'skill', id: 'pdf-cjk' })
  expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['office-docx', 'pdf-cjk'])
  expect((await ctx.skills.get('pdf-cjk'))?.content).toBe('pdf-cjk body.')

  const signal = new AbortController().signal
  expect((await ctx.marketSkills.installed(signal)).skills).toEqual([
    expect.objectContaining({ name: 'pdf-cjk', origin: 'market', enabled: true }),
  ])

  await ctx.market.uninstallPackage({ kind: 'skill', id: 'pdf-cjk' })
  expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['office-docx'])
})

it('lists personal skills but leaves out bundled, composition and project skills', async () => {
  const { ctx, home } = await mount(await serveCatalog({}, []))
  // The mounted default directory is the project, so its .agents/skills is a project root.
  await mkdir(join(home, '.git'))
  await writeSkill(join(home, '.agents', 'skills'), 'repo-review', 'Project skill')
  await writeSkill(join(home, 'preset-skills'), 'agent-experience', 'Composition skill')
  await writeSkill(join(home, 'dsh-home', 'skills'), 'camera-log', 'Created by the user')
  await writeSkill(join(home, 'agents-home', 'skills'), 'shared-notes', 'Shared with other agents')
  await ctx.plugin(skillFilesystem, {
    providerName: 'filesystem', watch: false, customSkillDirs: [join(home, 'preset-skills')],
    dshHome: join(home, 'dsh-home'), agentsHome: join(home, 'agents-home'),
  })

  const listed = await ctx.skills.list({ cwd: home })
  expect(listed.map(skill => skill.name)).toEqual(['agent-experience', 'camera-log', 'office-docx', 'repo-review', 'shared-notes'])
  const { skills } = await ctx.marketSkills.installed(new AbortController().signal)
  expect(skills).toEqual([
    expect.objectContaining({ name: 'camera-log', origin: 'user', enabled: true }),
    expect.objectContaining({ name: 'shared-notes', origin: 'user', enabled: true }),
  ])
})

/** Mount the default filesystem roots over personal folders that `DSH_HOME` and `DSH_AGENTS_HOME` point at. */
async function mountPersonal() {
  const mounted = await mount(await serveCatalog({}, []))
  const dshHome = join(mounted.home, 'dsh-home')
  const agentsHome = join(mounted.home, 'agents-home')
  vi.stubEnv('DSH_HOME', dshHome)
  vi.stubEnv('DSH_AGENTS_HOME', agentsHome)
  cleanup.push(() => { vi.unstubAllEnvs(); return Promise.resolve() })
  await mounted.ctx.plugin(skillFilesystem, {
    providerName: 'filesystem', watch: false, customSkillDirs: [join(mounted.home, 'preset-skills')], dshHome, agentsHome,
  })
  return { ...mounted, dshHome, agentsHome }
}

it('deletes a personal skill directory or flat file and returns the list without it', async () => {
  const { ctx, dshHome, agentsHome } = await mountPersonal()
  await writeSkill(join(dshHome, 'skills'), 'camera-log', 'Created by the user')
  await mkdir(join(agentsHome, 'skills'), { recursive: true })
  await writeFile(join(agentsHome, 'skills', 'notes.md'), skillFile('shared-notes', 'Flat skill file'))
  await writeFile(join(agentsHome, 'skills', 'keep.txt'), 'not a skill')
  const signal = new AbortController().signal
  expect((await ctx.marketSkills.installed(signal)).skills.map(skill => skill.name)).toEqual(['camera-log', 'shared-notes'])

  const afterDir = await ctx.marketSkills.uninstallPersonal({ name: 'camera-log' }, signal)
  expect(afterDir.skills.map(skill => skill.name)).toEqual(['shared-notes'])
  await expect(stat(join(dshHome, 'skills', 'camera-log'))).rejects.toMatchObject({ code: 'ENOENT' })
  expect((await stat(join(dshHome, 'skills'))).isDirectory()).toBe(true)

  const afterFile = await ctx.marketSkills.uninstallPersonal({ name: 'shared-notes' }, signal)
  expect(afterFile.skills).toEqual([])
  await expect(stat(join(agentsHome, 'skills', 'notes.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  expect((await stat(join(agentsHome, 'skills', 'keep.txt'))).isFile()).toBe(true)
})

it('removes a linked personal skill without touching the linked directory', async () => {
  const { ctx, home, agentsHome } = await mountPersonal()
  await writeSkill(join(home, 'elsewhere'), 'linked-skill', 'Lives outside the folder')
  await mkdir(join(agentsHome, 'skills'), { recursive: true })
  await symlink(join(home, 'elsewhere', 'linked-skill'), join(agentsHome, 'skills', 'linked-skill'), 'junction')
  const signal = new AbortController().signal
  expect((await ctx.marketSkills.installed(signal)).skills.map(skill => skill.name)).toEqual(['linked-skill'])

  await ctx.marketSkills.uninstallPersonal({ name: 'linked-skill' }, signal)
  await expect(lstat(join(agentsHome, 'skills', 'linked-skill'))).rejects.toMatchObject({ code: 'ENOENT' })
  expect((await stat(join(home, 'elsewhere', 'linked-skill', 'SKILL.md'))).isFile()).toBe(true)
})

it('refuses to delete a skill outside the personal folders or one that is not visible', async () => {
  const { ctx, home } = await mountPersonal()
  await writeSkill(join(home, 'preset-skills'), 'agent-experience', 'Composition skill')
  const signal = new AbortController().signal
  for (const name of ['agent-experience', 'office-docx']) {
    await expect(ctx.marketSkills.uninstallPersonal({ name }, signal))
      .rejects.toMatchObject({ code: 'market-skills/remove-failed', details: { name, reason: 'not-personal' } })
  }
  expect((await stat(join(home, 'preset-skills', 'agent-experience', 'SKILL.md'))).isFile()).toBe(true)
  await expect(ctx.marketSkills.uninstallPersonal({ name: 'missing' }, signal)).rejects.toMatchObject({ code: 'market-skills/not-found' })
})

it('leaves a market download to the market uninstall', async () => {
  const zip = zipSync({ 'pdf-cjk/SKILL.md': strToU8(skillFile('pdf-cjk', 'Chinese PDF')) })
  const { ctx } = await mount(await serveCatalog({ 'packages/skill/pdf-cjk.zip': zip }, [skillItem('pdf-cjk', zip)]))
  await ctx.market.installItem({ kind: 'skill', id: 'pdf-cjk' })
  await expect(ctx.marketSkills.uninstallPersonal({ name: 'pdf-cjk' }, new AbortController().signal))
    .rejects.toMatchObject({ code: 'market-skills/remove-failed' })
  expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['office-docx', 'pdf-cjk'])
})

it('reports a personal skill whose files cannot be deleted', async () => {
  const { ctx, dshHome } = await mountPersonal()
  await writeSkill(join(dshHome, 'skills'), 'camera-log', 'Created by the user')
  const signal = new AbortController().signal
  removal.failure = Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' })
  await expect(ctx.marketSkills.uninstallPersonal({ name: 'camera-log' }, signal))
    .rejects.toMatchObject({ code: 'market-skills/remove-failed', details: { name: 'camera-log', reason: 'EBUSY: resource busy' } })
})

it('switches a skill off and on through the registry setting, whatever its source', async () => {
  const { ctx, updates } = await mount(await serveCatalog({}, []))
  const signal = new AbortController().signal
  // The page lists only installed skills; the switch itself writes the registry setting for any name.
  const off = await ctx.marketSkills.setEnabled({ names: ['office-docx'], enabled: false }, signal)
  expect(updates).toEqual([{ ns: 'skill', patch: { disabled: ['office-docx'] } }])
  expect(off.skills).toEqual([])
  expect(await ctx.skills.list()).toEqual([])

  await ctx.marketSkills.setEnabled({ names: ['office-docx'], enabled: true }, signal)
  expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['office-docx'])
})

it('reads any skill document, disabled ones included', async () => {
  const zip = zipSync({ 'pdf-cjk/SKILL.md': strToU8('---\nname: pdf-cjk\ndescription: d\nmetadata:\n  version: "2.0.0"\n---\n# PDF\nbody') })
  const { ctx } = await mount(await serveCatalog({ 'packages/skill/pdf-cjk.zip': zip }, [skillItem('pdf-cjk', zip)]))
  await ctx.market.installItem({ kind: 'skill', id: 'pdf-cjk' })
  const signal = new AbortController().signal
  await ctx.marketSkills.setEnabled({ names: ['pdf-cjk'], enabled: false }, signal)
  expect(await ctx.marketSkills.document({ name: 'pdf-cjk' }, signal)).toEqual({ name: 'pdf-cjk', content: '# PDF\nbody', version: '2.0.0' })
  expect(await ctx.marketSkills.document({ name: 'office-docx' }, signal)).toEqual({ name: 'office-docx', content: 'office-docx body.' })
  await expect(ctx.marketSkills.document({ name: 'missing' }, signal)).rejects.toMatchObject({ code: 'market-skills/not-found' })
})

it.each([
  ['no SKILL.md', { 'pdf-cjk/README.md': strToU8('x') }, 'no SKILL.md'],
  ['a different name', { 'pdf-cjk/SKILL.md': strToU8(skillFile('other-name', 'x')) }, 'catalog id is pdf-cjk'],
  ['no frontmatter', { 'pdf-cjk/SKILL.md': strToU8('plain text') }, 'YAML frontmatter'],
])('refuses a package with %s', async (_label, entries, message) => {
  const zip = zipSync(entries)
  const { ctx } = await mount(await serveCatalog({ 'packages/skill/pdf-cjk.zip': zip }, [skillItem('pdf-cjk', zip)]))
  const failure: unknown = await ctx.market.installItem({ kind: 'skill', id: 'pdf-cjk' }).then(() => undefined, (error: unknown) => error)
  expect(failure).toMatchObject({ code: 'market/install-failed' })
  expect((failure as { details: { reason: string } }).details.reason).toContain(message)
  expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['office-docx'])
})
