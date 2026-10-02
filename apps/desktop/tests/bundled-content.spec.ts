import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BUNDLED_CONTENT_DIRECTORY,
  BUNDLED_CONTENT_MANIFEST,
  BUNDLED_SOURCES,
  prepareBundledContent,
  verifyBundledContent,
  type BundledSource,
} from '../scripts/bundled-content.mjs'

const temporary: string[] = []

/** Record preparation writes beside the copied content. */
interface BundledContentManifest {
  schemaVersion: number
  skills: Record<string, unknown>[]
  plugins: Record<string, unknown>[]
}

function scratch(): string {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-bundled-content-'))
  temporary.push(directory)
  return directory
}

/** Write one skill directory the way an upstream checkout lays it out. */
function writeSkill(directory: string, name = basename(directory), frontmatterName = name): void {
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'SKILL.md'), `---\nname: ${frontmatterName}\ndescription: ${name} workflow.\n---\n\n# ${name}\n`)
}

/** Write one built dsh bundle checkout, with development files beside the ones it distributes. */
function writePlugin(checkout: string, manifest: Record<string, unknown> = {}): void {
  mkdirSync(join(checkout, 'lib'), { recursive: true })
  mkdirSync(join(checkout, 'src'), { recursive: true })
  mkdirSync(join(checkout, 'node_modules', 'esbuild'), { recursive: true })
  writeFileSync(join(checkout, 'package.json'), `${JSON.stringify({
    name: basename(checkout), version: '1.0.0', files: ['index.js', 'lib/', 'cordis.patch.yml'],
    dsh: { bundle: { patch: './cordis.patch.yml' } }, devDependencies: { esbuild: '^0.28.1' }, ...manifest,
  })}\n`)
  writeFileSync(join(checkout, 'index.js'), 'export const name = "plugin"\n')
  writeFileSync(join(checkout, 'lib', 'client.js'), 'export {}\n')
  writeFileSync(join(checkout, 'cordis.patch.yml'), '[]\n')
  writeFileSync(join(checkout, 'src', 'card.jsx'), 'export {}\n')
  writeFileSync(join(checkout, 'plugin-1.0.0.tgz'), 'packed')
}

function content(runtime: string, ...path: string[]): string {
  return join(runtime, BUNDLED_CONTENT_DIRECTORY, ...path)
}

function readManifest(runtime: string): BundledContentManifest {
  return JSON.parse(readFileSync(content(runtime, BUNDLED_CONTENT_MANIFEST), 'utf8')) as BundledContentManifest
}

/** Run preparation as a thrower for `expect(...).toThrow`. */
function preparing(runtime: string, env: NodeJS.ProcessEnv, sources: readonly BundledSource[]): () => void {
  return () => { prepareBundledContent(runtime, env, sources) }
}

/** Run packaged verification as a thrower for `expect(...).toThrow`. */
function verifying(runtime: string): () => void {
  return () => { verifyBundledContent(runtime) }
}

function git(directory: string, args: string[]): void {
  execFileSync('git', ['-C', directory, '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', '-c', 'commit.gpgsign=false', ...args], { stdio: 'ignore' })
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('bundled skill preparation', () => {
  it('copies listed skills flat from every source without checkout residue or stale entries', () => {
    const sources = scratch()
    const runtime = scratch()
    const deck = join(sources, 'deck-kit', 'skills', 'deck')
    writeSkill(deck)
    mkdirSync(join(deck, 'scripts', '__pycache__'), { recursive: true })
    writeFileSync(join(deck, 'scripts', 'export.py'), 'print("export")\n')
    writeFileSync(join(deck, 'scripts', 'export.pyc'), 'bytecode')
    writeFileSync(join(deck, 'scripts', '__pycache__', 'export.cpython-312.pyc'), 'bytecode')
    mkdirSync(join(deck, 'node_modules', 'left-pad'), { recursive: true })
    writeFileSync(join(deck, '.DS_Store'), 'finder')
    writeSkill(join(sources, 'process-kit', 'skills', 'planning'))
    writeSkill(join(sources, 'process-kit', 'skills', 'unlisted'))
    mkdirSync(content(runtime, 'skills', 'previous-release'), { recursive: true })
    // The fixture checkouts are not git work trees, so each records no commit.
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    prepareBundledContent(runtime, { DSH_DESKTOP_BUNDLED_SOURCES_DIR: sources }, [
      { checkout: 'deck-kit', skills: { root: 'skills', names: ['deck'] } },
      { checkout: 'process-kit', skills: { root: 'skills', names: ['planning'] } },
    ])

    expect(readFileSync(content(runtime, 'skills', 'deck', 'scripts', 'export.py'), 'utf8')).toBe('print("export")\n')
    expect(existsSync(content(runtime, 'skills', 'planning', 'SKILL.md'))).toBe(true)
    for (const absent of ['deck/scripts/export.pyc', 'deck/scripts/__pycache__', 'deck/node_modules', 'deck/.DS_Store', 'unlisted', 'previous-release']) {
      expect(existsSync(content(runtime, 'skills', ...absent.split('/')))).toBe(false)
    }
    expect(readManifest(runtime)).toEqual({
      schemaVersion: 1,
      skills: [
        { name: 'deck', path: 'skills/deck', checkout: 'deck-kit' },
        { name: 'planning', path: 'skills/planning', checkout: 'process-kit' },
      ],
      plugins: [],
    })
    expect(verifying(runtime)).not.toThrow()
  })

  it('records the commit each item came from and whether its directory had local changes', () => {
    const sources = scratch()
    const runtime = scratch()
    const checkout = join(sources, 'process-kit')
    writeSkill(join(checkout, 'skills', 'clean'))
    writeSkill(join(checkout, 'skills', 'edited'))
    git(checkout, ['init', '--quiet'])
    git(checkout, ['add', '.'])
    git(checkout, ['commit', '--quiet', '-m', 'fixture'])
    writeFileSync(join(checkout, 'skills', 'edited', 'notes.md'), 'local experiment\n')
    const revision = execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()

    prepareBundledContent(runtime, { DSH_DESKTOP_BUNDLED_SOURCES_DIR: sources }, [
      { checkout: 'process-kit', skills: { root: 'skills', names: ['clean', 'edited'] } },
    ])

    expect(readManifest(runtime).skills).toEqual([
      { name: 'clean', path: 'skills/clean', checkout: 'process-kit', revision, dirty: false },
      { name: 'edited', path: 'skills/edited', checkout: 'process-kit', revision, dirty: true },
    ])
  })

  it('requires the declared branch and packages the source license beside the content', () => {
    const sources = scratch()
    const runtime = scratch()
    const checkout = join(sources, 'process-kit')
    writeSkill(join(checkout, 'skills', 'planning'))
    writeFileSync(join(checkout, 'LICENSE'), 'MIT License\n')
    git(checkout, ['init', '--quiet', '--initial-branch=main'])
    git(checkout, ['add', '.'])
    git(checkout, ['commit', '--quiet', '-m', 'fixture'])
    const env = { DSH_DESKTOP_BUNDLED_SOURCES_DIR: sources }
    const listed = [{ checkout: 'process-kit', branch: 'dsh', license: 'LICENSE', skills: { root: 'skills', names: ['planning'] } }]

    expect(preparing(runtime, env, listed)).toThrow('is on main; check out dsh')
    git(checkout, ['switch', '--quiet', '-c', 'dsh'])
    prepareBundledContent(runtime, env, listed)

    expect(readFileSync(content(runtime, 'licenses', 'process-kit', 'LICENSE'), 'utf8')).toBe('MIT License\n')
    expect(readManifest(runtime).skills).toEqual([expect.objectContaining({ name: 'planning', license: 'licenses/process-kit/LICENSE' })])
    expect(verifying(runtime)).not.toThrow()

    rmSync(content(runtime, 'licenses'), { recursive: true })
    expect(verifying(runtime)).toThrow('packaged resources lack planning\'s license')
    rmSync(join(checkout, 'LICENSE'))
    expect(preparing(runtime, env, listed)).toThrow('LICENSE is missing')
  })

  it('fails on an absent checkout unless the build explicitly omits it', () => {
    const sources = scratch()
    const runtime = scratch()
    const listed = [{ checkout: 'deck-kit', skills: { root: 'skills', names: ['deck'] } }, { checkout: 'acme-bundle', plugin: 'acme-bundle' }]

    expect(preparing(runtime, { DSH_DESKTOP_BUNDLED_SOURCES_DIR: sources }, listed)).toThrow('checkout deck-kit is absent')
    expect(preparing(runtime, { DSH_DESKTOP_BUNDLED_SOURCES_DIR: sources, DSH_DESKTOP_ALLOW_MISSING_SOURCES: 'yes' }, listed))
      .toThrow('DSH_DESKTOP_ALLOW_MISSING_SOURCES must be 0 or 1')

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    prepareBundledContent(runtime, { DSH_DESKTOP_BUNDLED_SOURCES_DIR: sources, DSH_DESKTOP_ALLOW_MISSING_SOURCES: '1' }, listed)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('this build omits deck'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('this build omits acme-bundle'))
    expect(readManifest(runtime)).toEqual({ schemaVersion: 1, skills: [], plugins: [] })
    expect(verifying(runtime)).not.toThrow()
  })

  it('rejects a listed skill the registry would not publish under its listed name', () => {
    const sources = scratch()
    const runtime = scratch()
    const env = { DSH_DESKTOP_BUNDLED_SOURCES_DIR: sources }
    writeSkill(join(sources, 'kit', 'skills', 'renamed'), 'renamed', 'other-name')
    mkdirSync(join(sources, 'kit', 'skills', 'empty'), { recursive: true })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const skills = (...names: string[]) => ({ root: 'skills', names })

    expect(preparing(runtime, env, [{ checkout: 'kit', skills: skills('renamed') }])).toThrow('must declare name "renamed"')
    expect(preparing(runtime, env, [{ checkout: 'kit', skills: skills('empty') }])).toThrow('SKILL.md is missing')
    expect(preparing(runtime, env, [{ checkout: 'kit', skills: skills('Not_Kebab') }])).toThrow('is not a kebab-case skill name')
    expect(preparing(runtime, env, [
      { checkout: 'kit', skills: skills('renamed') },
      { checkout: 'other', skills: skills('renamed') },
    ])).toThrow('skill "renamed" is listed more than once')
    expect(preparing(runtime, env, [{ checkout: 'kit' }])).toThrow('must list either skills or one plugin')
    expect(preparing(runtime, env, [{ checkout: 'kit', skills: skills('renamed'), plugin: 'kit' }])).toThrow('must list either skills or one plugin')
  })
})

describe('bundled plugin preparation', () => {
  it('copies only the files a plugin distributes and records its version and content digest', () => {
    const sources = scratch()
    const runtime = scratch()
    writePlugin(join(sources, 'acme-bundle'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const listed = [{ checkout: 'acme-bundle', plugin: 'acme-bundle' }]

    prepareBundledContent(runtime, { DSH_DESKTOP_BUNDLED_SOURCES_DIR: sources }, listed)

    const plugin = content(runtime, 'plugins', 'acme-bundle')
    for (const present of ['package.json', 'index.js', 'lib/client.js', 'cordis.patch.yml']) expect(existsSync(join(plugin, ...present.split('/')))).toBe(true)
    for (const absent of ['src', 'node_modules', 'plugin-1.0.0.tgz']) expect(existsSync(join(plugin, absent))).toBe(false)
    const [record] = readManifest(runtime).plugins
    expect(record).toEqual({ name: 'acme-bundle', version: '1.0.0', digest: record?.digest, checkout: 'acme-bundle' })
    expect(record?.digest).toMatch(/^sha256-[0-9a-f]{64}$/u)
    expect(verifying(runtime)).not.toThrow()

    // The digest follows content, not the version: a rebuild under the same version is a different plugin release.
    writeFileSync(join(sources, 'acme-bundle', 'index.js'), 'export const name = "rebuilt"\n')
    prepareBundledContent(runtime, { DSH_DESKTOP_BUNDLED_SOURCES_DIR: sources }, listed)
    expect(readManifest(runtime).plugins[0]?.digest).not.toBe(record?.digest)
  })

  it('fails packaging when a packaged plugin is missing or differs from the prepared copy', () => {
    const sources = scratch()
    const runtime = scratch()
    writePlugin(join(sources, 'acme-bundle'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    prepareBundledContent(runtime, { DSH_DESKTOP_BUNDLED_SOURCES_DIR: sources }, [{ checkout: 'acme-bundle', plugin: 'acme-bundle' }])

    writeFileSync(content(runtime, 'plugins', 'acme-bundle', 'lib', 'extra.js'), 'export {}\n')
    expect(verifying(runtime)).toThrow('packaged plugin acme-bundle differs')
    rmSync(content(runtime, 'plugins'), { recursive: true })
    expect(verifying(runtime)).toThrow('packaged resources lack plugin acme-bundle')
  })

  it('rejects a plugin the profile could not load without a package installation', () => {
    const sources = scratch()
    const runtime = scratch()
    const env = { DSH_DESKTOP_BUNDLED_SOURCES_DIR: sources }
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const cases: [Record<string, unknown>, string][] = [
      [{ name: 'other-name' }, 'names other-name; the source lists acme-bundle'],
      [{ version: '' }, 'declares no version'],
      [{ dsh: {} }, 'declares no dsh.bundle'],
      [{ dependencies: { 'left-pad': '^1.0.0' } }, 'declares dependencies'],
      [{ files: undefined }, 'must list the paths it distributes in "files"'],
      [{ files: ['dist/**'] }, 'lists the pattern "dist/**"'],
      [{ files: ['../outside.js'] }, 'which is not inside the package'],
      [{ files: ['dist/'] }, '"dist/" in "files", which is missing; build the plugin first'],
    ]
    for (const [manifest, message] of cases) {
      rmSync(join(sources, 'acme-bundle'), { recursive: true, force: true })
      writePlugin(join(sources, 'acme-bundle'), manifest)
      expect(preparing(runtime, env, [{ checkout: 'acme-bundle', plugin: 'acme-bundle' }])).toThrow(message)
    }
    expect(preparing(runtime, env, [{ checkout: 'x', plugin: 'Not A Package' }])).toThrow('is not an npm package name')
    expect(preparing(runtime, env, [{ checkout: 'x', plugin: 'dup' }, { checkout: 'y', plugin: 'dup' }])).toThrow('plugin "dup" is listed more than once')
  })
})

describe('bundled sources', () => {
  it('lists distinct, valid skills and plugins', () => {
    const skills = BUNDLED_SOURCES.flatMap(source => source.skills?.names ?? [])
    const plugins = BUNDLED_SOURCES.flatMap(source => source.plugin ?? [])
    expect(skills).toContain('ppt-master')
    expect(skills).toContain('using-superpowers')
    expect(plugins).toEqual(['dsh-bundle-exa-search'])
    expect(new Set(skills).size).toBe(skills.length)
    for (const name of skills) expect(name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
  })
})

describe('packaged bundled content verification', () => {
  it('fails packaging when preparation did not run or a recorded skill was not packaged', () => {
    const runtime = scratch()
    expect(verifying(runtime)).toThrow(`${BUNDLED_CONTENT_MANIFEST} is missing`)

    mkdirSync(content(runtime), { recursive: true })
    writeFileSync(content(runtime, BUNDLED_CONTENT_MANIFEST), `${JSON.stringify({ schemaVersion: 1, skills: [{ name: 'deck' }], plugins: [] })}\n`)
    expect(verifying(runtime)).toThrow('packaged resources lack skill deck')

    writeSkill(content(runtime, 'skills', 'deck'))
    expect(verifying(runtime)).not.toThrow()
  })
})
