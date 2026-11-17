/** Read package identity from verified archives without extracting or running package contents. */
import { Parser } from 'tar'
import { z } from 'zod'

const manifestSchema = z.object({
  name: z.string(),
  version: z.string(),
  dsh: z.object({ bundle: z.object({ patch: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]) }) }),
})

/**
 * Require exactly one regular root package.json whose identity matches the selected market version and declares a bundle.
 * @param data - archive already verified against the catalog size and digest.
 * @param name - expected npm package name.
 * @param version - expected exact package version.
 * @param maxBytes - largest accepted package.json before parsing JSON.
 * @returns after the complete archive and its manifest have been read.
 * @throws when the archive, metadata, identity, or bundle declaration is invalid.
 */
export async function validateTarballManifest(data: Uint8Array, name: string, version: string, maxBytes: number): Promise<void> {
  let manifest: Buffer | undefined
  let count = 0
  await new Promise<void>((resolve, reject) => {
    const parser = new Parser({ strict: true, onReadEntry: (entry) => {
      const path = entry.path.replace(/^\.\//, '')
      if (/^[^/]+\/package\.json$/.test(path)) {
        count += 1
        if (count !== 1 || entry.type !== 'File' || entry.size > maxBytes) {
          parser.abort(new Error(`Invalid package manifest in ${name}@${version}`))
          return
        }
        const chunks: Buffer[] = []
        entry.on('data', (chunk: Buffer) => { chunks.push(chunk) })
        entry.on('end', () => { manifest = Buffer.concat(chunks) })
      }
      entry.resume()
    } })
    parser.once('error', reject)
    parser.once('end', resolve)
    parser.end(Buffer.from(data))
  })
  if (manifest === undefined || count !== 1) throw new Error(`${name}@${version} has no package manifest`)
  const raw: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifest))
  const parsed = manifestSchema.parse(raw)
  if (parsed.name !== name || parsed.version !== version) {
    throw new Error(`Market package ${name}@${version} contains ${parsed.name}@${parsed.version}`)
  }
}
