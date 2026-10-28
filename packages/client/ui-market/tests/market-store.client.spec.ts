/** The market store follows the Host stream and reports each outcome once. */
import type { MarketSnapshot } from '@deepseek-ai/dsh-market/types'
import type { InstalledSkillsValue } from '@deepseek-ai/dsh-market-skills/types'
import { expect, it, vi } from 'vitest'
import { createMarketStore, type MarketRemote } from '../src/client/market-store.ts'

function snapshot(patch: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return { revision: 1, source: 'remote', categories: [], featured: [], items: [], kinds: ['skill'], installing: [], ...patch }
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
    ...patch,
  }
}

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
