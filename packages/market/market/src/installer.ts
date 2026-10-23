/** Download, verification and atomic placement of one market package. */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { extractArchive, MarketArchiveError, within } from './archive.ts'
import type { MarketCatalogItem, MarketKindName } from './types.ts'

/** Locations and timing shared by every install. */
export interface InstallerOptions {
  /** `<market home>/packages`. */
  readonly packagesRoot: string
  /** `<market home>/tmp`, emptied on start. */
  readonly stagingRoot: string
  /** Deadline for one download. */
  readonly downloadTimeoutMs: number
  /** How long a rename keeps retrying while an endpoint scanner holds a handle. */
  readonly renameRetryMs: number
}

/** Checks the kind's domain package runs on the unpacked directory before it is placed. */
export type ValidateUnpacked = (directory: string, item: MarketCatalogItem) => Promise<void>

/**
 * Directory that holds one installed item.
 * @param packagesRoot - `<market home>/packages`.
 * @param kind - item kind.
 * @param id - item id, already validated against the id grammar.
 * @returns the absolute directory.
 */
export function itemDirectory(packagesRoot: string, kind: MarketKindName, id: string): string {
  return within(packagesRoot, kind, id)
}

/**
 * Download one package, verify size and SHA-256, unpack it, let the domain
 * package validate it, and swap it into place. A failure at any step leaves the
 * previous install untouched and removes the staging directory.
 * @param url - absolute package URL.
 * @param item - catalog entry with its package reference.
 * @param validate - domain check of the unpacked directory.
 * @param options - locations and timing.
 * @param signal - cancellation.
 * @returns the installed directory.
 * @throws MarketArchiveError or a download error naming the failed step.
 */
export async function installPackage(
  url: string,
  item: MarketCatalogItem,
  validate: ValidateUnpacked,
  options: InstallerOptions,
  signal: AbortSignal,
): Promise<string> {
  const ref = item.package
  if (ref === undefined) throw new MarketArchiveError(`${item.kind}:${item.id} has no package to install`)
  const data = await download(url, ref.size, options, signal)
  const digest = createHash('sha256').update(data).digest('hex')
  if (digest !== ref.sha256) throw new MarketArchiveError(`package SHA-256 ${digest} does not match the catalog`)
  await mkdir(options.stagingRoot, { recursive: true })
  const staging = join(options.stagingRoot, randomUUID())
  try {
    await extractArchive(data, staging)
    signal.throwIfAborted()
    await validate(staging, item)
    signal.throwIfAborted()
    const target = itemDirectory(options.packagesRoot, item.kind, item.id)
    await mkdir(join(options.packagesRoot, item.kind), { recursive: true })
    const previous = `${staging}.previous`
    let moved = false
    try {
      await renameWithRetry(target, previous, options.renameRetryMs)
      moved = true
    } catch (error) {
      if (!isMissing(error)) throw error
    }
    try {
      await renameWithRetry(staging, target, options.renameRetryMs)
    } catch (error) {
      if (moved) await renameWithRetry(previous, target, options.renameRetryMs)
      throw error
    }
    if (moved) await rm(previous, { recursive: true, force: true })
    return target
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

/**
 * Remove one installed item's directory. An absent directory is not an error.
 * @param packagesRoot - `<market home>/packages`.
 * @param kind - item kind.
 * @param id - item id.
 */
export async function removePackage(packagesRoot: string, kind: MarketKindName, id: string): Promise<void> {
  await rm(itemDirectory(packagesRoot, kind, id), { recursive: true, force: true })
}

async function download(url: string, size: number, options: InstallerOptions, signal: AbortSignal): Promise<Uint8Array> {
  const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(options.downloadTimeoutMs)]), redirect: 'error' })
  if (!response.ok) throw new MarketArchiveError(`package download returned HTTP ${response.status}`)
  if (response.body === null) throw new MarketArchiveError('package download returned no body')
  const chunks: Uint8Array[] = []
  let received = 0
  for await (const chunk of response.body) {
    received += chunk.byteLength
    if (received > size) {
      await response.body.cancel().catch(() => undefined)
      throw new MarketArchiveError('package download is larger than the catalog says')
    }
    chunks.push(chunk)
  }
  if (received !== size) throw new MarketArchiveError(`package download is ${received} bytes; the catalog says ${size}`)
  const data = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    data.set(chunk, offset)
    offset += chunk.byteLength
  }
  return data
}

/** Rename, retrying while Windows reports the path busy (endpoint scanners hold fresh files briefly). */
async function renameWithRetry(from: string, to: string, retryMs: number): Promise<void> {
  const deadline = Date.now() + retryMs
  for (;;) {
    try {
      await rename(from, to)
      return
    } catch (error) {
      if (!isBusy(error) || Date.now() >= deadline) throw error
      await new Promise(resolve => setTimeout(resolve, 250))
    }
  }
}

function isBusy(error: unknown): boolean {
  const code = errorCode(error)
  return code === 'EPERM' || code === 'EACCES' || code === 'EBUSY'
}

function isMissing(error: unknown): boolean {
  return errorCode(error) === 'ENOENT'
}

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
}
