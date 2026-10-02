import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BUNDLED_SKILL_DIRECTORY,
  BUNDLED_SKILL_LICENSE_DIRECTORY,
  BUNDLED_SKILL_MANIFEST,
  BUNDLED_SKILL_SOURCES,
  prepareBundledSkills,
  verifyBundledSkills,
  type BundledSkillSource,
} from '../scripts/bundled-skills.mjs'

const temporary: string[] = []

/** Record preparation writes beside the copied skills. */
interface BundledSkillManifest {
  schemaVersion: number
  skills: Record<string, unknown>[]
}

function scratch(): string {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-bundled-skill-'))
  temporary.push(directory)
  return directory
}

/** Write one skill directory the way an upstream checkout lays it out. */
function writeSkill(directory: string, name = basename(directory), frontmatterName = name): void {
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'SKILL.md'), `---\nname: ${frontmatterName}\ndescription: ${name} workflow.\n---\n\n# ${name}\n`)
}

function readManifest(runtime: string): BundledSkillManifest {
  return JSON.parse(readFileSync(join(runtime, BUNDLED_SKILL_MANIFEST), 'utf8')) as BundledSkillManifest
}

/** Run preparation as a thrower for `expect(...).toThrow`. */
function preparing(runtime: string, env: NodeJS.ProcessEnv, sources: readonly BundledSkillSource[]): () => void {
  return () => { prepareBundledSkills(runtime, env, sources) }
}

/** Run packaged verification as a thrower for `expect(...).toThrow`. */
function verifying(runtime: string): () => void {
  return () => { verifyBundledSkills(runtime) }
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
    mkdirSync(join(runtime, BUNDLED_SKILL_DIRECTORY, 'previous-release'), { recursive: true })
    // The fixture checkouts are not git work trees, so each records no commit.
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    prepareBundledSkills(runtime, { DSH_DESKTOP_BUNDLED_SKILLS_DIR: sources }, [
      { checkout: 'deck-kit', root: 'skills', skills: ['deck'] },
      { checkout: 'process-kit', root: 'skills', skills: ['planning'] },
    ])

    const skills = join(runtime, BUNDLED_SKILL_DIRECTORY)
    expect(readFileSync(join(skills, 'deck', 'scripts', 'export.py'), 'utf8')).toBe('print("export")\n')
    expect(existsSync(join(skills, 'planning', 'SKILL.md'))).toBe(true)
    for (const absent of ['deck/scripts/export.pyc', 'deck/scripts/__pycache__', 'deck/node_modules', 'deck/.DS_Store', 'unlisted', 'previous-release']) {
      expect(existsSync(join(skills, ...absent.split('/')))).toBe(false)
    }
    expect(readManifest(runtime)).toEqual({
      schemaVersion: 1,
      skills: [
        { name: 'deck', checkout: 'deck-kit', path: 'skills/deck' },
        { name: 'planning', checkout: 'process-kit', path: 'skills/planning' },
      ],
    })
    expect(verifying(runtime)).not.toThrow()
  })

  it('records the commit each skill came from and whether its directory had local changes', () => {
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

    prepareBundledSkills(runtime, { DSH_DESKTOP_BUNDLED_SKILLS_DIR: sources }, [
      { checkout: 'process-kit', root: 'skills', skills: ['clean', 'edited'] },
    ])

    expect(readManifest(runtime).skills).toEqual([
      { name: 'clean', checkout: 'process-kit', path: 'skills/clean', revision, dirty: false },
      { name: 'edited', checkout: 'process-kit', path: 'skills/edited', revision, dirty: true },
    ])
  })

  it('requires the declared branch and packages the source license beside the skills', () => {
    const sources = scratch()
    const runtime = scratch()
    const checkout = join(sources, 'process-kit')
    writeSkill(join(checkout, 'skills', 'planning'))
    writeFileSync(join(checkout, 'LICENSE'), 'MIT License\n')
    git(checkout, ['init', '--quiet', '--initial-branch=main'])
    git(checkout, ['add', '.'])
    git(checkout, ['commit', '--quiet', '-m', 'fixture'])
    const env = { DSH_DESKTOP_BUNDLED_SKILLS_DIR: sources }
    const listed = [{ checkout: 'process-kit', root: 'skills', skills: ['planning'], branch: 'dsh', license: 'LICENSE' }]

    expect(preparing(runtime, env, listed)).toThrow('is on main; check out dsh')
    git(checkout, ['switch', '--quiet', '-c', 'dsh'])
    mkdirSync(join(runtime, BUNDLED_SKILL_LICENSE_DIRECTORY, 'previous-source'), { recursive: true })
    prepareBundledSkills(runtime, env, listed)

    const license = `${BUNDLED_SKILL_LICENSE_DIRECTORY}/process-kit/LICENSE`
    expect(readFileSync(join(runtime, ...license.split('/')), 'utf8')).toBe('MIT License\n')
    expect(existsSync(join(runtime, BUNDLED_SKILL_LICENSE_DIRECTORY, 'previous-source'))).toBe(false)
    expect(readManifest(runtime).skills).toEqual([expect.objectContaining({ name: 'planning', license })])
    expect(verifying(runtime)).not.toThrow()

    rmSync(join(runtime, BUNDLED_SKILL_LICENSE_DIRECTORY), { recursive: true })
    expect(verifying(runtime)).toThrow('packaged resources lack planning\'s license')
    rmSync(join(checkout, 'LICENSE'))
    expect(preparing(runtime, env, listed)).toThrow('LICENSE is missing')
  })

  it('fails on an absent checkout unless the build explicitly omits it', () => {
    const sources = scratch()
    const runtime = scratch()
    const listed = [{ checkout: 'deck-kit', root: 'skills', skills: ['deck'] }]

    expect(preparing(runtime, { DSH_DESKTOP_BUNDLED_SKILLS_DIR: sources }, listed)).toThrow('checkout deck-kit is absent')
    expect(preparing(runtime, { DSH_DESKTOP_BUNDLED_SKILLS_DIR: sources, DSH_DESKTOP_ALLOW_MISSING_SKILLS: 'yes' }, listed))
      .toThrow('DSH_DESKTOP_ALLOW_MISSING_SKILLS must be 0 or 1')

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    prepareBundledSkills(runtime, { DSH_DESKTOP_BUNDLED_SKILLS_DIR: sources, DSH_DESKTOP_ALLOW_MISSING_SKILLS: '1' }, listed)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('this build omits deck'))
    expect(readManifest(runtime).skills).toEqual([])
    expect(verifying(runtime)).not.toThrow()
  })

  it('rejects a listed skill the registry would not publish under its listed name', () => {
    const sources = scratch()
    const runtime = scratch()
    const env = { DSH_DESKTOP_BUNDLED_SKILLS_DIR: sources }
    writeSkill(join(sources, 'kit', 'skills', 'renamed'), 'renamed', 'other-name')
    mkdirSync(join(sources, 'kit', 'skills', 'empty'), { recursive: true })
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(preparing(runtime, env, [{ checkout: 'kit', root: 'skills', skills: ['renamed'] }])).toThrow('must declare name "renamed"')
    expect(preparing(runtime, env, [{ checkout: 'kit', root: 'skills', skills: ['empty'] }])).toThrow('SKILL.md is missing')
    expect(preparing(runtime, env, [{ checkout: 'kit', root: 'skills', skills: ['Not_Kebab'] }])).toThrow('is not a kebab-case skill name')
    expect(preparing(runtime, env, [
      { checkout: 'kit', root: 'skills', skills: ['renamed'] },
      { checkout: 'other', root: 'skills', skills: ['renamed'] },
    ])).toThrow('"renamed" is listed more than once')
  })

  it('lists only distinct kebab-case skill names', () => {
    const names = BUNDLED_SKILL_SOURCES.flatMap(source => source.skills)
    expect(names).toContain('ppt-master')
    expect(names).toContain('using-superpowers')
    expect(new Set(names).size).toBe(names.length)
    for (const name of names) expect(name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
  })
})

describe('packaged bundled skill verification', () => {
  it('fails packaging when preparation did not run or a recorded skill was not packaged', () => {
    const runtime = scratch()
    expect(verifying(runtime)).toThrow(`${BUNDLED_SKILL_MANIFEST} is missing`)

    writeFileSync(join(runtime, BUNDLED_SKILL_MANIFEST), `${JSON.stringify({ schemaVersion: 1, skills: [{ name: 'deck' }] })}\n`)
    expect(verifying(runtime)).toThrow('packaged resources lack deck')

    writeSkill(join(runtime, BUNDLED_SKILL_DIRECTORY, 'deck'))
    expect(verifying(runtime)).not.toThrow()
  })
})
