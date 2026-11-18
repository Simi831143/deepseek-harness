import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { CredentialInfo } from '@deepseek-ai/dsh-credentials/types'
import { remoteErrorOf, remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import CredentialsController from '../src/credentials.ts'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'

/** A store whose `describe` carries more than the view declares, as a foreign provider might. */
class LeakyCredentials extends MemoryCredentials {
  override describe(): Promise<CredentialInfo> {
    return Promise.resolve(
      { configured: true, source: 'memory', writable: true, masked: '•'.repeat(9), value: 'sk-leaked', preview: 'sk…ed' } as CredentialInfo,
    )
  }
}

/** A store whose write rejects with a bare string, the way some client libraries do. */
class LiteralRejectingCredentials extends MemoryCredentials {
  override async set(): Promise<void> {
    throw 'the store refused'
  }
}

/** A store whose provider-owned policy rejects an otherwise valid write. */
class RejectingCredentials extends MemoryCredentials {
  override set(): Promise<void> {
    return Promise.reject(new Error('the stored document no longer parses'))
  }
}

/** A store whose document lives at a path the test chooses, as the local file provider's does. */
function documentAt(filename: string): typeof MemoryCredentials {
  return class extends MemoryCredentials {
    override get filename(): string { return filename }
  }
}

/** A fresh directory removed when the test ends. */
async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-credentials-reveal-'))
  onTestFinished(() => rm(dir, { recursive: true, force: true }))
  return dir
}

async function boot(
  seed: Record<string, string> = {},
  provider: typeof MemoryCredentials = MemoryCredentials,
): Promise<CredentialsController> {
  const ctx = new Context()
  await ctx.plugin(provider, seed)
  await ctx.plugin(CredentialsController)
  return ctx.credentialsController
}

describe('the credentials Remote namespace a configuration surface calls', () => {
  it('publishes the credentials namespace from its own service key', async () => {
    const controller = await boot()
    const binding = controller.typertRemote
    expect(binding.serviceKey).toBe('credentialsController')
    expect(binding.namespace).toBe('credentials')
    expect(remoteMethods(controller)).toEqual([
      { method: 'describe', invocation: { kind: 'direct' } },
      { method: 'set', invocation: { kind: 'direct' } },
      { method: 'unset', invocation: { kind: 'direct' } },
      { method: 'revealDocument', invocation: { kind: 'direct' } },
    ])
  })

  it('reports the actionable configuration error while no credential provider is mounted', async () => {
    const ctx = new Context()
    await ctx.plugin(CredentialsController)
    for (const call of [
      () => ctx.credentialsController.describe(['DEEPSEEK_API_KEY']),
      () => ctx.credentialsController.set('DEEPSEEK_API_KEY', 'sk-live'),
      () => ctx.credentialsController.unset('DEEPSEEK_API_KEY'),
      () => ctx.credentialsController.revealDocument(new AbortController().signal),
    ]) {
      const failure = await call().catch((error: unknown) => error)
      expect(remoteErrorOf(failure)).toMatchObject({
        code: 'gateway/internal',
        message: 'credentials service is absent: this deployment does not mount a credential provider (e.g. @deepseek-ai/dsh-credentials-local) in its composition',
        details: {},
      })
    }
  })

  it('describes a batch of references as one map, values excluded', async () => {
    const controller = await boot({ DEEPSEEK_API_KEY: 'sk-seeded' })
    const described = await controller.describe(['DEEPSEEK_API_KEY', 'OPENAI_API_KEY'])
    expect(described).toEqual({
      DEEPSEEK_API_KEY: { configured: true, source: 'memory', writable: true },
      OPENAI_API_KEY: { configured: false, writable: true },
    })
    expect(JSON.stringify(described)).not.toContain('sk-seeded')
  })

  it('reports an invalid reference as bad-request', async () => {
    const controller = await boot()
    for (const call of [
      () => controller.describe(['DEEPSEEK_API_KEY', 'not a var']),
      () => controller.set('not a var', 'sk-live'),
      () => controller.unset('not a var'),
    ]) {
      const failure = await call().catch((error: unknown) => error)
      expect(remoteErrorOf(failure)).toMatchObject({ code: 'gateway/bad-request' })
    }
  })

  it('answers the largest batch it accepts and reports one reference more as bad-request', async () => {
    const controller = await boot()
    const accepted = Array.from({ length: 64 }, (_unused, index) => `REF_${String(index)}`)
    expect(Object.keys(await controller.describe(accepted))).toHaveLength(64)
    const failure = await controller.describe([...accepted, 'REF_64']).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'gateway/bad-request' })
  })

  it('answers only the fields the view declares, whatever a provider returns', async () => {
    const controller = await boot({}, LeakyCredentials)
    const described = await controller.describe(['DEEPSEEK_API_KEY'])
    expect(described.DEEPSEEK_API_KEY).toEqual({ configured: true, source: 'memory', writable: true, masked: '•'.repeat(9) })
    expect(JSON.stringify(described)).not.toContain('sk-leaked')
    expect(JSON.stringify(described)).not.toContain('sk…ed')
  })

  it('stores and removes through the same references the batch describes', async () => {
    const controller = await boot()
    await controller.set('DEEPSEEK_API_KEY', 'sk-live')
    expect(await controller.describe(['DEEPSEEK_API_KEY']))
      .toEqual({ DEEPSEEK_API_KEY: { configured: true, source: 'memory', writable: true } })
    await controller.unset('DEEPSEEK_API_KEY')
    expect(await controller.describe(['DEEPSEEK_API_KEY']))
      .toEqual({ DEEPSEEK_API_KEY: { configured: false, writable: true } })
  })

  it('reports a refused write as credential/rejected naming only the reference', async () => {
    const controller = await boot({}, RejectingCredentials)
    const failure = await controller.set('DEEPSEEK_API_KEY', 'sk-live').catch((error: unknown) => error)
    const { code, message, details } = remoteErrorOf(failure) ?? {}
    expect(code).toBe('credential/rejected')
    expect(message).toContain('no longer parses')
    expect(details).toEqual({ ref: 'DEEPSEEK_API_KEY' })
  })

  it('reports an empty value as bad-request', async () => {
    const controller = await boot()
    const failure = await controller.set('DEEPSEEK_API_KEY', '').catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'gateway/bad-request' })
  })

  it('stringifies a refusal that is not an Error', async () => {
    const controller = await boot({}, LiteralRejectingCredentials)
    const failure = await controller.set('DEEPSEEK_API_KEY', 'sk-live').catch((error: unknown) => error)
    expect(remoteErrorOf(failure)?.message).toBe('the store refused')
  })
})

describe('revealing the credential document a configuration surface points at', () => {
  const reveal = vi.fn(async (_path: string, _signal: AbortSignal) => {})
  const openFolder = vi.fn(async (_path: string, _signal: AbortSignal) => {})
  beforeEach(() => { CredentialsController.internals = { reveal, openFolder } })
  afterEach(() => {
    CredentialsController.internals = {}
    reveal.mockReset()
    openFolder.mockReset()
  })

  it('selects an existing document in its folder and answers nothing about it', async () => {
    const dir = await scratch()
    const filename = join(dir, '.credentials.yaml')
    await writeFile(filename, 'version: 1\nrefs:\n  DEEPSEEK_API_KEY: sk-on-disk\n')
    const controller = await boot({}, documentAt(filename))
    const abort = new AbortController()
    await expect(controller.revealDocument(abort.signal)).resolves.toBeUndefined()
    expect(reveal).toHaveBeenCalledExactlyOnceWith(filename, abort.signal)
    expect(openFolder).not.toHaveBeenCalled()
  })

  it('opens the folder alone while the document has not been written yet', async () => {
    const dir = await scratch()
    const controller = await boot({}, documentAt(join(dir, '.credentials.yaml')))
    const abort = new AbortController()
    await controller.revealDocument(abort.signal)
    expect(openFolder).toHaveBeenCalledExactlyOnceWith(dir, abort.signal)
    expect(reveal).not.toHaveBeenCalled()
  })

  it('reports a folder that does not exist instead of opening something else', async () => {
    const dir = await scratch()
    const missing = join(dir, 'never-created')
    const controller = await boot({}, documentAt(join(missing, '.credentials.yaml')))
    const failure = await controller.revealDocument(new AbortController().signal).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'gateway/internal', message: `credential document reveal failed: ${missing} does not exist yet` })
    expect(openFolder).not.toHaveBeenCalled()
  })

  it('reports a provider that keeps no local document', async () => {
    const controller = await boot()
    const failure = await controller.revealDocument(new AbortController().signal).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'gateway/internal', message: 'the mounted credential provider keeps no local document' })
  })

  it('contains an opener failure and reports cancellation as cancelled', async () => {
    const dir = await scratch()
    const controller = await boot({}, documentAt(join(dir, '.credentials.yaml')))
    openFolder.mockRejectedValueOnce('no file manager')
    const failure = await controller.revealDocument(new AbortController().signal).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'gateway/internal', message: 'credential document reveal failed: no file manager' })

    const aborted = new AbortController()
    aborted.abort()
    await expect(controller.revealDocument(aborted.signal)).rejects.toMatchObject({ code: 'gateway/cancelled' })
    expect(openFolder).toHaveBeenCalledTimes(1)

    const during = new AbortController()
    openFolder.mockImplementationOnce(async () => {
      during.abort()
      throw new Error('terminated')
    })
    await expect(controller.revealDocument(during.signal)).rejects.toMatchObject({ code: 'gateway/cancelled' })
  })
})
