/** JSON values of the `market` Remote namespace and the published catalog format. */
import type {} from '@deepseek-ai/dsh-typert-protocol'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The named item is not in the current catalog. */
    'market/not-found': { readonly kind: MarketKindName; readonly id: string }
    /** The item's package could not be downloaded, verified, unpacked, or validated. */
    'market/install-failed': { readonly kind: MarketKindName; readonly id: string; readonly reason: string }
    /** No domain package handles this kind of item in the running composition. */
    'market/kind-unavailable': { readonly kind: MarketKindName }
  }
}

/** Kinds of market item; each is owned by one domain package. */
export type MarketKindName = 'skill' | 'expert' | 'connector'

/** Text in each catalog language; `zh` is required, `en` falls back to `zh`. */
export interface MarketText {
  readonly zh: string
  readonly en?: string
}

/** One downloadable package referenced by a catalog item. */
export interface MarketPackageRef {
  /** Path relative to the catalog file, on the catalog's origin. */
  readonly path: string
  /** Lowercase hex SHA-256 of the whole package file. */
  readonly sha256: string
  /** Package size in bytes. */
  readonly size: number
}

/** One item in the published catalog. Fields beyond these belong to the item's domain package. */
export interface MarketCatalogItem {
  readonly kind: MarketKindName
  readonly id: string
  readonly version: string
  readonly name: MarketText
  readonly description: MarketText
  readonly category?: string
  readonly tags?: readonly string[]
  /** Image path relative to the catalog file, on the catalog's origin. */
  readonly icon?: string
  /** Example requests the detail view offers under "Try asking"; picking one installs the item and starts a conversation with it. */
  readonly examples?: readonly MarketText[]
  readonly package?: MarketPackageRef
}

/** One category chip for one kind. */
export interface MarketCategory {
  readonly kind: MarketKindName
  readonly id: string
  readonly name: MarketText
}

/** Reference to an item shown in the featured row. */
export interface MarketFeaturedRef {
  readonly kind: MarketKindName
  readonly id: string
}

/** The published catalog file, schema version 1. */
export interface MarketCatalog {
  readonly schemaVersion: 1
  readonly generatedAt: string
  readonly categories: readonly MarketCategory[]
  readonly featured: readonly MarketFeaturedRef[]
  readonly items: readonly MarketCatalogItem[]
}

/** One installed item as recorded on this machine. */
export interface MarketInstalledRecord {
  readonly kind: MarketKindName
  readonly id: string
  readonly version: string
  readonly sha256: string
  readonly installedAt: string
}

/** Where the catalog came from on the last read. */
export type MarketCatalogSource = 'remote' | 'cache' | 'none'

/** Catalog item as the browser shows it: absolute icon URL plus local install state. */
export interface MarketItemView extends MarketCatalogItem {
  /** Absolute image URL resolved against the catalog URL. */
  readonly iconUrl?: string
  /** Installed version, absent when the item is not installed. */
  readonly installedVersion?: string
}

/** Complete market state sent to the browser. */
export interface MarketSnapshot {
  /** Increases with every change the browser should render. */
  readonly revision: number
  readonly source: MarketCatalogSource
  /** ISO time of the last successful remote read, when there was one. */
  readonly fetchedAt?: string
  /** Why the last remote read failed; absent after a successful read. */
  readonly fetchError?: string
  readonly categories: readonly MarketCategory[]
  readonly featured: readonly MarketFeaturedRef[]
  readonly items: readonly MarketItemView[]
  /** Kinds a domain package handles in this composition. */
  readonly kinds: readonly MarketKindName[]
  /** Items installing right now, as `<kind>:<id>`. */
  readonly installing: readonly string[]
  /** How far each running install has come; an item in `installing` has no entry until its download starts. */
  readonly progress: readonly MarketInstallProgress[]
}

/**
 * Step of one install that reports progress: `download` counts the package bytes received,
 * `unpack` counts the package files written.
 */
export type MarketInstallPhase = 'download' | 'unpack'

/** How far one running install has come. */
export interface MarketInstallProgress {
  /** The item, as `<kind>:<id>` in `installing`. */
  readonly key: string
  readonly phase: MarketInstallPhase
  /** Bytes received or files written so far. */
  readonly done: number
  /** Package size in bytes, or the number of files in the package. */
  readonly total: number
}

/** Install or uninstall target. */
export interface MarketItemRef {
  readonly kind: MarketKindName
  readonly id: string
}
