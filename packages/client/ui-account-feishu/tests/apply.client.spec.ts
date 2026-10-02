// @vitest-environment jsdom
/** The Feishu account UI inside the shipped client composition: launcher and Settings seats over one stream. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, expect, vi } from 'vitest'
import { ClientRoster, createClientTest, webApp, type TestClient } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/index.ts'
import type { AccountView } from '@deepseek-ai/dsh-deepseek-account/types'
import type { FeishuAccountFace } from '../src/client/index.ts'

const manifest = JSON.parse(readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8')) as {
  name: string
  dsh: { client: { inject: string[] } }
}
const it = createClientTest({ roster: ClientRoster.of([...webApp.rows, {
  name: manifest.name, inject: manifest.dsh.client.inject, immediately: false,
}]) })
const view: AccountView = { status: 'signed-out', links: { usageUrl: '', topUpUrl: '' }, attempt: null }

function face(c: TestClient, slot: 'settings.launcher' | 'settings.section'): FeishuAccountFace {
  const entry = slot === 'settings.launcher'
    ? c.ctx.slots.entries('settings.launcher')[0]!
    : c.ctx.slots.entries('settings.section').find(candidate => candidate.options.id === 'account')!
  const injected: object = entry.inject!()
  return injected as FeishuAccountFace
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('shares one account session between the sidebar launcher and the Settings page', async ({ start, mock }) => {
  const c = await start()
  const launcher = face(c, 'settings.launcher')
  const settings = face(c, 'settings.section')
  expect(launcher.hooks.session).toBe(settings.hooks.session)
  mock.remote.account.getProfile.mockResolvedValue({ ok: true, value: { status: 'ready', value: { id: null, name: 'Ada', contact: null } } })
  c.mock.streams.push('account/watch', { ...view, status: 'credential-stored' })
  await vi.waitFor(() => { expect(launcher.hooks.session.getSnapshot().profile?.name).toBe('Ada') })
  vi.stubGlobal('__DSH_TRANSPORT__', { streamBaseUrl: 'http://127.0.0.1:19387' })
  mock.remote.account.startSignIn.mockResolvedValue({ ok: true, value: view })
  await settings.signIn()
  expect(mock.remote.account.startSignIn).toHaveBeenLastCalledWith(expect.anything(), 'http://127.0.0.1:19387', 'desktop')
}, 60_000)
