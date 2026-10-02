import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BUNDLED_PLUGIN_LEDGER, reconcileBundledPlugins } from '../src/bundled-plugins.ts'

const temporary: string[] = []
const WEB_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']

function scratch(): string {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-bundled-plugin-'))
  temporary.push(directory)
  return directory
}

/** One plugin a fixture build carries; the digest stands for its content. */
interface ShippedPlugin {
  name: string
  version?: string
  digest?: string
}

/**
 * Write a build's bundled content the way preparation lays it out.
 * @param content - Content directory to replace.
 * @param plugins - Plugins the build carries.
 * @returns the content directory.
 */
function writeBuild(content: string, plugins: readonly ShippedPlugin[]): string {
  rmSync(content, { recursive: true, force: true })
  mkdirSync(content, { recursive: true })
  const records = plugins.map(({ name, version = '1.0.0', digest = `sha256-${version}` }) => {
    const directory = join(content, 'plugins', ...name.split('/'))
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'package.json'), `${JSON.stringify({ name, version })}\n`)
    writeFileSync(join(directory, 'index.js'), `export const release = ${JSON.stringify(digest)}\n`)
    return { name, version, digest, checkout: name }
  })
  writeFileSync(join(content, 'manifest.json'), `${JSON.stringify({ schemaVersion: 1, skills: [], plugins: records })}\n`)
  return content
}

interface ProfileManifest {
  name: string
  private: boolean
  dependencies: Record<string, string>
  dsh: { profile: { bundles: string[] } }
}

function readManifest(profile: string): ProfileManifest {
  return JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8')) as ProfileManifest
}

function readLedger(profile: string): unknown {
  return JSON.parse(readFileSync(join(profile, BUNDLED_PLUGIN_LEDGER), 'utf8'))
}

function writeProfile(profile: string, manifest: Partial<ProfileManifest> = {}): void {
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(profile, 'package.json'), `${JSON.stringify({
    name: 'dsh-profile-desktop', private: true, dependencies: {}, dsh: { profile: { bundles: [...WEB_BUNDLES] } }, ...manifest,
  }, undefined, 2)}\n`)
}

function installedRelease(profile: string, name: string): string {
  return readFileSync(join(profile, 'node_modules', ...name.split('/'), 'index.js'), 'utf8')
}

afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('bundled plugin reconciliation', () => {
  it('installs and enables every plugin on a profile that has been given none', async () => {
    const content = writeBuild(scratch(), [{ name: 'acme-bundle' }, { name: '@acme/scoped-bundle' }])
    const profile = scratch()
    writeProfile(profile)

    expect(await reconcileBundledPlugins(profile, content)).toEqual({
      installed: ['acme-bundle', '@acme/scoped-bundle'], updated: [], removed: [],
    })
    expect(readManifest(profile).dependencies).toEqual({
      'acme-bundle': 'file:./bundled-plugins/acme-bundle',
      '@acme/scoped-bundle': 'file:./bundled-plugins/@acme/scoped-bundle',
    })
    expect(readManifest(profile).dsh.profile.bundles).toEqual([...WEB_BUNDLES, 'acme-bundle', '@acme/scoped-bundle'])
    for (const root of ['node_modules', 'bundled-plugins']) {
      expect(existsSync(join(profile, root, '@acme', 'scoped-bundle', 'package.json'))).toBe(true)
    }
    expect(readLedger(profile)).toEqual({
      schemaVersion: 1,
      plugins: {
        '@acme/scoped-bundle': { version: '1.0.0', digest: 'sha256-1.0.0' },
        'acme-bundle': { version: '1.0.0', digest: 'sha256-1.0.0' },
      },
    })
  })

  it('gives an existing profile the plugin a newer build introduces', async () => {
    const content = scratch()
    const profile = scratch()
    writeProfile(profile)
    await reconcileBundledPlugins(profile, writeBuild(content, [{ name: 'first' }]))

    expect(await reconcileBundledPlugins(profile, writeBuild(content, [{ name: 'first' }, { name: 'second' }])))
      .toEqual({ installed: ['second'], updated: [], removed: [] })
    expect(readManifest(profile).dsh.profile.bundles).toEqual([...WEB_BUNDLES, 'first', 'second'])
  })

  it('replaces the code of a plugin whose content changed and keeps its enabled state and configuration', async () => {
    const content = scratch()
    const profile = scratch()
    writeProfile(profile)
    await reconcileBundledPlugins(profile, writeBuild(content, [{ name: 'acme-bundle' }]))
    // The user disables the plugin and configures it.
    const manifest = readManifest(profile)
    writeProfile(profile, { ...manifest, dsh: { profile: { bundles: [...WEB_BUNDLES] } } })
    writeFileSync(join(profile, 'cordis.patch.yml'), '- id: acme\n  config:\n    region: eu\n')

    // A rebuild with the same version but different content is still an update.
    expect(await reconcileBundledPlugins(profile, writeBuild(content, [{ name: 'acme-bundle', digest: 'sha256-rebuilt' }])))
      .toEqual({ installed: [], updated: ['acme-bundle'], removed: [] })
    expect(installedRelease(profile, 'acme-bundle')).toContain('sha256-rebuilt')
    expect(readManifest(profile).dsh.profile.bundles).toEqual([...WEB_BUNDLES])
    expect(readFileSync(join(profile, 'cordis.patch.yml'), 'utf8')).toBe('- id: acme\n  config:\n    region: eu\n')

    // Installing an older build rolls the code back the same way.
    expect((await reconcileBundledPlugins(profile, writeBuild(content, [{ name: 'acme-bundle' }]))).updated).toEqual(['acme-bundle'])
    expect(installedRelease(profile, 'acme-bundle')).toContain('sha256-1.0.0')
  })

  it('writes nothing while the profile holds the copy this build carries, and restores a missing copy', async () => {
    const content = writeBuild(scratch(), [{ name: 'acme-bundle' }])
    const profile = scratch()
    writeProfile(profile)
    await reconcileBundledPlugins(profile, content)
    const manifest = readFileSync(join(profile, 'package.json'), 'utf8')
    const ledger = readFileSync(join(profile, BUNDLED_PLUGIN_LEDGER), 'utf8')

    expect(await reconcileBundledPlugins(profile, content)).toEqual({ installed: [], updated: [], removed: [] })
    expect(readFileSync(join(profile, 'package.json'), 'utf8')).toBe(manifest)
    expect(readFileSync(join(profile, BUNDLED_PLUGIN_LEDGER), 'utf8')).toBe(ledger)

    rmSync(join(profile, 'node_modules'), { recursive: true })
    expect((await reconcileBundledPlugins(profile, content)).updated).toEqual(['acme-bundle'])
    expect(installedRelease(profile, 'acme-bundle')).toContain('sha256-1.0.0')
  })

  it('keeps a plugin the profile removed removed, through updates, withdrawal, and reintroduction', async () => {
    const content = scratch()
    const profile = scratch()
    writeProfile(profile)
    await reconcileBundledPlugins(profile, writeBuild(content, [{ name: 'acme-bundle' }]))
    // The plugin manager's removal drops the dependency and the resolvable copy.
    writeProfile(profile)
    rmSync(join(profile, 'node_modules', 'acme-bundle'), { recursive: true })

    const unchanged = { installed: [], updated: [], removed: [] }
    expect(await reconcileBundledPlugins(profile, writeBuild(content, [{ name: 'acme-bundle', version: '2.0.0' }]))).toEqual(unchanged)
    expect(await reconcileBundledPlugins(profile, writeBuild(content, []))).toEqual(unchanged)
    expect(await reconcileBundledPlugins(profile, writeBuild(content, [{ name: 'acme-bundle', version: '3.0.0' }]))).toEqual(unchanged)
    expect(readManifest(profile).dependencies).toEqual({})
    expect(readManifest(profile).dsh.profile.bundles).toEqual([...WEB_BUNDLES])
    expect(existsSync(join(profile, 'node_modules', 'acme-bundle'))).toBe(false)
    expect(existsSync(join(profile, 'bundled-plugins', 'acme-bundle'))).toBe(false)
  })

  it('never touches a same-named plugin the user installed another way', async () => {
    const content = writeBuild(scratch(), [{ name: 'acme-bundle', version: '2.0.0' }])
    const profile = scratch()
    writeProfile(profile, { dependencies: { 'acme-bundle': '^1.0.0' }, dsh: { profile: { bundles: [...WEB_BUNDLES, 'acme-bundle'] } } })
    mkdirSync(join(profile, 'node_modules', 'acme-bundle'), { recursive: true })
    writeFileSync(join(profile, 'node_modules', 'acme-bundle', 'index.js'), 'registry release\n')

    expect(await reconcileBundledPlugins(profile, content)).toEqual({ installed: [], updated: [], removed: [] })
    expect(installedRelease(profile, 'acme-bundle')).toBe('registry release\n')
    expect(await reconcileBundledPlugins(profile, writeBuild(content, []))).toEqual({ installed: [], updated: [], removed: [] })
    expect(readManifest(profile).dependencies).toEqual({ 'acme-bundle': '^1.0.0' })
    expect(existsSync(join(profile, BUNDLED_PLUGIN_LEDGER))).toBe(false)
  })

  it('removes a plugin this build no longer carries and keeps its configuration', async () => {
    const content = scratch()
    const profile = scratch()
    writeProfile(profile)
    await reconcileBundledPlugins(profile, writeBuild(content, [{ name: 'kept' }, { name: 'withdrawn' }]))
    writeFileSync(join(profile, 'cordis.patch.yml'), '- id: withdrawn\n  config:\n    region: eu\n')

    expect(await reconcileBundledPlugins(profile, writeBuild(content, [{ name: 'kept' }])))
      .toEqual({ installed: [], updated: [], removed: ['withdrawn'] })
    expect(readManifest(profile).dependencies).toEqual({ kept: 'file:./bundled-plugins/kept' })
    expect(readManifest(profile).dsh.profile.bundles).toEqual([...WEB_BUNDLES, 'kept'])
    for (const root of ['node_modules', 'bundled-plugins']) expect(existsSync(join(profile, root, 'withdrawn'))).toBe(false)
    expect(readLedger(profile)).toEqual({ schemaVersion: 1, plugins: { kept: { version: '1.0.0', digest: 'sha256-1.0.0' } } })
    expect(readFileSync(join(profile, 'cordis.patch.yml'), 'utf8')).toContain('region: eu')

    // A later build that brings it back installs it again.
    expect((await reconcileBundledPlugins(profile, writeBuild(content, [{ name: 'kept' }, { name: 'withdrawn' }]))).installed)
      .toEqual(['withdrawn'])
  })

  it('treats an owned plugin as the build\'s own even when the profile lost its ledger', async () => {
    const content = scratch()
    const profile = scratch()
    writeProfile(profile)
    await reconcileBundledPlugins(profile, writeBuild(content, [{ name: 'shipped' }, { name: 'withdrawn' }]))
    rmSync(join(profile, BUNDLED_PLUGIN_LEDGER))

    expect(await reconcileBundledPlugins(profile, writeBuild(content, [{ name: 'shipped' }])))
      .toEqual({ installed: [], updated: ['shipped'], removed: ['withdrawn'] })
    expect(readManifest(profile).dependencies).toEqual({ shipped: 'file:./bundled-plugins/shipped' })
  })

  it('fails instead of guessing when the build record or the ledger is unreadable', async () => {
    const content = scratch()
    const profile = scratch()
    writeProfile(profile)
    await expect(reconcileBundledPlugins(profile, content)).rejects.toThrow('manifest.json is missing')

    writeBuild(content, [{ name: 'acme-bundle' }])
    writeFileSync(join(profile, BUNDLED_PLUGIN_LEDGER), '{broken')
    await expect(reconcileBundledPlugins(profile, content)).rejects.toThrow('is not valid JSON')
    writeFileSync(join(profile, BUNDLED_PLUGIN_LEDGER), '{"schemaVersion":2,"plugins":{}}')
    await expect(reconcileBundledPlugins(profile, content)).rejects.toThrow('is not a schema 1 ledger')
    expect(readManifest(profile).dependencies).toEqual({})
  })
})
