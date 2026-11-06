/** Safe extraction of one market package archive into a staging directory. */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { unzipSync } from 'fflate'

/** An archive that cannot be installed. */
export class MarketArchiveError extends Error {
  override name = 'MarketArchiveError'
}

/**
 * Unpack a zip into `destination`. Absolute paths, `..` segments, drive letters
 * and backslash paths are refused before any file is written, and symbolic-link
 * entries are not recreated (a zip stores them as plain files, which are written
 * as such). Size and file count are not capped: packages come from the
 * self-published market only. A single top-level directory is stripped, so
 * `name/SKILL.md` and `SKILL.md` produce the same layout.
 * @param data - archive bytes.
 * @param destination - empty directory that receives the files.
 * @param written - called after each file is written with the count so far and the total.
 * @returns relative paths of the written files.
 * @throws MarketArchiveError when the archive is malformed, empty, or unsafe.
 */
export async function extractArchive(
  data: Uint8Array, destination: string, written: (done: number, total: number) => void = () => {},
): Promise<string[]> {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(data)
  } catch (error) {
    throw new MarketArchiveError(`package is not a valid zip: ${error instanceof Error ? error.message : String(error)}`)
  }
  const files = Object.entries(entries).filter(([name]) => !name.endsWith('/'))
  if (files.length === 0) throw new MarketArchiveError('package is empty')
  for (const [name] of files) assertSafeEntryName(name)
  const prefix = commonTopDirectory(files.map(([name]) => name))
  const root = resolve(destination)
  const paths: string[] = []
  for (const [name, content] of files) {
    const relativePath = name.slice(prefix.length)
    if (relativePath.length === 0) continue
    const target = resolve(root, ...relativePath.split('/'))
    if (target !== root && !target.startsWith(root + sep)) throw new MarketArchiveError(`package entry ${name} leaves the package directory`)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content)
    paths.push(relativePath)
    written(paths.length, files.length)
  }
  return paths
}

function assertSafeEntryName(name: string): void {
  if (name.includes('\\') || name.startsWith('/') || /^[a-z]:/i.test(name) || name.includes('\0')) {
    throw new MarketArchiveError(`package entry ${JSON.stringify(name)} has an unsafe path`)
  }
  if (name.split('/').some(segment => segment === '..' || segment === '.')) {
    throw new MarketArchiveError(`package entry ${JSON.stringify(name)} has an unsafe path`)
  }
}

/** The single top-level directory every entry shares, with its trailing slash, or ''. */
function commonTopDirectory(names: readonly string[]): string {
  const first = names[0]?.split('/')[0]
  if (first === undefined || names.some(name => !name.includes('/'))) return ''
  return names.every(name => name.split('/')[0] === first) ? `${first}/` : ''
}

/**
 * Join under a root and refuse escapes; used for item directories named by ids.
 * @param root - trusted directory.
 * @param segments - path segments below it.
 * @returns the joined absolute path.
 */
export function within(root: string, ...segments: string[]): string {
  const base = resolve(root)
  const target = resolve(join(base, ...segments))
  if (!target.startsWith(base + sep)) throw new MarketArchiveError(`path ${segments.join('/')} leaves ${base}`)
  return target
}
