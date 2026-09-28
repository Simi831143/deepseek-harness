import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BUNDLED_PLUGIN_MARKER, listBundledPlugins, reconcileBundledPlugins } from '../src/bundled-plugins.ts'

const temporary: string[] = []
const WEB_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']

function scratch(): string {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-bundled-plugin-'))
  temporary.push(directory)
  return directory
}

/** Write one payload directory the way packaging ships it. */
function writePayload(payloadRoot: string, name: string, version = '1.0.0'): string {
  const source = join(payloadRoot, name)
  mkdirSync(source, { recursive: true })
  writeFileSync(join(source, 'package.json'), `${JSON.stringify({ name, version })}\n`)
  writeFileSync(join(source, 'cordis.patch.yml'), '[]\n')
  return source
}

interface ProfileManifest {
  name: string
  private: boolean
  dependencies?: Record<string, string>
  dsh: { profile: { bundles: string[] } }
}

function readManifest(profile: string): ProfileManifest {
  return JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8')) as ProfileManifest
}

function writeProfile(profile: string, manifest: Partial<ProfileManifest> = {}): void {
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(profile, 'package.json'), `${JSON.stringify({
    name: 'dsh-profile-desktop', private: true, dsh: { profile: { bundles: [...WEB_BUNDLES] } }, ...manifest,
  }, undefined, 2)}\n`)
}

function writeMarker(profile: string, recorded: Record<string, string>): void {
  writeFileSync(join(profile, BUNDLED_PLUGIN_MARKER), `${JSON.stringify({ schemaVersion: 1, recorded })}\n`)
}

afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('bundled plugin payloads', () => {
  it('adds a payload to a profile that has never seen it', () => {
    const payloadRoot = scratch()
    const profile = scratch()
    writePayload(payloadRoot, 'acme-bundle')
    writeProfile(profile)

    expect(reconcileBundledPlugins(profile, payloadRoot)).toEqual(['acme-bundle'])
    expect(readManifest(profile).dependencies).toEqual({ 'acme-bundle': 'file:./bundled-plugins/acme-bundle' })
    expect(readManifest(profile).dsh.profile.bundles).toEqual([...WEB_BUNDLES, 'acme-bundle'])
    expect(existsSync(join(profile, 'node_modules', 'acme-bundle', 'cordis.patch.yml'))).toBe(true)
    expect(existsSync(join(profile, 'bundled-plugins', 'acme-bundle', 'package.json'))).toBe(true)
    expect(JSON.parse(readFileSync(join(profile, BUNDLED_PLUGIN_MARKER), 'utf8'))).toMatchObject({
      recorded: { 'acme-bundle': '1.0.0' },
    })
  })

  it('reaches an existing profile when a later build introduces a plugin', () => {
    const payloadRoot = scratch()
    const profile = scratch()
    writePayload(payloadRoot, 'already-shipped')
    writeProfile(profile, {
      dependencies: { 'already-shipped': 'file:./bundled-plugins/already-shipped' },
      dsh: { profile: { bundles: [...WEB_BUNDLES, 'already-shipped'] } },
    })
    mkdirSync(join(profile, 'node_modules', 'already-shipped'), { recursive: true })
    writeFileSync(join(profile, 'node_modules', 'already-shipped', 'package.json'), '{"name":"already-shipped","version":"1.0.0"}\n')
    writeMarker(profile, { 'already-shipped': '1.0.0' })

    // The next release carries one more payload.
    writePayload(payloadRoot, 'added-later')
    expect(reconcileBundledPlugins(profile, payloadRoot)).toEqual(['added-later'])
    expect(readManifest(profile).dsh.profile.bundles).toEqual([...WEB_BUNDLES, 'already-shipped', 'added-later'])
    expect(readManifest(profile).dependencies).toEqual({
      'already-shipped': 'file:./bundled-plugins/already-shipped',
      'added-later': 'file:./bundled-plugins/added-later',
    })
  })

  it('keeps a plugin the profile removed removed', () => {
    const payloadRoot = scratch()
    const profile = scratch()
    writePayload(payloadRoot, 'removed-bundle')
    writeProfile(profile, {
      dependencies: {},
      dsh: { profile: { bundles: [...WEB_BUNDLES] } },
    })
    writeMarker(profile, { 'removed-bundle': '1.0.0' })

    expect(reconcileBundledPlugins(profile, payloadRoot)).toEqual([])
    expect(existsSync(join(profile, 'node_modules', 'removed-bundle'))).toBe(false)
    expect(readManifest(profile).dsh.profile.bundles).toEqual([...WEB_BUNDLES])
  })

  it('refreshes a held payload in place when the build carries a newer version', () => {
    const payloadRoot = scratch()
    const profile = scratch()
    writePayload(payloadRoot, 'held-bundle', '2.0.0')
    writeProfile(profile, {
      dependencies: { 'held-bundle': 'file:./bundled-plugins/held-bundle' },
      dsh: { profile: { bundles: [...WEB_BUNDLES, 'held-bundle'] } },
    })
    mkdirSync(join(profile, 'node_modules', 'held-bundle'), { recursive: true })
    writeFileSync(join(profile, 'node_modules', 'held-bundle', 'package.json'), '{"name":"held-bundle","version":"1.0.0"}\n')
    writeMarker(profile, { 'held-bundle': '1.0.0' })

    expect(reconcileBundledPlugins(profile, payloadRoot)).toEqual([])
    expect(JSON.parse(readFileSync(join(profile, 'node_modules', 'held-bundle', 'package.json'), 'utf8')))
      .toMatchObject({ version: '2.0.0' })
    expect(JSON.parse(readFileSync(join(profile, BUNDLED_PLUGIN_MARKER), 'utf8')))
      .toMatchObject({ recorded: { 'held-bundle': '2.0.0' } })
  })

  it('leaves a held payload alone while the recorded version is the one this build carries', () => {
    const payloadRoot = scratch()
    const profile = scratch()
    writePayload(payloadRoot, 'held-bundle', '1.0.0')
    writeProfile(profile, {
      dependencies: { 'held-bundle': 'file:./bundled-plugins/held-bundle' },
      dsh: { profile: { bundles: [...WEB_BUNDLES, 'held-bundle'] } },
    })
    const installed = join(profile, 'node_modules', 'held-bundle')
    mkdirSync(installed, { recursive: true })
    writeFileSync(join(installed, 'package.json'), '{"name":"held-bundle","version":"1.0.0"}\n')
    writeFileSync(join(installed, 'profile-local.txt'), 'kept\n')
    writeMarker(profile, { 'held-bundle': '1.0.0' })
    const before = readFileSync(join(profile, 'package.json'), 'utf8')

    expect(reconcileBundledPlugins(profile, payloadRoot)).toEqual([])
    // A fresh copy would have replaced the directory, so a file the profile added survives.
    expect(existsSync(join(installed, 'profile-local.txt'))).toBe(true)
    expect(readFileSync(join(profile, 'package.json'), 'utf8')).toBe(before)
  })

  it('lists only real payloads and ignores an absent root', () => {
    const payloadRoot = scratch()
    mkdirSync(join(payloadRoot, 'not-a-package'), { recursive: true })
    writePayload(payloadRoot, 'real-bundle')
    const profile = scratch()
    writeProfile(profile)

    expect(listBundledPlugins(payloadRoot).map(payload => payload.name)).toEqual(['real-bundle'])
    expect(listBundledPlugins(join(payloadRoot, 'missing'))).toEqual([])
    expect(reconcileBundledPlugins(profile, undefined)).toEqual([])
    expect(existsSync(join(profile, 'node_modules'))).toBe(false)
  })
})
