/**
 * Connector settings outside a running program: reading `settings.json` from a package
 * directory, and the credential record that holds the saved values.
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'
import { ConnectorSettingStore, digestOf } from '../src/setting-store.ts'
import { ConnectorSettingsError, parseConnectorSettings, readConnectorSettings } from '../src/settings.ts'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const step of cleanup.splice(0).reverse()) await step() })

const key = { env: 'LAB_API_KEY', label: { zh: '密钥' } }

describe('readConnectorSettings', () => {
  async function packageDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-connector-settings-'))
    cleanup.push(() => rm(dir, { recursive: true, force: true }))
    return dir
  }

  it('reads nothing from a package without settings.json, and the declaration from one with it', async () => {
    const dir = await packageDir()
    expect(await readConnectorSettings(dir)).toEqual([])
    await writeFile(join(dir, 'settings.json'), JSON.stringify({ settings: [{ ...key, description: { zh: '可选', en: 'Optional' } }] }))
    expect(await readConnectorSettings(dir)).toEqual([
      { env: 'LAB_API_KEY', label: { zh: '密钥' }, description: { zh: '可选', en: 'Optional' }, secret: true, required: false },
    ])
  })

  it('reports a settings.json that cannot be read', async () => {
    const dir = await packageDir()
    // A directory in the file's place fails the read with something other than ENOENT.
    await mkdir(join(dir, 'settings.json'))
    await expect(readConnectorSettings(dir)).rejects.toThrow(/cannot be read/)
  })

  it('names the root when the whole file has the wrong type', () => {
    expect(() => parseConnectorSettings('[]')).toThrow(new ConnectorSettingsError('settings.json is invalid at (root): Invalid input: expected object, received array'))
  })
})

describe('ConnectorSettingStore', () => {
  async function store() {
    const ctx = new Context()
    cleanup.push(() => ctx.fiber.dispose())
    await ctx.plugin(MemoryCredentials)
    return { ctx, store: new ConnectorSettingStore(ctx) }
  }

  it('keeps only declared values, merges changes, and drops the record once it is empty', async () => {
    const { ctx, store: settings } = await store()
    const recordKey = credentialKey('market-connectors', 'lab')
    expect(await settings.read('lab', [])).toEqual({})
    expect(await settings.read('lab', [{ ...key, secret: true, required: false }])).toEqual({})

    await settings.write('lab', { LAB_API_KEY: 'k1', LAB_OLD: 'stale' })
    await settings.write('lab', { LAB_REGION: 'cn' })
    expect(await ctx.credentials.readRecord(recordKey)).toEqual({ kind: 'api-key', env: { LAB_API_KEY: 'k1', LAB_OLD: 'stale', LAB_REGION: 'cn' } })
    expect(await settings.read('lab', [
      { ...key, secret: true, required: false }, { env: 'LAB_REGION', label: { zh: '区域' }, secret: false, required: false },
    ])).toEqual({ LAB_API_KEY: 'k1', LAB_REGION: 'cn' })

    await settings.write('lab', { LAB_API_KEY: null, LAB_OLD: null, LAB_REGION: null })
    expect(await ctx.credentials.readRecord(recordKey)).toBeUndefined()
  })

  it('ignores a record of another kind or without values', async () => {
    const { ctx, store: settings } = await store()
    const specs = [{ ...key, secret: true, required: false }]
    await ctx.credentials.modifyRecord(credentialKey('market-connectors', 'lab'), () => Promise.resolve({ kind: 'grant', payload: { token: 'x' } }))
    expect(await settings.read('lab', specs)).toEqual({})
    await ctx.credentials.modifyRecord(credentialKey('market-connectors', 'lab'), () => Promise.resolve({ kind: 'api-key' }))
    expect(await settings.read('lab', specs)).toEqual({})
    await settings.write('lab', { LAB_API_KEY: 'k' })
    expect(await ctx.credentials.readRecord(credentialKey('market-connectors', 'lab'))).toEqual({ kind: 'api-key', env: { LAB_API_KEY: 'k' } })
    // Writing over a record of another kind starts from no values.
    await ctx.credentials.modifyRecord(credentialKey('market-connectors', 'other'), () => Promise.resolve({ kind: 'grant', payload: {} }))
    await settings.write('other', { LAB_API_KEY: 'k' })
    expect(await ctx.credentials.readRecord(credentialKey('market-connectors', 'other'))).toEqual({ kind: 'api-key', env: { LAB_API_KEY: 'k' } })
  })

  it('maps only its own records back to a connector', () => {
    expect(ConnectorSettingStore.connectorOf(credentialKey('market-connectors', 'context7'))).toBe('context7')
    expect(ConnectorSettingStore.connectorOf(credentialKey('feishu-account', 'default'))).toBeUndefined()
  })

  it('digests values independently of their order and changes with any value', () => {
    expect(digestOf({ A: '1', B: '2' })).toBe(digestOf({ B: '2', A: '1' }))
    expect(digestOf({ A: '1', B: '2' })).not.toBe(digestOf({ A: '1', B: '3' }))
    expect(digestOf({ A: 'ctx7sk-secret' })).toMatch(/^[0-9a-f]{64}$/)
  })
})
