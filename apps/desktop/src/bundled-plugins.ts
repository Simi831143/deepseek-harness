/** Plugin payloads a Desktop build carries, and the profile reconciliation that consumes them. */

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { readProfileManifest, writeProfileManifest } from '@deepseek-ai/dsh-app-boot'

/**
 * Resources subdirectory holding one directory per bundled plugin payload.
 *
 * Must agree with `BUNDLED_PLUGIN_DIRECTORY` in `scripts/bundled-plugins.mjs`, which decides
 * what the packaging step copies there. The two cannot share a module: the application
 * bundles from `src/`, and a build script cannot import TypeScript.
 */
export const BUNDLED_PLUGIN_DIRECTORY = 'plugins'

/** Profile-relative directory holding the copy a declared dependency points at. */
export const BUNDLED_PLUGIN_PROFILE_DIRECTORY = 'bundled-plugins'

/**
 * Profile file recording the payloads this installation has already offered.
 *
 * It separates the two cases a present payload cannot: a plugin added by a newer build, which
 * belongs in the profile, and a plugin the profile removed on purpose, which must stay removed.
 */
export const BUNDLED_PLUGIN_MARKER = '.desktop-bundled-plugins.json'

/** One payload a build carries. */
interface BundledPluginPayload {
  readonly name: string
  readonly version: string
  readonly directory: string
}

/** Plugin names the profile already holds, by version this installation last recorded. */
interface BundledPluginMarker {
  readonly recorded: Record<string, string>
}

/**
 * List the packaged plugin payloads: one package directory per bundled plugin.
 * @param payloadRoot - resources directory holding the payloads, or undefined when this build carries none.
 * @returns payloads in directory order.
 */
export function listBundledPlugins(payloadRoot: string | undefined): readonly BundledPluginPayload[] {
  if (payloadRoot === undefined || !existsSync(payloadRoot)) return []
  const payloads: BundledPluginPayload[] = []
  for (const entry of readdirSync(payloadRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const directory = join(payloadRoot, entry.name)
    const manifest = readJson(join(directory, 'package.json'))
    if (typeof manifest?.version !== 'string') continue
    payloads.push({ name: entry.name, version: manifest.version, directory })
  }
  return payloads.sort((left, right) => left.name.localeCompare(right.name))
}

function readJson(path: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}

function readMarker(profileDir: string): BundledPluginMarker {
  const parsed = readJson(join(profileDir, BUNDLED_PLUGIN_MARKER))
  const recorded = parsed?.recorded
  if (typeof recorded !== 'object' || recorded === null || Array.isArray(recorded)) return { recorded: {} }
  return { recorded: recorded as Record<string, string> }
}

function copyTree(source: string, destination: string): void {
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 })
  rmSync(destination, { recursive: true, force: true })
  cpSync(source, destination, { recursive: true, dereference: true })
}

/** Copy one payload where the profile resolves it and where its declared dependency points. */
function placePayload(profileDir: string, payload: BundledPluginPayload): void {
  copyTree(payload.directory, join(profileDir, 'node_modules', payload.name))
  copyTree(payload.directory, join(profileDir, BUNDLED_PLUGIN_PROFILE_DIRECTORY, payload.name))
}

/** The dependency spec a seeded plugin is recorded under, relative to the profile directory. */
function payloadSpec(name: string): string {
  return `file:./${BUNDLED_PLUGIN_PROFILE_DIRECTORY}/${name}`
}

/**
 * Bring a profile in line with the payloads this build carries.
 *
 * A payload the profile has never been offered is added — selected in `dsh.profile.bundles` and
 * declared as a dependency, which is what makes the plugin list show it and a registered
 * configuration card reachable. A payload the profile holds is refreshed when this build
 * carries a different version, so an application upgrade updates the plugin it ships. A payload
 * the profile removed is left removed and never re-added.
 *
 * Seeded plugins need no package installation: a bundled plugin declares no third-party
 * dependencies, and the runtime's resolution layer supplies the installation's copies of
 * anything it does import. The dependency names the profile's own copy so a later
 * package-manager run resolves locally instead of asking a registry for an unpublished package.
 * @param profileDir - the profile directory, whose manifest must already exist.
 * @param payloadRoot - resources directory holding the payloads, or undefined when this build carries none.
 * @returns the payloads this call added to the profile.
 */
export function reconcileBundledPlugins(profileDir: string, payloadRoot: string | undefined): readonly string[] {
  const payloads = listBundledPlugins(payloadRoot)
  if (payloads.length === 0) return []
  const marker = readMarker(profileDir)
  const manifest = readProfileManifest('dsh', profileDir)
  const dependencies: Record<string, string> = { ...manifest.dependencies }
  const bundles = [...(manifest.dsh?.profile?.bundles ?? [])]
  const added: string[] = []
  const refreshed: string[] = []

  for (const payload of payloads) {
    const recorded = marker.recorded[payload.name]
    const known = recorded !== undefined
    const held = dependencies[payload.name] !== undefined || existsSync(join(profileDir, 'node_modules', payload.name, 'package.json'))
    // A profile that removed the plugin keeps it removed; a payload it already runs at this
    // version is left untouched, so an upgrade copies only what actually changed.
    if (known && (!held || recorded === payload.version)) continue
    placePayload(profileDir, payload)
    refreshed.push(payload.name)
    if (!known) {
      added.push(payload.name)
      dependencies[payload.name] = payloadSpec(payload.name)
      if (!bundles.includes(payload.name)) bundles.push(payload.name)
    }
    marker.recorded[payload.name] = payload.version
  }

  if (added.length > 0 || refreshed.length > 0) {
    if (added.length > 0) {
      writeProfileManifest(profileDir, {
        ...manifest,
        dependencies,
        dsh: { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles } },
      })
    }
    writeFileSync(
      join(profileDir, BUNDLED_PLUGIN_MARKER),
      `${JSON.stringify({ schemaVersion: 1, recorded: marker.recorded }, undefined, 2)}\n`,
      { mode: 0o600 },
    )
  }
  return added
}
