/** ZIP and Markdown extraction into a private, unpublished skill directory. */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { addAbortSignal, type Readable } from 'node:stream'
import { crc32 } from 'node:zlib'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { fromBuffer, type Entry, type ZipFile } from 'yauzl'
import type { SkillImportProblem, SkillImportRequest } from './types.ts'

/**
 * Decode and extract one upload without executing its contents.
 * @param request - canonical base64 ZIP or Markdown upload.
 * @param directory - private destination, outside the scanned skill roots.
 * @param signal - cancellation; extraction settles before rejection.
 * @throws RemoteError `market-skills/import-invalid` for invalid content.
 */
export async function extractSkillImport(
  request: SkillImportRequest, directory: string, signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted()
  const extension = /\.(zip|md)$/i.exec(request.fileName)?.[1]?.toLowerCase()
  if (extension === undefined) invalidImport('unsupported-file')
  if (request.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(request.data)) invalidImport('invalid-base64')
  const data = Buffer.from(request.data, 'base64')
  if (data.toString('base64') !== request.data) invalidImport('invalid-base64')
  if (extension === 'md') {
    try { new TextDecoder('utf-8', { fatal: true }).decode(data) } catch (_invalidUtf8) { invalidImport('invalid-skill') }
    await writeFile(join(directory, 'SKILL.md'), data, { mode: 0o600, flag: 'wx', signal })
    return
  }
  await extractZip(data, directory, signal)
}

/**
 * Reject an upload with a stable validation reason.
 * @param reason - condition the upload UI localizes.
 * @returns never; always throws the corresponding RemoteError.
 */
export function invalidImport(reason: SkillImportProblem): never {
  throw new RemoteError('market-skills/import-invalid', `invalid skill upload: ${reason}`, { reason })
}

async function openZip(data: Buffer): Promise<ZipFile> {
  return await new Promise((resolve, reject) => {
    fromBuffer(data, { lazyEntries: true, autoClose: false, strictFileNames: true, validateEntrySizes: true }, (error, zip) => {
      if (error !== null) reject(error)
      else resolve(zip)
    })
  })
}

async function entriesOf(zip: ZipFile, signal: AbortSignal): Promise<Entry[]> {
  return await new Promise((resolve, reject) => {
    const entries: Entry[] = []
    const finish = (error?: Error) => {
      zip.off('entry', entry)
      zip.off('end', end)
      zip.off('error', fail)
      signal.removeEventListener('abort', abort)
      if (error === undefined) resolve(entries)
      else reject(error)
    }
    const end = () => { finish() }
    const fail = (error: Error) => { finish(error) }
    const abort = () => { finish(signal.reason instanceof Error ? signal.reason : new Error('skill import cancelled')) }
    const entry = (value: Entry) => {
      try {
        signal.throwIfAborted()
        const kind = (value.externalFileAttributes >>> 16) & 0o170000
        if (kind !== 0 && kind !== 0o100000 && kind !== 0o040000) invalidImport('unsafe-path')
        if (kind === 0o040000 && !value.fileName.endsWith('/')) invalidImport('unsafe-path')
        if (value.fileName.endsWith('/') && (kind === 0o100000 || value.uncompressedSize !== 0)) invalidImport('unsafe-path')
        if (value.isEncrypted() || (value.compressionMethod !== 0 && value.compressionMethod !== 8)) invalidImport('invalid-archive')
        safePath(value.fileName)
        entries.push(value)
        zip.readEntry()
      } catch (error) { finish(error instanceof Error ? error : new Error('ZIP entry could not be read')) }
    }
    zip.on('entry', entry)
    zip.once('end', end)
    zip.once('error', fail)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    else zip.readEntry()
  })
}

function safePath(path: string): void {
  const value = path.endsWith('/') ? path.slice(0, -1) : path
  if (value.length === 0 || Buffer.byteLength(value) > 1024 || /[\\\x00-\x1f\x7f:*?"<>|]/.test(value)) invalidImport('unsafe-path')
  for (const part of value.split('/')) {
    if (part === '' || part === '.' || part === '..' || /[. ]$/.test(part) || Buffer.byteLength(part) > 255
      || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part)) invalidImport('unsafe-path')
  }
}

function importPaths(entries: readonly Entry[]): Map<Entry, string> {
  const files = entries.filter(entry => !entry.fileName.endsWith('/'))
  const root = files.some(entry => entry.fileName === 'SKILL.md') ? '' : files[0]?.fileName.split('/')[0]
  if (root === undefined || (root !== '' && !files.some(entry => entry.fileName === `${root}/SKILL.md`))) invalidImport('invalid-skill')
  const prefix = root === '' ? '' : `${root}/`
  const paths = new Map<Entry, string>()
  const seen = new Map<string, { path: string; file: boolean; explicit: boolean }>()
  for (const entry of entries) {
    if (!entry.fileName.startsWith(prefix)) invalidImport('invalid-skill')
    const path = entry.fileName.slice(prefix.length).replace(/\/$/, '')
    if (path === '') continue
    const parts = path.split('/')
    const file = !entry.fileName.endsWith('/')
    if (file && parts.at(-1)?.toLowerCase() === 'skill.md' && path !== 'SKILL.md') invalidImport('invalid-skill')
    for (let index = 0; index < parts.length; index += 1) {
      const segment = parts.slice(0, index + 1).join('/')
      const key = segment.normalize('NFC').toLowerCase()
      const explicit = index === parts.length - 1
      const isFile = explicit && file
      const previous = seen.get(key)
      if (previous !== undefined && (previous.path !== segment || previous.file || isFile || (explicit && previous.explicit))) invalidImport('unsafe-path')
      seen.set(key, { path: segment, file: isFile, explicit: explicit || previous?.explicit === true })
    }
    paths.set(entry, path)
  }
  return paths
}

async function readEntry(zip: ZipFile, entry: Entry, signal: AbortSignal): Promise<Buffer> {
  signal.throwIfAborted()
  const stream = await new Promise<Readable>((resolve, reject) => {
    zip.openReadStream(entry, (error, value) => {
      if (error !== null) reject(error)
      else resolve(value)
    })
  })
  addAbortSignal(signal, stream)
  const chunks: Buffer[] = []
  let size = 0
  let checksum = 0
  for await (const chunk of stream) {
    if (!Buffer.isBuffer(chunk)) invalidImport('invalid-archive')
    size += chunk.length
    if (size > entry.uncompressedSize) invalidImport('invalid-archive')
    checksum = crc32(chunk, checksum)
    chunks.push(chunk)
  }
  if (size !== entry.uncompressedSize || checksum !== entry.crc32) invalidImport('invalid-archive')
  return Buffer.concat(chunks, size)
}

async function extractZip(data: Buffer, directory: string, signal: AbortSignal): Promise<void> {
  let zip: ZipFile | undefined
  try {
    zip = await archiveRead(() => openZip(data), signal)
    const archive = zip
    const paths = importPaths(await archiveRead(() => entriesOf(archive, signal), signal))
    for (const [entry, path] of paths) {
      signal.throwIfAborted()
      const target = join(directory, path)
      if (entry.fileName.endsWith('/')) await mkdir(target, { recursive: true, mode: 0o700 })
      else {
        const data = await archiveRead(() => readEntry(archive, entry, signal), signal)
        if (path === 'SKILL.md') {
          try { new TextDecoder('utf-8', { fatal: true }).decode(data) } catch (_invalidUtf8) { invalidImport('invalid-skill') }
        }
        await mkdir(dirname(target), { recursive: true, mode: 0o700 })
        await writeFile(target, data, { mode: 0o600, flag: 'wx', signal })
      }
    }
  } finally {
    zip?.close()
  }
}

async function archiveRead<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  try { return await operation() } catch (error) {
    signal.throwIfAborted()
    if (error instanceof RemoteError) throw error
    invalidImport('invalid-archive')
  }
}
