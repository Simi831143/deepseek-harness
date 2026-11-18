/**
 * Host owner of the `credentials` Remote namespace: the reference half of
 * `ctx.credentials` as a browser configuration page reads and writes it.
 *
 * @module @deepseek-ai/dsh-api-settings-controller/src/credentials.ts
 */

import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { CredentialInfo } from '@deepseek-ai/dsh-credentials/types'
import { stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { openNativePath, revealNativePath } from '@deepseek-ai/dsh-native-command'
import { z } from 'zod'

/**
 * Fan-out bound on one remote `describe` batch. A settings page asks about the
 * references its own rows name, so this is far above any real page and still
 * keeps one authenticated request from starting unbounded provider work.
 */
const MAX_DESCRIBE_REFS = 64

const credentialRefSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
const describeRequestSchema = z.object({
  refs: z.array(credentialRefSchema).max(MAX_DESCRIBE_REFS),
})
const setRequestSchema = z.object({ ref: credentialRefSchema, value: z.string().min(1) })
const unsetRequestSchema = z.object({ ref: credentialRefSchema })

/** Parse the domain constraints that are more specific than generated TypeScript codecs. */
function parseRequest<T>(method: string, schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new RemoteError('gateway/bad-request', `invalid payload for ${method}`, { issues: parsed.error.issues })
  }
  return parsed.data
}

/** A failure's own message, or the thrown value itself when it is not an Error. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Whether a path names an existing regular file; an absent or unreadable path answers false. */
async function isFile(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined))?.isFile() === true
}

/** Whether a path names an existing directory; an absent or unreadable path answers false. */
async function isDirectory(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined))?.isDirectory() === true
}

/**
 * Copy exactly the fields {@link CredentialInfo} declares. The Gateway returns
 * a business result without decoding it, so a provider whose `describe` carried
 * extra enumerable properties would otherwise serialize them to the caller.
 * @param info - the provider's answer for one reference.
 * @returns the same facts with nothing else attached.
 */
function projectCredentialInfo(info: CredentialInfo): CredentialInfo {
  return {
    configured: info.configured,
    ...info.source === undefined ? {} : { source: info.source },
    writable: info.writable,
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `credentials` Remote namespace. */
    credentialsController: CredentialsController
  }
}

/**
 * Host service backing the generated `ctx.remote.credentials` namespace. It
 * carries every wire obligation the credential seam itself does not: the batch
 * fan-out bound, the field-by-field view projection, the reference-grammar
 * guard, and the refusal mapping. Secret values cross in one direction only —
 * no method here returns one.
 */
export class CredentialsController extends TypertRemoteService {
  /** @param ctx - Host context where a credential provider may be mounted. */
  constructor(ctx: Context) {
    super(ctx, 'credentialsController', { namespace: 'credentials' })
  }

  /**
   * Describe several references for one configuration surface. Batched because
   * a settings page describes every reference its rows name at once, and one
   * round trip keeps those rows from settling separately.
   * @param refs - reference names, at most {@link MAX_DESCRIBE_REFS}; a name outside the grammar
   *   rejects the whole call as `gateway/bad-request`.
   * @returns one view per requested name, keyed by that name.
   * @throws RemoteError when the request is invalid or no credential provider is mounted.
   */
  @Remote
  async describe(refs: string[]): Promise<Record<string, CredentialInfo>> {
    const request = parseRequest('credentials.describe', describeRequestSchema, { refs })
    const branded = request.refs.map(ref => [ref, credentialRef(ref)] as const)
    const credentials = this.provider()
    const entries = await Promise.all(branded.map(async ([ref, key]) =>
      [ref, projectCredentialInfo(await credentials.describe(key))] as const))
    return Object.fromEntries(entries)
  }

  /**
   * Store one value from a configuration surface. The value crosses the wire in
   * this direction only: no read path returns it.
   * @param ref - reference name to store under.
   * @param value - the non-empty secret value.
   * @throws RemoteError when the request is invalid, no provider is mounted, or the provider refuses the write.
   */
  @Remote
  async set(ref: string, value: string): Promise<void> {
    const request = parseRequest('credentials.set', setRequestSchema, { ref, value })
    const branded = credentialRef(request.ref)
    const credentials = this.provider()
    await this.write(request.ref, () => credentials.set(branded, request.value))
  }

  /**
   * Remove one reference from a configuration surface.
   * @param ref - reference name to remove.
   * @throws RemoteError when the request is invalid, no provider is mounted, or the provider refuses the write.
   */
  @Remote
  async unset(ref: string): Promise<void> {
    const request = parseRequest('credentials.unset', unsetRequestSchema, { ref })
    const branded = credentialRef(request.ref)
    const credentials = this.provider()
    await this.write(request.ref, () => credentials.unset(branded))
  }

  /**
   * Native file-manager integrations, replaceable by direct unit tests: `reveal`
   * opens a file's folder with the file selected, `openFolder` opens a folder.
   */
  static internals: {
    reveal?: (path: string, signal: AbortSignal) => Promise<void>
    openFolder?: (path: string, signal: AbortSignal) => Promise<void>
  } = {}

  /**
   * Open the folder holding the provider's own credential document in the
   * native file manager, with the document selected once it exists; before the
   * first write creates it, the folder opens alone. The browser supplies no
   * path and receives none back, and nothing is read from the document.
   * @param signal - caller lifetime; abort terminates the native command.
   * @throws RemoteError when no provider is mounted, the provider keeps no local
   *   document, its folder does not exist, opening fails, or the caller aborts.
   */
  @Remote
  async revealDocument(signal: AbortSignal): Promise<void> {
    const filename = this.provider().filename
    if (filename === undefined) {
      throw new RemoteError('gateway/internal', 'the mounted credential provider keeps no local document', {})
    }
    if (signal.aborted) throw new RemoteError('gateway/cancelled', 'credential document reveal was aborted', {})
    const { reveal = revealNativePath, openFolder = openNativePath } = CredentialsController.internals
    try {
      if (await isFile(filename)) {
        await reveal(filename, signal)
        return
      }
      const folder = dirname(filename)
      if (!await isDirectory(folder)) throw new Error(`${folder} does not exist yet`)
      await openFolder(folder, signal)
    } catch (error: unknown) {
      if (signal.aborted) throw new RemoteError('gateway/cancelled', 'credential document reveal was aborted', {})
      throw new RemoteError('gateway/internal', `credential document reveal failed: ${messageOf(error)}`, {}, { cause: error })
    }
  }

  /** Resolve the optional provider or report how to supply it. */
  private provider(): CredentialProvider {
    const credentials = this.ctx.get('credentials')
    if (credentials === undefined) {
      throw new RemoteError(
        'gateway/internal',
        'credentials service is absent: this deployment does not mount a credential provider (e.g. @deepseek-ai/dsh-credentials-local) in its composition',
        {},
      )
    }
    return credentials
  }

  /**
   * Run one remote write and report every refusal as `credential/rejected`
   * carrying the seam's own message: a provider refusal, such as a stored
   * document that no longer parses, is what a settings page must show
   * verbatim. Callers brand the reference before entering, so a name outside
   * the grammar never reaches this path and fails the same way it does on the
   * read side. The details name only the reference, so no failure path can
   * carry the value back out.
   */
  private async write(ref: string, write: () => Promise<void>): Promise<void> {
    try {
      await write()
    } catch (error: unknown) {
      throw new RemoteError(
        'credential/rejected',
        error instanceof Error ? error.message : String(error),
        { ref },
        { cause: error },
      )
    }
  }
}

export default CredentialsController
