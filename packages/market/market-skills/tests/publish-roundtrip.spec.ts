/**
 * A catalog built by the lc-market publishing tool installs through the real
 * market core and skill kind. Skipped when the tool's demo build is absent;
 * produce it with `node publish.mjs --out dist` in a content checkout and point
 * LC_MARKET_DIST at the output.
 */
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, normalize } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Market from '@deepseek-ai/dsh-market'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { afterEach, expect, it, vi } from 'vitest'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import MarketSkills from '../src/index.ts'

const dist = process.env.LC_MARKET_DIST
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step()
})

it.skipIf(dist === undefined || !existsSync(join(dist ?? '', 'index.json')))('installs every skill a published catalog lists', async () => {
  const root = dist!
  const server = createServer((req, res) => {
    const path = normalize(new URL(req.url ?? '/', 'http://localhost').pathname.replace(/^\/market\//, ''))
    const file = join(root, path)
    if (!file.startsWith(root) || !existsSync(file)) { res.writeHead(404).end(); return }
    res.writeHead(200).end(readFileSync(file))
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  cleanup.push(() => new Promise<void>((resolve) => { server.close(() => { resolve() }) }))
  const home = await mkdtemp(join(tmpdir(), 'dsh-market-roundtrip-'))
  cleanup.push(() => rm(home, { recursive: true, force: true }))

  const ctx = new Context()
  cleanup.push(() => ctx.fiber.dispose())
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend())
  const storageDomain = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', storageDomain)
  ctx.provide('storageDomain', storageDomain)
  ctx.provide('typert', {})
  ctx.provide('workingDirectory', { defaultDirectory: home })
  await ctx.plugin(SkillRegistry, { disabled: [] })
  await ctx.plugin(Market, { catalogUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/market/index.json`, home })
  await ctx.plugin(MarketSkills)
  await vi.waitFor(() => { expect(ctx.market.catalogSnapshot().source).toBe('remote') })

  const skills = ctx.market.catalogSnapshot().items.filter(item => item.kind === 'skill')
  expect(skills.length).toBeGreaterThan(0)
  for (const item of skills) await ctx.market.installItem({ kind: 'skill', id: item.id })
  expect((await ctx.skills.list()).map(skill => skill.name).sort()).toEqual(skills.map(item => item.id).sort())
})
