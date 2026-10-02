/**
 * Skills a Desktop build carries in its read-only application resources.
 *
 * Each source is a checkout beside this repository whose listed skill directories
 * preparation copies flat into `runtime/bundled-skills/<name>/`, recording where each
 * came from in `runtime/bundled-skills.json`. Packaging checks the packaged resources
 * against that record, so a build whose preparation skipped this step fails instead of
 * shipping without its skills. The Host mounts the directory as one bundled skill root.
 */

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, posix, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'

/**
 * Runtime subdirectory holding one directory per bundled skill.
 *
 * Must agree with `BUNDLED_SKILL_DIRECTORY` in `apps/desktop-host/src/bundled-skills.ts`,
 * which mounts it; a build script and the Host bundle cannot share a module.
 */
export const BUNDLED_SKILL_DIRECTORY = 'bundled-skills'

/** Runtime file recording the skills preparation copied and the checkout state each came from. */
export const BUNDLED_SKILL_MANIFEST = 'bundled-skills.json'

/** Runtime subdirectory holding the license file of each source that keeps one outside its skill directories. */
export const BUNDLED_SKILL_LICENSE_DIRECTORY = 'bundled-skill-licenses'

/** Skill sources this build carries, each a checkout beside this repository. */
export const BUNDLED_SKILL_SOURCES = [
  { checkout: 'ppt-master', root: 'skills', skills: ['ppt-master'] },
  {
    // The `dsh` branch adapts an upstream release tag to DSH tool names; other
    // branches of this checkout carry unadapted or host-specific skill text.
    checkout: 'superpowers',
    root: 'skills',
    branch: 'dsh',
    license: 'LICENSE',
    skills: [
      'brainstorming',
      'dispatching-parallel-agents',
      'executing-plans',
      'finishing-a-development-branch',
      'receiving-code-review',
      'requesting-code-review',
      'subagent-driven-development',
      'systematic-debugging',
      'test-driven-development',
      'using-git-worktrees',
      'using-superpowers',
      'verification-before-completion',
      'writing-plans',
    ],
  },
]

/** Environment override for the directory holding the source checkouts. */
const SOURCE_ROOT_ENV = 'DSH_DESKTOP_BUNDLED_SKILLS_DIR'

/** Environment switch that lets preparation omit a source whose checkout is absent. */
const ALLOW_MISSING_ENV = 'DSH_DESKTOP_ALLOW_MISSING_SKILLS'

/** Directory entries that belong to a working checkout rather than to a released skill. */
const CHECKOUT_ENTRIES = new Set(['.git', '.DS_Store', '__pycache__', 'node_modules'])

/** Skill names the DSH skill registry accepts. */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

/** Leading YAML frontmatter block of a `SKILL.md`. */
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u

/** Directory beside this repository that holds the source checkouts by default. */
const DEFAULT_SOURCE_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)), '..', '..', '..')

/**
 * Copy every listed skill into the runtime resources and record where each came from.
 * @param {string} runtimeDir - Desktop runtime resource directory outside ASAR.
 * @param {NodeJS.ProcessEnv} [env] - Preparation environment; `DSH_DESKTOP_BUNDLED_SKILLS_DIR` overrides the
 *   checkout root and `DSH_DESKTOP_ALLOW_MISSING_SKILLS=1` lets an absent checkout be omitted with a warning.
 * @param {readonly { checkout: string, root: string, skills: readonly string[], branch?: string, license?: string }[]} [sources] -
 *   Skill sources to copy.
 * @throws when a skill name is invalid or listed twice, a present checkout lacks a listed skill or declared license,
 *   is not on its declared branch, or has a `SKILL.md` that does not declare its directory name and a description,
 *   or when a checkout is absent without the switch.
 */
export function prepareBundledSkills(runtimeDir, env = process.env, sources = BUNDLED_SKILL_SOURCES) {
  const allowMissing = readAllowMissing(env)
  const names = sources.flatMap(source => source.skills)
  for (const [index, name] of names.entries()) {
    if (!SKILL_NAME.test(name)) throw new Error(`bundled skills: "${name}" is not a kebab-case skill name`)
    if (names.indexOf(name) !== index) throw new Error(`bundled skills: "${name}" is listed more than once`)
  }
  const destination = join(runtimeDir, BUNDLED_SKILL_DIRECTORY)
  rmSync(destination, { recursive: true, force: true })
  rmSync(join(runtimeDir, BUNDLED_SKILL_LICENSE_DIRECTORY), { recursive: true, force: true })
  mkdirSync(destination, { recursive: true })
  const root = env[SOURCE_ROOT_ENV] || DEFAULT_SOURCE_ROOT
  const skills = []
  for (const source of sources) {
    const checkout = join(root, source.checkout)
    if (!existsSync(checkout)) {
      if (!allowMissing) {
        throw new Error(`bundled skills: checkout ${source.checkout} is absent at ${checkout}; set ${SOURCE_ROOT_ENV} to the directory holding it, or ${ALLOW_MISSING_ENV}=1 to build without it`)
      }
      console.warn(`bundled skills: checkout ${source.checkout} is absent at ${checkout}; this build omits ${source.skills.join(', ')}`)
      continue
    }
    if (source.branch !== undefined) checkBranch(checkout, source.branch)
    const revision = readRevision(checkout)
    const license = source.license === undefined ? undefined : copyLicense(runtimeDir, checkout, source)
    for (const name of source.skills) {
      const path = posix.join(source.root, name)
      const skill = join(checkout, path)
      checkSkill(skill, name)
      cpSync(skill, join(destination, name), { recursive: true, dereference: true, filter: entry => isDistributable(relative(skill, entry)) })
      skills.push({
        name, checkout: source.checkout, path,
        ...revision === undefined ? {} : { revision, dirty: isDirty(checkout, path) },
        ...license === undefined ? {} : { license },
      })
    }
  }
  writeFileSync(join(runtimeDir, BUNDLED_SKILL_MANIFEST), `${JSON.stringify({ schemaVersion: 1, skills }, undefined, 2)}\n`)
}

/**
 * Check that packaged resources carry every skill preparation recorded.
 * @param {string} runtimeDir - Packaged `runtime` resources directory.
 * @throws when the record is absent, so preparation did not run, or a recorded skill or license was not packaged.
 */
export function verifyBundledSkills(runtimeDir) {
  const manifest = join(runtimeDir, BUNDLED_SKILL_MANIFEST)
  if (!existsSync(manifest)) throw new Error(`bundled skills: ${manifest} is missing; Desktop preparation must run prepareBundledSkills`)
  const { skills } = JSON.parse(readFileSync(manifest, 'utf8'))
  if (!Array.isArray(skills)) throw new Error(`bundled skills: ${manifest} does not list skills`)
  for (const { name, license } of skills) {
    const file = join(runtimeDir, BUNDLED_SKILL_DIRECTORY, name, 'SKILL.md')
    if (!existsSync(file)) throw new Error(`bundled skills: packaged resources lack ${name}; expected ${file}`)
    if (license !== undefined && !existsSync(join(runtimeDir, license))) {
      throw new Error(`bundled skills: packaged resources lack ${name}'s license; expected ${join(runtimeDir, license)}`)
    }
  }
}

/**
 * Read the switch that lets preparation omit an absent checkout.
 * @param {NodeJS.ProcessEnv} env - Preparation environment.
 * @returns {boolean} Whether an absent checkout is omitted instead of failing preparation.
 */
function readAllowMissing(env) {
  const value = env[ALLOW_MISSING_ENV]
  if (value !== undefined && value !== '' && value !== '0' && value !== '1') throw new Error(`bundled skills: ${ALLOW_MISSING_ENV} must be 0 or 1`)
  return value === '1'
}

/**
 * Require a source checkout to be on the branch that carries its DSH adaptation.
 * @param {string} checkout - Source checkout directory.
 * @param {string} branch - Branch the source declares.
 */
function checkBranch(checkout, branch) {
  let current
  try { current = git(checkout, ['rev-parse', '--abbrev-ref', 'HEAD']) } catch (error) {
    throw new Error(`bundled skills: cannot read the branch of ${checkout}, which must be on ${branch}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (current !== branch) throw new Error(`bundled skills: ${checkout} is on ${current}; check out ${branch}, the branch this build bundles`)
}

/**
 * Copy the license file a source keeps outside its skill directories.
 * @param {string} runtimeDir - Desktop runtime resource directory outside ASAR.
 * @param {string} checkout - Source checkout directory.
 * @param {{ checkout: string, license: string }} source - Source declaring the checkout-relative license file.
 * @returns {string} Runtime-relative path of the copied license.
 */
function copyLicense(runtimeDir, checkout, source) {
  const file = join(checkout, source.license)
  if (statSync(file, { throwIfNoEntry: false })?.isFile() !== true) throw new Error(`bundled skills: license ${file} is missing`)
  const license = posix.join(BUNDLED_SKILL_LICENSE_DIRECTORY, source.checkout, basename(source.license))
  mkdirSync(join(runtimeDir, BUNDLED_SKILL_LICENSE_DIRECTORY, source.checkout), { recursive: true })
  cpSync(file, join(runtimeDir, license))
  return license
}

/**
 * Require a skill directory whose `SKILL.md` declares the listed name and a description.
 * @param {string} directory - Skill directory inside its checkout.
 * @param {string} name - Listed skill name.
 */
function checkSkill(directory, name) {
  const file = join(directory, 'SKILL.md')
  if (statSync(file, { throwIfNoEntry: false })?.isFile() !== true) throw new Error(`bundled skills: ${file} is missing`)
  const frontmatter = FRONTMATTER.exec(readFileSync(file, 'utf8'))?.[1]
  let metadata
  try { metadata = frontmatter === undefined ? undefined : load(frontmatter) } catch (error) {
    throw new Error(`bundled skills: ${file} has invalid YAML frontmatter: ${error instanceof Error ? error.message : String(error)}`)
  }
  // The registry identifies a skill by its frontmatter name and ignores a file without a description.
  if (metadata?.name !== name || typeof metadata.description !== 'string' || metadata.description.trim() === '') {
    throw new Error(`bundled skills: ${file} must declare name "${name}" and a description in its YAML frontmatter`)
  }
}

/**
 * Decide whether one copied entry belongs to the released skill.
 * @param {string} path - Entry path relative to the skill directory.
 * @returns {boolean} Whether the entry is copied.
 */
function isDistributable(path) {
  return !path.endsWith('.pyc') && !path.split(sep).some(segment => CHECKOUT_ENTRIES.has(segment))
}

/**
 * Read the commit a source checkout is at.
 * @param {string} checkout - Source checkout directory.
 * @returns {string | undefined} The checked-out commit, or undefined when the directory is not a git work tree.
 */
function readRevision(checkout) {
  try { return git(checkout, ['rev-parse', 'HEAD']) } catch (error) {
    // A source copied without history, or a host without git, still ships; its record carries no commit.
    console.warn(`bundled skills: ${checkout} records no commit: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
}

/**
 * Report whether a skill directory differs from the checked-out commit.
 * @param {string} checkout - Source checkout directory.
 * @param {string} path - Checkout-relative skill directory.
 * @returns {boolean} Whether the directory has uncommitted or untracked changes.
 */
function isDirty(checkout, path) {
  return git(checkout, ['status', '--porcelain', '--untracked-files=normal', '--', path]) !== ''
}

/**
 * Run one git query in a checkout.
 * @param {string} checkout - Directory to inspect.
 * @param {string[]} args - git arguments.
 * @returns {string} Trimmed standard output.
 */
function git(checkout, args) {
  return execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
}
