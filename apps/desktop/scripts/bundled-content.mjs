/**
 * Skills and plugins a Desktop build carries in its read-only application resources.
 *
 * Each source is a checkout beside this repository. Preparation copies what a source lists
 * into `runtime/bundled/` and records every item and the checkout state it came from in
 * `runtime/bundled/manifest.json`: skill directories flat under `skills/<name>/`, which the
 * Host mounts as one bundled skill root, and plugin packages under `plugins/<name>/`, which
 * the shell reconciles into the Desktop profile at launch. Packaging checks the packaged
 * resources against that record, so a build whose preparation skipped this step, or whose
 * packaged copy lost or changed a file, fails instead of shipping without it.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, isAbsolute, join, posix, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'

/**
 * Runtime subdirectory holding everything this module prepares.
 *
 * Must agree with `BUNDLED_CONTENT_DIRECTORY` in `apps/desktop/src/bundled-plugins.ts` and
 * `apps/desktop-host/src/bundled-skills.ts`, which read it; a build script cannot share a
 * module with either application bundle.
 */
export const BUNDLED_CONTENT_DIRECTORY = 'bundled'

/** File inside the content directory recording what preparation copied and where each item came from. */
export const BUNDLED_CONTENT_MANIFEST = 'manifest.json'

/** Content subdirectories; the Host reads `skills`, the shell reads `plugins`. */
const SKILL_DIRECTORY = 'skills'
const PLUGIN_DIRECTORY = 'plugins'
const LICENSE_DIRECTORY = 'licenses'

/** Sources this build carries, each a checkout beside this repository. */
export const BUNDLED_SOURCES = [
  { checkout: 'ppt-master', skills: { root: 'skills', names: ['ppt-master'] } },
  // mattpocock/skills groups its skills by category, and preparation copies from one root per
  // source, so each published category is its own source over the same checkout. The names are
  // the upstream plugin manifest's (`.claude-plugin/plugin.json`); `in-progress/` and `misc/` are
  // unpublished upstream.
  {
    checkout: 'skills',
    branch: 'main',
    license: 'LICENSE',
    skills: {
      root: 'skills/engineering',
      names: [
        'ask-matt',
        'code-review',
        'codebase-design',
        'diagnosing-bugs',
        'domain-modeling',
        'grill-with-docs',
        'implement',
        'implement-spec',
        'improve-codebase-architecture',
        'pr',
        'prototype',
        'research',
        'retro',
        'setup-matt-pocock-skills',
        'tdd',
        'to-spec',
        'to-tickets',
        'triage',
        'wayfinder',
        'wizard',
      ],
    },
  },
  {
    checkout: 'skills',
    branch: 'main',
    license: 'LICENSE',
    skills: {
      root: 'skills/productivity',
      names: ['grill-me', 'grilling', 'handoff', 'teach', 'to-questionnaire', 'wait-what', 'writing-for-agents'],
    },
  },
  { checkout: 'dsh-bundle-exa-search', plugin: 'dsh-bundle-exa-search' },
  { checkout: 'dsh-bundle-jina-fetch', plugin: 'dsh-bundle-jina-fetch' },
]

/** Environment override for the directory holding the source checkouts. */
const SOURCE_ROOT_ENV = 'DSH_DESKTOP_BUNDLED_SOURCES_DIR'

/** Environment switch that lets preparation omit a source whose checkout is absent. */
const ALLOW_MISSING_ENV = 'DSH_DESKTOP_ALLOW_MISSING_SOURCES'

/** Directory entries that belong to a working checkout rather than to a released item. */
const CHECKOUT_ENTRIES = new Set(['.git', '.DS_Store', '__pycache__', 'node_modules'])

/** Skill names the DSH skill registry accepts. */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

/** npm package names, optionally scoped. */
const PACKAGE_NAME = /^(?:@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/u

/** Characters that make an npm `files` entry a pattern rather than a path. */
const FILES_PATTERN = /[*?[\]{}!]/u

/** Leading YAML frontmatter block of a `SKILL.md`. */
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u

/** Directory beside this repository that holds the source checkouts by default. */
const DEFAULT_SOURCE_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)), '..', '..', '..')

/**
 * Copy every listed skill and plugin into the runtime resources and record where each came from.
 * @param {string} runtimeDir - Desktop runtime resource directory outside ASAR.
 * @param {NodeJS.ProcessEnv} [env] - Preparation environment; `DSH_DESKTOP_BUNDLED_SOURCES_DIR` overrides the
 *   checkout root and `DSH_DESKTOP_ALLOW_MISSING_SOURCES=1` lets an absent checkout be omitted with a warning.
 * @param {readonly import('./bundled-content.d.mts').BundledSource[]} [sources] - Sources to copy.
 * @throws when the source list is invalid, a checkout is absent without the switch, is not on its declared
 *   branch, or lacks its declared license, or when a listed skill or plugin is not publishable as listed.
 */
export function prepareBundledContent(runtimeDir, env = process.env, sources = BUNDLED_SOURCES) {
  const allowMissing = readAllowMissing(env)
  checkSources(sources)
  const content = join(runtimeDir, BUNDLED_CONTENT_DIRECTORY)
  rmSync(content, { recursive: true, force: true })
  mkdirSync(content, { recursive: true })
  const root = env[SOURCE_ROOT_ENV] || DEFAULT_SOURCE_ROOT
  const skills = []
  const plugins = []
  for (const source of sources) {
    const checkout = join(root, source.checkout)
    if (!existsSync(checkout)) {
      if (!allowMissing) {
        throw new Error(`bundled content: checkout ${source.checkout} is absent at ${checkout}; set ${SOURCE_ROOT_ENV} to the directory holding it, or ${ALLOW_MISSING_ENV}=1 to build without it`)
      }
      console.warn(`bundled content: checkout ${source.checkout} is absent at ${checkout}; this build omits ${itemNames(source).join(', ')}`)
      continue
    }
    if (source.branch !== undefined) checkBranch(checkout, source.branch)
    const revision = readRevision(checkout)
    const license = source.license === undefined ? undefined : copyLicense(content, checkout, source)
    const origin = path => ({
      checkout: source.checkout,
      ...revision === undefined ? {} : { revision, dirty: isDirty(checkout, path) },
      ...license === undefined ? {} : { license },
    })
    if (source.plugin !== undefined) {
      plugins.push({ ...copyPlugin(checkout, join(content, PLUGIN_DIRECTORY), source.plugin), ...origin('.') })
      continue
    }
    for (const name of source.skills.names) {
      const path = posix.join(source.skills.root, name)
      copySkill(join(checkout, path), join(content, SKILL_DIRECTORY, name), name)
      skills.push({ name, path, ...origin(path) })
    }
  }
  writeFileSync(join(content, BUNDLED_CONTENT_MANIFEST), `${JSON.stringify({ schemaVersion: 1, skills, plugins }, undefined, 2)}\n`)
}

/**
 * Check that packaged resources carry every item preparation recorded, byte for byte for plugins.
 * @param {string} runtimeDir - Packaged `runtime` resources directory.
 * @throws when the record is absent, so preparation did not run, or a recorded skill, plugin, or license
 *   was not packaged, or a packaged plugin differs from the prepared copy.
 */
export function verifyBundledContent(runtimeDir) {
  const content = join(runtimeDir, BUNDLED_CONTENT_DIRECTORY)
  const manifest = join(content, BUNDLED_CONTENT_MANIFEST)
  if (!existsSync(manifest)) throw new Error(`bundled content: ${manifest} is missing; Desktop preparation must run prepareBundledContent`)
  const { skills, plugins } = JSON.parse(readFileSync(manifest, 'utf8'))
  if (!Array.isArray(skills) || !Array.isArray(plugins)) throw new Error(`bundled content: ${manifest} does not list skills and plugins`)
  for (const { name, license } of [...skills, ...plugins]) {
    if (license !== undefined && !existsSync(join(content, license))) {
      throw new Error(`bundled content: packaged resources lack ${name}'s license; expected ${join(content, license)}`)
    }
  }
  for (const { name } of skills) {
    const file = join(content, SKILL_DIRECTORY, name, 'SKILL.md')
    if (!existsSync(file)) throw new Error(`bundled content: packaged resources lack skill ${name}; expected ${file}`)
  }
  for (const { name, digest } of plugins) {
    const directory = join(content, PLUGIN_DIRECTORY, ...name.split('/'))
    if (!existsSync(join(directory, 'package.json'))) throw new Error(`bundled content: packaged resources lack plugin ${name}; expected ${directory}`)
    if (digestTree(directory) !== digest) throw new Error(`bundled content: packaged plugin ${name} differs from the copy preparation recorded`)
  }
}

/**
 * Reject a source list whose items could not all be published under their listed names.
 * @param {readonly import('./bundled-content.d.mts').BundledSource[]} sources - Sources to copy.
 */
function checkSources(sources) {
  for (const source of sources) {
    if ((source.skills === undefined) === (source.plugin === undefined)) {
      throw new Error(`bundled content: source ${source.checkout} must list either skills or one plugin`)
    }
  }
  const skills = sources.flatMap(source => source.skills?.names ?? [])
  const plugins = sources.flatMap(source => source.plugin ?? [])
  for (const [index, name] of skills.entries()) {
    if (!SKILL_NAME.test(name)) throw new Error(`bundled content: "${name}" is not a kebab-case skill name`)
    if (skills.indexOf(name) !== index) throw new Error(`bundled content: skill "${name}" is listed more than once`)
  }
  for (const [index, name] of plugins.entries()) {
    if (!PACKAGE_NAME.test(name)) throw new Error(`bundled content: "${name}" is not an npm package name`)
    if (plugins.indexOf(name) !== index) throw new Error(`bundled content: plugin "${name}" is listed more than once`)
  }
}

/**
 * @param {import('./bundled-content.d.mts').BundledSource} source - One source.
 * @returns {readonly string[]} Names of the items the source lists.
 */
function itemNames(source) {
  return source.plugin === undefined ? source.skills.names : [source.plugin]
}

/**
 * Read the switch that lets preparation omit an absent checkout.
 * @param {NodeJS.ProcessEnv} env - Preparation environment.
 * @returns {boolean} Whether an absent checkout is omitted instead of failing preparation.
 */
function readAllowMissing(env) {
  const value = env[ALLOW_MISSING_ENV]
  if (value !== undefined && value !== '' && value !== '0' && value !== '1') throw new Error(`bundled content: ${ALLOW_MISSING_ENV} must be 0 or 1`)
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
    throw new Error(`bundled content: cannot read the branch of ${checkout}, which must be on ${branch}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (current !== branch) throw new Error(`bundled content: ${checkout} is on ${current}; check out ${branch}, the branch this build bundles`)
}

/**
 * Copy the license file a source keeps outside the items it lists.
 * @param {string} content - Content directory being prepared.
 * @param {string} checkout - Source checkout directory.
 * @param {{ checkout: string, license: string }} source - Source declaring the checkout-relative license file.
 * @returns {string} Content-relative path of the copied license.
 */
function copyLicense(content, checkout, source) {
  const file = join(checkout, source.license)
  if (statSync(file, { throwIfNoEntry: false })?.isFile() !== true) throw new Error(`bundled content: license ${file} is missing`)
  const license = posix.join(LICENSE_DIRECTORY, source.checkout, basename(source.license))
  mkdirSync(join(content, LICENSE_DIRECTORY, source.checkout), { recursive: true })
  cpSync(file, join(content, license))
  return license
}

/**
 * Copy one skill directory whose `SKILL.md` declares the listed name and a description.
 * @param {string} source - Skill directory inside its checkout.
 * @param {string} destination - Skill directory inside the content directory.
 * @param {string} name - Listed skill name.
 */
function copySkill(source, destination, name) {
  const file = join(source, 'SKILL.md')
  if (statSync(file, { throwIfNoEntry: false })?.isFile() !== true) throw new Error(`bundled content: ${file} is missing`)
  const frontmatter = FRONTMATTER.exec(readFileSync(file, 'utf8'))?.[1]
  let metadata
  try { metadata = frontmatter === undefined ? undefined : load(frontmatter) } catch (error) {
    throw new Error(`bundled content: ${file} has invalid YAML frontmatter: ${error instanceof Error ? error.message : String(error)}`)
  }
  // The registry identifies a skill by its frontmatter name and ignores a file without a description.
  if (metadata?.name !== name || typeof metadata.description !== 'string' || metadata.description.trim() === '') {
    throw new Error(`bundled content: ${file} must declare name "${name}" and a description in its YAML frontmatter`)
  }
  cpSync(source, destination, { recursive: true, dereference: true, filter: entry => isDistributable(relative(source, entry)) })
}

/**
 * Copy one plugin package as npm would publish it: `package.json` and the paths its `files` lists.
 *
 * A bundled plugin is placed in the profile without a package installation, so it must be a
 * dsh bundle that declares no runtime dependencies; the runtime resolution supplies the
 * installation's copies of the `@deepseek-ai` packages it imports.
 * @param {string} checkout - Plugin package checkout.
 * @param {string} plugins - Content subdirectory holding plugin packages.
 * @param {string} name - Listed package name.
 * @returns {{ name: string, version: string, digest: string }} The copied package's record.
 */
function copyPlugin(checkout, plugins, name) {
  const file = join(checkout, 'package.json')
  let manifest
  try { manifest = JSON.parse(readFileSync(file, 'utf8')) } catch (error) {
    throw new Error(`bundled content: cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (manifest?.name !== name) throw new Error(`bundled content: ${file} names ${String(manifest?.name)}; the source lists ${name}`)
  if (typeof manifest.version !== 'string' || manifest.version === '') throw new Error(`bundled content: ${file} declares no version`)
  if (manifest.dsh?.bundle === undefined) throw new Error(`bundled content: ${file} declares no dsh.bundle; only dsh bundles can be bundled plugins`)
  if (Object.keys(manifest.dependencies ?? {}).length > 0) {
    throw new Error(`bundled content: ${file} declares dependencies; a bundled plugin is placed without a package installation, so it must bundle them or declare them as peers`)
  }
  const files = manifest.files
  if (!Array.isArray(files) || files.length === 0 || !files.every(entry => typeof entry === 'string')) {
    throw new Error(`bundled content: ${file} must list the paths it distributes in "files"`)
  }
  const destination = join(plugins, ...name.split('/'))
  mkdirSync(destination, { recursive: true })
  cpSync(file, join(destination, 'package.json'))
  for (const entry of files) {
    if (FILES_PATTERN.test(entry)) throw new Error(`bundled content: ${file} lists the pattern "${entry}" in "files"; list file and directory paths`)
    const path = relative(checkout, resolve(checkout, entry))
    if (path === '' || path.startsWith('..') || isAbsolute(path)) throw new Error(`bundled content: ${file} lists "${entry}" in "files", which is not inside the package`)
    if (!existsSync(join(checkout, path))) throw new Error(`bundled content: ${file} lists "${entry}" in "files", which is missing; build the plugin first`)
    cpSync(join(checkout, path), join(destination, path), {
      recursive: true, dereference: true, filter: source => isDistributable(relative(checkout, source)),
    })
  }
  return { name, version: manifest.version, digest: digestTree(destination) }
}

/**
 * Hash a directory tree by relative path and file content, independent of platform and copy order.
 * @param {string} directory - Directory to hash.
 * @returns {string} `sha256-<hex>` digest.
 */
function digestTree(directory) {
  const tree = createHash('sha256')
  for (const path of listFiles(directory, '')) {
    const file = createHash('sha256').update(readFileSync(join(directory, ...path.split('/')))).digest('hex')
    tree.update(`${path}\0${file}\n`)
  }
  return `sha256-${tree.digest('hex')}`
}

/**
 * @param {string} directory - Directory to list.
 * @param {string} prefix - POSIX path of `directory` relative to the tree root.
 * @returns {string[]} POSIX paths of every file below `directory`, in code-unit order.
 */
function listFiles(directory, prefix) {
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
    .flatMap(entry => entry.isDirectory()
      ? listFiles(join(directory, entry.name), posix.join(prefix, entry.name))
      : [posix.join(prefix, entry.name)])
}

/**
 * Decide whether one copied entry belongs to the released item.
 * @param {string} path - Entry path relative to the item's source directory.
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
    console.warn(`bundled content: ${checkout} records no commit: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
}

/**
 * Report whether a source path differs from the checked-out commit.
 * @param {string} checkout - Source checkout directory.
 * @param {string} path - Checkout-relative path.
 * @returns {boolean} Whether the path has uncommitted or untracked changes.
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
