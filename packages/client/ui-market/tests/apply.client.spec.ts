// @vitest-environment jsdom
/** The market UI's generated Remote contributions mount on the real Client Remote service. */
import { Context } from '@deepseek-ai/cordis'
import { openConnectionWebSocket } from '@deepseek-ai/dsh-client-connection/src/client/socket.ts'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { apply, inject } from '@deepseek-ai/dsh-api-gateway/src/client/index.ts'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import marketRemote from '@deepseek-ai/dsh-market/remote'
import marketSkillsRemote from '@deepseek-ai/dsh-market-skills/remote'
import { expect, it, onTestFinished } from 'vitest'

// Every Remote method name must stay clear of the Client namespace service's own members
// (`install`, `remove`, `has`, …); a clash makes `$mount` refuse the whole namespace,
// which left the market entry failed at boot.
it('mounts the market and marketSkills namespaces', async () => {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(TypertRegistry)
  ctx.provide('connection', {
    interactions: 'answer',
    openWebSocket: openConnectionWebSocket,
    isLoopback: true,
    generation: { getSnapshot: () => undefined, subscribe: () => () => {} },
    state: { getSnapshot: () => undefined, subscribe: () => () => {} },
    reconnect: () => {},
    rpc: { call: () => Promise.reject(new Error('no Host in this test')) },
    registerGenerationSource: () => () => {},
    start: () => ({ stop: () => {} }),
  } satisfies ConnectionHandle)
  await ctx.plugin({ inject, apply })
  const disposeMarket = await ctx.remote.$mount(marketRemote)
  const disposeSkills = await ctx.remote.$mount(marketSkillsRemote)
  const market = ctx.get('remote.market') as Record<string, unknown>
  const skills = ctx.get('remote.marketSkills') as Record<string, unknown>
  for (const method of ['catalogSnapshot', 'refreshCatalog', 'installPackage', 'uninstallPackage', 'watch']) {
    expect(typeof market[method]).toBe('function')
  }
  for (const method of ['installed', 'setEnabled']) expect(typeof skills[method]).toBe('function')
  await disposeSkills()
  await disposeMarket()
})
