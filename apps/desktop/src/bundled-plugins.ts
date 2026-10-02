/** Plugin packages a Desktop build carries, and the profile reconciliation that installs, updates, and withdraws them. */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { readProfileManifest } from '@deepseek-ai/dsh-app-boot'

/**
 * Runtime subdirectory holding the Desktop's bundled content.
 *
 * Must agree with `BUNDLED_CONTENT_DIRECTORY` in `scripts/bundled-content.mjs`, which prepares
 * it; the application bundles from `src/`, and a build script cannot import TypeScript.
 */
export const BUNDLED_CONTENT_DIRECTORY = 'bundled'

/** Content files and directories `scripts/bundled-content.mjs` writes. */
const CONTENT_MANIFEST = 'manifest.json'
const CONTENT_PLUGIN_DIRECTORY = 'plugins'

/** Profile-relative directory holding the copy a bundled plugin's dependency spec points at. */
const PROFILE_COPY_DIRECTORY = 'bundled-plugins'

/**
 * Profile file recording the bundled plugins this profile has been given and the copy it holds.
 *
 * It separates the two cases an absent plugin cannot: one a newer build introduces, which the
 * profile receives, and one the profile removed, which stays removed.
 */
export const BUNDLED_PLUGIN_LEDGER = 'bundled-plugins.json'

/** One plugin package the running build carries. */
interface BundledPlugin {
  readonly name: string
  readonly version: string
  /** Content digest preparation recorded; a different digest is a different release of the plugin. */
  readonly digest: string
  readonly directory: string
}

/** The copy a profile holds of one bundled plugin. */
interface LedgerEntry {
  readonly version: string
  readonly digest: string
}

/** What one reconciliation changed in the profile. */
export interface BundledPluginChanges {
  /** Plugins this build introduced to the profile, installed and enabled. */
  readonly installed: readonly string[]
  /** Plugins whose code this build replaced; their enabled state and configuration are kept. */
  readonly updated: readonly string[]
  /** Plugins this build no longer carries, removed from the profile; their configuration is kept. */
  readonly removed: readonly string[]
}

/**
 * Bring a profile in line with the plugin packages this build carries.
 *
 * A bundled plugin is owned by the build while the profile declares it with the spec this
 * function writes, `file:./bundled-plugins/<name>`; a same-named dependency declared any other
 * way belongs to the user and is never touched. Against the ledger of plugins the profile has
 * been given, each launch:
 *
 * - installs and enables a plugin the profile has never been given, which covers both a fresh
 *   profile and a plugin a newer build introduces;
 * - replaces an owned plugin's code when the build carries a different digest or a copy is
 *   missing, keeping whether it is enabled and its configuration in `cordis.patch.yml`;
 * - leaves a plugin the profile was given and then removed absent, even when a later build
 *   withdraws and reintroduces it;
 * - removes an owned plugin the build no longer carries, keeping its configuration.
 *
 * Every step is repeatable, so a launch interrupted midway converges on the next one. Bundled
 * plugins need no package installation: preparation admits only dsh bundles without runtime
 * dependencies, and the runtime resolution supplies the installation's copies of the
 * `@deepseek-ai` packages they import.
 * @param profileDir - Desktop profile directory, whose manifest must already exist.
 * @param contentDir - The build's bundled content directory.
 * @returns what the reconciliation changed.
 * @throws when the build's content record or the profile's ledger is missing or malformed.
 */
export async function reconcileBundledPlugins(profileDir: string, contentDir: string): Promise<BundledPluginChanges> {
  const shipped = readBundledPlugins(contentDir)
  const ledger = readLedger(profileDir)
  const manifest = readProfileManifest('dsh', profileDir)
  const dependencies = new Map(Object.entries(manifest.dependencies ?? {}))
  let bundles = [...(manifest.dsh?.profile?.bundles ?? [])]
  const owned = (name: string): boolean => dependencies.get(name) === copySpec(name)
  const installed: string[] = []
  const updated: string[] = []
  const removed: string[] = []

  for (const plugin of shipped.values()) {
    const given = ledger.get(plugin.name)
    if (owned(plugin.name)) {
      if (given?.digest === plugin.digest && holdsCopies(profileDir, plugin.name)) continue
      placeCopies(profileDir, plugin)
      updated.push(plugin.name)
    } else if (given === undefined && !dependencies.has(plugin.name)) {
      placeCopies(profileDir, plugin)
      dependencies.set(plugin.name, copySpec(plugin.name))
      if (!bundles.includes(plugin.name)) bundles.push(plugin.name)
      installed.push(plugin.name)
    } else {
      // The profile removed the plugin after it was given, or the user installed their own copy.
      if (!dependencies.has(plugin.name)) removeCopy(join(profileDir, PROFILE_COPY_DIRECTORY), plugin.name)
      continue
    }
    ledger.set(plugin.name, { version: plugin.version, digest: plugin.digest })
  }
  // Withdrawal follows the dependency spec, so a profile whose ledger was lost still drops a plugin
  // this build no longer carries. A plugin the profile removed keeps its ledger entry, so it stays
  // removed if a later build reintroduces it.
  for (const name of [...dependencies.keys()]) {
    if (shipped.has(name) || !owned(name)) continue
    removeCopy(join(profileDir, 'node_modules'), name)
    removeCopy(join(profileDir, PROFILE_COPY_DIRECTORY), name)
    dependencies.delete(name)
    bundles = bundles.filter(bundle => bundle !== name)
    ledger.delete(name)
    removed.push(name)
  }

  if (installed.length > 0 || removed.length > 0) {
    await writeJson(join(profileDir, 'package.json'), {
      ...manifest,
      dependencies: Object.fromEntries(dependencies),
      dsh: { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles } },
    })
  }
  if (installed.length > 0 || updated.length > 0 || removed.length > 0) {
    await writeJson(join(profileDir, BUNDLED_PLUGIN_LEDGER), {
      schemaVersion: 1,
      plugins: Object.fromEntries([...ledger].sort(([left], [right]) => left.localeCompare(right))),
    })
  }
  return { installed, updated, removed }
}

/**
 * Read the plugin packages the build's content record lists.
 * @param contentDir - The build's bundled content directory.
 * @returns plugins by package name.
 */
function readBundledPlugins(contentDir: string): ReadonlyMap<string, BundledPlugin> {
  const path = join(contentDir, CONTENT_MANIFEST)
  const record = readJson(path)
  // An absent record must not read as "this build carries no plugins", which would remove every owned plugin.
  if (record === undefined) throw new Error(`desktop bundled plugins: ${path} is missing; this build's resources are incomplete`)
  if (!isRecord(record) || record.schemaVersion !== 1 || !Array.isArray(record.plugins)) {
    throw new Error(`desktop bundled plugins: ${path} is not a schema 1 content record`)
  }
  const plugins = new Map<string, BundledPlugin>()
  for (const entry of record.plugins) {
    if (!isRecord(entry) || typeof entry.name !== 'string' || typeof entry.version !== 'string' || typeof entry.digest !== 'string') {
      throw new Error(`desktop bundled plugins: ${path} lists a plugin without a name, version, and digest`)
    }
    plugins.set(entry.name, {
      name: entry.name,
      version: entry.version,
      digest: entry.digest,
      directory: join(contentDir, CONTENT_PLUGIN_DIRECTORY, ...entry.name.split('/')),
    })
  }
  return plugins
}

/**
 * Read the plugins the profile has been given; a profile that has been given none has no ledger.
 * @param profileDir - Desktop profile directory.
 * @returns ledger entries by package name.
 */
function readLedger(profileDir: string): Map<string, LedgerEntry> {
  const path = join(profileDir, BUNDLED_PLUGIN_LEDGER)
  const ledger = readJson(path)
  const entries = new Map<string, LedgerEntry>()
  if (ledger === undefined) return entries
  if (!isRecord(ledger) || ledger.schemaVersion !== 1 || !isRecord(ledger.plugins)) {
    throw new Error(`desktop bundled plugins: ${path} is not a schema 1 ledger; remove it to let this build reinstall its plugins`)
  }
  for (const [name, entry] of Object.entries(ledger.plugins)) {
    if (!isRecord(entry) || typeof entry.version !== 'string' || typeof entry.digest !== 'string') {
      throw new Error(`desktop bundled plugins: ${path} records ${name} without a version and digest`)
    }
    entries.set(name, { version: entry.version, digest: entry.digest })
  }
  return entries
}

/** The dependency spec an owned bundled plugin is declared with, relative to the profile directory. */
function copySpec(name: string): string {
  return `file:./${PROFILE_COPY_DIRECTORY}/${name}`
}

/**
 * Report whether both profile copies of a plugin are present.
 * @param profileDir - Desktop profile directory.
 * @param name - Plugin package name.
 * @returns whether the resolvable copy and the copy the dependency spec names both exist.
 */
function holdsCopies(profileDir: string, name: string): boolean {
  return [join(profileDir, 'node_modules'), join(profileDir, PROFILE_COPY_DIRECTORY)]
    .every(root => existsSync(join(root, ...name.split('/'), 'package.json')))
}

/**
 * Copy one plugin where Node resolves it from the profile and where its dependency spec points,
 * so a later package-manager run in the profile resolves it locally instead of from a registry.
 * @param profileDir - Desktop profile directory.
 * @param plugin - Plugin the build carries.
 */
function placeCopies(profileDir: string, plugin: BundledPlugin): void {
  for (const root of [join(profileDir, 'node_modules'), join(profileDir, PROFILE_COPY_DIRECTORY)]) {
    const destination = join(root, ...plugin.name.split('/'))
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 })
    rmSync(destination, { recursive: true, force: true })
    cpSync(plugin.directory, destination, { recursive: true, dereference: true })
  }
}

function removeCopy(root: string, name: string): void {
  rmSync(join(root, ...name.split('/')), { recursive: true, force: true })
}

/**
 * @param path - JSON file.
 * @returns the parsed value, or undefined when the file does not exist.
 * @throws when the file exists but does not parse.
 */
function readJson(path: string): unknown {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    throw new Error(`desktop bundled plugins: ${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFileAtomic(path, `${JSON.stringify(value, undefined, 2)}\n`, { mode: 0o600 })
}
