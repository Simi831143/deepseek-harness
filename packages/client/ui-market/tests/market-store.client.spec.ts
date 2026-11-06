/** The market store follows the Host stream and reports each outcome once. */
import type { MarketSnapshot } from '@deepseek-ai/dsh-market/types'
import type { ConnectorView, ConnectorsValue } from '@deepseek-ai/dsh-market-connectors/types'
import type { InstalledSkillsValue } from '@deepseek-ai/dsh-market-skills/types'
import { expect, it, vi } from 'vitest'
import { createMarketStore, type MarketRemote } from '../src/client/market-store.ts'

function snapshot(patch: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return { revision: 1, source: 'remote', categories: [], featured: [], items: [], kinds: ['skill'], installing: [], progress: [], ...patch }
}

const installed: InstalledSkillsValue = {
  complete: true,
  skills: [{ name: 'office-docx', description: 'Word', origin: 'user', enabled: true }],
}

function remote(frames: MarketSnapshot[], patch: Partial<MarketRemote> = {}): MarketRemote {
  return {
    async *watch() { for (const value of frames) yield { value, accept: () => {} } },
    install: vi.fn(() => Promise.resolve({ ok: true as const, value: snapshot({ revision: 2 }) })),
    uninstall: vi.fn(() => Promise.resolve({ ok: true as const, value: snapshot({ revision: 3 }) })),
    refresh: vi.fn(() => Promise.resolve({ ok: true as const, value: snapshot() })),
    installedSkills: vi.fn(() => Promise.resolve({ ok: true as const, value: installed })),
    setSkillsEnabled: vi.fn(() => Promise.resolve({ ok: true as const, value: installed })),
    skillDocument: vi.fn(() => Promise.resolve({ ok: true as const, value: { name: 'office-docx', content: '# Word' } })),
    uninstallPersonal: vi.fn(() => Promise.resolve({ ok: true as const, value: { complete: true, skills: [] } })),
    canReveal: vi.fn(() => Promise.resolve({ ok: true as const, value: true })),
    reveal: vi.fn(() => Promise.resolve({ ok: true as const, value: { opened: true } })),
    async *watchConnectors() { /* no connector kind */ },
    connectorList: vi.fn(() => Promise.resolve({ ok: true as const, value: { revision: 1, connectors: [] } })),
    setConnectorEnabled: vi.fn(() => Promise.resolve({ ok: true as const, value: { revision: 1, connectors: [] } })),
    retryConnector: vi.fn(() => Promise.resolve({ ok: true as const, value: { revision: 1, connectors: [] } })),
    parseCustomConnectors: vi.fn(() => Promise.resolve({ ok: true as const, value: { entries: [] } })),
    saveCustomConnector: vi.fn(() => Promise.resolve({ ok: true as const, value: { revision: 1, connectors: [] } })),
    removeCustomConnector: vi.fn(() => Promise.resolve({ ok: true as const, value: { revision: 1, connectors: [] } })),
    saveConnectorSettings: vi.fn(() => Promise.resolve({ ok: true as const, value: { revision: 1, connectors: [] } })),
    ...patch,
  }
}

const echoLab: ConnectorView = { id: 'echo-lab', origin: 'market', enabled: true, confirmed: true, state: 'connected', launch: { command: 'server.cmd', args: [] } }

it('follows the connector stream and keeps a connector busy only while its switch is written', async () => {
  let release!: () => void
  const pending = new Promise<void>((resolve) => { release = resolve })
  const setConnectorEnabled = vi.fn(async () => {
    await pending
    return { ok: true as const, value: { revision: 1, connectors: [echoLab] } }
  })
  const store = createMarketStore(remote([], {
    async *watchConnectors() { yield { value: { revision: 1, connectors: [{ ...echoLab, enabled: false, state: 'off' as const }] }, accept: () => {} } },
    setConnectorEnabled,
  }))
  await vi.waitFor(() => { expect(store.state.getSnapshot().connectors?.connectors[0]?.state).toBe('off') })
  const write = store.setConnectorEnabled('echo-lab', true, true, 'Echo')
  expect(store.state.getSnapshot().connectorBusy).toEqual(['echo-lab'])
  release()
  expect(await write).toBe(true)
  expect(setConnectorEnabled).toHaveBeenCalledWith({ id: 'echo-lab', enabled: true, confirmed: true })
  expect(store.state.getSnapshot()).toMatchObject({ connectorBusy: [], connectors: { revision: 1, connectors: [echoLab] } })
})

it('reports a connector switch the Host refused and leaves acceptance out of a plain switch', async () => {
  const setConnectorEnabled = vi.fn(() => Promise.resolve({ ok: false as const, error: { message: 'connector echo-lab runs a program the user has not accepted' } }))
  const store = createMarketStore(remote([], { setConnectorEnabled }))
  expect(await store.setConnectorEnabled('echo-lab', true, false, 'Echo')).toBe(false)
  expect(setConnectorEnabled).toHaveBeenCalledWith({ id: 'echo-lab', enabled: true })
  expect(store.state.getSnapshot().notice).toMatchObject({ kind: 'connect-failed', name: 'Echo' })
})

it('keeps a newer stream frame over a retry result that arrives late, and takes every frame after a Host restart', async () => {
  const failed: ConnectorView = { ...echoLab, state: 'failed', error: 'connection refused' }
  const frames: { readonly value: ConnectorsValue; accept(): void }[] = []
  let wake: (() => void) | undefined
  const push = (value: ConnectorsValue): void => { frames.push({ value, accept: () => {} }); wake?.() }
  let answer!: (value: ConnectorsValue) => void
  const retryConnector = vi.fn(() => new Promise<{ ok: true; value: ConnectorsValue }>((resolve) => {
    answer = (value) => { resolve({ ok: true, value }) }
  }))
  const store = createMarketStore(remote([], {
    async *watchConnectors() {
      for (;;) {
        const frame = frames.shift()
        if (frame === undefined) await new Promise<void>((resolve) => { wake = resolve })
        else yield frame
      }
    },
    retryConnector,
  }))
  push({ revision: 3, connectors: [failed] })
  await vi.waitFor(() => { expect(store.state.getSnapshot().connectors?.revision).toBe(3) })
  const retry = store.retryConnector('echo-lab', 'Echo')
  // The retry began at revision 4 and failed again at 5; the stream reports 5 before the call returns.
  push({ revision: 5, connectors: [failed] })
  await vi.waitFor(() => { expect(store.state.getSnapshot().connectors?.revision).toBe(5) })
  answer({ revision: 4, connectors: [{ ...echoLab, state: 'starting' }] })
  await retry
  expect(store.state.getSnapshot().connectors).toEqual({ revision: 5, connectors: [failed] })

  // A restarted Host counts from the start again; its stream frames still apply.
  push({ revision: 1, connectors: [echoLab] })
  await vi.waitFor(() => { expect(store.state.getSnapshot().connectors).toEqual({ revision: 1, connectors: [echoLab] }) })
})

it('saves a custom connector, returns a refusal to the form, and reports a deletion', async () => {
  const custom: ConnectorView = {
    id: 'custom-time', origin: 'custom', enabled: true, confirmed: true, state: 'starting', launch: { command: 'uvx', args: ['mcp-server-time'] },
    custom: { name: 'time', transport: 'stdio', command: 'uvx', args: ['mcp-server-time'], env: {} },
  }
  const refusal = { code: 'market-connectors/name-taken', message: 'a custom connector is already named time', details: { name: 'time' } }
  const saveCustomConnector = vi.fn()
    .mockResolvedValueOnce({ ok: true as const, value: { revision: 1, connectors: [custom] } })
    .mockResolvedValueOnce({ ok: false as const, error: refusal })
  const removeCustomConnector = vi.fn()
    .mockResolvedValueOnce({ ok: true as const, value: { revision: 1, connectors: [] } })
    .mockResolvedValueOnce({ ok: false as const, error: { message: 'storage is read-only' } })
  const store = createMarketStore(remote([], { saveCustomConnector, removeCustomConnector }))
  const config = custom.custom as NonNullable<ConnectorView['custom']>
  expect(await store.saveCustomConnector({ config })).toEqual({ ok: true, value: { revision: 1, connectors: [custom] } })
  expect(store.state.getSnapshot().connectors).toEqual({ revision: 1, connectors: [custom] })
  expect(await store.saveCustomConnector({ config })).toEqual({ ok: false, error: refusal })
  // A refusal belongs to the form; it is not a toast.
  expect(store.state.getSnapshot().notice).toBeNull()

  expect(await store.removeCustomConnector('time')).toBe(true)
  expect(store.state.getSnapshot()).toMatchObject({ connectors: { revision: 1, connectors: [] }, notice: { kind: 'removed', name: 'time' } })
  expect(await store.removeCustomConnector('time')).toBe(false)
  expect(store.state.getSnapshot().notice).toMatchObject({ kind: 'remove-failed', name: 'time', reason: 'storage is read-only' })
  expect(removeCustomConnector).toHaveBeenCalledWith({ name: 'time' })
})

it('reads the connector list on demand', async () => {
  const store = createMarketStore(remote([], {
    connectorList: vi.fn(() => Promise.resolve({ ok: true as const, value: { revision: 1, connectors: [echoLab] } })),
  }))
  expect(await store.refreshConnectors()).toEqual({ revision: 1, connectors: [echoLab] })
  expect(store.state.getSnapshot().connectors).toEqual({ revision: 1, connectors: [echoLab] })
})

it('reads once whether the Host can show a folder, and treats a failed read as no', async () => {
  const able = createMarketStore(remote([]))
  expect(able.state.getSnapshot().canReveal).toBe(false)
  await vi.waitFor(() => { expect(able.state.getSnapshot().canReveal).toBe(true) })
  const canReveal = vi.fn(() => Promise.resolve({ ok: false as const, error: { message: 'offline' } }))
  const unable = createMarketStore(remote([], { canReveal }))
  await vi.waitFor(() => { expect(canReveal).toHaveBeenCalledOnce() })
  expect(unable.state.getSnapshot().canReveal).toBe(false)
})

it('deletes a personal skill, publishes the list after it, and reports a failure', async () => {
  const store = createMarketStore(remote([]))
  expect(await store.uninstallPersonal('camera-log', 'camera-log')).toBe(true)
  expect(store.state.getSnapshot()).toMatchObject({ installedSkills: { skills: [] }, notice: { kind: 'uninstalled', name: 'camera-log' } })
  const failing = createMarketStore(remote([], {
    uninstallPersonal: vi.fn(() => Promise.resolve({ ok: false as const, error: { message: 'EBUSY' } })),
  }))
  expect(await failing.uninstallPersonal('camera-log', 'camera-log')).toBe(false)
  expect(failing.state.getSnapshot().notice).toMatchObject({ kind: 'uninstall-failed', name: 'camera-log', reason: 'EBUSY' })
})

it('reveals a skill file and reports only a failed reveal', async () => {
  const reveal = vi.fn(() => Promise.resolve({ ok: true as const, value: { opened: true } }))
  const store = createMarketStore(remote([], { reveal }))
  await store.revealSkill('/home/me/.agents/skills/camera-log/SKILL.md', 'camera-log')
  expect(reveal).toHaveBeenCalledWith('/home/me/.agents/skills/camera-log/SKILL.md')
  expect(store.state.getSnapshot().notice).toBeNull()
  const failing = createMarketStore(remote([], { reveal: vi.fn(() => Promise.resolve({ ok: false as const, error: {} })) }))
  await failing.revealSkill('/missing/SKILL.md', 'camera-log')
  expect(failing.state.getSnapshot().notice).toMatchObject({ kind: 'reveal-failed', name: 'camera-log' })
})

it('publishes stream frames and marks a stream that failed', async () => {
  const store = createMarketStore(remote([], {
    async *watch() {
      yield { value: snapshot({ revision: 7 }), accept: () => {} }
      throw new Error('market stream ended')
    },
  }))
  await vi.waitFor(() => { expect(store.state.getSnapshot().streamFailed).toBe(true) })
  expect(store.state.getSnapshot().market?.revision).toBe(7)
  store.dispose()
})

it('reports a successful install and a failed one', async () => {
  const failing = remote([], {
    install: vi.fn(() => Promise.resolve({ ok: false as const, error: { message: 'package SHA-256 does not match' } })),
  })
  const store = createMarketStore(failing)
  expect(await store.install({ kind: 'skill', id: 'pdf-cjk' }, 'pdf-cjk')).toBe(false)
  expect(store.state.getSnapshot().notice).toMatchObject({ kind: 'install-failed', name: 'pdf-cjk', reason: 'package SHA-256 does not match' })
  store.dismissNotice()
  expect(store.state.getSnapshot().notice).toBeNull()

  const working = createMarketStore(remote([]))
  expect(await working.install({ kind: 'skill', id: 'pdf-cjk' }, 'pdf-cjk')).toBe(true)
  expect(working.state.getSnapshot()).toMatchObject({ market: { revision: 2 }, notice: { kind: 'installed', name: 'pdf-cjk' } })
})

it('loads installed skills and keeps the switch busy only while the write runs', async () => {
  let release!: () => void
  const pending = new Promise<void>((resolve) => { release = resolve })
  const setSkillsEnabled = vi.fn(async () => { await pending; return { ok: true as const, value: installed } })
  const backend = remote([], { setSkillsEnabled })
  const store = createMarketStore(backend)
  await store.loadInstalledSkills()
  expect(store.state.getSnapshot().installedSkills).toBe(installed)
  const write = store.setSkillsEnabled(['office-docx'], false)
  expect(store.state.getSnapshot().switching).toEqual(['office-docx'])
  release()
  await write
  expect(store.state.getSnapshot().switching).toEqual([])
  expect(setSkillsEnabled).toHaveBeenCalledWith({ names: ['office-docx'], enabled: false })
})

it('reads a skill document through the Remote by name', async () => {
  const skillDocument = vi.fn(() => Promise.resolve({ ok: true as const, value: { name: 'office-docx', content: '# Word' } }))
  const store = createMarketStore(remote([], { skillDocument }))
  expect(await store.readSkillDocument('office-docx')).toEqual({ ok: true, value: { name: 'office-docx', content: '# Word' } })
  expect(skillDocument).toHaveBeenCalledWith({ name: 'office-docx' })
})

it('rereads the installed list when an install changes the installed set', async () => {
  const before = snapshot({ items: [] })
  const after = snapshot({ revision: 2, items: [{ kind: 'skill', id: 'pdf-cjk', version: '1', name: { zh: 'p' }, description: { zh: 'd' }, installedVersion: '1' }] })
  let push!: (value: MarketSnapshot) => void
  const installedSkills = vi.fn(() => Promise.resolve({ ok: true as const, value: installed }))
  const backend = remote([], {
    installedSkills,
    async *watch() {
      yield { value: before, accept: () => {} }
      const next = await new Promise<MarketSnapshot>((resolve) => { push = resolve })
      yield { value: next, accept: () => {} }
      await new Promise(() => {})
    },
  })
  const store = createMarketStore(backend)
  await vi.waitFor(() => { expect(store.state.getSnapshot().market).toBe(before) })
  await store.loadInstalledSkills()
  expect(installedSkills).toHaveBeenCalledTimes(1)
  push(after)
  await vi.waitFor(() => { expect(installedSkills).toHaveBeenCalledTimes(2) })
  store.dispose()
})

it('saves connector settings, shows the result, and leaves a refusal to the form', async () => {
  const withKey: ConnectorView = { ...echoLab, settings: [{ env: 'LAB_API_KEY', label: { zh: 'API key' }, secret: true, required: false, configured: true }] }
  const refusal = { code: 'market-connectors/invalid-setting', message: 'too long' }
  const saveConnectorSettings = vi.fn()
    .mockResolvedValueOnce({ ok: true as const, value: { revision: 2, connectors: [withKey] } })
    .mockResolvedValueOnce({ ok: false as const, error: refusal })
  const store = createMarketStore(remote([], { saveConnectorSettings }))
  expect(await store.saveConnectorSettings('echo-lab', { LAB_API_KEY: 'k' })).toEqual({ ok: true, value: { revision: 2, connectors: [withKey] } })
  expect(saveConnectorSettings).toHaveBeenCalledWith({ id: 'echo-lab', values: { LAB_API_KEY: 'k' } })
  expect(store.state.getSnapshot()).toMatchObject({ connectors: { revision: 2, connectors: [withKey] }, connectorBusy: [] })
  expect(await store.saveConnectorSettings('echo-lab', { LAB_API_KEY: null })).toEqual({ ok: false, error: refusal })
  expect(store.state.getSnapshot().notice).toBeNull()
})
