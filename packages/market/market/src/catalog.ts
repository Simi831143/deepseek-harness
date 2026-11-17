/** Validation of the published catalog file and its URL rules. */
import { z } from 'zod'
import { MarketIndexError, parseMarketIndex, type MarketPlugin, type MarketVersion } from '@deepseek-ai/dsh-plugin-market-index'
import type { MarketCatalog, MarketCatalogItem, MarketKindName } from './types.ts'

/**
 * Item id grammar shared by every kind: a skill name, an MCP server name and a
 * credential key segment must all accept it.
 */
export const MARKET_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
/** Longest id; MCP server names stop at 32 characters. */
export const MARKET_ID_MAX_LENGTH = 32

const KINDS = ['skill', 'expert', 'connector'] as const satisfies readonly MarketKindName[]

const textSchema = z.object({ zh: z.string().min(1), en: z.string().min(1).optional() })
const idSchema = z.string().max(MARKET_ID_MAX_LENGTH).regex(MARKET_ID)
const relativePathSchema = z.string().min(1).refine(isPlainRelativePath, 'must be a relative path without ".." segments')

const itemSchema = z.object({
  kind: z.enum(KINDS),
  id: idSchema,
  version: z.string().min(1),
  name: textSchema,
  description: textSchema,
  category: z.string().min(1).optional(),
  tags: z.array(z.string().min(1)).optional(),
  icon: relativePathSchema.optional(),
  // No upper bound: the publisher caps the count, and a later raise must not make older clients refuse the catalog.
  examples: z.array(textSchema).optional(),
  package: z.object({
    path: relativePathSchema,
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    size: z.number().int().nonnegative(),
  }).optional(),
}).loose()

const catalogSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string(),
  categories: z.array(z.object({ kind: z.enum(KINDS), id: z.string().min(1), name: textSchema })).default([]),
  featured: z.array(z.object({ kind: z.enum(KINDS), id: idSchema })).default([]),
  items: z.array(itemSchema),
  format: z.unknown().optional(),
  plugins: z.unknown().optional(),
})

/** A catalog file that could not be accepted. */
export class MarketCatalogError extends Error {
  override name = 'MarketCatalogError'
}

/**
 * Parse and validate catalog text. Duplicate `(kind, id)` pairs reject the whole file.
 * @param text - catalog file content, optionally including the published plugin index.
 * @param catalogUrl - URL used to resolve plugin sources; required when the catalog includes plugins.
 * @returns the validated catalog.
 * @throws MarketCatalogError when the text is not a schema 1 catalog.
 */
export function parseCatalog(text: string, catalogUrl?: string): MarketCatalog {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    throw new MarketCatalogError(`catalog is not JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  const parsed = catalogSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new MarketCatalogError(`catalog is invalid at ${issue?.path.join('.') ?? '?'}: ${issue?.message ?? 'unknown issue'}`)
  }
  const seen = new Set<string>()
  for (const item of parsed.data.items) {
    const key = itemKey(item)
    if (seen.has(key)) throw new MarketCatalogError(`catalog lists ${key} more than once`)
    seen.add(key)
  }
  const catalog: MarketCatalog = parsed.data as MarketCatalog
  if (parsed.data.plugins === undefined && parsed.data.format === undefined) return catalog
  if (catalogUrl === undefined) throw new MarketCatalogError('catalog URL is required to resolve plugin sources')
  try {
    const index = parseMarketIndex(raw, catalogUrl)
    const items = index.plugins.map((plugin) => {
      const version = plugin.versions[0]
      if (version === undefined) throw new MarketCatalogError(`${plugin.name} has no published version`)
      return pluginItem(plugin, version)
    })
    const categories = Object.entries(index.metadata.categories).map(([id, value]) => ({
      kind: 'plugin' as const, id, name: marketText(value.title, id),
    }))
    return { ...catalog, items: [...catalog.items, ...items], categories: [...catalog.categories, ...categories] }
  } catch (error) {
    if (!(error instanceof MarketIndexError)) throw error
    throw new MarketCatalogError(error.message, { cause: error })
  }
}

/**
 * Project a validated plugin version into the shared market catalog.
 * @param plugin - plugin identity, display metadata and published versions.
 * @param version - exact published version to install.
 * @returns common catalog fields with the plugin metadata retained.
 */
export function pluginItem(plugin: MarketPlugin, version: MarketVersion): MarketCatalogItem {
  const source = version.source
  return {
    kind: 'plugin', id: plugin.name, version: version.version,
    name: marketText(plugin.title, plugin.name), description: marketText(plugin.description, plugin.name),
    ...plugin.icon === undefined ? {} : { icon: plugin.icon },
    ...plugin.metadata.category === undefined ? {} : { category: plugin.metadata.category },
    tags: plugin.metadata.keywords, plugin,
    ...source.type !== 'tarball' ? {} : { package: { path: source.path, size: source.size, sha256: source.sha256 } },
  }
}

function marketText(value: MarketPlugin['title'], fallback: string): { zh: string; en?: string } {
  if (typeof value === 'string') return { zh: value, en: value }
  const zh = value?.zh ?? value?.en ?? Object.values(value ?? {})[0] ?? fallback
  return { zh, ...value?.en === undefined ? {} : { en: value.en } }
}

/**
 * Key of one item across kinds.
 * @param item - kind and id.
 * @returns `<kind>:<id>`.
 */
export function itemKey(item: { readonly kind: MarketKindName; readonly id: string }): string {
  return `${item.kind}:${item.id}`
}

/**
 * Resolve a catalog-relative path. Only same-origin targets are accepted, so a
 * published catalog cannot point the client at another host.
 * @param catalogUrl - URL the catalog was fetched from.
 * @param path - relative path from the catalog.
 * @returns the absolute URL.
 * @throws MarketCatalogError when the result leaves the catalog's origin.
 */
export function resolveCatalogPath(catalogUrl: string, path: string): string {
  const base = new URL(catalogUrl)
  const target = new URL(path, base)
  if (target.origin !== base.origin) throw new MarketCatalogError(`catalog path ${path} leaves ${base.origin}`)
  return target.href
}

/**
 * Find one item.
 * @param catalog - validated catalog.
 * @param kind - item kind.
 * @param id - item id.
 * @returns the item, or undefined when the catalog does not list it.
 */
export function findItem(catalog: MarketCatalog, kind: MarketKindName, id: string): MarketCatalogItem | undefined {
  return catalog.items.find(item => item.kind === kind && item.id === id)
}

function isPlainRelativePath(path: string): boolean {
  if (path.startsWith('/') || path.startsWith('\\') || /^[a-z][a-z0-9+.-]*:/i.test(path)) return false
  return !path.split(/[/\\]/).includes('..')
}
