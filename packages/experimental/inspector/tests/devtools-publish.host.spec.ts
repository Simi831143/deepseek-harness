/** DevTools publication retries only transient Windows interference and retains complete staging. */
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { publishFrontend } from '../scripts/devtools/publish.ts'

const state = vi.hoisted(() => ({
  source: '', target: '', attempts: 0, failures: [] as string[],
  firstAttempt: undefined as (() => void) | undefined,
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rename: async (...args: Parameters<typeof actual.rename>) => {
      if (args[0] === state.source && args[1] === state.target) {
        state.attempts += 1
        state.firstAttempt?.()
        const code = state.failures.shift()
        if (code !== undefined) throw Object.assign(new Error('injected publication failure'), { code })
      }
      return actual.rename(...args)
    },
  }
})

const roots: string[] = []

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  state.source = ''
  state.target = ''
  state.attempts = 0
  state.failures.length = 0
  state.firstAttempt = undefined
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 20 })))
})

async function fixture(): Promise<{ root: string; temporary: string; output: string; firstAttempt: Promise<undefined> }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-devtools-publish-'))
  roots.push(root)
  const temporary = join(root, 'devtools.build')
  const output = join(root, 'devtools')
  await mkdir(temporary)
  await mkdir(output)
  await writeFile(join(temporary, 'frontend.js'), 'complete new frontend')
  await writeFile(join(temporary, 'resource-manifest.json'), 'new manifest')
  await writeFile(join(output, 'old.js'), 'previous frontend')
  state.source = temporary
  state.target = output
  const firstAttempt = Promise.withResolvers<undefined>()
  state.firstAttempt = () => { firstAttempt.resolve(undefined) }
  return { root, temporary, output, firstAttempt: firstAttempt.promise }
}

it('publishes all staged files and removes obsolete output', async () => {
  const { root, temporary, output } = await fixture()
  await publishFrontend(temporary, output)
  expect(await readdir(root)).toEqual(['devtools'])
  expect((await readdir(output)).sort()).toEqual(['frontend.js', 'resource-manifest.json'])
  expect(await readFile(join(output, 'frontend.js'), 'utf8')).toBe('complete new frontend')
})

it('retries Windows EPERM, EBUSY and EACCES before publishing the complete directory', async () => {
  const { temporary, output, firstAttempt } = await fixture()
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  vi.useFakeTimers()
  state.failures.push('EPERM', 'EBUSY', 'EACCES')
  const published = publishFrontend(temporary, output)
  await firstAttempt
  expect(await readFile(join(temporary, 'frontend.js'), 'utf8')).toBe('complete new frontend')
  await vi.runAllTimersAsync()
  await published
  expect(state.attempts).toBe(4)
  expect((await readdir(output)).sort()).toEqual(['frontend.js', 'resource-manifest.json'])
  expect(await readFile(join(output, 'resource-manifest.json'), 'utf8')).toBe('new manifest')
})

it('rejects persistent Windows contention after a bounded interval and leaves staging to its owner', async () => {
  const { temporary, output, firstAttempt } = await fixture()
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  vi.useFakeTimers()
  state.failures.push(...Array.from({ length: 9 }, () => 'EPERM'))
  const published = publishFrontend(temporary, output)
  const rejected = expect(published).rejects.toMatchObject({ code: 'EPERM' })
  await firstAttempt
  await vi.runAllTimersAsync()
  await rejected
  expect(state.attempts).toBe(9)
  expect(await readFile(join(temporary, 'frontend.js'), 'utf8')).toBe('complete new frontend')
})

it.each<{ platform: NodeJS.Platform; code: string }>([
  { platform: 'linux', code: 'EPERM' },
  { platform: 'win32', code: 'ENOSPC' },
])('rejects $code on $platform without retrying', async ({ platform, code }) => {
  const { temporary, output } = await fixture()
  vi.spyOn(process, 'platform', 'get').mockReturnValue(platform)
  state.failures.push(code)
  await expect(publishFrontend(temporary, output)).rejects.toMatchObject({ code })
  expect(state.attempts).toBe(1)
  expect(await readFile(join(temporary, 'frontend.js'), 'utf8')).toBe('complete new frontend')
})
